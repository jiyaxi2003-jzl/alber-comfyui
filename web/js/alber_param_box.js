// Alber 导演台 · 参数折叠框
// ---------------------------------------------------------------------------
// 导演台把 UNET / LoRA / CLIP / VAE / 采样 / 导出 / 性能默认值全都内置成节点控件，
// 光下拉就有二十多个，纵向排开节点轻松破千像素，时间轴反而被挤没了。
//
// 这里把这些 canvas 控件统一收进一个可折叠的「参数框」：
//   · canvas 控件仍然留在 node.widgets 里 —— 序列化、API 提交、工作流兼容完全不变
//   · 只是 computeSize 归零、draw 置空，等于「隐身」而不是「删除」
//   · 真正的界面交给框里的原生 DOM 控件：两列网格，比单列下拉紧凑一半
//   · 框默认收起（只占一行），展开状态记在 node.properties 里，跟着工作流走
//   · 值双向同步：Pika 切换条改 lora_name，框里的下拉跟着变；反之亦然
// ---------------------------------------------------------------------------
import { app } from "../../scripts/app.js";
import { hookMp4Panel, installPreviewColumn } from "./alber_mp4_panel.js";
import { installUiZoom } from "./alber_ui_zoom.js";

// 只接管 Alber 自己的节点。原版 H3DirectorConsole 的界面完全交给原版前端。
const CONSOLE_TYPES = new Set(["AlberH3DirectorConsole"]);

const BOX_CLASS = "alber-param-box";
const PROP_OPEN = "alberParamBoxOpen";

// 收进框里的控件（顺序 = 显示顺序）。
// 名字必须和 director_console.py / director.py / director_common.py 的 INPUT_TYPES 一致。
const GROUPS = [
    {
        id: "model",
        title: "模型加载",
        hint: "基座 · LoRA · 文本编码 · VAE",
        items: [
            "unet_name",
            "weight_dtype",
            "lora_name",
            "lora_strength",
            "clip_name",
            "clip_type",
            "video_vae_name",
            "audio_vae_name",
        ],
    },
    {
        id: "sample",
        title: "采样",
        hint: "调度 · 步数 · 采样器 · shift",
        items: [
            "seed",
            "pika_schedule",
            "sage_attention",
            "steps",
            "sampler",
            "scheduler",
            "shift_video",
            "shift_audio",
        ],
    },
    {
        id: "export",
        title: "导出 MP4",
        hint: "跑完自动落盘 · H.264 + H3 原生音轨",
        items: ["save_mp4", "mp4_dir", "mp4_prefix", "mp4_crf", "mp4_overwrite"],
    },
    {
        id: "perf",
        title: "性能与缓存",
        hint: "显存清理 · 分段缓存 · 调试图层",
        items: [
            "clear_vram_between_segments",
            "clear_vram_before_refine",
            "clear_vram_before_face_refine",
            "cache_frames_codec",
            "export_source_images",
            "export_pre_face_refine",
            "cache_name",
        ],
    },
];

// 纯 canvas 标题条：框里有自己的分组标题，这些留着只是孤零零一条。
const HEADER_WIDGETS = ["bd_grp_sample", "bd_grp_advanced", "bd_grp_perf"];

const ALL_NAMES = (() => {
    const names = [];
    for (const g of GROUPS) for (const n of g.items) if (!names.includes(n)) names.push(n);
    for (const n of HEADER_WIDGETS) if (!names.includes(n)) names.push(n);
    return names;
})();

// ---------------------------------------------------------------- 值自愈
//
// 老工作流里 widgets_values 是按「保存当时的控件顺序」存的数组。前端如果多挂了
// widget（标题条、control_after_generate 之类），旧数组就会整体错位，导出这组的
// 参数会拿到 True / False / "性能" 这种完全不相干的值 —— 实测就跑出过
// G://PC//output//性能//False.mp4。
//
// 这里在加载时做一次兜底纠正：明显不合理的值掰回默认，用户自己填的正常值不动。
const DEFAULT_PREFIX = "Alber导演台";
const DEFAULT_CRF = 18;
const HEADER_TEXTS = new Set(["采样设置", "高级采样", "性能"]);

