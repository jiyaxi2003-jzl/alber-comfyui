// Alber 导演台 · 操作区中键平移
// ---------------------------------------------------------------------------
// 导演台的主体是一块 DOM 面板（时间轴 / 素材卡 / 参数框），它整块盖在画布上。
// 鼠标落在这块 DOM 上时，事件不会冒泡到 litegraph 的 canvas，
// 于是 ComfyUI 默认的「中键拖动平移视口」在这片区域完全失效 ——
// 想挪画布得先把鼠标移到节点外面，非常别扭。
//
// 这里在 DOM 宿主上接管中键：自己改 app.canvas.ds.offset，
// 让中键在节点内部任意位置都能拖动画布，和空白处的手感一致。
// ---------------------------------------------------------------------------
import { app } from "../../scripts/app.js";

const CONSOLE_TYPES = new Set(["AlberH3DirectorConsole"]);

function installPan(node) {
    const host = node?._minimaxDomWidget?.element;
    if (!host) return false;
    if (host._alberPanHooked) return true;
    host._alberPanHooked = true;

    let active = false;
    let lastX = 0;
    let lastY = 0;
    let pointerId = null;

    const isMiddle = (e) => e.button === 1;

    const onDown = (e) => {
        if (!isMiddle(e)) return;
        const ds = app.canvas?.ds;
        if (!ds) return;
        // 中键对 DOM 控件本来没有语义，直接吃掉，改成画布平移
        e.preventDefault();
        e.stopPropagation();
        active = true;
        lastX = e.clientX;
        lastY = e.clientY;
        pointerId = e.pointerId;
        try {
            host.setPointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
        host.style.cursor = "grabbing";
    };

    const onMove = (e) => {
        if (!active) return;
        e.preventDefault();
        e.stopPropagation();
        const ds = app.canvas?.ds;
        if (!ds) return;
        const scale = ds.scale || 1;
        ds.offset[0] += (e.clientX - lastX) / scale;
        ds.offset[1] += (e.clientY - lastY) / scale;
        lastX = e.clientX;
        lastY = e.clientY;
        app.canvas.setDirty(true, true);
    };

    const onUp = () => {
        if (!active) return;
        active = false;
        host.style.cursor = "";
        try {
            if (pointerId != null) host.releasePointerCapture(pointerId);
        } catch {
            /* ignore */
        }
        pointerId = null;
    };

    // 捕获阶段先拿：子元素（下拉、输入框、时间轴画布）都抢不走中键
    host.addEventListener("pointerdown", onDown, true);
    host.addEventListener("pointermove", onMove, true);
    host.addEventListener("pointerup", onUp, true);
    host.addEventListener("pointercancel", onUp, true);
    // Windows 上中键还会触发自动滚动 / auxclick，一并屏蔽
    host.addEventListener("mousedown", (e) => {
        if (isMiddle(e)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
    host.addEventListener("auxclick", (e) => {
        if (isMiddle(e)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    return true;
}

function hookNode(node) {
    if (!node) return;
    if (installPan(node)) return;
    let tries = 0;
    const tick = () => {
        if (installPan(node) || ++tries > 60) return;
        setTimeout(tick, 150);
    };
    tick();
}

app.registerExtension({
    name: "Alber.ViewportPan",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        const cls = nodeType?.comfyClass || nodeData?.name || "";
        if (!CONSOLE_TYPES.has(cls)) return;

        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const out = onCreated?.apply(this, arguments);
            hookNode(this);
            return out;
        };
    },
    async loadedGraphNode(node) {
        const cls = node?.comfyClass || node?.type || "";
        if (CONSOLE_TYPES.has(cls)) hookNode(node);
    },
});
