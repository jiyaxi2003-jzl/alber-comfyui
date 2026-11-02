// Alber 导演台 · 滚轮缩放「画布视口」
// ---------------------------------------------------------------------------
// 在导演台面板上滚轮 = 缩放 ComfyUI 画布本身（等同在画布空白处滚轮），
// 节点外框、里面所有内容一起等比放大/缩小，版面关系完全不变。
//
// 实现：把 wheel 事件原样转发给 LiteGraph 的画布元素，让 ComfyUI 用它自己
// 的缩放逻辑（含以鼠标位置为中心、加减速、min/max 限制）。转发后用
// ds.scale 校验——若 ComfyUI 关掉了「滚轮缩放」（只留 ctrl+滚轮或只平移），
// 转发的效果为 0，这时退回直接调 ds.changeScale 手动缩放，保证滚轮一定有反应。
//
// 不做什么：
//   · 不再改 .mmx-host 的 transform / width / height —— 上一版就是这么干的，
//     内层放大但外框不变，内容全溢出去、互相压住。
//   · 落在文本框、可横向滚动的镜头条、时间轴画布内部这些「自己会滚」的地方，
//     普通滚轮不抢，保持原滚动行为；Ctrl/⌘ + 滚轮则强制缩放视口。
//
// 上一版把比例存在 node.properties.alberUiZoom，这里会一并清掉并把残留的
// transform 还原，所以已经存过盘的工作流打开也是正常的。
// ---------------------------------------------------------------------------

import { syncPreviewGeometry } from "./alber_mp4_panel.js";

const LEGACY_PROP = "alberUiZoom";
const HOST_SELECTOR = ".mmx-host";

function hostOf(node) {
    return node?._minimaxDomWidget?.element || null;
}

function lgraphApp() {
    return globalThis.app || globalThis.comfyAPI?.app?.app || null;
}

/** 画布元素：优先 app.canvas.canvas，拿不到就按 ComfyUI 固定 id 找。 */
function canvasElement() {
    const lc = lgraphApp()?.canvas;
    if (lc?.canvas) return lc.canvas;
    return document.getElementById("graph-canvas") || document.querySelector("canvas.litegraph");
}

/** 画布当前缩放（1 = 100%）。 */
export function viewportScale() {
    const s = Number(lgraphApp()?.canvas?.ds?.scale);
    return Number.isFinite(s) && s > 0 ? s : 1;
}

/** 兼容旧调用点：现在没有「UI 缩放」这个概念了，恒为 1。 */
export function uiZoomOf() {
    return 1;
}

/** 清掉上一版遗留的 UI 缩放（transform + 存盘属性）。 */
function clearLegacyScale(node, host) {
    if (host) {
        if (host.dataset) delete host.dataset.alberUiZoom;
        host.style.transform = "";
        host.style.transformOrigin = "";
        host.style.width = "";
        host.style.height = "";
    }
    if (node?.properties && LEGACY_PROP in node.properties) {
        delete node.properties[LEGACY_PROP];
    }
}

let toastTimer = 0;
let toastEl = null;

function showToast(host, scale) {
    try {
        const r = host.getBoundingClientRect();
        if (!toastEl) {
            toastEl = document.createElement("div");
            toastEl.style.cssText = [
                "position:fixed", "z-index:99999", "pointer-events:none",
                "padding:3px 9px", "border-radius:11px",
                "font:600 11px/1.5 system-ui,'Microsoft YaHei',sans-serif",
                "background:rgba(20,20,26,.86)", "color:#d8e2ff",
                "border:1px solid rgba(120,150,255,.5)",
                "transition:opacity .18s ease", "opacity:0",
            ].join(";");
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = `视口 ${Math.round(scale * 100)}%`;
        toastEl.style.left = `${Math.round(r.left + 10)}px`;
        toastEl.style.top = `${Math.round(r.top + 8)}px`;
        toastEl.style.opacity = "1";
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            if (toastEl) toastEl.style.opacity = "0";
        }, 900);
    } catch {
        /* ignore */
    }
}