const EXPORT_FIXERS = {
    save_mp4: (v) => (typeof v === "boolean" ? v : true),
    mp4_prefix: (v) => {
        if (typeof v !== "string") return DEFAULT_PREFIX;
        const t = v.trim();
        // 布尔值被字符串化、或干脆是空串，都不是合法文件名
        if (!t || /^(true|false|none|null|undefined|nan)$/i.test(t)) return DEFAULT_PREFIX;
        return t;
    },
    mp4_dir: (v) => {
        if (typeof v !== "string") return "";
        // 错位时这里会拿到标题条的文字（"性能" / "采样设置" …），那显然不是目录
        if (HEADER_TEXTS.has(v.trim())) return "";
        return v;
    },
    mp4_crf: (v) => {
        const n = Number(v);
        // boolean 会被 Number() 变成 0/1；crf<=0 等于无损，成片体积会爆
        if (typeof v === "boolean" || !Number.isFinite(n) || n < 1 || n > 51) return DEFAULT_CRF;
        return Math.round(n);
    },
    mp4_overwrite: (v) => (typeof v === "boolean" ? v : false),
    sage_attention: (v) => (typeof v === "boolean" ? v : true),
};

// 采样参数一旦错位，后果不是「不好看」而是整条片纯黑：steps 被写成标题文字、
// sampler/scheduler 拿到非法串、pika_schedule 变成空串，跑完采样第一步就 NaN，
// 但流程不报错。这里跟导出参数一样做加载自愈。
function fixSamplingWidgets(node) {
    let fixed = 0;
    const setIfChanged = (w, want, name) => {
        if (!w || want === w.value) return;
        const before = w.value;
        w.value = want;
        try {
            w.callback?.(want, w.canvas, node, [0, 0], null);
        } catch {
            /* 回调不是必需的 */
        }
        fixed += 1;
        console.warn(`[Alber] 采样参数自愈：${name} ${JSON.stringify(before)} → ${JSON.stringify(want)}`);
    };

    const stepsW = widgetByName(node, "steps");
    if (stepsW) {
        const n = Number(stepsW.value);
        if (typeof stepsW.value === "boolean" || !Number.isFinite(n) || n < 1 || n > 200) {
            setIfChanged(stepsW, 25, "steps");
        }
    }

    for (const name of ["sampler", "scheduler"]) {
        const w = widgetByName(node, name);
        if (!w) continue;
        const vals = comboValues(w);
        if (!vals) continue;
        const ok = vals.some((v) => rawValue(v) === w.value);
        if (!ok) setIfChanged(w, rawValue(vals[0]), name);
    }

    const pikaW = widgetByName(node, "pika_schedule");
    if (pikaW) {
        const vals = comboValues(pikaW);
        if (vals) {
            const ok = vals.some((v) => rawValue(v) === pikaW.value);
            // 空串/标题文字 = 错位，回默认「自动（按 LoRA）」，别让它在后端当成 AUTO 以外的意思
            if (!ok) setIfChanged(pikaW, rawValue(vals[0]), "pika_schedule");
        }
    }
    return fixed;
}

function sanitizeExportWidgets(node) {
    let fixed = 0;
    for (const [name, fix] of Object.entries(EXPORT_FIXERS)) {
        const w = widgetByName(node, name);
        if (!w) continue;
        const want = fix(w.value);
        if (want !== w.value) {
            const before = w.value;
            w.value = want;
            try {
                w.callback?.(want, w.canvas, node, [0, 0], null);
            } catch {
                /* 回调不是必需的 */
            }
            fixed += 1;
            console.warn(`[Alber] 导出参数自愈：${name} ${JSON.stringify(before)} → ${JSON.stringify(want)}`);
        }
    }
    fixed += fixSamplingWidgets(node);
    return fixed;
}

// ---------------------------------------------------------------- 通用工具

function widgetByName(node, name) {
    return (node?.widgets || []).find((w) => w && w.name === name) || null;
}

