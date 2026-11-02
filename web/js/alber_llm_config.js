// Alber 导演台 · 共享 LLM 配置
// ---------------------------------------------------------------------------
// 「剧本 → 分镜」和「提示词扩写」共用同一份模型配置，存 localStorage。
//
// 为什么自己存：节点上没有 llm_* 这些输入（Python 端 INPUT_TYPES 里没有，
// /object_info 也查不到），所以 editor.node.widgets 里读 llm_model 永远是空。
// 老的 minimax_prompt_enhancer.js 就是栽在这上面 —— 它写 syncToWidgets 时
// 全落到不存在的 widget 上，配置根本存不下来。
//
// 用法：
//   const row = buildLlmRow({ editor, onStatus, onModelChange });
//   card.append(row.el);
//   row.read()      -> { api_format, llm_url, model, api_key, openai_compat_mode }
//   await row.probe()  -> 模型名数组（同时填进 datalist）
// ---------------------------------------------------------------------------

import { api } from "../../scripts/api.js";

export const LLM_STORE_KEY = "alber.llm.config";
export const API_FORMATS = ["Ollama", "智谱 GLM", "OpenAI Compatible"];
export const FMT_DEFAULT_URL = {
    "Ollama": "http://127.0.0.1:11434/v1",
    "智谱 GLM": "https://open.bigmodel.cn/api/paas/v4",
    "OpenAI Compatible": "http://127.0.0.1:8080/v1",
};
export const FMT_DEFAULT_MODEL = {
    "Ollama": "qwen3.5",
    "智谱 GLM": "glm-4.6v-flash",
    "OpenAI Compatible": "",
};

