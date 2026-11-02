/**
 * Alber 导演台 · 旧节点 ID 自动迁移
 *
 * Alber 版使用独立节点 ID（AlberH3DirectorConsole / AlberH3Console*），
 * 因此可以与本机的原版 H3 Director Console 插件共存、互不抢占。
 *
 * 代价是：旧工作流里保存的是 H3DirectorConsole / H3Console*，如果本机没有原版，
 * 打开就会变成红色缺失节点。这个扩展负责在**加载工作流的那一刻**把旧 ID 换成新 ID：
 *
 *   - 旧 ID 未被任何插件注册（原版没装或被停用）→ 自动替换为 Alber 版 ID
 *   - 旧 ID 已注册（原版在）→ 原样保留，交给原版处理，不越权
 *   - 新旧都不可用 → 不动，让 ComfyUI 正常报缺失
 *
 * 只改内存里的图数据，不会回写你的工作流文件；保存时按新 ID 存。
 */

import { app } from "../../scripts/app.js";

const LEGACY_ID_MAP = {
    H3DirectorConsole: "AlberH3DirectorConsole",
    H3ConsoleRefine: "AlberH3ConsoleRefine",
    H3ConsoleSelfLift: "AlberH3ConsoleSelfLift",
    H3ConsoleSemanticBridge: "AlberH3ConsoleSemanticBridge",
    H3ConsoleFaceRefine: "AlberH3ConsoleFaceRefine",
    H3ConsoleConditioning: "AlberH3ConsoleConditioning",
    H3ConsolePlannerConditioning: "AlberH3ConsolePlannerConditioning",
    H3ConsoleGroupImageToVideo: "AlberH3ConsoleGroupImageToVideo",
    H3ConsoleGroupReferenceToVideo: "AlberH3ConsoleGroupReferenceToVideo",
    H3ConsoleGroupsCombine: "AlberH3ConsoleGroupsCombine",
};

const LOG_PREFIX = "[Alber Director]";

const NEW_TO_LEGACY = Object.fromEntries(
    Object.entries(LEGACY_ID_MAP).map(([legacy, current]) => [current, legacy])
);

/** 该节点类型是否已经被某个插件注册（不看显示名，只看 type）。 */
function isTypeRegistered(type) {
    try {
        const lg = globalThis.LiteGraph;
        if (lg?.registered_node_types?.[type]) return true;
    } catch (_) {
        /* ignore */
    }
    try {
        const reg = app?.nodeTypeRegistry;
        if (reg && typeof reg.get === "function" && reg.get(type)) return true;
        if (reg && typeof reg.has === "function" && reg.has(type)) return true;
    } catch (_) {
        /* ignore */
    }
    try {
        if (app?.registered_node_types?.[type]) return true;
    } catch (_) {
        /* ignore */
    }
    return false;
}

/** 旧 ID → 新 ID；不需要迁移时返回 null。 */
function resolveType(type) {
    if (typeof type !== "string") return null;
    const target = LEGACY_ID_MAP[type];
    if (!target) return null;
    // 原版在，就让原版继续负责这张图。
    if (isTypeRegistered(type)) return null;
    // 新版也没装好，别把图改成另一种坏状态。
    if (!isTypeRegistered(target)) return null;
    return target;
}

/** 原地改写一个 nodes 数组里的类型。返回改动数量。 */
function remapNodeArray(nodes) {
    if (!Array.isArray(nodes)) return 0;
    let changed = 0;
    for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const target = resolveType(node.type);
        if (!target) continue;
        node.type = target;
        // 有些序列化结构会把原始类型另存一份。
        if (NEW_TO_LEGACY[target] === node.comfyClass) node.comfyClass = target;
        changed += 1;
    }
    return changed;
}

/** 兼容 UI 工作流（nodes 数组）与 API 工作流（nodes 字典）。 */
function migrateWorkflowData(data) {
    if (!data || typeof data !== "object") return 0;

    let changed = 0;

    changed += remapNodeArray(data.nodes);

    if (data.nodes && !Array.isArray(data.nodes) && typeof data.nodes === "object") {
        for (const key of Object.keys(data.nodes)) {
            const entry = data.nodes[key];
            if (!entry || typeof entry !== "object") continue;
            const target = resolveType(entry.class_type) || resolveType(entry.type);
            if (!target) continue;
            if (typeof entry.class_type === "string") entry.class_type = target;
            if (typeof entry.type === "string") entry.type = target;
            changed += 1;
        }
    }

    // 新版前端的子图定义（definitions.subgraphs[].nodes）
    const subgraphs = data?.definitions?.subgraphs;
    if (Array.isArray(subgraphs)) {
        for (const sg of subgraphs) {
            if (sg && typeof sg === "object") changed += remapNodeArray(sg.nodes);
        }
    }

    return changed;
}

/** 已实例化的 LGraph（比如从 graph.serialize() 回来）也兜一层。 */
function migrateGraphInstance(graph) {
    if (!graph || typeof graph !== "object" || !Array.isArray(graph._nodes)) return 0;
    let changed = 0;
    for (const node of graph._nodes) {
        if (!node || typeof node !== "object") continue;
        const current = node.type || node.comfyClass;
        const target = resolveType(current);
        if (!target) continue;
        node.type = target;
        node.comfyClass = target;
        changed += 1;
    }
    return changed;
}

function report(changed, source) {
    if (!changed) return;
    console.info(`${LOG_PREFIX} 旧节点 ID 已迁移 ${changed} 处（${source}）→ Alber 独立节点`);
}

function install() {
    if (app.__alberIdMigrateInstalled) return;
    app.__alberIdMigrateInstalled = true;

    const wrap = (methodName, extractor, label) => {
        const original = app[methodName];
        if (typeof original !== "function") return;
        app[methodName] = function (...args) {
            try {
                const target = extractor(args);
                const changed = migrateGraphDataAny(target);
                report(changed, label);
            } catch (err) {
                console.warn(`${LOG_PREFIX} ID 迁移跳过（${label}）:`, err);
            }
            return original.apply(this, args);
        };
    };

    wrap("loadGraphData", (args) => args[0], "loadGraphData");
    wrap("loadApiJson", (args) => args[0], "loadApiJson");

    console.info(`${LOG_PREFIX} 旧 ID 自动迁移已就绪`);
}

function migrateGraphDataAny(target) {
    if (!target) return 0;
    // 字符串（序列化 JSON）不解析，交给调用方原有逻辑处理。
    if (typeof target === "string") return 0;
    const instanceChanged = migrateGraphInstance(target);
    const dataChanged = migrateWorkflowData(target);
    return instanceChanged + dataChanged;
}

app.registerExtension({
    name: "Alber.DirectorIdMigrate",
    setup() {
        install();
    },
});
