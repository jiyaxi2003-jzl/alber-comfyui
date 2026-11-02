// Alber 导演台 · 提示词扩写（独立面板）
// ---------------------------------------------------------------------------
// 把原来那个「挂在节点里、从来没被调用过」的 minimax_prompt_enhancer.js 重做成
// 独立浮层：不依赖节点 DOM，也不依赖节点上不存在的 llm_* widget。
//
// 功能：
//   ① 按 MiniMax H3 官方 task 模板扩写提示词（t2v / i2v / fl2v / r2v / v2v / rv2v）
//   ② 批量扩写（逐镜串行，结果先列出，确认后一次性写回）
//   ③ 多语言输出（中文 / English）
//   ④ 角色特征增强（≥300 汉字的详尽外观描述，需要 vision 模型）
//   ⑤ 可查看 / 修改当前任务的官方模板（custom_template）
//
// 后端：全部复用 director/prompt_enhance_routes.py 里已注册的老路由
//   POST /alber/director/enhance         扩写
//   POST /alber/director/enhance_models  列模型
//   POST /alber/director/get_template    取模板
//   POST /alber/director/image_b64       图片转 b64（vision 用）
// ---------------------------------------------------------------------------

import { api } from "../../scripts/api.js";
import { isDarkTheme } from "./alber_palette.js";
import { buildLlmRow, initialLlm } from "./alber_llm_config.js";
import { resolveTaskKey } from "./minimax_gen_timeline.js";

const STYLE_ID = "alber-enh-style";

const TASK_OPTIONS = [
    ["default", "通用（不套模板）"],
    ["t2v", "文生视频 t2v"],
    ["i2v", "图生视频 i2v"],
    ["fl2v", "首尾帧 fl2v"],
    ["r2v", "参考主体 r2v"],
    ["v2v", "视频转视频 v2v"],
    ["rv2v", "参考素材改视频 rv2v"],
];

const LANGS = [
    ["中文", "中文（简体）"],
    ["English", "English（官方推荐）"],
];

// 需要剥掉「完全保持首帧…」包装的任务
const PREFIX_WRAP_TASKS = new Set(["fl2v", "i2v"]);

let rootEl = null;

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
.alber-pe-mask{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.62);
  display:flex;align-items:center;justify-content:center;padding:24px}
.alber-pe-card{width:min(980px,94vw);height:min(760px,90vh);display:flex;flex-direction:column;
  border-radius:12px;background:#1b1b20;color:#dcdce4;border:1px solid #33333d;
  box-shadow:0 24px 70px rgba(0,0,0,.6);overflow:hidden;font:12px/1.55 inherit}
