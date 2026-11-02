"""H3 Director Console — timeline director with built-in MiniMax H3 model/LoRA loading.

This node is a thin, self-contained wrapper around the upstream ``MiniMaxH3Director``
execution path.  It keeps the full director timeline UI/behavior, but when the
optional ``model`` / ``clip`` / ``video_vae`` / ``audio_vae`` inputs are not wired,
it loads the configured base model, LoRA and VAEs automatically.

External inputs always win.  That makes it possible to insert a Sage Attention
patch (or any other model patch) into the chain by wiring ``model`` explicitly,
while still letting the node load the text encoder and VAEs.
"""

from __future__ import annotations

import logging
import threading

import comfy.sd
import comfy.utils
import folder_paths
import torch

from .director import MiniMaxH3Director
from .console_mp4 import (
    DEFAULT_CRF,
    DEFAULT_DIR,
    DEFAULT_PREFIX,
    pick_export_frames,
    save_timeline_mp4,
)

log = logging.getLogger("Alber-H3-Director-Console")

# Defaults requested for the new console.  The values are intentionally the
# exact filenames used by the reference workflow.
DEFAULT_UNET = "minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors"
DEFAULT_LORA = "pika_h3_flex_ref2va_v1_bf16.safetensors"
DEFAULT_CLIP = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
DEFAULT_VIDEO_VAE = "minimax_h3_video_vae_fp16.safetensors"
DEFAULT_AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"

# The two Pika H3 Flex LoRAs used to steer the shared hybrid base.
PIKA_LORAS = (
    "pika_h3_flex_ref2va_v1_bf16.safetensors",
    "pika_h3_flex_fl2va_v1_bf16.safetensors",
)

# KJNodes provides the actual MiniMax H3 self-attention replacement.  The
# console only orchestrates it so the single-node workflow can use the same
# built-in loader path as everything else.
SAGE_PATCH_NODE_ID = "MiniMaxH3MemoryEfficientSageAttentionPatch"

# ---------------------------------------------------------------------------
# Pika H3 Flex 蒸馏调度
# ---------------------------------------------------------------------------
# Pika 把 H3 的生成器从 50 步蒸馏到 6 步，并且是**按固定 sigma 计划**训练的：
# ManualSigmas 1.0 / 0.972973 / 0.923077 / 0.8 / 0.571429 / 0.333333 / 0（7 个 sigma = 6 步），
# 采样器 lcm，CFG 1.0，LoRA 强度 1.0。
#
# 【务必别写成 1000 / 750 / 500 / ...】H3 是 flow matching，sigma 值域是 0–1；
# 传 1000 级的值会让 DiT 的 timestep 反演整个错位，采样第一步就发散成 NaN，
# 成片是纯黑 mp4（NaN→uint8 静默变 0），而且不报错、帧数音轨全都正常。
# 这套数字直接从官方 Pika H3 Flex 模板的 ManualSigmas 抄过来，不要手改。
PIKA_SIGMAS = (1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0)
PIKA_SAMPLER = "lcm"
PIKA_SCHEDULE_MODES = ["自动（按 LoRA）", "强制 Pika 6 步", "关闭（用步数/调度器）"]


def _use_pika_schedule(mode: str, lora_name: str) -> bool:
    text = str(mode or "").strip()
    if text.startswith("关闭"):
        return False
    if text.startswith("强制"):
        return True
    return "pika" in str(lora_name or "").lower()

_WEIGHT_DTYPES = ["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"]

# One-entry cache for the base UNET.  The key deliberately EXCLUDES the LoRA
# name: switching ref2va <-> fl2va must not re-read the multi-GB base weights,
# it only re-applies a LoRA on top of the already-loaded base.
_unet_cache: dict = {"key": None, "value": None}
_clip_cache: dict = {"key": None, "value": None}
_vae_cache: dict[str, object] = {}
# LoRA tensors are small compared with the base; a tiny LRU keeps the usual
# two-Pika-LoRA ping-pong instant.
_lora_cache: dict = {}
_LORA_CACHE_MAX = 4
_cache_lock = threading.RLock()