function comboValues(w) {
    let vals = w?.options?.values;
    if (typeof vals === "function") {
        try {
            vals = vals(w);
        } catch {
            vals = null;
        }
    }
    return Array.isArray(vals) && vals.length ? vals : null;
}

/** combo 的选项可能是字符串，也可能是 {value,label} 对象。 */
function rawValue(v) {
    if (v && typeof v === "object") return v.value ?? v.name ?? v;
    return v;
}

function valueLabel(v) {
    if (v && typeof v === "object") {
        const text = v.label ?? v.name ?? v.value;
        return String(text ?? "");
    }
    return String(v ?? "");
}

function sameValue(a, b) {
    if (a === b) return true;
    const x = rawValue(a);
    const y = rawValue(b);
    if (x === y) return true;
    return String(x) === String(y);
}

function controlKind(w) {
    if (comboValues(w)) return "combo";
    if (typeof w.value === "boolean") return "bool";
    if (typeof w.value === "number") return "number";
    return "text";
}

function labelOf(w) {
    const text = w?.label || w?.options?.label || w?.name || "";
    return String(text).trim();
}

/** 三条提交路径都走一遍，兼容不同 ComfyUI 版本的控件实现。 */
function commitWidget(node, widget, value) {
    const old = widget.value;
    if (sameValue(old, value)) return false;
    widget.value = value;
    try {
        widget.callback?.(value, app.canvas, node, null, old);
    } catch {
        /* ignore */
    }
    try {
        node.onWidgetChanged?.(widget.name, value, old, widget);
    } catch {
        /* ignore */
    }
    try {
        node.setDirtyCanvas?.(true, true);
    } catch {
        /* ignore */
    }
    try {
        app.graph?.setDirtyCanvas?.(true, true);
    } catch {
        /* ignore */
    }
    return true;
}

// ---------------------------------------------------------------- 隐身 canvas 控件

function hiddenSize() {
    return [0, -4];
}

function noopDraw() {}

function enforceHidden(w) {
    w.hidden = true;
    if (!w.options) w.options = {};
    w.options.hidden = true;
    w.computeSize = hiddenSize;
    w.draw = noopDraw;
    if (w.element) w.element.style.display = "none";
}

function hideCanvasWidget(w) {
    if (!w) return;
    if (typeof w.computeSize === "function" && !w._alberBoxOrigCompute) {
        w._alberBoxOrigCompute = w.computeSize.bind(w);
    }
    if (typeof w.draw === "function" && w.draw !== noopDraw && !w._alberBoxOrigDraw) {
        w._alberBoxOrigDraw = w.draw;
    }
    w._alberBoxHidden = true;
    enforceHidden(w);
}

/** 上游会在接线变化时把 steps / scheduler 重新显示出来，这里补回去。 */
function guardHidden(node) {
    const list = node?._alberBoxWidgets;
    if (!list || !list.length) return;
    for (const w of list) {
        if (w && w.computeSize !== hiddenSize) enforceHidden(w);
    }
}

function collectWidgets(node) {
    const list = [];
    for (const name of ALL_NAMES) {
        const w = widgetByName(node, name);
        if (w) list.push(w);
    }
    // seed 的「生成前后」联动下拉也一并收进来（框里手动渲染在 seed 行尾）。
    const cag = findControlAfterGenerate(node);
    if (cag && !list.includes(cag)) list.push(cag);
    node._alberBoxWidgets = list;
    return list;
}

function findControlAfterGenerate(node) {
    const seed = widgetByName(node, "seed");
    const links = seed?.linkedWidgets;
    if (Array.isArray(links)) {
        const hit = links.find((l) =>
            /control[_\s]?after[_\s]?generate|生成前后/i.test(String(l?.name || l?.label || ""))
        );
        if (hit) return hit;
    }
    return (node?.widgets || []).find((w) =>
        /control[_\s]?after[_\s]?generate|生成前后/i.test(String(w?.name || ""))
    ) || null;
}

// ---------------------------------------------------------------- 样式

