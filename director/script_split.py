"""剧本 → 镜头表：把一段剧本拆成可直接喂给 H3 的镜头列表。

和提示词扩写（``prompt_enhance_routes``）共用同一套 LLM 配置
（llm_url / llm_model / llm_api_key / llm_api_format），但走独立提示词：
扩写那条链路会把模型输出当成「一条视频提示词」来清洗解析，
JSON 镜头表会被它当噪声吃掉，所以这里直接自己发请求、自己解析 JSON。

对外只有一个路由：``POST /alber/director/script_to_shots``
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import urllib.error
import urllib.request

from aiohttp import web

from ..lib.prompt_enhancer import (
    API_FORMAT_OLLAMA,
    API_FORMAT_ZHIPU,
    DEFAULT_API_FORMAT,
    DEFAULT_OLLAMA_NUM_CTX,
    DEFAULT_OPENAI_COMPAT_MODE,
    _apply_openai_generation_options,
    coerce_llm_model,
    coerce_llm_url,
    default_url_for_format,
    infer_api_format,
    llm_chat_endpoint,
    llm_headers,
    normalize_openai_compat_mode,
)

log = logging.getLogger("ComfyUI-MiniMaxH3-Director.director")

MAX_SCRIPT_CHARS = 20000
MAX_SHOTS = 40
DEFAULT_MIN_SEC = 3.0
DEFAULT_MAX_SEC = 10.0

SYSTEM_PROMPT = """你是短剧导演组的分镜师，负责把剧本拆成可以直接送进 MiniMax H3 图生视频模型的镜头表。

硬性规则：
1. 一个镜头 = 一次生成，只演一件事，5~8 秒内能演完；不要把两个动作塞进同一镜。
2. 每个镜头输出两个字段：
   - "prompt"：给视频模型的运动提示词，中文，60~140 字。必须交代：谁（用「年轻女人/中年男人/小女孩」这类说法，不要写人名代号）、在哪、做什么动作、镜头怎么运动（推/拉/摇/跟/固定）、结尾停在哪里。重点写「怎么动」，不要堆静态画面描写，不要写台词，不要出现 image0 / image1 / 首帧 / 尾帧 这类词。
   - "framePrompt"：这一镜**首帧**的静态画面，中文，40~100 字。只写画面上能看到的东西：景别、人物外观与表情、服装、环境、光源方向、构图。不写动作过程。
3. "durationSec"：这一镜的时长，数字，单位秒，取值 {min_sec}~{max_sec}，按动作量给，不要全部给同一个值。
4. 相邻镜头必须能接上：同一场戏里服装、场景、光线、时间段保持一致；换了场景要在 prompt 里自然带出转场。
5. 人物用固定称呼贯穿全片（例如一直叫「年轻女人」），不要中途换说法。

