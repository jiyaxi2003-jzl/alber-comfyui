// Alber 导演台 · 跟随 ComfyUI 主题
// ---------------------------------------------------------------------------
// 以前这里是「强制浅色」：不管 ComfyUI 是黑是白，节点一律白底。
// 现在改成跟随：
//   · ComfyUI 浅色  → 注入 alber_light_theme.css（把插件原本的深色面板整体翻亮）
//   · ComfyUI 深色  → 不注入，直接吃插件原生的深色样式
//   · 切换主题立刻生效，不用刷新页面
//
// canvas 上的配色（时间轴标尺 / 轨道底色 / 缩略图占位）CSS 管不到，交给
// alber_palette.js 在 fillStyle / strokeStyle 上做字面量映射。
//
// 节点外框（标题栏 / 节点底色）是 LiteGraph 用 canvas 画的，只能设
// bgcolor / color / title_text_color 三个属性；标题文字色必须在 prototype 上，
// 否则不生效。
// ---------------------------------------------------------------------------

import { app } from "../../scripts/app.js";
import {
    isDarkTheme,
    installCanvasThemePatch,
    onThemeChange,
    THEME_EVENT,
} from "./alber_palette.js";

const STYLE_ID = "alber-light-theme";
const CSS_HREF = new URL("./alber_light_theme.css", import.meta.url).href;

const LIGHT_NODE = {
    bgcolor: "#ffffff",
    header: "#eef1f6",
    title: "#1b1e24",
};

// 深色不用写死：ComfyUI 自己会把前景色放进制服变量里，读它更贴主题
function darkTitleText() {
    try {
        const v = getComputedStyle(document.body).getPropertyValue("--fg-color").trim();
        if (v) return v;
    } catch {
        /* ignore */
    }
    return "#e8e8ef";
}

const CSS_FALLBACK = `
.mmx-host{background:#ffffff!important;color:#2b3140!important}
.mmx-host .bd-wrap{color:#2b3140!important}
.mmx-host .alber-param-box,.mmx-host .bd-panel,.mmx-host .bd-btn{background:#ffffff!important;color:#2b3140!important}
.mmx-host .alber-pika-bar{background:#f7f9fc!important;color:#26303d!important}`;

function lightStyleEl() {
    return document.getElementById(STYLE_ID);
}

function applyLightCss(on) {
    const existing = lightStyleEl();
    if (on) {
        if (existing) return;
        const link = document.createElement("link");
        link.id = STYLE_ID;
        link.rel = "stylesheet";
        link.href = CSS_HREF;
        // 静态路径没映射上时兜底，至少不是「深色面板里蹦出白框」
        link.addEventListener("error", () => {
            console.warn("[Alber] 浅色主题样式没加载上：", CSS_HREF);
            if (document.getElementById(`${STYLE_ID}-fallback`)) return;
            const st = document.createElement("style");
            st.id = `${STYLE_ID}-fallback`;
            st.textContent = CSS_FALLBACK;
            document.head.appendChild(st);
        });
        document.head.appendChild(link);
    } else if (existing) {
        existing.remove();
        document.getElementById(`${STYLE_ID}-fallback`)?.remove();
    }
}

function isAlberNode(node) {
    return /^Alber/.test(String(node?.type || node?.comfyClass || ""));
}

function paintNode(node, dark) {
    if (!isAlberNode(node)) return;
    node._alberThemeDark = dark;
    if (dark) {
        // null 让 LiteGraph 回到 ComfyUI 默认配色，比我们自己猜一个准
        node.bgcolor = null;
        node.color = null;
    } else {
        node.bgcolor = LIGHT_NODE.bgcolor;
        node.color = LIGHT_NODE.header;
    }
    try {
        node.setDirtyCanvas?.(true, false);
    } catch {
        /* 画布还没准备好 */
    }
}

/** DOM 面板重绘（时间轴 / 预览列 / 参数框） */
function refreshCanvases() {
    for (const node of app.graph?._nodes || []) {
        try {
            node._minimaxEditor?.scheduleRender?.();
        } catch {
            /* ignore */
        }
        node.setDirtyCanvas?.(true, true);
    }
}

function applyAll(dark) {
    applyLightCss(!dark);
    document.documentElement.style.setProperty(
        "--alber-theme-dark",
        dark ? "1" : "0"
    );
    for (const node of app.graph?._nodes || []) paintNode(node, dark);
    refreshCanvases();
    try {
        window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { dark } }));
    } catch {
        /* ignore */
    }
}

installCanvasThemePatch();
applyLightCss(!isDarkTheme());

app.registerExtension({
    name: "Alber.ThemeSync",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!/^Alber/.test(String(nodeData?.name || ""))) return;
        // 标题文字色是类级属性，必须挂在 prototype 上。这里用 getter，
        // 主题一变下次绘制就是新颜色，不用回头改每个实例。
        Object.defineProperty(nodeType.prototype, "title_text_color", {
            configurable: true,
            enumerable: true,
            get() {
                return isDarkTheme() ? darkTitleText() : LIGHT_NODE.title;
            },
            set(value) {
                Object.defineProperty(this, "title_text_color", {
                    value,
                    writable: true,
                    configurable: true,
                    enumerable: true,
                });
            },
        });
    },
    nodeCreated(node) {
        paintNode(node, isDarkTheme());
    },
    loadedGraphNode(node) {
        paintNode(node, isDarkTheme());
    },
    setup() {
        const sync = () => applyAll(isDarkTheme(true));
        sync();
        setTimeout(sync, 300);
        // ComfyUI 切主题时立刻跟
        onThemeChange((dark) => applyAll(dark));
    },
});