const CSS = `
.${BOX_CLASS}{
  flex:none;width:100%;box-sizing:border-box;
  background:#1d1d24;border-bottom:1px solid #3d3d48;
  font-family:system-ui,"Microsoft YaHei",sans-serif;color:#e2e2e8;font-size:12px;
  user-select:none;
}
.${BOX_CLASS} .apb-head{
  display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;
  padding:6px 10px;cursor:pointer;background:#242430;
  font:inherit;color:inherit;text-align:left;
}
.${BOX_CLASS} .apb-head:hover{background:#2c2c3a}
.${BOX_CLASS} .apb-portbtn{
  all:unset;flex:none;cursor:pointer;padding:2px 9px;border-radius:10px;
  border:1px solid #45455a;background:#2a2a36;color:#9a9aad;
  font-size:10px;line-height:15px;font-family:inherit;transition:all .12s;
}
.${BOX_CLASS} .apb-portbtn:hover{background:#34344a;color:#c9d6ff;border-color:#5a5a74}
.${BOX_CLASS} .apb-portbtn.on{background:#2b4a72;color:#cfe2ff;border-color:#3f7fd6}
.${BOX_CLASS} .apb-caret{
  display:inline-block;width:12px;flex:none;color:#8fa8ff;font-size:11px;
  transition:transform .15s ease;
}
.${BOX_CLASS}.open .apb-caret{transform:rotate(90deg)}
.${BOX_CLASS} .apb-title{font-weight:700;color:#c9d6ff;letter-spacing:.3px;flex:none}
.${BOX_CLASS} .apb-sub{
  color:#8a8a99;font-size:11px;flex:1;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.${BOX_CLASS} .apb-badge{
  flex:none;padding:1px 7px;border-radius:9px;background:#33333f;color:#9fb0e8;
  font-size:10px;line-height:15px;
}
.${BOX_CLASS} .apb-body{display:none;padding:8px 10px 10px;max-height:640px;overflow-y:auto}
.${BOX_CLASS}.open .apb-body{display:block}
.${BOX_CLASS} .apb-group{
  border:1px solid #34343f;border-radius:6px;background:#191920;
  padding:6px 8px 8px;margin-bottom:8px;
}
.${BOX_CLASS} .apb-group:last-child{margin-bottom:0}
.${BOX_CLASS} .apb-gtitle{
  display:flex;align-items:baseline;gap:8px;
  font-weight:700;color:#a8bcf5;font-size:11px;letter-spacing:.4px;
  padding:2px 0 6px;border-bottom:1px dashed #2e2e3a;margin-bottom:6px;
}
.${BOX_CLASS} .apb-ghint{font-weight:400;color:#7e7e8e;font-size:10px}
.${BOX_CLASS} .apb-grid{
  display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));
  gap:5px 14px;
}
.${BOX_CLASS} .apb-row{display:flex;align-items:center;gap:8px;min-width:0}
.${BOX_CLASS} .apb-lbl{
  flex:none;width:100px;color:#a9a9b8;font-size:11px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.${BOX_CLASS} .apb-ctl{
  flex:1;min-width:0;display:flex;align-items:center;gap:5px;
}
.${BOX_CLASS} select,.${BOX_CLASS} input[type=text],.${BOX_CLASS} input[type=number]{
  flex:1;min-width:0;height:22px;box-sizing:border-box;
  background:#151519;color:#e6e6ee;border:1px solid #3a3a47;border-radius:4px;
  padding:0 5px;font-size:11px;font-family:inherit;outline:none;
  user-select:text;
}
.${BOX_CLASS} select{cursor:pointer;padding-right:2px}
.${BOX_CLASS} select:hover,.${BOX_CLASS} input:hover{border-color:#4d4d5e}
.${BOX_CLASS} select:focus,.${BOX_CLASS} input:focus{border-color:#3f7fd6;box-shadow:0 0 0 1px rgba(63,127,214,.35)}
.${BOX_CLASS} input[type=checkbox]{
  appearance:none;width:32px;height:18px;border-radius:9px;background:#3a3a47;
  border:1px solid #4a4a58;position:relative;cursor:pointer;transition:background .12s;flex:none;
}
.${BOX_CLASS} input[type=checkbox]::after{
  content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;
  background:#8b8b9a;transition:transform .12s,background .12s;
}
.${BOX_CLASS} input[type=checkbox]:checked{background:#2b6cb0;border-color:#3f7fd6}
.${BOX_CLASS} input[type=checkbox]:checked::after{transform:translateX(14px);background:#fff}
/* 属性选择器比类选择器更具体，必须写成 input.apb-num 才压得住上面的 flex:1 */
.${BOX_CLASS} input.apb-num{flex:0 0 112px;max-width:112px}
.${BOX_CLASS} .apb-ctl>select.apb-num{flex:0 1 108px;max-width:108px}
.${BOX_CLASS} .apb-flagro{opacity:.45;cursor:not-allowed}
`;