def _choices(folder: str, preferred: str) -> list[str]:
    names = list(folder_paths.get_filename_list(folder))
    if preferred and preferred not in names:
        # Keep the default visible even before the model is installed.  Loading
        # then fails with ComfyUI's normal "file not found" message.
        names.insert(0, preferred)
    return names


def _lora_choices() -> list[str]:
    """LoRA dropdown. The two Pika H3 Flex LoRAs are pinned to the top so the
    ref2va / fl2va switch is one click away without scrolling."""
    installed = list(folder_paths.get_filename_list("loras"))
    names = ["None"]
    for pinned in PIKA_LORAS:
        if pinned not in names:
            names.append(pinned)
    for name in installed:
        if name not in names:
            names.append(name)
    return names


def _loader_inputs() -> dict:
    return {
        "unet_name": (
            _choices("diffusion_models", DEFAULT_UNET),
            {
                "label": "UNET 基座",
                "default": DEFAULT_UNET,
                "tooltip": "MiniMax H3 base UNET. Only used when the model input is not connected.",
            },
        ),
        "weight_dtype": (
            _WEIGHT_DTYPES,
            {
                "label": "权重量化",
                "default": "default",
                "tooltip": "UNETLoader weight_dtype. Use default for the int8 hybrid base.",
            },
        ),
        "lora_name": (
            _lora_choices(),
            {
                "label": "LoRA",
                "default": DEFAULT_LORA,
                "tooltip": "LoRA applied to the built-in base model. Choose None to disable.",
            },
        ),
        "lora_strength": (
            "FLOAT",
            {
                "label": "LoRA 强度",
                "default": 1.0,
                "min": -100.0,
                "max": 100.0,
                "step": 0.01,
                "tooltip": "LoRA strength_model. The reference LoRA is a ref2va LoRA; set None/0 for pure T2V.",
            },
        ),
        "clip_name": (
            _choices("text_encoders", DEFAULT_CLIP),
            {
                "label": "CLIP 文本编码",
                "default": DEFAULT_CLIP,
                "tooltip": "Text encoder for MiniMax H3 (CLIPLoader type=minimax).",
            },
        ),
        "clip_type": (
            ["minimax"],
            {
                "label": "CLIP 类型",
                "default": "minimax",
                "tooltip": "MiniMax H3 requires CLIPLoader type=minimax (Qwen3-VL).",
            },
        ),
        "video_vae_name": (
            _choices("vae", DEFAULT_VIDEO_VAE),
            {
                "label": "视频 VAE",
                "default": DEFAULT_VIDEO_VAE,
                "tooltip": "MiniMax H3 video VAE. Only used when video_vae is not connected.",
            },
        ),
        "audio_vae_name": (
            _choices("vae", DEFAULT_AUDIO_VAE),
            {
                "label": "音频 VAE",
                "default": DEFAULT_AUDIO_VAE,
                "tooltip": "MiniMax H3 audio VAE. Only used when audio_vae is not connected.",
            },
        ),
    }


def _load_base_unet(unet_name: str, weight_dtype: str):
    """Load the MiniMax H3 base UNET only (no LoRA)."""
    model_options = {}
    if weight_dtype == "fp8_e4m3fn":
        model_options["dtype"] = torch.float8_e4m3fn
    elif weight_dtype == "fp8_e4m3fn_fast":
        model_options["dtype"] = torch.float8_e4m3fn
        model_options["fp8_optimizations"] = True
    elif weight_dtype == "fp8_e5m2":
        model_options["dtype"] = torch.float8_e5m2

    unet_path = folder_paths.get_full_path_or_raise("diffusion_models", unet_name)
    return comfy.sd.load_diffusion_model(unet_path, model_options=model_options)