const STYLE_ID = "alber-llm-cfg-style";

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
.alber-llm-row{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:flex-end;
  padding:7px 9px;border-radius:7px;background:#141418;border:1px solid #2c2c35}
.alber-llm-row.light{background:#f5f6fa;border-color:#e3e4ec}
.alber-llm-row label{display:flex;flex-direction:column;gap:2px;font-size:10px;opacity:.75}
.alber-llm-row input,.alber-llm-row select{font:11px/1.4 inherit;padding:3px 6px;border-radius:5px;
  background:#1c1c22;color:#dcdce4;border:1px solid #3a3a44;outline:none;box-sizing:border-box}
.alber-llm-row.light input,.alber-llm-row.light select{background:#fff;color:#24242c;border-color:#d5d5de}
.alber-llm-row input:focus,.alber-llm-row select:focus{border-color:#5ec8ff}
.alber-llm-row .f-url{flex:1 1 180px;min-width:140px}
.alber-llm-row .f-url input{width:100%}
.alber-llm-row .f-model{flex:0 1 160px;min-width:120px}
.alber-llm-row .f-model input{width:100%}
.alber-llm-row .f-key{flex:0 1 140px;min-width:110px}
.alber-llm-row .f-key input{width:100%}
.alber-llm-row .f-fmt select{width:112px}
.alber-llm-row .row-btns{display:flex;gap:5px;padding-bottom:1px}
.alber-llm-row .mini-btn{all:unset;cursor:pointer;padding:3px 8px;border-radius:5px;font-size:10px;
  border:1px solid #3f3f4a;background:#26262c;color:#dcdce4;white-space:nowrap}
.alber-llm-row.light .mini-btn{background:#f2f2f7;color:#24242c;border-color:#d5d5de}
.alber-llm-row .mini-btn:hover{border-color:#5ec8ff}
.alber-llm-row .mini-btn.busy{opacity:.6;cursor:progress}
`;
    document.head.appendChild(st);
}

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

/** 老节点上可能残留 llm_* widget，有就拿来当初始值。 */
function widgetValue(editor, name, dflt = "") {
    const w = editor?.node?.widgets?.find?.((x) => x?.name === name);
    const v = w?.value;
    return v == null || v === "" ? dflt : v;
}

function nodeLlm(editor) {
    return {
        llm_url: String(widgetValue(editor, "llm_url", "")),
        model: String(widgetValue(editor, "llm_model", "")),
        api_key: String(widgetValue(editor, "llm_api_key", "")),
        api_format: String(widgetValue(editor, "llm_api_format", "")),
    };
}

export function loadLlmPrefs() {
    try {
        const raw = localStorage.getItem(LLM_STORE_KEY);
        const o = raw ? JSON.parse(raw) : null;
        return o && typeof o === "object" ? o : {};
    } catch {
        return {};
    }
}

export function saveLlmPrefs(o) {
    try {
        localStorage.setItem(LLM_STORE_KEY, JSON.stringify(o));
    } catch {
        /* 隐私模式忽略 */
    }
}

/** 初始值：本地保存过 → 节点遗留 widget → 默认。 */
export function initialLlm(editor, extra = {}) {
    const saved = { ...loadLlmPrefs(), ...extra };
    const node = nodeLlm(editor);
    const fmt = API_FORMATS.includes(saved.api_format)
        ? saved.api_format
        : (API_FORMATS.includes(node.api_format) ? node.api_format : API_FORMATS[0]);
    return {
        api_format: fmt,
        llm_url: saved.llm_url || node.llm_url || FMT_DEFAULT_URL[fmt],
        model: saved.model || node.model || "",
        api_key: saved.api_key || node.api_key || "",
        openai_compat_mode: saved.openai_compat_mode || "auto",
    };
}

/**
 * 建一行 LLM 配置：服务 / 地址 / 模型 / Key + 拉模型、测连通。
 * @returns {{ el: HTMLElement, read: () => object, probe: (silent?: boolean) => Promise<string[]>, focusModel: () => void, save: () => void }}
 */
export function buildLlmRow({ editor, prefs, dark = true, onStatus, onModelChange } = {}) {
    ensureStyle();
    const init = prefs || initialLlm(editor);

    const wrap = el("div", `alber-llm-row${dark ? "" : " light"}`);

    const fmtSel = document.createElement("select");
    for (const f of API_FORMATS) {
        const o = document.createElement("option");
        o.value = f;
        o.textContent = f;
        fmtSel.appendChild(o);
    }
    fmtSel.value = init.api_format;

    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.value = init.llm_url || FMT_DEFAULT_URL[init.api_format];
    urlInput.placeholder = FMT_DEFAULT_URL[init.api_format];
    urlInput.spellcheck = false;

    const dlId = `alber-llm-models-${Math.random().toString(36).slice(2, 8)}`;
    const datalist = document.createElement("datalist");
    datalist.id = dlId;
    const modelInput = document.createElement("input");
    modelInput.type = "text";
    modelInput.setAttribute("list", dlId);
    modelInput.value = init.model || "";
    modelInput.placeholder = FMT_DEFAULT_MODEL[init.api_format] || "模型名";
    modelInput.spellcheck = false;

    const keyInput = document.createElement("input");
    keyInput.type = "password";
    keyInput.value = init.api_key || "";
    keyInput.placeholder = "API Key（可选）";
    keyInput.spellcheck = false;

    const fmtWrap = el("label", "f-fmt");
    fmtWrap.append(el("span", null, "服务"), fmtSel);
    const urlWrap = el("label", "f-url");
    urlWrap.append(el("span", null, "地址"), urlInput);
    const modelWrap = el("label", "f-model");
    modelWrap.append(el("span", null, "模型"), modelInput, datalist);
    const keyWrap = el("label", "f-key");
    keyWrap.append(el("span", null, "Key"), keyInput);

    const fetchBtn = el("button", "mini-btn", "拉模型");
    const testBtn = el("button", "mini-btn", "测连通");
    fetchBtn.type = "button";
    testBtn.type = "button";
    const btns = el("div", "row-btns");
    btns.append(fetchBtn, testBtn);

    wrap.append(fmtWrap, urlWrap, modelWrap, keyWrap, btns);

    const read = () => ({
        api_format: fmtSel.value,
        llm_url: (urlInput.value.trim() || FMT_DEFAULT_URL[fmtSel.value] || "").replace(/\/+$/, ""),
        model: modelInput.value.trim(),
        api_key: keyInput.value.trim(),
        openai_compat_mode: "auto",
    });

    const save = () => saveLlmPrefs(read());

    let lastModels = [];
    const probe = async (silent = false) => {
        const c = read();
        if (!silent) onStatus?.(`正在连 ${c.llm_url} …`, "info");
        fetchBtn.classList.add("busy");
        try {
            const resp = await api.fetchApi("/alber/director/enhance_models", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    llm_url: c.llm_url,
                    api_format: c.api_format,
                    openai_compat_mode: c.openai_compat_mode,
                    api_key: c.api_key,
                }),
            });
            let data = {};
            try {
                data = await resp.json();
            } catch {
                data = {};
            }
            if (!resp.ok) {
                onStatus?.(`连不上：${data.error || "HTTP " + resp.status}`, "err");
                return [];
            }
            lastModels = Array.isArray(data.models) ? data.models.map(String) : [];
            datalist.innerHTML = "";
            for (const m of lastModels) {
                const o = document.createElement("option");
                o.value = m;
                datalist.appendChild(o);
            }
            if (!modelInput.value && lastModels.length) {
                modelInput.value = lastModels[0];
                save();
                onModelChange?.(modelInput.value);
            }
            onStatus?.(
                lastModels.length ? `连通，找到 ${lastModels.length} 个模型` : "连通，但没有模型列表",
                "ok",
            );
            return lastModels;
        } catch (err) {
            onStatus?.(`连不上：${err?.message || err}`, "err");
            return [];
        } finally {
            fetchBtn.classList.remove("busy");
        }
    };

    fetchBtn.addEventListener("click", () => probe(false));
    testBtn.addEventListener("click", () => probe(false));

    fmtSel.addEventListener("change", () => {
        const f = fmtSel.value;
        const isDefault = Object.values(FMT_DEFAULT_URL).includes(urlInput.value.trim());
        if (!urlInput.value.trim() || isDefault) urlInput.value = FMT_DEFAULT_URL[f] || "";
        urlInput.placeholder = FMT_DEFAULT_URL[f] || "";
        modelInput.placeholder = FMT_DEFAULT_MODEL[f] || "模型名";
        save();
    });

    const onEdit = () => {
        save();
        onModelChange?.(modelInput.value.trim());
    };
    for (const i of [urlInput, modelInput, keyInput]) {
        i.addEventListener("input", onEdit);
        i.addEventListener("change", onEdit);
    }
    // 面板里的输入不要把按键冒泡给画布快捷键
    for (const i of [fmtSel, urlInput, modelInput, keyInput]) {
        i.addEventListener("keydown", (e) => e.stopPropagation());
    }

    return {
        el: wrap,
        read,
        probe,
        save,
        getModels: () => lastModels,
        focusModel: () => modelInput.focus(),
    };
}
