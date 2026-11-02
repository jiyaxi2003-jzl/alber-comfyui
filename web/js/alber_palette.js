// Alber 导演台 · 主题跟随层
// ---------------------------------------------------------------------------
// 目标：节点 UI（DOM + canvas）跟着 ComfyUI 自己的明暗设置走，而不是焊死一种。
//
// 分两半：
//   · DOM  —— 由 alber_light_theme.css 负责，只有浅色主题时才注入；深色主题下
//             什么都不做，直接吃插件原本的深色样式。
//   · canvas —— CSS 管不到。原来的画布颜色是按浅色写死的字面量，这里不改调用点，
//             而是在 CanvasRenderingContext2D 的 fillStyle / strokeStyle 上装一层
//             转换：深色主题时把「浅色字面量」换回它对应的深色值。
//             只对 .mmx-host 里的 canvas 生效，不会污染别的节点。
//
// 没动任何绘制代码，删掉本文件即退回原来的固定配色。
// ---------------------------------------------------------------------------

const THEME_EVENT = "alber-theme-change";

// 浅色字面量 → 深色对应值。键一律小写。
// 数值来自本插件改成浅色之前的原始深色版本，逐条对照取回。
const LIGHT_TO_DARK = {
    // 面
    "#edf0f5": "#2e2e2e",
    "#f7f8fa": "#0d0d0d",
    "#fafbfd": "#111",
    "#f2f5f8": "#1a1a1a",
    "#f2f4f7": "#000",
    "#eef1f6": "#252525",
    "#ffffff": "#0e0e0e",
    "#f1f3f7": "#1c1c1c",
    "#e7f7ee": "#1a3a2a",
    // 线
    "#c9d0db": "#333",
    "#b6bdc9": "#888",
    "#8b929f": "#666",
    // 字
    "#6b7280": "#888",
    "#4b5563": "#aaa",
    "#1f2937": "#e0e3ed",
    "#242a33": "#d8dce8",
    // 强调
    "#16a34a": "#4fff8f",
    "#1f8f52": "#4fff8f",
    "#0e7fd6": "#5ec8ff",
    "rgba(22,163,74,0.12)": "rgba(79,255,143,0.14)",
    "rgba(22,163,74,0.06)": "rgba(79,255,143,0.08)",
    "rgba(232,247,238,0.96)": "rgba(20,40,28,0.92)",
    // 片段循环底色（浅色马卡龙 → 深色同色系）
    "#fdf7e6": "#2a2318",
    "#eef4fb": "#16202b",
    "#eefaf1": "#152418",
    "#fdeef4": "#231521",
};

/** 归一化颜色字符串，便于查表：去掉空格、统一小写、rgba 逗号后补空格。 */
function normalize(raw) {
    return String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/, "rgba($1,$2,$3,$4)");
}

const LOOKUP = new Map(
    Object.entries(LIGHT_TO_DARK).map(([k, v]) => [normalize(k), v])
);

// ---------------------------------------------------------------------------
// 主题判定：类名优先，CSS 变量兜底。ComfyUI 前端两套机制都出现过，
// 只认一种容易在新版/旧版之间失灵。
// ---------------------------------------------------------------------------

function parseLuminance(color) {
    const s = String(color || "").trim();
    if (!s) return null;
    let r, g, b;
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) {
        const h = m[1];
        r = parseInt(h[0] + h[0], 16);
        g = parseInt(h[1] + h[1], 16);
        b = parseInt(h[2] + h[2], 16);
    } else if ((m = /^#([0-9a-f]{6})$/i.exec(s))) {
        const h = m[1];
        r = parseInt(h.slice(0, 2), 16);
        g = parseInt(h.slice(2, 4), 16);
        b = parseInt(h.slice(4, 6), 16);
    } else if ((m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s))) {
        r = Number(m[1]);
        g = Number(m[2]);
        b = Number(m[3]);
    } else {
        return null;
    }
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const BG_VARS = [
    "--comfy-menu-bg",
    "--comfy-body-background",
    "--bg-color",
    "--comfy-input-bg",
    "--p-bg-color",
];

let cachedDark = null;
let cachedAt = 0;