def _apply_lora(model, lora_name: str, lora_strength: float):
    """Apply a LoRA on top of an already-loaded base.

    ``load_lora_for_models`` clones the patcher, so the cached base stays intact
    and can be reused for the next LoRA switch.
    """
    if not lora_name or lora_name == "None" or float(lora_strength) == 0.0:
        return model

    with _cache_lock:
        entry = _lora_cache.pop(lora_name, None)
        if entry is None:
            lora_path = folder_paths.get_full_path_or_raise("loras", lora_name)
            entry = comfy.utils.load_torch_file(
                lora_path, safe_load=True, return_metadata=True
            )
        _lora_cache[lora_name] = entry  # LRU touch
        while len(_lora_cache) > _LORA_CACHE_MAX:
            _lora_cache.pop(next(iter(_lora_cache)))

    lora, lora_metadata = entry
    patched, _ = comfy.sd.load_lora_for_models(
        model,
        None,
        lora,
        float(lora_strength),
        0.0,
        lora_metadata=lora_metadata,
    )
    return patched


def _apply_builtin_sage_attention(model):
    """Apply KJNodes' MiniMax H3 memory-efficient Sage Attention patch.

    The node is deliberately optional: if KJNodes is not installed the console
    keeps working with the native attention path and logs a warning.  A real
    failure inside the KJNodes patch is surfaced because silently falling back
    would make the ``Sage 加速`` switch misleading.
    """
    try:
        import nodes as comfy_nodes

        node_cls = getattr(comfy_nodes, "NODE_CLASS_MAPPINGS", {}).get(
            SAGE_PATCH_NODE_ID
        )
    except Exception as exc:
        log.warning(
            "Sage 加速：无法读取 ComfyUI 节点注册表（%s），本次回退原生 attention。",
            exc,
        )
        return model

    if node_cls is None:
        log.warning(
            "Sage 加速已开启，但未找到 %s。请安装/启用 comfyui-kjnodes，"
            "本次回退原生 attention。",
            SAGE_PATCH_NODE_ID,
        )
        return model

    log.info("Applying built-in MiniMax H3 Mem Eff Sage Attention Patch")
    try:
        out = node_cls.execute(model=model)
    except Exception as exc:
        raise RuntimeError(
            f"Sage 加速失败：{exc}。如果不需要加速，请关闭节点里的“Sage 加速”控件。"
        ) from exc

    result = getattr(out, "result", None)
    if result is None:
        result = out if isinstance(out, (tuple, list)) else (out,)
    if not result:
        raise RuntimeError("Sage 加速：KJNodes 加速节点没有返回模型。")
    return result[0]


def _load_clip(clip_name: str, clip_type: str):
    clip_type_enum = getattr(
        comfy.sd.CLIPType, str(clip_type or "minimax").upper(), comfy.sd.CLIPType.MINIMAX
    )
    clip_path = folder_paths.get_full_path_or_raise("text_encoders", clip_name)
    return comfy.sd.load_clip(
        ckpt_paths=[clip_path],
        embedding_directory=folder_paths.get_folder_paths("embeddings"),
        clip_type=clip_type_enum,
    )


def _load_vae(vae_name: str):
    vae_path = folder_paths.get_full_path_or_raise("vae", vae_name)
    sd, metadata = comfy.utils.load_torch_file(vae_path, return_metadata=True)
    vae = comfy.sd.VAE(sd=sd, metadata=metadata)
    vae.throw_exception_if_invalid()
    return vae


