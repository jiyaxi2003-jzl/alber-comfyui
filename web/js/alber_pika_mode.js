// Alber 导演台 · Pika 双 LoRA 一键切换
// ---------------------------------------------------------------------------
// Alber 导演台（AlberH3DirectorConsole）把 UNET 基座 / LoRA / CLIP / VAE 都内置成
// 节点控件，所以「切 LoRA」= 改本节点自己的 lora_name 控件，不涉及图上追线。
//
// 主模型固定 minimax_h3_hybrid_fl2va_ref2va_b25-49-int8，
// 靠 LoRA 决定走哪条路：
//   pika_h3_flex_ref2va_v1_bf16 → 参考主体（r2v / v2v / rv2v）
//   pika_h3_flex_fl2va_v1_bf16  → 首尾帧 / 文生（t2v / i2v / fl2v）
// 点一下即切换，并同步 task_type，避免「LoRA 和任务模式对不上」把画面跑崩。
// ---------------------------------------------------------------------------
import { app } from "../../scripts/app.js";

// Alber 版有独立节点 ID，所以这里只接管 Alber 自己的节点。
// 本机若同时装了原版 H3 Director Console（H3DirectorConsole），它的节点与面板
// 完全交给原版前端管理，Alber 不去改它的 DOM、也不改它的 LoRA。
// 旧工作流里的 H3DirectorConsole 由 alber_id_migrate.js 在原版缺失时自动换成本 ID。
const CONSOLE_TYPES = new Set(["AlberH3DirectorConsole"]);

const LORAS = {
    ref2va: "pika_h3_flex_ref2va_v1_bf16.safetensors",
    fl2va: "pika_h3_flex_fl2va_v1_bf16.safetensors",
};

const TASK_FOR_MODE = { ref2va: "r2v", fl2va: "fl2v" };
const FL2VA_TASKS = new Set(["t2v", "i2v", "fl2v"]);
const REF2VA_TASKS = new Set(["r2v", "v2v", "rv2v"]);

const BAR_CLASS = "alber-pika-bar";

// ---------------------------------------------------------------- 工具

function modeOfLora(v) {
    if (typeof v !== "string") return "";
    if (/ref2va/i.test(v)) return "ref2va";
    if (/fl2va/i.test(v)) return "fl2va";
    return "";
}

function widgetNamed(node, name) {
    return (node?.widgets || []).find((w) => w.name === name) || null;
}

function comboValues(widget) {
    let vals = widget?.options?.values;
    if (typeof vals === "function") {
        try { vals = vals(widget); } catch { vals = null; }
    }
    return Array.isArray(vals) ? vals : null;
}

/** 三条提交路径都走一遍，兼容不同 ComfyUI 版本的控件实现。 */
function commitWidget(node, widget, value) {
    const old = widget.value;
    widget.value = value;
    try { widget.callback?.(value, app.canvas, node, null, old); } catch { /* ignore */ }
    try { node.onWidgetChanged?.(widget.name, value, old, widget); } catch { /* ignore */ }
    try { node.setDirtyCanvas?.(true, true); } catch { /* ignore */ }
}

function taskKeyOf(value) {
    let v = String(value ?? "").split(",[object Object]", 1)[0].trim();
    for (const sep of [" · ", " — ", " —— ", " - ", " – "]) {
        if (v.includes(sep)) return v.split(sep, 1)[0].trim();
    }
    return v;
}

// ---------------------------------------------------------------- 切换

function applyMode(node, mode) {
    const target = LORAS[mode];
    const loraWidget = widgetNamed(node, "lora_name");
    if (!loraWidget) {
        return { ok: false, msg: "本节点没有 lora_name 控件（不是 Alber 导演台？）" };
    }

    const vals = comboValues(loraWidget);
    if (vals && vals.length && !vals.includes(target)) {
        return {
            ok: false,
            msg: `LoRA 列表里没有 ${target} —— 检查 models/loras/ 下文件名`,
        };
    }

    commitWidget(node, loraWidget, target);

    // 同步任务模式
    let note = "";
    const tw = widgetNamed(node, "task_type");
    if (tw) {
        const key = taskKeyOf(tw.value);
        const mismatch =
            (mode === "ref2va" && FL2VA_TASKS.has(key)) ||
            (mode === "fl2va" && REF2VA_TASKS.has(key));
        if (mismatch) {
            const opts = comboValues(tw) || [];
            const want = TASK_FOR_MODE[mode];
            const label = opts.find((o) => taskKeyOf(o) === want);
            if (label) {
                commitWidget(node, tw, label);
                note = ` · 任务模式已同步为 ${want}`;
            }
        }
    }
    return { ok: true, msg: `已切到 ${target}${note}` };
}

// ---------------------------------------------------------------- UI