function injectCss() {
    if (document.getElementById("alber-param-box-css")) return;
    const st = document.createElement("style");
    st.id = "alber-param-box-css";
    st.textContent = CSS;
    document.head.appendChild(st);
}

// ---------------------------------------------------------------- 控件构建

function buildCombo(node, w) {
    const sel = document.createElement("select");
    sel.dataset.alberWidget = w.name;
    fillCombo(sel, w);
    sel.addEventListener("change", (e) => {
        e.stopPropagation();
        const vals = comboValues(w);
        const idx = Number(sel.value);
        if (!vals || !Number.isFinite(idx) || vals[idx] === undefined) return;
        commitWidget(node, w, vals[idx]);
    });
    return sel;
}

function fillCombo(sel, w) {
    const vals = comboValues(w) || [];
    sel.innerHTML = "";
    vals.forEach((v, i) => {
        const o = document.createElement("option");
        // 用原始下标做 value：combo 选项可能是 {value,label} 对象，
        // 字符串化会变成 [object Object]，回写时统一取 vals[i] 原对象。
        o.value = String(i);
        const text = valueLabel(v);
        o.textContent = text || String(i);
        if (sameValue(v, w.value)) o.selected = true;
        sel.appendChild(o);
    });
    sel.dataset.alberCount = String(vals.length);
    sel.title = valueLabel(w.value);
}

function buildNumber(node, w) {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.className = "apb-num";
    const o = w.options || {};
    if (o.min != null) inp.min = String(o.min);
    if (o.max != null) inp.max = String(o.max);
    if (o.step != null) inp.step = String(o.step);
    const isInt = Number.isInteger(w.value);
    inp.value = String(w.value ?? 0);
    const apply = () => {
        let v = Number(inp.value);
        if (!Number.isFinite(v)) {
            inp.value = String(w.value ?? 0);
            return;
        }
        if (o.min != null) v = Math.max(Number(o.min), v);
        if (o.max != null) v = Math.min(Number(o.max), v);
        if (isInt) v = Math.round(v);
        if (commitWidget(node, w, v)) inp.value = String(v);
    };
    inp.addEventListener("change", (e) => {
        e.stopPropagation();
        apply();
    });
    inp.addEventListener("blur", apply);
    inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") apply();
    });
    return inp;
}

function buildText(node, w) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = String(w.value ?? "");
    inp.title = String(w.value ?? "");
    // 只有用户真的敲过字才提交。
    // 旧版这里是 blur 无条件提交：控件值若是布尔 false，显示成字符串 "false"，
    // 用户随便点一下框（blur）就把 "false" 写回控件 —— 布尔值被污染成字符串，
    // 于是 mp4_prefix 拿到了 "false"，生成 false.mp4。dirty 标记堵住这条路。
    let dirty = false;
    inp.addEventListener("input", () => {
        dirty = true;
    });
    const apply = () => {
        if (!dirty) return;
        const v = inp.value;
        dirty = false;
        if (commitWidget(node, w, v)) inp.title = v;
    };
    inp.addEventListener("change", (e) => {
        e.stopPropagation();
        apply();
    });
    inp.addEventListener("blur", apply);
    inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") apply();
    });
    return inp;
}

function buildBool(node, w) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !!w.value;
    box.addEventListener("change", (e) => {
        e.stopPropagation();
        commitWidget(node, w, box.checked);
    });
    return box;
}