.alber-pe-card.light{background:#fff;color:#24242c;border-color:#dcdce4}

.alber-pe-head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #2b2b33;
  flex:0 0 auto;background:#202027}
.alber-pe-card.light .alber-pe-head{background:#f6f7fa;border-bottom-color:#e6e6ee}
.alber-pe-head b{font-size:13px}
.alber-pe-head .sub{font-size:11px;opacity:.6;margin-left:auto;max-width:46%;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.alber-pe-x{all:unset;cursor:pointer;width:22px;height:22px;line-height:22px;text-align:center;
  border-radius:6px;opacity:.6;font-size:16px}
.alber-pe-x:hover{background:rgba(130,130,160,.22);opacity:1}

.alber-pe-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:8px;
  padding:10px 14px;overflow:auto}

.alber-pe-opts{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:11px}
.alber-pe-opts label{display:flex;flex-direction:column;gap:2px;opacity:.85}
.alber-pe-opts label.chk{flex-direction:row;align-items:center;gap:5px;padding-top:12px}
.alber-pe-opts select{font:11px/1.4 inherit;padding:3px 6px;border-radius:5px;background:#1c1c22;
  color:#dcdce4;border:1px solid #3a3a44;outline:none}
.alber-pe-card.light .alber-pe-opts select{background:#fff;color:#24242c;border-color:#d5d5de}
.alber-pe-opts .grow{flex:1 1 auto}

.alber-pe-btn{all:unset;cursor:pointer;padding:4px 11px;border-radius:6px;font-size:11px;
  border:1px solid #3f3f4a;background:#26262c;color:#dcdce4;white-space:nowrap}
.alber-pe-card.light .alber-pe-btn{background:#f2f2f7;color:#24242c;border-color:#d5d5de}
.alber-pe-btn:hover{border-color:#5ec8ff}
.alber-pe-btn[disabled]{opacity:.45;cursor:default}
.alber-pe-btn.primary{background:#2f6fd0;border-color:#2f6fd0;color:#fff}
.alber-pe-btn.primary:hover{background:#3a7de0}
.alber-pe-btn.busy{opacity:.6;cursor:progress}

.alber-pe-tpl{display:none;flex-direction:column;gap:5px}
.alber-pe-tpl.on{display:flex}
.alber-pe-tpl textarea{width:100%;box-sizing:border-box;min-height:110px;max-height:200px;resize:vertical;
  border-radius:7px;padding:7px 9px;font:11px/1.55 inherit;outline:none;
  background:#141418;color:#cfd6e2;border:1px solid #3a3a44}
.alber-pe-card.light .alber-pe-tpl textarea{background:#f8f8fb;color:#24242c;border-color:#d5d5de}
.alber-pe-tpl .tip{font-size:10px;opacity:.55}

.alber-pe-split{flex:1 1 auto;min-height:180px;display:flex;gap:10px}
.alber-pe-col{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:5px}
.alber-pe-col .cap{display:flex;align-items:center;gap:6px;font-size:11px;opacity:.75}
.alber-pe-col .cap .grow{flex:1 1 auto}
.alber-pe-col textarea{flex:1 1 auto;width:100%;box-sizing:border-box;min-height:120px;resize:none;
  border-radius:8px;padding:8px 10px;font:12px/1.65 inherit;outline:none;
  background:#17171a;color:#dcdce4;border:1px solid #3a3a44}
.alber-pe-card.light .alber-pe-col textarea{background:#f8f8fb;color:#24242c;border-color:#d5d5de}
.alber-pe-col textarea:focus{border-color:#5ec8ff}
.alber-pe-col.out textarea{border-color:#2f6fd0}
.alber-pe-meta{font-size:10px;opacity:.5;display:flex;gap:10px;min-height:14px;align-items:center}

.alber-pe-batch{display:none;flex-direction:column;gap:6px;max-height:260px;overflow:auto;
  padding:8px 10px;border-radius:8px;background:#141418;border:1px solid #2c2c35}
.alber-pe-card.light .alber-pe-batch{background:#f5f6fa;border-color:#e3e4ec}
.alber-pe-batch.on{display:flex}
.alber-pe-brow{display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border-radius:7px;
  border:1px solid #2e2e37;background:#1a1a1e}
.alber-pe-card.light .alber-pe-brow{border-color:#e2e2ea;background:#fff}
.alber-pe-brow .no{flex:0 0 26px;font-size:11px;opacity:.65;padding-top:4px;text-align:right}
.alber-pe-brow .mid{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}
.alber-pe-brow .old{font-size:10px;opacity:.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.alber-pe-brow textarea{width:100%;box-sizing:border-box;min-height:48px;max-height:120px;
  border-radius:6px;padding:5px 7px;font:11px/1.55 inherit;outline:none;
  background:#17171a;color:#dcdce4;border:1px solid #3a3a44;resize:vertical}
.alber-pe-card.light .alber-pe-brow textarea{background:#f8f8fb;color:#24242c;border-color:#d5d5de}
.alber-pe-brow .err{font-size:10px;color:#ff8a8a}
.alber-pe-brow .ok{font-size:10px;color:#4fff8f}
.alber-pe-card.light .alber-pe-brow .ok{color:#178a4b}

.alber-pe-foot{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 14px;
  border-top:1px solid #31313a}
.alber-pe-card.light .alber-pe-foot{border-top-color:#e6e6ee}
.alber-pe-status{font-size:11px;opacity:.78;margin-right:auto;min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.alber-pe-status.err{color:#ff8a8a;opacity:1}
.alber-pe-status.ok{color:#4fff8f;opacity:1}
.alber-pe-card.light .alber-pe-status.ok{color:#178a4b}
.alber-pe-bar{width:120px;height:4px;border-radius:2px;background:#2c2c35;overflow:hidden;flex:0 0 auto}
.alber-pe-bar i{display:block;height:100%;width:0;background:#2f6fd0;transition:width .2s}
`;
    document.head.appendChild(st);
}

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

function opt(value, label) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    return o;
}

/** 去掉 H3 模板给 fl2v/i2v 加的「完全保持首帧…」包裹。 */
function stripWrap(text) {
    let out = String(text || "").trim();
    if (!out) return "";
    const wraps = [
        "完全保持首尾帧。", "完全保持首帧。", "完全保持尾帧。",
        "视频开始完全按照image0的画面，不修改，视频结束完全保持image1的画面。",
        "视频开始完全按照image0的画面，不修改，视频结束完全保持image1。",
        "视频开始完全按照image0的构图，不修改，视频结束完全保持image1。",
        "视频开始完全按照image0的画面，不修改。",
        "视频开始完全按照image0的构图，不修改。",
        "视频结束完全保持image1的画面。",
        "视频结束完全保持image1。",
        "完全保持首尾帧：开头必须是image0，结尾必须是image1。",
        "完全保持首帧：开头必须是image0。",
        "完全保持尾帧：结尾锁定尾帧。",
        "完全保持首尾帧：开头锁定首帧，结尾锁定尾帧。",
        "再次强调：开头锁定image0，结尾锁定image1。",
        "再次强调：开头锁定image0。",
        "再次强调：结尾锁定尾帧。",
        "中间过程：",
    ];
    let changed = true;
    while (changed && out) {
        changed = false;
        for (const w of wraps) {
            if (out.startsWith(w)) {
                out = out.slice(w.length).trim();
                changed = true;
            }
        }
    }
    return out;
}

/**
 * 打开「提示词扩写」面板。
 * hooks: { syncFromShots(editor), refreshDetail(editor), stripPrompt(text) }
 */
export function openEnhanceDialog(editor, hooks = {}) {
    ensureStyle();
    if (rootEl) return rootEl;

    const dark = isDarkTheme();
    const shots = () => editor?.timeline?.shots || [];
    const curIdx = () => {
        const i = Number(editor?.selectedIndex);
        return Number.isFinite(i) && i >= 0 && i < shots().length ? i : 0;
    };
    const strip = (t) => (typeof hooks.stripPrompt === "function" ? hooks.stripPrompt(t) : stripWrap(t));

    const mask = el("div", "alber-pe-mask");
    const card = el("div", `alber-pe-card${dark ? "" : " light"}`);

    // ---- 头部 ----
    const head = el("div", "alber-pe-head");
    head.appendChild(el("b", null, "提示词扩写"));
    const sub = el("span", "sub", "");
    head.appendChild(sub);
    const closeBtn = el("button", "alber-pe-x", "×");
    closeBtn.type = "button";
    head.appendChild(closeBtn);

    const body = el("div", "alber-pe-body");

    // ---- LLM 配置 ----
    const llmRow = buildLlmRow({
        editor,
        dark,
        onStatus: (txt, kind) => setStatus(txt, kind),
        onModelChange: (m) => {
            sub.textContent = m ? `模型 ${m}` : "未填模型名";
        },
    });
    const readLlm = llmRow.read;
    body.appendChild(llmRow.el);

    // ---- 选项 ----
    const taskSel = document.createElement("select");
    for (const [v, l] of TASK_OPTIONS) taskSel.appendChild(opt(v, l));
    {
        // 默认跟着节点当前任务类型走，省得每次都选
        const raw = editor?.getTaskKey?.() || editor?.taskTypeWidget?.value || "";
        const guess = resolveTaskKey(raw);
        taskSel.value = TASK_OPTIONS.some(([v]) => v === guess) ? guess : "fl2v";
    }
    const langSel = document.createElement("select");
    for (const [v, l] of LANGS) langSel.appendChild(opt(v, l));
    langSel.value = "中文";

    const detailCk = el("input");
    detailCk.type = "checkbox";
    detailCk.title = "让模型写出 ≥300 汉字的详尽人物外观（需要 vision 模型 + 参考图更准）";
    const visionCk = el("input");
    visionCk.type = "checkbox";
    visionCk.checked = false;
    visionCk.title = "把当前镜头的首帧/尾帧图一并发给模型（仅 vision 模型有效）";

    const tplBtn = el("button", "alber-pe-btn", "查看模板");
    tplBtn.type = "button";

    const taskWrap = el("label");
    taskWrap.append(el("span", null, "任务模板"), taskSel);
    const langWrap = el("label");
    langWrap.append(el("span", null, "输出语言"), langSel);
    const detailWrap = el("label", "chk");
    detailWrap.append(detailCk, el("span", null, "角色特征增强"));
    const visionWrap = el("label", "chk");
    visionWrap.append(visionCk, el("span", null, "带参考图"));
    const grow = el("span", "grow");

    const optsRow = el("div", "alber-pe-opts");
    optsRow.append(taskWrap, langWrap, detailWrap, visionWrap, grow, tplBtn);
    body.appendChild(optsRow);

    // ---- 模板区 ----
    const tplWrap = el("div", "alber-pe-tpl");
    const tplTa = document.createElement("textarea");
    tplTa.spellcheck = false;
    const tplTip = el("div", "tip", "这是当前任务类型的官方模板。改过之后会作为自定义模板发出去；点「恢复官方」还原。");
    const tplOps = el("div", "alber-pe-opts");
    const restoreBtn = el("button", "alber-pe-btn", "恢复官方");
    restoreBtn.type = "button";
    tplOps.append(restoreBtn);
    tplWrap.append(tplTa, tplOps, tplTip);
    body.appendChild(tplWrap);

    // ---- 左右分栏 ----
    const split = el("div", "alber-pe-split");

    const inCol = el("div", "alber-pe-col");
    const inCap = el("div", "cap");
    inCap.appendChild(el("span", null, "原始提示词"));
    inCap.appendChild(el("span", "grow"));
    const fromCurBtn = el("button", "alber-pe-btn", "取当前镜头");
    const fromCommonBtn = el("button", "alber-pe-btn", "取通用");
    for (const b of [fromCurBtn, fromCommonBtn]) b.type = "button";
    inCap.append(fromCurBtn, fromCommonBtn);
    const srcTa = document.createElement("textarea");
    srcTa.spellcheck = false;
    srcTa.placeholder = "写一句短的就行，比如：\n她推门进来，甩了甩伞上的水，抬头看向货架尽头";
    const inMeta = el("div", "alber-pe-meta");
    inCol.append(inCap, srcTa, inMeta);

    const outCol = el("div", "alber-pe-col out");
    const outCap = el("div", "cap");
    outCap.appendChild(el("span", null, "扩写结果"));
    outCap.appendChild(el("span", "grow"));
    const copyBtn = el("button", "alber-pe-btn", "复制");
    const applyBtn = el("button", "alber-pe-btn primary", "应用到当前镜头");
    for (const b of [copyBtn, applyBtn]) b.type = "button";
    outCap.append(copyBtn, applyBtn);
    const outTa = document.createElement("textarea");
    outTa.spellcheck = false;
    outTa.placeholder = "扩写结果会出现在这里，可以直接改";
    const outMeta = el("div", "alber-pe-meta");
    outCol.append(outCap, outTa, outMeta);

    split.append(inCol, outCol);
    body.appendChild(split);

    // ---- 批量结果 ----
    const batchSec = el("div", "alber-pe-batch");
    body.appendChild(batchSec);

    // ---- 底部 ----
    const foot = el("div", "alber-pe-foot");
    const status = el("span", "alber-pe-status", "");
    const bar = el("div", "alber-pe-bar");
    const barFill = document.createElement("i");
    bar.appendChild(barFill);
    const oneBtn = el("button", "alber-pe-btn primary", "扩写这一条");
    const allBtn = el("button", "alber-pe-btn", "批量扩写全部镜头");
    const stopBtn = el("button", "alber-pe-btn", "停止");
    const applyAllBtn = el("button", "alber-pe-btn primary", "全部应用");
    for (const b of [oneBtn, allBtn, stopBtn, applyAllBtn]) b.type = "button";
    stopBtn.style.display = "none";
    applyAllBtn.style.display = "none";
    foot.append(status, bar, stopBtn, allBtn, applyAllBtn, oneBtn);
    bar.style.display = "none";

    card.append(head, body, foot);
    mask.appendChild(card);
    document.body.appendChild(mask);
    rootEl = mask;

    // ------------------------------------------------------------------
    let busy = false;
    let cancelled = false;
    let batchResults = []; // [{ idx, before, text, error }]
    let officialTemplate = "";
    let templateTaskKey = "";
    let templateLang = "";

    function setStatus(txt, kind = "") {
        status.textContent = txt || "";
        status.className = `alber-pe-status${kind ? " " + kind : ""}`;
    }

    function setBusy(on, label) {
        busy = on;
        oneBtn.disabled = on;
        allBtn.disabled = on;
        tplBtn.disabled = on;
        inCol.querySelectorAll("button").forEach((b) => (b.disabled = on));
        stopBtn.style.display = on ? "" : "none";
        bar.style.display = on ? "" : "none";
        if (on) {
            oneBtn.textContent = label || "扩写中…";
            oneBtn.classList.add("busy");
        } else {
            oneBtn.textContent = "扩写这一条";
            oneBtn.classList.remove("busy");
            barFill.style.width = "0%";
        }
    }

    const tplValue = () => {
        const v = tplTa.value.trim();
        // 和官方模板一样就不必当自定义模板发（省 token）
        return v && v !== officialTemplate.trim() ? v : "";
    };

    async function loadTemplate(force = false) {
        const task = taskSel.value;
        const lang = langSel.value;
        if (!force && task === templateTaskKey && lang === templateLang) return;
        try {
            const resp = await api.fetchApi("/alber/director/get_template", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ task_type: task, output_language: lang }),
            });
            const data = await resp.json().catch(() => ({}));
            if (data.template) {
                officialTemplate = String(data.template);
                tplTa.value = officialTemplate;
                templateTaskKey = task;
                templateLang = lang;
            } else {
                tplTa.value = data.error || "取不到模板";
            }
        } catch (err) {
            tplTa.value = `取不到模板：${err?.message || err}`;
        }
    }

    tplBtn.addEventListener("click", async () => {
        const on = tplWrap.classList.toggle("on");
        tplBtn.textContent = on ? "收起模板" : "查看模板";
        if (on) await loadTemplate();
    });
    restoreBtn.addEventListener("click", () => loadTemplate(true));
    taskSel.addEventListener("change", () => {
        if (tplWrap.classList.contains("on")) loadTemplate(true);
    });
    langSel.addEventListener("change", () => {
        if (tplWrap.classList.contains("on")) loadTemplate(true);
    });

    // ---- 取源文本 ----
    const shotText = (i) => {
        const s = shots()[i];
        return s ? String(s.prompt || "") : "";
    };
    fromCurBtn.addEventListener("click", () => {
        const t = shotText(curIdx());
        if (!t) {
            setStatus("当前镜头还没有提示词", "err");
            return;
        }
        srcTa.value = t;
        setStatus(`已取第 ${curIdx() + 1} 镜的提示词`);
    });
    fromCommonBtn.addEventListener("click", () => {
        const t = String(editor?.timeline?.global?.prompt || editor?.globalPrompt?.value || "");
        if (!t) {
            setStatus("没有通用提示词", "err");
            return;
        }
        srcTa.value = t;
        setStatus("已取通用提示词");
    });

    const syncMeta = () => {
        inMeta.textContent = "";
        inMeta.append(
            el("span", null, `${srcTa.value.length} 字`),
            el("span", null, `第 ${curIdx() + 1} / ${shots().length} 镜`),
        );
        outMeta.textContent = "";
        if (outTa.value) outMeta.append(el("span", null, `${outTa.value.length} 字`));
    };
    srcTa.addEventListener("input", syncMeta);
    outTa.addEventListener("input", syncMeta);

    // ---- 收集参考图（vision） ----
    async function collectImages(idx) {
        if (!visionCk.checked) return { images: [], slots: [] };
        const s = shots()[idx];
        if (!s) return { images: [], slots: [] };
        const files = [];
        if (s.startImage?.imageFile) files.push(s.startImage.imageFile);
        if (s.endImage?.imageFile) files.push(s.endImage.imageFile);
        const images = [];
        const slots = [];
        for (let i = 0; i < files.length; i += 1) {
            try {
                const resp = await api.fetchApi("/alber/director/image_b64", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ filename: files[i] }),
                });
                const data = await resp.json();
                if (data.image) {
                    images.push(String(data.image).replace(/^data:[^,]+,/, ""));
                    slots.push(i + 1);
                }
            } catch {
                /* 单张失败不影响扩写 */
            }
        }
        return { images, slots };
    }

    // ---- 调扩写接口 ----
    async function callEnhance(text, idx) {
        const c = readLlm();
        if (!c.model) throw new Error("没填模型名");
        const task = taskSel.value;
        const { images, slots } = await collectImages(idx);
        const payload = {
            llm_url: c.llm_url,
            model: c.model,
            prompt: text,
            task_type: task,
            api_format: c.api_format,
            openai_compat_mode: c.openai_compat_mode,
            api_key: c.api_key,
            output_language: langSel.value,
            character_feature_enhance: detailCk.checked,
            custom_template: tplValue(),
            images,
            image_num: Math.max(1, images.length),
            source_count: 0,
            ref_slots: slots,
            ref_video_count: 0,
        };
        const resp = await api.fetchApi("/alber/director/enhance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.response) {
            throw new Error(data.error || `HTTP ${resp.status}`);
        }
        const raw = String(data.response);
        const out = PREFIX_WRAP_TASKS.has(task) ? strip(raw) : raw;
        return {
            text: out,
            han: data.han_count,
            detailed: !!data.detailed_mode,
            vision: images.length,
        };
    }

    // ---- 单条扩写 ----
    oneBtn.addEventListener("click", async () => {
        if (busy) return;
        const text = srcTa.value.trim();
        if (!text) {
            setStatus("先写一句提示词，或点「取当前镜头」", "err");
            srcTa.focus();
            return;
        }
        setBusy(true, "扩写中…");
        setStatus(`正在扩写…（${readLlm().model}）`);
        const t0 = Date.now();
        try {
            const r = await callEnhance(text, curIdx());
            outTa.value = r.text;
            syncMeta();
            const bits = [`${Math.round((Date.now() - t0) / 1000)}s`, `${r.text.length} 字`];
            if (r.han) bits.push(`${r.han} 汉字`);
            if (r.detailed) bits.push("角色特征增强");
            if (r.vision) bits.push(`${r.vision} 张参考图`);
            setStatus(`扩写完成 · ${bits.join(" · ")}`, "ok");
        } catch (err) {
            setStatus(`失败：${err?.message || err}`, "err");
        } finally {
            setBusy(false);
        }
    });

    // ---- 应用 ----
    const applyToShot = (idx, text) => {
        const s = shots()[idx];
        if (!s) return false;
        s.prompt = text;
        return true;
    };
    const commitAll = () => {
        hooks.syncFromShots?.(editor);
        hooks.refreshDetail?.(editor);
        editor?.commit?.();
        editor?.scheduleTimelineSync?.(true);
        editor?.scheduleRender?.();
    };

    applyBtn.addEventListener("click", () => {
        const text = outTa.value.trim();
        if (!text) {
            setStatus("结果还是空的", "err");
            return;
        }
        const idx = curIdx();
        if (!applyToShot(idx, text)) {
            setStatus("当前没有可写的镜头", "err");
            return;
        }
        commitAll();
        setStatus(`已写回第 ${idx + 1} 镜`, "ok");
    });

    copyBtn.addEventListener("click", async () => {
        const text = outTa.value;
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            setStatus("已复制", "ok");
        } catch {
            outTa.select();
            document.execCommand?.("copy");
            setStatus("已复制", "ok");
        }
    });

    // ---- 批量 ----
    function renderBatch() {
        batchSec.innerHTML = "";
        if (!batchResults.length) {
            batchSec.classList.remove("on");
            applyAllBtn.style.display = "none";
            return;
        }
        batchSec.classList.add("on");
        for (const r of batchResults) {
            const row = el("div", "alber-pe-brow");
            const no = el("div", "no", String(r.idx + 1));
            const mid = el("div", "mid");
            mid.appendChild(el("div", "old", `原：${r.before || "（空）"}`));
            if (r.error) {
                mid.appendChild(el("div", "err", `失败：${r.error}`));
            } else {
                const ta = document.createElement("textarea");
                ta.value = r.text;
                ta.spellcheck = false;
                ta.addEventListener("input", () => {
                    r.text = ta.value;
                });
                mid.appendChild(ta);
            }
            row.append(no, mid);
            batchSec.appendChild(row);
        }
        applyAllBtn.style.display = "";
    }

    allBtn.addEventListener("click", async () => {
        if (busy) return;
        const list = shots();
        if (!list.length) {
            setStatus("时间轴上还没有镜头", "err");
            return;
        }
        const empty = list.filter((s) => !String(s.prompt || "").trim()).length;
        const msg = `会把 ${list.length} 个镜头逐条发给模型扩写（空提示词的会跳过 ${
            empty ? `，共 ${empty} 个` : ""
        }）。\n结果先列出来，不会直接改时间轴。继续？`;
        if (!confirm(msg)) return;

        setBusy(true, "批量扩写中…");
        cancelled = false;
        batchResults = [];
        renderBatch();
        const targets = list.map((s, i) => ({ s, i })).filter(({ s }) => String(s.prompt || "").trim());
        if (!targets.length) {
            setBusy(false);
            setStatus("所有镜头的提示词都是空的", "err");
            return;
        }
        applyAllBtn.style.display = "none";

        let okCount = 0;
        for (let n = 0; n < targets.length; n += 1) {
            if (cancelled) break;
            const { s, i } = targets[n];
            const before = String(s.prompt || "");
            setStatus(`正在扩写第 ${i + 1} 镜（${n + 1}/${targets.length}）…（${readLlm().model}）`);
            barFill.style.width = `${Math.round((n / targets.length) * 100)}%`;
            try {
                const r = await callEnhance(before, i);
                batchResults.push({ idx: i, before, text: r.text, error: "" });
                okCount += 1;
            } catch (err) {
                batchResults.push({ idx: i, before, text: before, error: String(err?.message || err) });
            }
            renderBatch();
        }
        barFill.style.width = "100%";
        setBusy(false);
        if (cancelled) setStatus(`已停止：完成 ${okCount}/${targets.length}`, "err");
        else setStatus(`批量完成：${okCount}/${targets.length} 成功，确认后点「全部应用」`, okCount ? "ok" : "err");
    });

    stopBtn.addEventListener("click", () => {
        cancelled = true;
        setStatus("正在停止…（当前这条跑完就停）");
    });

    applyAllBtn.addEventListener("click", () => {
        let n = 0;
        for (const r of batchResults) {
            if (r.error) continue;
            if (applyToShot(r.idx, r.text)) n += 1;
        }
        commitAll();
        applyAllBtn.style.display = "none";
        setStatus(`已写回 ${n} 个镜头`, "ok");
    });

    // ---- 关闭 ----
    const teardown = () => {
        if (busy) {
            setStatus("正在跑，等这条结束或点停止", "err");
            return;
        }
        if (rootEl === mask) rootEl = null;
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

    // 初始化
    syncMeta();
    const m = readLlm().model;
    sub.textContent = m ? `模型 ${m}` : "未填模型名";
    if (!m) setTimeout(() => llmRow.probe(true), 60);
    const t0 = shotText(curIdx());
    if (t0) srcTa.value = t0;
    syncMeta();

    return mask;
}

export function closeEnhanceDialog() {
    rootEl?.remove();
    rootEl = null;
}