def _resolve_models(
    *,
    model,
    clip,
    video_vae,
    audio_vae,
    unet_name: str,
    weight_dtype: str,
    lora_name: str,
    lora_strength: float,
    clip_name: str,
    clip_type: str,
    video_vae_name: str,
    audio_vae_name: str,
    sage_attention: bool = True,
):
    model_from_input = model is not None
    with _cache_lock:
        if model is None:
            # Base key excludes the LoRA: switching LoRA must reuse the base.
            base_key = (unet_name, weight_dtype)
            if _unet_cache["key"] != base_key or _unet_cache["value"] is None:
                log.info(
                    "Loading built-in H3 base: %s (dtype=%s)", unet_name, weight_dtype
                )
                _unet_cache["value"] = _load_base_unet(unet_name, weight_dtype)
                _unet_cache["key"] = base_key
            model = _apply_lora(
                _unet_cache["value"], lora_name, float(lora_strength)
            )

        if clip is None:
            key = (clip_name, clip_type)
            if _clip_cache["key"] != key or _clip_cache["value"] is None:
                log.info("Loading built-in H3 text encoder: %s (%s)", clip_name, clip_type)
                _clip_cache["value"] = _load_clip(clip_name, clip_type)
                _clip_cache["key"] = key
            clip = _clip_cache["value"]

        if video_vae is None:
            if video_vae_name not in _vae_cache:
                log.info("Loading built-in H3 video VAE: %s", video_vae_name)
                _vae_cache[video_vae_name] = _load_vae(video_vae_name)
            video_vae = _vae_cache[video_vae_name]

        if audio_vae is None:
            if audio_vae_name not in _vae_cache:
                log.info("Loading built-in H3 audio VAE: %s", audio_vae_name)
                _vae_cache[audio_vae_name] = _load_vae(audio_vae_name)
            audio_vae = _vae_cache[audio_vae_name]

    if sage_attention:
        if model_from_input:
            log.info(
                "Sage 加速控件已开启，但 model 已外接；使用外部模型链，跳过内置加速。"
            )
        else:
            model = _apply_builtin_sage_attention(model)

    return model, clip, video_vae, audio_vae