function buildControl(node, w) {
    const kind = controlKind(w);
    let el;
    if (kind === "combo") el = buildCombo(node, w);
    else if (kind === "bool") el = buildBool(node, w);
    else if (kind === "number") el = buildNumber(node, w);
    else el = buildText(node, w);
    el.dataset.alberKind = kind;
    el.dataset.alberWidget = w.name;
    return el;
}

function buildRow(node, w, extras = []) {
    const row = document.createElement("div");
    row.className = "apb-row";

    const lbl = document.createElement("span");
    lbl.className = "apb-lbl";
    lbl.textContent = labelOf(w);
    lbl.title = w?.options?.tooltip || labelOf(w);
    row.appendChild(lbl);

    const ctl = document.createElement("span");
    ctl.className = "apb-ctl";
    ctl.appendChild(buildControl(node, w));
    for (const extra of extras) {
        if (!extra) continue;
        const sub = buildControl(node, extra);
        sub.classList.add("apb-num");
        sub.dataset.alberExtra = extra.name;
        ctl.appendChild(sub);
    }
    row.appendChild(ctl);
    return row;
}

// ---------------------------------------------------------------- 折叠框

function isOpen(node) {
    return !!node?._alberBoxOpen;
}

/** onConfigure 之后 properties 才恢复，此时要把展开状态读回来。 */
function syncOpenFromProperties(node) {
    try {
        const saved = node?.properties?.[PROP_OPEN];
        if (saved === true || saved === false) node._alberBoxOpen = saved;
    } catch {
        /* ignore */
    }
}

/**
 * 节点高度 = 时间轴内容高度 + 参数框高度。
 *
 * 二十多个控件隐身之后，节点原来保存的高度空着也白占画布，所以这里把节点
 * 收到内容高度。只在切换展开/收起、或首次挂载时明显超课时才动手，
 * 用户手动拉高的尺寸不会被反复抹平。
 *
 * delay：展开/收起后等一帧让 CSS 布局落地，box.offsetHeight 才是真实值。
 * shrinkOnly：首次挂载时只缩不涨 —— 此时编辑器可能还没初始化，
 *   computeSize 偏小，贸然涨高会把节点撑得莫名其妙。
 */
function fitNodeToContent(node, { force = false, delay = 0, shrinkOnly = false } = {}) {
    const run = () => {
        requestAnimationFrame(() => {
            if (!node?.computeSize) return;
            let ideal = 0;
            try {
                ideal = node.computeSize()?.[1] || 0;
            } catch {
                return;
            }
            if (!ideal) return;
            const box = node._alberParamBox;
            const boxH = box && node._alberBoxOpen ? box.offsetHeight || 0 : 0;
            const target = Math.round(ideal + boxH);
            const cur = Math.round(node.size?.[1] || 0);
            if (shrinkOnly && target >= cur) return;
            if (!force && Math.abs(cur - target) < 160) return;
            if (Math.abs(cur - target) < 8) return;
            try {
                node.setSize([node.size?.[0] || 1000, target]);
                node.setDirtyCanvas?.(true, true);
            } catch {
                /* ignore */
            }
        });
    };
    if (delay > 0) setTimeout(run, delay);
    else run();
}

function setOpen(node, open) {
    node._alberBoxOpen = !!open;
    const box = node._alberParamBox;
    if (box) {
        // 箭头方向完全交给 CSS（.open .apb-caret 旋转 90°），不要同时改文本，
        // 否则「▼ + 旋转」会转成反方向。
        box.classList.toggle("open", !!open);
    }
    try {
        if (!node.properties) node.properties = {};
        node.properties[PROP_OPEN] = !!open;
    } catch {
        /* ignore */
    }
    try {
        node.setDirtyCanvas?.(true, true);
    } catch {
        /* ignore */
    }
    // 展开撑高、收起还回画布，两种情况都按「内容 + 框」重算一次
    fitNodeToContent(node, { force: true, delay: open ? 120 : 60 });
}

