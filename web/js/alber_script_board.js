// Alber 导演台 · 剧本 → 镜头表
// ---------------------------------------------------------------------------
// 把一段剧本（或一个故事梗概）拆成可直接跑的镜头列表：每镜一条运动提示词
// + 一条首帧画面提示词 + 时长，确认后写进时间轴。
//
// 两条路：
//   ① LLM 拆解 —— 走 /alber/director/script_to_shots。模型配置由本面板自己管
//      （服务 / 地址 / 模型 / Key，存 localStorage），不依赖节点上的任何 widget
//      ——节点那边其实没有 llm_* 这些输入，读也读不到。
//   ② 本地快拆 —— 不接模型，按空行/句号切句再按字数配时长。
//      模型没开、或者只想先把骨架摆出来时用它。
//
// 写时间轴支持「替换全部 / 追加」，用 hooks.newShot 建镜头对象，不直接 import
// minimax_fl2v.js（那边 import 本文件，双向 import 容易踩坑）。
// ---------------------------------------------------------------------------

import { api } from "../../scripts/api.js";
import { isDarkTheme } from "./alber_palette.js";
import { buildLlmRow, initialLlm } from "./alber_llm_config.js";
import { maxDurationSec } from "./minimax_gen_timeline.js";

const STYLE_ID = "alber-sb-style";
const MAX_SHOTS = 40;

let boardEl = null;