class H3DirectorConsole(MiniMaxH3Director):
    """Full timeline director with built-in model/LoRA loaders.

    All upstream optionals (groups, Semantic Bridge, SelfLift, Refine,
    FaceRefine, sigmas) are preserved.  Model/CLIP/VAE inputs are optional; when
    they are missing, the loader widgets above the timeline are used.
    """

    # 一个节点就是出片终点：勾上「导出 MP4」后不必再接 VHS / SaveVideo。
    OUTPUT_NODE = True
    RETURN_TYPES = MiniMaxH3Director.RETURN_TYPES + ("STRING",)
    RETURN_NAMES = MiniMaxH3Director.RETURN_NAMES + ("mp4_path",)
    OUTPUT_IS_LIST = MiniMaxH3Director.OUTPUT_IS_LIST + (False,)

    @classmethod
    def INPUT_TYPES(cls):
        base = MiniMaxH3Director.INPUT_TYPES()
        required = dict(base["required"])
        optional = {}

        # Make the four heavy inputs optional so the node can run standalone.
        for name in ("model", "video_vae", "audio_vae", "clip"):
            optional[name] = required.pop(name)

        # Keep all original optionals after the model slots.
        optional.update(base.get("optional", {}))

        # Appended last on purpose: existing workflows keep every previous
        # widget index, and the frontend reset-by-name logic fills this new
        # boolean with its default.
        optional["sage_attention"] = (
            "BOOLEAN",
            {
                "label": "Sage 加速",
                "default": True,
                "tooltip": (
                    "内置应用 comfyui-kjnodes 的 MiniMax H3 Mem Eff Sage Attention "
                    "Patch，降低显存并加速。需要启用 KJNodes；model 外接时以外部链为准。"
                ),
            },
        )

        # Also appended last (after sage_attention) so old workflows keep their
        # widget indices.  Auto mode needs zero setup: pick a Pika LoRA and the
        # node runs Pika's 6-step distilled schedule instead of 25 generic steps.
        optional["pika_schedule"] = (
            PIKA_SCHEDULE_MODES,
            {
                "label": "Pika 调度",
                "default": PIKA_SCHEDULE_MODES[0],
                "tooltip": (
                    "Pika H3 Flex 是按 6 步固定计划蒸馏的：ManualSigmas "
                    "1.0 / 0.972973 / 0.923077 / 0.8 / 0.571429 / 0.333333 / 0（0–1 值域，"
                    "不是 1000 级 timestep）+ lcm + CFG 1.0。\n"
                    "自动：LoRA 是 Pika 时用 6 步，否则用下面的步数/调度器。\n"
                    "强制/关闭：无视 LoRA 名，强行开或关。\n"
                    "外接 sigmas 口时以你的 sigmas 为准，本项不生效。"
                ),
            },
        )

        # 同样追加在最后：不改变已有工作流的控件索引。
        # 勾上就直接落一个 mp4，接线只剩「一个节点 + 一个 mp4」。
        optional["save_mp4"] = (
            "BOOLEAN",
            {
                "label": "导出 MP4",
                "default": True,
                "tooltip": (
                    "跑完直接在本机 output 目录写出一个 H.264 MP4（带 H3 原生音轨），"
                    "不需要再接 VHS_VideoCombine / SaveVideo。\n"
                    "多段或分段导出时会拼成一整片。"
                ),
            },
        )
        optional["mp4_prefix"] = (
            "STRING",
            {
                "label": "MP4 文件名前缀",
                "default": DEFAULT_PREFIX,
                "multiline": False,
                "tooltip": "相对 output 目录的路径。带 / 会建子目录，例如：Alber/牙膏从中间挤",
            },
        )
        optional["mp4_crf"] = (
            "INT",
            {
                "label": "MP4 画质 CRF",
                "default": DEFAULT_CRF,
                "min": 0,
                "max": 51,
                "step": 1,
                "tooltip": "libx264 的 CRF：数值越小越清晰、文件越大。默认 18，成片建议 16–20。",
            },
        )

        # 保存目录 / 覆盖策略同样追加在最后（保持所有已有控件的索引不变）。
        optional["mp4_dir"] = (
            "STRING",
            {
                "label": "MP4 保存目录",
                "default": DEFAULT_DIR,
                "multiline": False,
                "tooltip": (
                    "留空 = ComfyUI 的 output 目录。\n"
                    "相对路径 = output 下的子目录，例如 成片/牙膏。\n"
                    "绝对路径 = 直接写那里，例如 G:/成片/牙膏。"
                ),
            },
        )
        optional["mp4_overwrite"] = (
            "BOOLEAN",
            {
                "label": "覆盖同名 MP4",
                "default": False,
                "tooltip": (
                    "关闭（默认）：同名文件已存在时自动加 _2 / _3，不会覆盖旧片。\n"
                    "打开：直接覆盖同名文件（播放器正占用时可能失败）。"
                ),
            },
        )

        # Loader widgets first: they render at the top of the node, above the
        # timeline panel.
        merged_required = {}
        merged_required.update(_loader_inputs())
        merged_required.update(required)
        return {
            "required": merged_required,
            "optional": optional,
            "hidden": base.get("hidden", {"unique_id": "UNIQUE_ID"}),
        }

    @classmethod
    def VALIDATE_INPUTS(cls, input_types=None, **kwargs):
        # The upstream validator only checks types for connected inputs; with
        # the model inputs unconnected, input_types lacks them and validation
        # still succeeds.  Delegate so the sigmas / bridge / selflift checks
        # remain intact.
        return MiniMaxH3Director.VALIDATE_INPUTS(input_types=input_types, **kwargs)

    def execute(
        self,
        model=None,
        video_vae=None,
        audio_vae=None,
        clip=None,
        unet_name=DEFAULT_UNET,
        weight_dtype="default",
        lora_name=DEFAULT_LORA,
        lora_strength=1.0,
        clip_name=DEFAULT_CLIP,
        clip_type="minimax",
        video_vae_name=DEFAULT_VIDEO_VAE,
        audio_vae_name=DEFAULT_AUDIO_VAE,
        sage_attention=True,
        pika_schedule=PIKA_SCHEDULE_MODES[0],
        save_mp4=True,
        mp4_prefix=DEFAULT_PREFIX,
        mp4_crf=DEFAULT_CRF,
        mp4_dir=DEFAULT_DIR,
        mp4_overwrite=False,
        **kwargs,
    ):
        model, clip, video_vae, audio_vae = _resolve_models(
            model=model,
            clip=clip,
            video_vae=video_vae,
            audio_vae=audio_vae,
            unet_name=unet_name,
            weight_dtype=weight_dtype,
            lora_name=lora_name,
            lora_strength=lora_strength,
            clip_name=clip_name,
            clip_type=clip_type,
            video_vae_name=video_vae_name,
            audio_vae_name=audio_vae_name,
            sage_attention=sage_attention,
        )

        # Pika Flex 是 6 步蒸馏模型；用 25 步通用调度既慢又偏离训练计划。
        # 只有用户没外接 sigmas 时才接管。
        if kwargs.get("sigmas") is None and _use_pika_schedule(pika_schedule, lora_name):
            kwargs["sigmas"] = PIKA_SIGMAS
            kwargs["sampler"] = PIKA_SAMPLER
            log.info(
                "Pika 6 步调度已启用：lcm + ManualSigmas %s（0–1 值域，忽略步数/调度器控件）",
                " / ".join(f"{float(s):g}" for s in PIKA_SIGMAS),
            )
        else:
            log.info(
                "采样设置：steps=%s sampler=%s scheduler=%s sigmas=%s（Pika 调度=%s）",
                kwargs.get("steps"),
                kwargs.get("sampler"),
                kwargs.get("scheduler"),
                "外接" if kwargs.get("sigmas") is not None else "自动",
                pika_schedule,
            )

        outputs = super().execute(
            model=model,
            video_vae=video_vae,
            audio_vae=audio_vae,
            clip=clip,
            **kwargs,
        )

        # 上游可能返回裸元组，也可能返回 {"ui":..., "result":...}；两种都兼容。
        payload: dict | None = outputs if isinstance(outputs, dict) else None
        result = payload.get("result", ()) if payload is not None else outputs
        if not isinstance(result, tuple):
            result = tuple(result) if isinstance(result, list) else (result,)

        mp4_path = ""
        if save_mp4:
            images = result[0] if len(result) > 0 else None
            audio = result[1] if len(result) > 1 else None
            fps = result[2] if len(result) > 2 else 24
            if isinstance(fps, (list, tuple)):
                fps = fps[0] if fps else 24
            # images 整条 NaN 时（采样发散 / 解码溢出）自动退到二采前的输出，
            # 否则编码出来就是一条纯黑 mp4。
            frames, source = pick_export_frames(result)
            info = save_timeline_mp4(
                images,
                audio,
                fps=float(fps or 24),
                prefix=mp4_prefix,
                crf=mp4_crf,
                save_dir=mp4_dir,
                overwrite=bool(mp4_overwrite),
                frames=frames,
            )
            if info is not None:
                mp4_path = str(info.get("path") or "")
                ui = dict(payload.get("ui") or {}) if payload is not None else {}
                ui["mp4"] = [
                    {
                        "filename": info["filename"],
                        "subfolder": info["subfolder"],
                        "type": info["type"],
                    }
                ]
                # 前端「导出 MP4」组用它刷新预览框 / 打开目录按钮。
                ui["alber_mp4"] = [
                    {
                        "path": str(info.get("path") or ""),
                        "dir": str(info.get("dir") or ""),
                        "filename": str(info.get("filename") or ""),
                        "size": int(info.get("size") or 0),
                        "frames": int(info.get("frames") or 0),
                        "fallback": bool(info.get("fallback")),
                        "width": int(info.get("width") or 0),
                        "height": int(info.get("height") or 0),
                        "warning": str(info.get("warning") or ""),
                    }
                ]
                # 不再写 ui["text"]：那个只读文本条会一直占节点一行，
                # 路径改由参数框里的成片面板显示。
                return {"ui": ui, "result": result + (mp4_path,)}

        if payload is not None:
            payload["result"] = result + (mp4_path,)
            return payload
        return result + (mp4_path,)


__all__ = ["H3DirectorConsole"]