function refreshBox(node) {
    const box = node._alberParamBox;
    if (!box) return;
    // Pika 切换条改了 lora_name / task_type 之后，把框里的下拉同步过来
    box.querySelectorAll("[data-alber-widget]").forEach((el) => {
        const name = el.dataset.alberWidget;
        const w = widgetByName(node, name);
        if (!w) return;
        // 用户正在操作这个控件时不要去抢它的值
        if (document.activeElement === el) return;
        const kind = el.dataset.alberKind;
        if (kind === "combo") {
            const vals = comboValues(w) || [];
            if (Number(el.dataset.alberCount) !== vals.length) {
                fillCombo(el, w);
                return;
            }
            let idx = -1;
            for (let i = 0; i < vals.length; i += 1) {
                if (sameValue(vals[i], w.value)) {
                    idx = i;
                    break;
                }
            }
            if (idx >= 0 && el.selectedIndex !== idx) el.selectedIndex = idx;
            el.title = valueLabel(w.value);
        } else if (kind === "bool") {
            if (el.checked !== !!w.value) el.checked = !!w.value;
        } else {
            const next = String(w.value ?? "");
            if (el.value !== next) el.value = next;
        }
    });
}

function buildBox(node) {
    const box = document.createElement("div");
    box.className = BOX_CLASS;

    // head 用 div：里面还要嵌「接口」按钮，button 不能套 button
    const head = document.createElement("div");
    head.className = "apb-head";
    head.setAttribute("role", "button");
    head.innerHTML = `
      <span class="apb-caret">▶</span>
      <span class="apb-title">参数面板</span>
      <span class="apb-sub"></span>
      <span class="apb-badge"></span>
      <button type="button" class="apb-portbtn" title="显示/隐藏不用的输入输出接口">接口</button>`;

    const body = document.createElement("div");
    body.className = "apb-body";

    let shown = 0;
    for (const g of GROUPS) {
        const rows = [];
        for (const name of g.items) {
            const w = widgetByName(node, name);
            if (!w) continue;
            const extras = name === "seed" ? [findControlAfterGenerate(node)] : [];
            rows.push(buildRow(node, w, extras));
            shown += 1;
        }
        if (!rows.length) continue;

        const card = document.createElement("div");
        card.className = "apb-group";
        const title = document.createElement("div");
        title.className = "apb-gtitle";
        title.innerHTML = `<span>${g.title}</span><span class="apb-ghint">${g.hint || ""}</span>`;
        const grid = document.createElement("div");
        grid.className = "apb-grid";
        rows.forEach((r) => grid.appendChild(r));
        card.appendChild(title);
        card.appendChild(grid);
        body.appendChild(card);
    }

    head.querySelector(".apb-sub").textContent = GROUPS.filter((g) =>
        g.items.some((n) => widgetByName(node, n))
    )
        .map((g) => g.title)
        .join(" · ");
    head.querySelector(".apb-badge").textContent = `${shown} 项`;

    head.addEventListener("mousedown", (e) => e.stopPropagation());
    head.addEventListener("pointerdown", (e) => e.stopPropagation());
    head.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(node, !isOpen(node));
    });

    // 「接口」按钮：精简 / 全部 切换（alber_ports.js 提供实现）
    const portBtn = head.querySelector(".apb-portbtn");
    const syncPortBtn = () => {
        const all = node._alberPortsAllShown ? node._alberPortsAllShown() : false;
        portBtn.classList.toggle("on", all);
        portBtn.title = all
            ? "当前显示全部接口，点一下收起没用的"
            : "只显示用得到的接口，点一下展开全部";
    };
    portBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    portBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    portBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof node._alberTogglePorts === "function") node._alberTogglePorts();
        syncPortBtn();
    });
    node._alberSyncPortBtn = syncPortBtn;
    syncPortBtn();

    box.addEventListener("mousedown", (e) => e.stopPropagation());
    box.addEventListener("pointerdown", (e) => e.stopPropagation());
    // 框里滚动/拖选不要把画布带走
    box.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    box.appendChild(head);
    box.appendChild(body);
    node._alberParamBox = box;
    box.classList.toggle("open", isOpen(node));
    return box;
}