/**
 * 把 wheel 原样转发给画布元素，让 ComfyUI 用自己那套缩放逻辑处理。
 *
 * 要点：ComfyUI 的 LGraphCanvas.processMouseWheel 里
 *   缩放分支 = (ctrlKey || metaKey且Mac) && !altKey && !shiftKey
 *              或 设置项 mouseWheelScroll === "zoom"
 *   其余情况 = 平移画布（改 ds.offset）
 * 所以这里**强制 ctrlKey=true**，否则在默认设置下转发过去只会平移、不会缩放。
 * 用合成事件不触发浏览器自身缩放，是安全的。
 */
function forwardWheel(e) {
    const el = canvasElement();
    if (!el || typeof WheelEvent !== "function") return null;
    const hasApp = !!lgraphApp()?.canvas?.ds;
    const before = viewportScale();
    const ev = new WheelEvent("wheel", {
        deltaX: Number(e.deltaX) || 0,
        deltaY: Number(e.deltaY) || 0,
        deltaMode: Number(e.deltaMode) || 0,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        // 画布的 wheel 监听就绑在 canvas 元素自身（target 阶段），
        // 不需要冒泡——冒泡反而会惊动别的全局 wheel 监听器。
        bubbles: false,
        cancelable: true,
        composed: false,
    });
    try {
        el.dispatchEvent(ev);
    } catch {
        return null;
    }
    if (!hasApp) return { before, after: before }; // 拿不到 ds 时无法校验，信任画布处理了
    const after = viewportScale();
    if (Math.abs(after - before) < 1e-4) return null;
    return { before, after };
}

/** 转发没生效时，自己按指针位置连续缩放（比 ComfyUI 每格 10% 的阶跃更顺）。 */
function manualZoom(e) {
    const canvas = lgraphApp()?.canvas;
    const ds = canvas?.ds;
    if (!ds || !canvas?.canvas) return null;
    const cur = viewportScale();
    const step = e.shiftKey ? 0.0015 * 2 : 0.0015;
    const dy = Number(e.deltaY) || 0;
    if (!dy) return null;
    const next = Math.min(8, Math.max(0.05, cur * Math.exp(-dy * step)));
    if (Math.abs(next - cur) < 1e-6) return null;

    try {
        // ComfyUI 自己也是直接传 client 坐标，不要减 rect（画布铺满视口）
        if (typeof ds.changeScale === "function") {
            ds.changeScale(next, [e.clientX, e.clientY]);
        } else {
            ds.scale = next;
        }
        canvas.setDirty?.(true, true);
        canvas.draw?.(true, true);
    } catch {
        return null;
    }
    return { before: cur, after: viewportScale() };
}

/** 目标元素是否处在「自己会滚动」的地方——这类地方滚轮不该被抢去缩放视口。 */
function isScrollTarget(target, host) {
    if (!target || typeof target.closest !== "function") return false;
    if (target.closest("textarea, select, .bd-fl2v-shots, canvas")) return true;
    for (let el = target; el && el !== host; el = el.parentElement) {
        if (!el.getClientRects || !el.getClientRects().length) continue;
        const st = getComputedStyle(el);
        const oy = st.overflowY;
        const ox = st.overflowX;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 4) return true;
        if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 4) return true;
    }
    return false;
}

function refresh(node) {
    try {
        syncPreviewGeometry(node);
    } catch {
        /* ignore */
    }
}

function onWheel(e) {
    const host = e.currentTarget;
    const node = host._alberZoomNode;
    if (!node) return;
    const forced = e.ctrlKey || e.metaKey;
    if (!forced && isScrollTarget(e.target, host)) return;
    if (!Number(e.deltaY) && !Number(e.deltaX)) return;

    e.preventDefault();
    e.stopPropagation();

    const res = forwardWheel(e) || manualZoom(e);
    const scale = res?.after ?? viewportScale();
    showToast(host, scale);
    refresh(node);
    // 画布缩放过程中节点 DOM 的 rect 会变，等一帧再校一次版
    requestAnimationFrame(() => refresh(node));
}

/** 挂滚轮缩放（幂等）。 */
export function installUiZoom(node) {
    const host = hostOf(node);
    if (!host) return false;

    // 无论是否已挂过，都先把上一版的 UI 缩放 residue 清掉
    clearLegacyScale(node, host);

    if (host._alberZoomHooked) return false;
    host._alberZoomHooked = true;
    host._alberZoomNode = node;

    host.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return true;
}

export { HOST_SELECTOR };
