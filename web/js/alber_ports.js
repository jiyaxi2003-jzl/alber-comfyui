// Alber 导演台 · 精简接口
// ---------------------------------------------------------------------------
// 导演台有 11 个输入 + 10 个输出。内置加载器之后，model / clip / video_vae /
// audio_vae 全都不接线；输出里 frame_rate / segments / source_images /
// images_pre_refine / face_ok 这些调试口平时也用不到。它们只是把节点
// 上半截撑得满满当当。
//
// 这里的策略是「默认只留用得上的，需要时一键展开」：
//   · 输入：没有连线的一律收起来（一个不留）
//   · 输出：只留 images / audio，以及任何已经接线的口
//   · 参数框头部的「接口」按钮切换「精简 / 全部」
//
// 为什么只裁**末尾连续段**：
//   前端 outputs 的下标就是提交给后端的 output index，
//   删中间任何一个都会让后面所有连线的 origin_slot 与后端 RETURN_TYPES 对不上，
//   接到 mp4_path 的节点会拿到 face_ok。只从尾部裁、且尾部必须全无连线，
//   前面每个口的下标就永远不会变，提交链路完全不受影响。
//   恢复时按原始顺序追加回末尾，下标同样能精确复原。
// ---------------------------------------------------------------------------
import { app } from "../../scripts/app.js";

const CONSOLE_TYPES = new Set(["AlberH3DirectorConsole"]);
const PROP_KEY = "alberShowAllPorts";

// 永远保留的输出口：出片结果，删了节点就没输出了
const KEEP_OUTPUT = new Set(["images", "audio"]);
// 输入口没有必须保留的（全部走内置加载器），需要时点「接口」展开
const KEEP_INPUT = new Set();

const META_KEYS = [
    "name",
    "type",
    "label",
    "localized_name",
    "shape",
    "color_on",
    "color_off",
    "tooltip",
    "hasErrors",
];

function wired(port) {
    if (!port) return false;
    if (Array.isArray(port.links)) return port.links.length > 0;
    return port.link != null;
}

function clonePort(port) {
    const out = {};
    for (const key of META_KEYS) out[key] = port?.[key];
    return out;
}

function makePort(def, kind) {
    const port = clonePort(def);
    port.pos = [0, 0];
    if (kind === "in") port.link = null;
    else port.links = [];
    return port;
}

function portsOf(node, kind) {
    return kind === "in" ? node.inputs : node.outputs;
}

/** 快照只在「端口最多的那次」更新，避免把自己裁完的残缺状态当成原始定义。 */
function refreshSnap(node) {
    const inN = node.inputs?.length || 0;
    const outN = node.outputs?.length || 0;
    const snap = node._alberPortSnap;
    if (snap && inN + outN < snap.inputs.length + snap.outputs.length) return snap;
    node._alberPortSnap = {
        inputs: (node.inputs || []).map(clonePort),
        outputs: (node.outputs || []).map(clonePort),
    };
    return node._alberPortSnap;
}

function trimTail(node, kind, keep) {
    const arr = portsOf(node, kind);
    if (!arr?.length) return 0;
    let last = -1;
    arr.forEach((p, i) => {
        if (wired(p) || keep.has(p.name)) last = i;
    });
    let removed = 0;
    for (let i = arr.length - 1; i > last; i -= 1) {
        if (wired(arr[i])) break; // 双保险：已连线绝不删
        arr.splice(i, 1);
        removed += 1;
    }
    return removed;
}

function restoreTail(node, kind, defs) {
    const arr = portsOf(node, kind);
    if (!arr || !defs?.length) return 0;
    const have = new Set(arr.map((p) => p.name));
    let added = 0;
    // 只裁过尾部，所以按原始顺序 push 回去，下标必然复原
    for (const def of defs) {
        if (have.has(def.name)) continue;
        arr.push(makePort(def, kind));
        added += 1;
    }
    return added;
}

function applyPorts(node) {
    if (!node) return;
    const snap = refreshSnap(node);
    if (!snap) return;
    const showAll = node.properties?.[PROP_KEY] === true;
    node._alberShowAll = showAll;

    if (showAll) {
        restoreTail(node, "in", snap.inputs);
        restoreTail(node, "out", snap.outputs);
    } else {
        trimTail(node, "in", KEEP_INPUT);
        trimTail(node, "out", KEEP_OUTPUT);
    }
    try {
        node._alberSyncPortBtn?.();
    } catch {
        /* ignore */
    }
    try {
        node.setDirtyCanvas?.(true, true);
    } catch {
        /* ignore */
    }
}

/** 给参数框头部按钮用：返回当前是否「全部展开」。 */
function isAllShown(node) {
    return node?.properties?.[PROP_KEY] === true;
}

function togglePorts(node) {
    if (!node) return false;
    const next = !isAllShown(node);
    try {
        if (!node.properties) node.properties = {};
        node.properties[PROP_KEY] = next;
    } catch {
        /* ignore */
    }
    applyPorts(node);
    return next;
}

function hookNode(node) {
    if (!node) return;
    node._alberTogglePorts = () => togglePorts(node);
    node._alberPortsAllShown = () => isAllShown(node);

    if (node._alberPortsHooked) {
        applyPorts(node);
        return;
    }
    node._alberPortsHooked = true;

    // 加载工作流时 link 在 onConfigure 之前已经恢复，但这里再等一帧，
    // 避免和 ComfyUI 的端口重建抢时序。
    setTimeout(() => applyPorts(node), 0);
    setTimeout(() => applyPorts(node), 300);

    const origConfigure = node.onConfigure;
    node.onConfigure = function () {
        const out = origConfigure?.apply(this, arguments);
        setTimeout(() => applyPorts(this), 0);
        return out;
    };

    const origConn = node.onConnectionsChange;
    node.onConnectionsChange = function () {
        const out = origConn?.apply(this, arguments);
        clearTimeout(this._alberPortsTimer);
        this._alberPortsTimer = setTimeout(() => applyPorts(this), 60);
        return out;
    };
}

app.registerExtension({
    name: "Alber.Ports",
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