function installBox(node) {
    const host = node?._minimaxDomWidget?.element;
    if (!host) return false;

    // 先把属于框的 canvas 控件全部隐身（无论展开还是收起，界面上都由 DOM 表达）
    collectWidgets(node).forEach(hideCanvasWidget);

    const existing = host.querySelector(`:scope > .${BOX_CLASS}`);
    if (existing) {
        node._alberParamBox = existing;
        existing.classList.toggle("open", isOpen(node));
        refreshBox(node);
        installPreviewColumn(node);
        installUiZoom(node);
        return true;
    }

    injectCss();
    const box = buildBox(node);

    // 顺序：Pika 切换条 → 参数框 → 时间轴面板
    const pikaBar = host.querySelector(":scope > .alber-pika-bar");
    if (pikaBar) host.insertBefore(box, pikaBar.nextSibling);
    else host.insertBefore(box, host.firstChild);

    refreshBox(node);
    guardHidden(node);
    // 成片预览是节点右侧独立的一列，不参与参数框折叠
    installPreviewColumn(node);
    // 整个导演台支持滚轮缩放（Ctrl+滚轮 或 空白处滚轮）
    installUiZoom(node);

    // 首次挂载：把隐身控件留下的空白还回画布（老工作流的高度里含二十多个控件）。
    // 只缩不涨 —— 此时时间轴编辑器可能还没初始化，computeSize 偏小。
    if (!node._alberBoxFitted) {
        node._alberBoxFitted = true;
        fitNodeToContent(node, { delay: 600, shrinkOnly: true });
        fitNodeToContent(node, { delay: 1400, shrinkOnly: true });
    }
    return true;
}

function hookNode(node) {
    if (node._alberBoxHooked) {
        syncOpenFromProperties(node);
        installBox(node);
        return;
    }
    node._alberBoxHooked = true;

    // 先把错位的导出参数掰回来，再往上挂界面
    setTimeout(() => sanitizeExportWidgets(node), 0);
    setTimeout(() => sanitizeExportWidgets(node), 600);

    // 出片后把 mp4 路径接进预览面板（包装 onExecuted，原逻辑照常执行）
    hookMp4Panel(node);

    // 恢复工作流里记录的展开状态（默认收起，尽量省画布面积）
    node._alberBoxOpen = node?.properties?.[PROP_OPEN] === true;

    let tries = 0;
    const tick = () => {
        // 大工作流里编辑器挂载可能要几秒，给够 60 次 × 150ms
        if (installBox(node) || ++tries > 60) return;
        setTimeout(tick, 150);
    };
    tick();

    // 编辑器重建会清空 host 子节点，补回来
    const host = node._minimaxDomWidget?.element;
    if (host && !host._alberBoxObserver) {
        const mo = new MutationObserver(() => {
            if (!host.querySelector(`:scope > .${BOX_CLASS}`)) {
                installBox(node);
            }
        });
        mo.observe(host, { childList: true });
        host._alberBoxObserver = mo;
    }

    // 外部改控件（Pika 切换条 / 上游同步）时刷新框里的显示
    const origChanged = node.onWidgetChanged;
    node.onWidgetChanged = function (name, ...rest) {
        const out = origChanged?.apply(this, [name, ...rest]);
        if (name === "lora_name" || name === "task_type" || name === "seed") {
            setTimeout(() => refreshBox(this), 0);
        }
        return out;
    };

    // 上游 syncDirectorSchedulerWidgets 会把 steps / scheduler 放回来，这里每帧补刀
    const origDraw = node.onDrawForeground;
    node.onDrawForeground = function () {
        guardHidden(this);
        return origDraw?.apply(this, arguments);
    };
}

app.registerExtension({
    name: "Alber.ParamBox",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        const cls = nodeType?.comfyClass || nodeData?.name || "";
        if (!CONSOLE_TYPES.has(cls)) return;

        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const out = onCreated?.apply(this, arguments);
            hookNode(this);
            return out;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const out = onConfigure?.apply(this, arguments);
            hookNode(this);
            return out;
        };
    },
    async loadedGraphNode(node) {
        const cls = node?.comfyClass || node?.type || "";
        if (CONSOLE_TYPES.has(cls)) hookNode(node);
    },
});