只输出 JSON，不要解释、不要 Markdown 代码块，格式固定为：
{{"shots":[{{"prompt":"…","framePrompt":"…","durationSec":5}}]}}
"""


def _strip_code_fence(text: str) -> str:
    out = (text or "").strip()
    if out.startswith("```"):
        out = re.sub(r"^```[a-zA-Z]*\s*", "", out)
        out = re.sub(r"\s*```$", "", out)
    return out.strip()


def _find_json_block(text: str) -> str | None:
    """在混杂文字里捞出最外层的 {...} 或 [...]。"""
    s = _strip_code_fence(text)
    for opener, closer in (("{", "}"), ("[", "]")):
        start = s.find(opener)
        end = s.rfind(closer)
        if start != -1 and end > start:
            return s[start : end + 1]
    return None


def parse_shots_json(raw: str) -> list[dict] | None:
    """尽量从模型输出里解析出镜头数组；失败返回 None。"""
    block = _find_json_block(raw)
    if not block:
        return None
    candidates = [block]
    # 有的模型会给 {...} 外面再包一层说明，补一次
    if block.startswith("{"):
        candidates.append(block)
    data = None
    for cand in candidates:
        for attempt in (cand, cand.replace("，", ",").replace("：", ":")):
            try:
                data = json.loads(attempt)
                break
            except Exception:
                data = None
        if data is not None:
            break
    if data is None:
        return None

    if isinstance(data, dict):
        for key in ("shots", "镜头", "shot_list", "list", "data"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
        else:
            # 单镜头对象也收
            if "prompt" in data:
                data = [data]
            else:
                return None
    if not isinstance(data, list):
        return None

    out: list[dict] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        prompt = str(item.get("prompt") or item.get("video_prompt") or item.get("运动提示词") or "").strip()
        frame = str(item.get("framePrompt") or item.get("frame_prompt") or item.get("画面提示词") or "").strip()
        if not prompt and not frame:
            continue
        try:
            dur = float(item.get("durationSec") or item.get("duration") or item.get("时长") or 0)
        except (TypeError, ValueError):
            dur = 0.0
        if not (dur > 0):
            dur = 5.0
        out.append({"prompt": prompt, "framePrompt": frame, "durationSec": round(dur, 1)})
    return out or None


def _call_llm_sync(
    *,
    url: str,
    model: str,
    api_format: str,
    openai_compat_mode: str,
    api_key: str,
    system_prompt: str,
    user_content: str,
    timeout: float = 300.0,
) -> tuple[str | None, str | None]:
    """同步发一次 chat 请求，返回 (文本, 错误)。"""
    endpoint = llm_chat_endpoint(url, api_format)
    payload: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "stream": False,
    }
    if api_format == API_FORMAT_OLLAMA:
        # Ollama 原生 /api/chat 不认 OpenAI 的 max_tokens，要放 options 里；
        # 顺手关掉 think，否则 qwen3 这类模型会把 JSON 塞进 thinking 字段。
        payload["think"] = False
        payload["options"] = {
            "temperature": 0.6,
            "num_predict": 4096,
            "num_ctx": DEFAULT_OLLAMA_NUM_CTX,
        }
    elif api_format == API_FORMAT_ZHIPU:
        payload["temperature"] = 0.6
    else:
        _apply_openai_generation_options(payload, model, max_tokens=4096, temperature=0.6)

    try:
        req = urllib.request.Request(
            endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=llm_headers(api_format, include_json=True, api_key=api_key),
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:400]
        return None, f"HTTP {exc.code} {endpoint}: {body or exc.reason}"
    except Exception as exc:  # noqa: BLE001 - 网络层什么都可能抛
        return None, f"{type(exc).__name__}: {exc} ({endpoint})"

    if isinstance(data, dict) and data.get("error"):
        err = data["error"]
        msg = err.get("message") if isinstance(err, dict) else str(err)
        return None, f"LLM API error: {msg}"

    # Ollama: {"message":{"content":...}} / OpenAI: {"choices":[{"message":{"content":...}}]}
    text = ""
    try:
        msg = data["message"]["content"]
        if isinstance(msg, str):
            text = msg
    except Exception:
        pass
    if not text:
        try:
            text = data["choices"][0]["message"]["content"]
        except Exception:
            text = ""
    if not text:
        return None, "LLM 返回为空（模型可能把内容放进了 thinking 字段）"
    # 去掉 think 块
    text = re.sub(r"<(think|thinking)>.*?</\1>", "", text, flags=re.S | re.I).strip()
    return text, None


def _build_user_content(script: str, shot_count: int | None, style: str, with_frame_prompt: bool) -> str:
    parts = ["【剧本】", script.strip()]
    if style.strip():
        parts += ["", "【人物与画风设定（所有镜头必须遵守）】", style.strip()]
    if shot_count and shot_count > 0:
        parts += ["", f"【镜头数量】请正好拆成 {shot_count} 个镜头。"]
    else:
        parts += ["", "【镜头数量】按剧情自然节奏决定，通常 4～10 个。"]
    if not with_frame_prompt:
        parts += ["", "【输出要求】只需要 prompt 和 durationSec，framePrompt 留空字符串。"]
    return "\n".join(parts)


async def director_script_to_shots(request):
    try:
        data = await request.json()
    except Exception as exc:
        return web.json_response({"error": f"Invalid JSON: {exc}"}, status=400)

    script = str(data.get("script") or "").strip()
    if not script:
        return web.json_response({"error": "剧本为空"}, status=400)
    if len(script) > MAX_SCRIPT_CHARS:
        return web.json_response(
            {"error": f"剧本太长（{len(script)} 字），上限 {MAX_SCRIPT_CHARS} 字，可分段生成"},
            status=400,
        )

    model = coerce_llm_model(str(data.get("model") or data.get("llm_model") or "").strip())
    if not model:
        return web.json_response({"error": "没有可用模型：请先在「提示词扩写」面板里选好模型"}, status=400)

    raw_url = data.get("llm_url") or data.get("ollama_url")
    api_format = infer_api_format(
        raw_url or "",
        data.get("api_format") or data.get("llm_api_format") or DEFAULT_API_FORMAT,
    )
    url = coerce_llm_url(raw_url, default=default_url_for_format(api_format))
    api_key = str(data.get("api_key") or data.get("llm_api_key") or "").strip()
    openai_compat_mode = normalize_openai_compat_mode(
        data.get("openai_compat_mode") or data.get("llm_openai_compat_mode") or DEFAULT_OPENAI_COMPAT_MODE
    )

    min_sec = float(data.get("min_seconds") or data.get("minSeconds") or DEFAULT_MIN_SEC)
    max_sec = float(data.get("max_seconds") or data.get("maxSeconds") or DEFAULT_MAX_SEC)
    if max_sec <= min_sec:
        max_sec = min_sec + 1.0
    try:
        shot_count = int(data.get("shot_count") or data.get("shotCount") or 0)
    except (TypeError, ValueError):
        shot_count = 0
    shot_count = max(0, min(shot_count, MAX_SHOTS))
    style = str(data.get("style") or "")
    with_frame_prompt = data.get("with_frame_prompt")
    if with_frame_prompt is None:
        with_frame_prompt = True

    system_prompt = SYSTEM_PROMPT.format(min_sec=min_sec, max_sec=max_sec)
    user_content = _build_user_content(script, shot_count or None, style, bool(with_frame_prompt))

    last_err: str | None = None
    shots: list[dict] | None = None
    raw_text = ""
    for attempt in range(2):
        prompt = user_content
        if attempt == 1:
            prompt += (
                "\n\n【上一次输出不是合法 JSON】请只输出 {\"shots\":[...]} 这一个 JSON 对象，"
                "不要任何解释文字、不要 Markdown 代码块。"
            )
        raw_text, err = await asyncio.to_thread(
            _call_llm_sync,
            url=url,
            model=model,
            api_format=api_format,
            openai_compat_mode=openai_compat_mode,
            api_key=api_key,
            system_prompt=system_prompt,
            user_content=prompt,
        )
        if err:
            last_err = err
            log.warning("script_to_shots LLM failed (attempt %d): %s", attempt + 1, err)
            # 网络/接口错误重试一次也就够了，不反复打
            if attempt == 1 or "HTTP 4" in err:
                break
            continue
        shots = parse_shots_json(raw_text)
        if shots:
            break
        last_err = f"模型输出不是合法 JSON（前 120 字）：{raw_text[:120]}"
        log.warning("script_to_shots parse failed (attempt %d)", attempt + 1)

    if not shots:
        return web.json_response(
            {"error": last_err or "分镜生成失败", "raw": raw_text[:2000]},
            status=502,
        )

    # 兜底钳制：模型偶尔给出 2 秒或 30 秒
    for s in shots[:MAX_SHOTS]:
        s["durationSec"] = round(max(min_sec, min(max_sec, float(s.get("durationSec") or 5.0))), 1)

    return web.json_response(
        {
            "shots": shots[:MAX_SHOTS],
            "count": len(shots[:MAX_SHOTS]),
            "model": model,
            "api_format": api_format,
        }
    )


def register_script_split_routes(routes, register_route) -> None:
    register_route(routes, "POST", "/alber/director/script_to_shots", director_script_to_shots)
    log.info("MiniMax H3 Director script→shots route registered")