export function isScriptBoardOpen() {
    return !!boardEl;
}

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
.alber-sb-mask{position:fixed;inset:0;z-index:100205;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.58);font:12px/1.5 system-ui,"Microsoft YaHei",sans-serif}
.alber-sb-card{width:min(900px,96vw);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;
  border-radius:10px;box-shadow:0 18px 60px rgba(0,0,0,.55);border:1px solid #3a3a44;background:#1e1e22;color:#dcdce4}
.alber-sb-card.light{border-color:#d5d5de;background:#fff;color:#24242c}
.alber-sb-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #31313a;flex:0 0 auto}
.alber-sb-card.light .alber-sb-head{border-bottom-color:#e6e6ee}
.alber-sb-head b{font-size:13px}
.alber-sb-head .sub{opacity:.6;font-size:11px;margin-left:auto;white-space:nowrap;max-width:46%;
  overflow:hidden;text-overflow:ellipsis}
.alber-sb-x{all:unset;cursor:pointer;width:22px;height:22px;line-height:22px;text-align:center;border-radius:6px;opacity:.7}
.alber-sb-x:hover{background:rgba(130,130,160,.22);opacity:1}

.alber-sb-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:auto}
.alber-sb-sec{padding:10px 12px;border-bottom:1px solid #2b2b33}
.alber-sb-card.light .alber-sb-sec{border-bottom-color:#ececf2}
.alber-sb-label{display:flex;align-items:center;gap:6px;font-size:11px;opacity:.72;margin-bottom:5px}
.alber-sb-label .grow{flex:1 1 auto}
.alber-sb-body textarea{width:100%;box-sizing:border-box;border-radius:7px;padding:7px 9px;
  font:12px/1.6 inherit;outline:none;background:#17171a;color:#dcdce4;border:1px solid #3a3a44;resize:vertical}
.alber-sb-card.light .alber-sb-body textarea{background:#f8f8fb;color:#24242c;border-color:#d5d5de}
.alber-sb-body textarea:focus{border-color:#5ec8ff}
.alber-sb-opts{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:flex-end}
.alber-sb-opts label{display:flex;flex-direction:column;gap:3px;font-size:11px;opacity:.85}
.alber-sb-opts input[type=number],.alber-sb-opts input[type=text],.alber-sb-opts select{
  font:11px/1.4 inherit;padding:4px 6px;border-radius:5px;background:#17171a;color:#dcdce4;
  border:1px solid #3a3a44;outline:none;width:78px}
.alber-sb-card.light .alber-sb-opts input,.alber-sb-card.light .alber-sb-opts select{
  background:#f8f8fb;color:#24242c;border-color:#d5d5de}
.alber-sb-opts .wide{width:auto;min-width:200px;flex:1 1 200px}
.alber-sb-opts label.chk{flex-direction:row;align-items:center;gap:5px;padding-bottom:5px;align-self:flex-end}

/* 模型配置行 */
.alber-sb-llm{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:flex-end;margin-top:8px;
  padding:7px 9px;border-radius:7px;background:#141418;border:1px solid #2c2c35}
.alber-sb-card.light .alber-sb-llm{background:#f5f6fa;border-color:#e3e4ec}
.alber-sb-llm label{display:flex;flex-direction:column;gap:2px;font-size:10px;opacity:.75}
.alber-sb-llm input,.alber-sb-llm select{font:11px/1.4 inherit;padding:3px 6px;border-radius:5px;
  background:#1c1c22;color:#dcdce4;border:1px solid #3a3a44;outline:none;box-sizing:border-box}
.alber-sb-card.light .alber-sb-llm input,.alber-sb-card.light .alber-sb-llm select{
  background:#fff;color:#24242c;border-color:#d5d5de}
.alber-sb-llm input:focus,.alber-sb-llm select:focus{border-color:#5ec8ff}
.alber-sb-llm .f-url{flex:1 1 190px;min-width:150px}
.alber-sb-llm .f-url input{width:100%}
.alber-sb-llm .f-model{flex:0 1 168px;min-width:130px}
.alber-sb-llm .f-model select{width:100%}
.alber-sb-llm .f-key{flex:0 1 150px;min-width:120px}
.alber-sb-llm .f-key input{width:100%}
.alber-sb-llm .f-fmt select{width:104px}
.alber-sb-llm .row-btns{display:flex;gap:5px;padding-bottom:1px}

.alber-sb-src{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px}
.alber-sb-btn{all:unset;cursor:pointer;padding:5px 12px;border-radius:7px;font-size:12px;border:1px solid #3f3f4a;
  background:#26262c;color:#dcdce4;white-space:nowrap}
.alber-sb-card.light .alber-sb-btn{background:#f2f2f7;color:#24242c;border-color:#d5d5de}
.alber-sb-btn:hover{border-color:#5ec8ff}
.alber-sb-btn[disabled]{opacity:.45;cursor:default;border-color:#3f3f4a}
.alber-sb-btn.primary{background:#2f6fd0;border-color:#2f6fd0;color:#fff}
.alber-sb-btn.primary:hover{background:#3a7de0}
.alber-sb-card.light .alber-sb-btn.primary{background:#2f6fd0;border-color:#2f6fd0;color:#fff}
.alber-sb-btn.small{padding:3px 8px;font-size:11px}
.alber-sb-btn.busy{opacity:.6;cursor:progress}

.alber-sb-list{display:flex;flex-direction:column;gap:6px;padding:8px 12px 4px;min-height:60px;max-height:46vh;
  overflow:auto}
.alber-sb-row{display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border-radius:7px;
  border:1px solid #2e2e37;background:#1a1a1e}
.alber-sb-card.light .alber-sb-row{border-color:#e2e2ea;background:#fafafd}
.alber-sb-row .no{flex:0 0 24px;font-size:11px;opacity:.7;padding-top:4px;text-align:right}
.alber-sb-row .mid{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px}
.alber-sb-row .mid .ln{display:flex;gap:6px;align-items:flex-start}
.alber-sb-row .k{flex:0 0 52px;font-size:10px;opacity:.55;padding-top:5px}
.alber-sb-row textarea{min-height:32px;max-height:120px;font-size:11px;line-height:1.5;padding:4px 6px}
.alber-sb-row .dur{flex:0 0 62px;display:flex;flex-direction:column;gap:2px;align-items:stretch}
.alber-sb-row .dur input{font:11px/1.4 inherit;width:100%;box-sizing:border-box;padding:3px 5px;border-radius:5px;
  background:#17171a;color:#dcdce4;border:1px solid #3a3a44;outline:none;text-align:center}
.alber-sb-card.light .alber-sb-row .dur input{background:#f8f8fb;color:#24242c;border-color:#d5d5de}
.alber-sb-row .dur span{font-size:9px;opacity:.5;text-align:center}
.alber-sb-row .ops{flex:0 0 auto;display:flex;flex-direction:column;gap:4px}

.alber-sb-empty{padding:18px 12px;text-align:center;opacity:.5;font-size:11px}
.alber-sb-foot{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid #31313a;flex:0 0 auto}
.alber-sb-card.light .alber-sb-foot{border-top-color:#e6e6ee}
.alber-sb-status{font-size:11px;opacity:.78;margin-right:auto;min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.alber-sb-status.err{color:#ff8a8a;opacity:1}
.alber-sb-status.ok{color:#4fff8f;opacity:1}
.alber-sb-card.light .alber-sb-status.ok{color:#178a4b}
`;
    document.head.appendChild(st);
}

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

// ---- LLM 配置：走共享模块 alber_llm_config.js ------------------------------
// 和「提示词扩写」面板用同一份配置（localStorage），填一次两边都有。

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 本地快拆：按空行 → 句末标点切分，再按目标字数合并成镜头。 */
function localSplit(script, { shotCount = 0, minSec, maxSec }) {
    const text = String(script || "").trim();
    if (!text) return [];
    // 先按空行切场，再按句末标点切句
    const paras = text.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
    const sentences = [];
    for (const p of paras.length ? paras : [text]) {
        const parts = p
            .replace(/\r/g, "")
            .split(/(?<=[。！？!?；;…])|\n+/)
            .map((s) => s.trim())
            .filter(Boolean);
        if (parts.length) sentences.push(...parts);
    }
    if (!sentences.length) return [];

    const total = sentences.reduce((n, s) => n + s.length, 0);
    const target = shotCount > 0 ? shotCount : clamp(Math.round(total / 45), 2, 12);
    const per = Math.max(1, Math.ceil(sentences.length / target));

    const groups = [];
    for (let i = 0; i < sentences.length; i += per) {
        groups.push(sentences.slice(i, i + per).join(""));
    }
    // 分组数超了就往回收（把最短的尾巴并进上一组）
    while (groups.length > target && groups.length > 1) {
        groups[groups.length - 2] += groups.pop();
    }

    return groups.slice(0, MAX_SHOTS).map((g) => ({
        prompt: g,
        framePrompt: "",
        // 中文口播大约 4.5 字/秒，再按节点允许的时长钳一下
        durationSec: Number(clamp(g.length / 4.5, minSec, maxSec).toFixed(1)),
    }));
}

/**
 * 打开「剧本 → 分镜」面板。
 * hooks: { newShot(overrides), syncFromShots(editor), refreshDetail(editor) }
 */
export function openScriptBoard(editor, hooks = {}) {
    ensureStyle();
    if (boardEl) return boardEl;
    const dark = isDarkTheme();
    // minDurationSec() 是「模型能生成的最短」≈0.2s，分镜用不着这么短；
    // 这里按创作习惯给 3~10s，再用节点能出的最长时长兜一下。
    const hardMax = Number(maxDurationSec() || 10) || 10;
    const maxSec = Math.min(10, hardMax);
    const minSec = Math.min(3, maxSec);
    const cfg = initialLlm(editor);

    const mask = el("div", "alber-sb-mask");
    const card = el("div", `alber-sb-card${dark ? "" : " light"}`);

    const head = el("div", "alber-sb-head");
    head.appendChild(el("b", null, "剧本 → 分镜表"));
    const sub = el("span", "sub", cfg.model ? `模型 ${cfg.model}` : "未填模型名 · 只能本地快拆");
    head.appendChild(sub);
    const closeBtn = el("button", "alber-sb-x", "×");
    closeBtn.type = "button";
    head.appendChild(closeBtn);

    const body = el("div", "alber-sb-body");

    // ---- 剧本输入 ----
    const srcSec = el("div", "alber-sb-sec");
    const srcLabel = el("div", "alber-sb-label");
    srcLabel.appendChild(el("span", null, "剧本 / 故事梗概"));
    srcLabel.appendChild(el("span", "grow"));
    const charCount = el("span", null, "0 字");
    srcLabel.appendChild(charCount);
    const scriptTa = document.createElement("textarea");
    scriptTa.rows = 5;
    scriptTa.placeholder =
        "把剧本贴进来。可以是一整段故事，也可以按场次分好。\n例：\n雨夜，年轻女人抱着纸袋冲进便利店躲雨，头发湿了一半。\n她抬头，看见货架尽头站着三年前不告而别的男人……";
    scriptTa.spellcheck = false;
    scriptTa.addEventListener("input", () => {
        charCount.textContent = `${scriptTa.value.length} 字`;
    });
    scriptTa.addEventListener("keydown", (e) => e.stopPropagation());

    // ---- 选项 ----
    const numShots = document.createElement("input");
    numShots.type = "number";
    numShots.min = "0";
    numShots.max = String(MAX_SHOTS);
    numShots.value = "0";
    numShots.title = "0 = 让模型按剧情自己定";
    const shotsWrap = el("label");
    shotsWrap.append(el("span", null, "镜头数（0=自动）"), numShots);

    const styleTa = document.createElement("input");
    styleTa.type = "text";
    styleTa.placeholder = "例：都市写实、冷调；女主 25 岁短发、米色风衣";
    styleTa.style.width = "100%";
    const styleWrap = el("label", "wide");
    styleWrap.append(el("span", null, "人物与画风设定（可选）"), styleTa);

    const withFrame = document.createElement("input");
    withFrame.type = "checkbox";
    withFrame.checked = true;
    const withFrameWrap = el("label", "chk");
    withFrameWrap.append(withFrame, el("span", null, "同时给首帧画面提示词"));

    const opts = el("div", "alber-sb-opts");
    opts.append(shotsWrap, styleWrap, withFrameWrap);

    // ---- 模型配置（AI 拆解才需要；和「提示词扩写」共用一份） --------------
    const llmRow = buildLlmRow({
        editor,
        dark,
        onStatus: (txt, kind) => setStatus(txt, kind),
        onModelChange: (m) => {
            sub.textContent = m ? `模型 ${m}` : "未填模型名 · 只能本地快拆";
        },
    });
    const readLlm = llmRow.read;
    const syncHeadModel = () => {
        const m = readLlm().model;
        sub.textContent = m ? `模型 ${m}` : "未填模型名 · 只能本地快拆";
    };
    syncHeadModel();
    // 没填模型时静默探一次，本机 ollama 有模型就直接列出来
    if (!readLlm().model) setTimeout(() => llmRow.probe(true), 60);

    const srcOps = el("div", "alber-sb-src");
    const llmBtn = el("button", "alber-sb-btn primary", "用 AI 拆解");
    const localBtn = el("button", "alber-sb-btn", "本地快拆");
    const clearBtn = el("button", "alber-sb-btn", "清空剧本");
    for (const b of [llmBtn, localBtn, clearBtn]) b.type = "button";
    const rangeTip = el("span", null, `每镜 ${minSec}~${maxSec}s`);
    rangeTip.style.cssText = "font-size:10px;opacity:.5";
    srcOps.append(llmBtn, localBtn, clearBtn, rangeTip);

    srcSec.append(srcLabel, scriptTa, opts, llmRow.el, srcOps);

    // ---- 结果列表 ----
    const listSec = el("div", "alber-sb-sec");
    listSec.style.cssText = "border-bottom:none;display:flex;flex-direction:column;min-height:0";
    const listLabel = el("div", "alber-sb-label");
    listLabel.appendChild(el("span", null, "分镜结果"));
    listLabel.appendChild(el("span", "grow"));
    const listCount = el("span", null, "0 镜");
    listLabel.appendChild(listCount);
    const list = el("div", "alber-sb-list");
    const empty = el("div", "alber-sb-empty", "还没有结果：先贴剧本，再点「用 AI 拆解」或「本地快拆」");
    list.appendChild(empty);
    listSec.append(listLabel, list);

    body.append(srcSec, listSec);

    // ---- 底部 ----
    const foot = el("div", "alber-sb-foot");
    const status = el("span", "alber-sb-status", "");
    const appendBtn = el("button", "alber-sb-btn primary", "追加到时间轴");
    const replaceBtn = el("button", "alber-sb-btn", "替换全部");
    for (const b of [appendBtn, replaceBtn]) b.type = "button";
    appendBtn.disabled = true;
    replaceBtn.disabled = true;
    foot.append(status, replaceBtn, appendBtn);

    card.append(head, body, foot);
    mask.appendChild(card);
    document.body.appendChild(mask);
    boardEl = mask;

    /** 当前结果（可直接编辑） */
    let results = [];
    let busy = false;

    const setStatus = (txt, kind = "") => {
        status.textContent = txt || "";
        status.className = `alber-sb-status${kind ? " " + kind : ""}`;
    };

    const teardown = () => {
        if (busy) return;
        if (boardEl === mask) boardEl = null;
        mask.remove();
        document.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            teardown();
        }
    };
    document.addEventListener("keydown", onKey, true);
    closeBtn.addEventListener("click", teardown);
    mask.addEventListener("pointerdown", (e) => {
        if (e.target === mask) teardown();
    });
    clearBtn.addEventListener("click", () => {
        scriptTa.value = "";
        charCount.textContent = "0 字";
        scriptTa.focus();
    });

    const refreshFooter = () => {
        const has = results.length > 0;
        appendBtn.disabled = !has || busy;
        replaceBtn.disabled = !has || busy;
        listCount.textContent = `${results.length} 镜`;
        empty.style.display = has ? "none" : "";
    };

    const renderResults = () => {
        // 保留空提示占位，其余重建
        list.querySelectorAll(".alber-sb-row").forEach((n) => n.remove());
        results.forEach((shot, i) => {
            const row = el("div", "alber-sb-row");
            const no = el("div", "no", String(i + 1));
            const mid = el("div", "mid");

            const mkLine = (key, label, ph) => {
                const ln = el("div", "ln");
                ln.appendChild(el("span", "k", label));
                const ta = document.createElement("textarea");
                ta.rows = 2;
                ta.value = shot[key] || "";
                ta.placeholder = ph;
                ta.spellcheck = false;
                ta.addEventListener("input", () => {
                    shot[key] = ta.value;
                });
                ta.addEventListener("keydown", (e) => e.stopPropagation());
                ln.appendChild(ta);
                return ln;
            };
            mid.append(
                mkLine("prompt", "运动", "谁、在哪、做什么动作、镜头怎么动、结尾停在哪"),
                mkLine("framePrompt", "首帧", "景别 + 人物外观表情 + 环境光源 + 构图"),
            );

            const durWrap = el("div", "dur");
            const dur = document.createElement("input");
            dur.type = "number";
            dur.step = "0.1";
            dur.min = String(minSec);
            dur.max = String(maxSec);
            dur.value = String(shot.durationSec ?? 5);
            dur.addEventListener("change", () => {
                shot.durationSec = clamp(Number(dur.value) || 5, minSec, maxSec);
                dur.value = String(shot.durationSec);
            });
            dur.addEventListener("keydown", (e) => e.stopPropagation());
            durWrap.append(dur, el("span", null, "秒"));

            const ops = el("div", "ops");
            const delBtn = el("button", "alber-sb-btn small", "删");
            delBtn.type = "button";
            delBtn.title = "删掉这一镜";
            delBtn.addEventListener("click", () => {
                results.splice(i, 1);
                renderResults();
            });
            ops.appendChild(delBtn);

            row.append(no, mid, durWrap, ops);
            list.appendChild(row);
        });
        refreshFooter();
    };

    // ---- 本地快拆 ----
    localBtn.addEventListener("click", () => {
        if (busy) return;
        const out = localSplit(scriptTa.value, {
            shotCount: clamp(parseInt(numShots.value, 10) || 0, 0, MAX_SHOTS),
            minSec,
            maxSec,
        });
        if (!out.length) {
            setStatus("剧本是空的", "err");
            return;
        }
        results = out;
        renderResults();
        setStatus(`本地快拆完成：${out.length} 镜。首帧提示词留空了，可以让 AI 首帧批量补`);
    });

    // ---- LLM 拆解 ----
    llmBtn.addEventListener("click", async () => {
        if (busy) return;
        const script = scriptTa.value.trim();
        if (!script) {
            setStatus("先贴一段剧本", "err");
            return;
        }
        const conf = readLlm();
        llmRow.save();
        if (!conf.model) {
            setStatus("先在上面「模型」里填一个模型名（点「拉模型」会列出本机已有的），或直接用「本地快拆」", "err");
            llmRow.focusModel();
            return;
        }
        busy = true;
        llmBtn.classList.add("busy");
        llmBtn.textContent = "拆解中…";
        appendBtn.disabled = true;
        replaceBtn.disabled = true;
        const t0 = Date.now();
        const timer = setInterval(() => {
            setStatus(`正在拆解… ${Math.round((Date.now() - t0) / 1000)}s（${conf.model}）`);
        }, 1000);
        setStatus(`正在拆解… 0s（${conf.model}）`);
        try {
            const resp = await api.fetchApi("/alber/director/script_to_shots", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    script,
                    shot_count: clamp(parseInt(numShots.value, 10) || 0, 0, MAX_SHOTS),
                    style: styleTa.value.trim(),
                    with_frame_prompt: withFrame.checked,
                    min_seconds: minSec,
                    max_seconds: maxSec,
                    llm_url: conf.llm_url,
                    model: conf.model,
                    api_key: conf.api_key,
                    api_format: conf.api_format,
                    openai_compat_mode: conf.openai_compat_mode,
                }),
            });
            let data = {};
            try {
                data = await resp.json();
            } catch {
                data = {};
            }
            if (!resp.ok || !data.shots?.length) {
                // ComfyUI 对没注册的路径统一回 405/404，这里换成一句人话
                const hint =
                    resp.status === 405 || resp.status === 404
                        ? "接口还没加载：装好新的后端文件后要重启一次 ComfyUI（临时可用「本地快拆」）"
                        : data.error || `HTTP ${resp.status}`;
                throw new Error(hint);
            }
            results = data.shots.map((s) => ({
                prompt: s.prompt || "",
                framePrompt: s.framePrompt || "",
                durationSec: clamp(Number(s.durationSec) || 5, minSec, maxSec),
            }));
            renderResults();
            setStatus(`拆好了：${results.length} 镜 · ${Math.round((Date.now() - t0) / 1000)}s`);
        } catch (err) {
            console.error("[Alber script-board]", err);
            setStatus(`失败：${err?.message || err}`, "err");
        } finally {
            clearInterval(timer);
            busy = false;
            llmBtn.classList.remove("busy");
            llmBtn.textContent = "用 AI 拆解";
            refreshFooter();
        }
    });

    // ---- 写进时间轴 ----
    const applyTo = (mode) => {
        if (!results.length) return;
        const shots = editor?.timeline?.shots || [];
        if (mode === "replace" && shots.length) {
            const ok = confirm(
                `替换会清掉现在这 ${shots.length} 组的提示词和首尾帧，只剩新分镜的 ${results.length} 组。继续？`,
            );
            if (!ok) return;
        }
        const make = hooks.newShot;
        if (typeof make !== "function") {
            setStatus("内部错误：缺少建组函数", "err");
            return;
        }
        const built = results.map((r, i) =>
            make({
                prompt: r.prompt || "",
                framePrompt: r.framePrompt || "",
                durationSec: clamp(Number(r.durationSec) || 5, minSec, maxSec),
                continuityFromPrev: mode === "append" ? (shots.length + i > 0) : i > 0,
            }),
        );
        if (!Array.isArray(editor.timeline.shots)) editor.timeline.shots = [];
        if (mode === "replace") {
            editor.timeline.shots = built;
            editor.selectedIndex = 0;
        } else {
            editor.timeline.shots.push(...built);
            editor.selectedIndex = Math.max(0, editor.timeline.shots.length - built.length);
        }
        hooks.syncFromShots?.(editor);
        editor.commit?.(false, { syncTimeline: true });
        hooks.refreshDetail?.(editor);
        editor.updateVideoNameLabel?.();
        editor.scheduleRender?.();
        editor.updateDomWidgetHeight?.();
        editor.updateRunSelectUI?.();
        setStatus(
            `${mode === "replace" ? "已替换" : "已追加"} ${built.length} 镜 · 首帧提示词已存好，可用「批量出首尾帧」一次出图`,
            "ok",
        );
        setTimeout(teardown, 900);
    };

    appendBtn.addEventListener("click", () => applyTo("append"));
    replaceBtn.addEventListener("click", () => applyTo("replace"));

    renderResults();
    setTimeout(() => scriptTa.focus(), 30);
    return mask;
}