/** 当前是不是深色主题。 */
export function isDarkTheme(force = false) {
    const now = Date.now();
    if (!force && cachedDark !== null && now - cachedAt < 400) return cachedDark;

    const html = document.documentElement;
    const body = document.body;
    const cls = `${html?.className || ""} ${body?.className || ""}`.toLowerCase();
    let dark = null;
    if (/\bdark-theme\b/.test(cls)) dark = true;
    else if (/\blight-theme\b/.test(cls)) dark = false;

    if (dark === null) {
        const attr = `${html?.dataset?.theme || ""} ${body?.dataset?.theme || ""}`.toLowerCase();
        if (attr.includes("dark")) dark = true;
        else if (attr.includes("light")) dark = false;
    }

    if (dark === null && body) {
        const cs = getComputedStyle(body);
        for (const name of BG_VARS) {
            const lum = parseLuminance(cs.getPropertyValue(name));
            if (lum !== null) {
                dark = lum < 0.5;
                break;
            }
        }
    }

    // 全都拿不到时按深色算：ComfyUI 默认就是深色，这样不会先闪一下白面板
    if (dark === null) dark = true;
    cachedDark = dark;
    cachedAt = now;
    return dark;
}

/** 把「浅色字面量」转成当前主题该用的颜色（深色主题才转，其余原样返回）。 */
export function paletteColor(color) {
    if (typeof color !== "string") return color;
    if (!isDarkTheme()) return color;
    return LOOKUP.get(normalize(color)) || color;
}

// ---------------------------------------------------------------------------
// canvas 颜色钩子：只作用于插件自己的画布
// ---------------------------------------------------------------------------

const ownCanvas = new WeakMap();

function isOwnCanvas(canvas) {
    if (!canvas) return false;
    let hit = ownCanvas.get(canvas);
    if (hit === undefined) {
        const el = canvas.closest ? canvas.closest(".mmx-host") : null;
        hit = !!el;
        ownCanvas.set(canvas, hit);
    }
    return hit;
}

let patched = false;

/** 装一次即可，重复调用无副作用。 */
export function installCanvasThemePatch() {
    if (patched) return;
    const proto = globalThis.CanvasRenderingContext2D?.prototype;
    if (!proto) return;
    patched = true;

    for (const prop of ["fillStyle", "strokeStyle"]) {
        const desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (!desc || typeof desc.set !== "function") continue;
        Object.defineProperty(proto, prop, {
            configurable: true,
            enumerable: desc.enumerable,
            get() {
                return desc.get.call(this);
            },
            set(value) {
                if (typeof value === "string" && isDarkTheme() && isOwnCanvas(this.canvas)) {
                    desc.set.call(this, LOOKUP.get(normalize(value)) || value);
                    return;
                }
                desc.set.call(this, value);
            },
        });
    }
}

// ---------------------------------------------------------------------------
// 变更通知
// ---------------------------------------------------------------------------

const listeners = new Set();
let watching = false;

/** 订阅主题变化；返回取消订阅函数。 */
export function onThemeChange(fn) {
    if (typeof fn !== "function") return () => {};
    listeners.add(fn);
    watchTheme();
    return () => listeners.delete(fn);
}

function emit() {
    const dark = isDarkTheme(true);
    listeners.forEach((fn) => {
        try {
            fn(dark);
        } catch (err) {
            console.warn("[Alber] 主题回调出错", err);
        }
    });
}

function watchTheme() {
    if (watching) return;
    watching = true;
    let last = isDarkTheme(true);

    const check = () => {
        cachedDark = null;
        const now = isDarkTheme();
        if (now !== last) {
            last = now;
            emit();
        }
        // ComfyUI 切换主题有时只改 CSS 变量、不动类名，所以属性观察之外还留了个轮询
        setTimeout(check, 1200);
    };

    try {
        const mo = new MutationObserver(() => {
            const was = last;
            cachedDark = null;
            const now = isDarkTheme();
            if (now !== was) {
                last = now;
                emit();
            }
        });
        [document.documentElement, document.body].forEach((el) => {
            if (el) mo.observe(el, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
        });
    } catch {
        /* MutationObserver 不可用时只靠轮询 */
    }

    setTimeout(check, 1200);
}

export { THEME_EVENT };