const CSS = `
.alber-pika-bar{
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  padding:6px 10px;flex:none;
  background:linear-gradient(180deg,#2a2a33,#22222a);
  border-bottom:1px solid #3d3d48;font-size:12px;color:#e6e6ea;
  font-family:system-ui,"Microsoft YaHei",sans-serif;user-select:none;
}
.alber-pika-bar .ttl{font-weight:700;color:#c9d6ff;letter-spacing:.3px}
.alber-pika-bar .seg{display:flex;border-radius:6px;overflow:hidden;border:1px solid #4a4a58}
.alber-pika-bar button{
  all:unset;cursor:pointer;padding:4px 12px;background:#33333d;color:#d6d6de;
  font-size:12px;line-height:18px;transition:background .12s;
}
.alber-pika-bar button:hover{background:#3f3f4c}
.alber-pika-bar button.on{background:#2b6cb0;color:#fff;font-weight:700}
.alber-pika-bar .info{color:#9a9aa6;font-size:11px;flex:1;min-width:120px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.alber-pika-bar .info.bad{color:#f0a1a1}
.alber-pika-bar .info.good{color:#8fd6a8}
`;

function injectCss() {
    if (document.getElementById("alber-pika-css")) return;
    const st = document.createElement("style");
    st.id = "alber-pika-css";
    st.textContent = CSS;
    document.head.appendChild(st);
}

function refreshBar(node) {
    const bar = node._alberPikaBar;
    if (!bar) return;
    const w = widgetNamed(node, "lora_name");
    const mode = modeOfLora(w?.value);
    bar.querySelectorAll("button[data-mode]").forEach((b) => {
        b.classList.toggle("on", b.dataset.mode === mode);
    });
    const info = bar.querySelector(".info");
    if (!info) return;
    if (w && w.value && w.value !== "None") {
        info.textContent = w.value;
        info.className = "info good";
    } else {
        info.textContent = "未启用 LoRA";
        info.className = "info";
    }
    info.title = w ? `lora_name = ${w.value}` : "";
}

function buildBar(node) {
    const bar = document.createElement("div");
    bar.className = BAR_CLASS;
    bar.innerHTML = `
      <span class="ttl">Pika 模式</span>
      <span class="seg">
        <button data-mode="ref2va">参考主体 ref2va</button>
        <button data-mode="fl2va">首尾帧/文生 fl2va</button>
      </span>
      <span class="info"></span>`;

    bar.addEventListener("mousedown", (e) => e.stopPropagation());
    bar.addEventListener("pointerdown", (e) => e.stopPropagation());

    bar.querySelectorAll("button[data-mode]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const res = applyMode(node, btn.dataset.mode);
            refreshBar(node);
            if (!res.ok) {
                const info = bar.querySelector(".info");
                if (info) { info.textContent = res.msg; info.className = "info bad"; }
            }
        });
    });

    node._alberPikaBar = bar;
    return bar;
}

function installBar(node) {
    const host = node._minimaxDomWidget?.element;
    if (!host) return false;
    if (host.querySelector(`:scope > .${BAR_CLASS}`)) {
        node._alberPikaBar = host.querySelector(`:scope > .${BAR_CLASS}`);
        refreshBar(node);
        return true;
    }
    injectCss();
    const bar = buildBar(node);
    host.prepend(bar);
    refreshBar(node);

    // 切换条占高度，节点补高一次，避免面板底部被裁
    setTimeout(() => {
        if (node._alberBarSized) return;
        const h = bar.offsetHeight || 0;
        if (h <= 0) return;
        node._alberBarSized = true;
        try {
            const [w, nh] = node.size || [1000, 680];
            node.setSize?.([w, nh + h]);
        } catch { /* ignore */ }
    }, 400);

    // 编辑器重建会清子节点，补回来
    if (!host._alberObserver) {
        const mo = new MutationObserver(() => {
            if (!host.querySelector(`:scope > .${BAR_CLASS}`)) {
                host.prepend(buildBar(node));
                refreshBar(node);
            }
        });
        mo.observe(host, { childList: true });
        host._alberObserver = mo;
    }
    return true;
}

function hookNode(node) {
    if (node._alberPikaHooked) return;
    node._alberPikaHooked = true;

    let tries = 0;
    const tick = () => {
        if (installBar(node) || ++tries > 40) return;
        setTimeout(tick, 150);
    };
    tick();

    // 用户手动改下拉时，切换条高亮跟着变
    const origChanged = node.onWidgetChanged;
    node.onWidgetChanged = function (name, value, oldValue, widget) {
        const out = origChanged?.apply(this, arguments);
        if (name === "lora_name") setTimeout(() => refreshBar(this), 0);
        return out;
    };
}

app.registerExtension({
    name: "Alber.PikaModeSwitch",
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
