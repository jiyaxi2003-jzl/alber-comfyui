// Alber 导演台 · 通用右键菜单
// ---------------------------------------------------------------------------
// 独立于节点 DOM 的一层浮层（挂到 document.body），所以不会被节点的
// overflow:hidden 裁掉，也不受节点缩放影响。
// 调用：showContextMenu(event, [{label, hint, checked, disabled, danger, sep, action}])
// ---------------------------------------------------------------------------

import { isDarkTheme } from "./alber_palette.js";

const STYLE_ID = "alber-ctxmenu-css";
let current = null;

function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
.alber-ctxmenu{
  position:fixed;left:-9999px;top:0;z-index:100000;display:block;
  min-width:208px;max-width:min(360px,86vw);padding:4px;
  border-radius:8px;font-family:system-ui,"Microsoft YaHei",sans-serif;
  font-size:12px;line-height:1.4;user-select:none;
  box-shadow:0 10px 30px rgba(0,0,0,.45);
}
.alber-ctxmenu.dark{background:#1e1e22;border:1px solid #3a3a44;color:#dcdce4}
.alber-ctxmenu.light{background:#ffffff;border:1px solid #d6dbe3;color:#2b3140;box-shadow:0 10px 30px rgba(20,30,60,.18)}
.alber-ctxmenu-item{
  all:unset;box-sizing:border-box;display:flex;align-items:center;gap:6px;
  width:100%;padding:5px 8px;border-radius:5px;cursor:pointer;
  font-size:12px;white-space:nowrap;
}
.alber-ctxmenu.dark .alber-ctxmenu-item:hover{background:#2f3140;color:#eaf0ff}
.alber-ctxmenu.light .alber-ctxmenu-item:hover{background:#eef2f9;color:#1a38a2}
.alber-ctxmenu-item.danger{color:#ff9a9a}
.alber-ctxmenu.light .alber-ctxmenu-item.danger{color:#b3261e}
.alber-ctxmenu-item.danger:hover{background:rgba(180,40,40,.22)}
.alber-ctxmenu-item.disabled{opacity:.42;cursor:default}
.alber-ctxmenu.dark .alber-ctxmenu-item.disabled:hover{background:transparent;color:inherit}
.alber-ctxmenu.light .alber-ctxmenu-item.disabled:hover{background:transparent;color:inherit}
.alber-ctxmenu-tick{flex:0 0 12px;text-align:center;font-size:11px;opacity:.9}
.alber-ctxmenu-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.alber-ctxmenu-hint{flex:0 0 auto;font-size:10px;opacity:.55;margin-left:10px}
.alber-ctxmenu-sep{height:1px;margin:4px 6px}
.alber-ctxmenu.dark .alber-ctxmenu-sep{background:#3a3a44}
.alber-ctxmenu.light .alber-ctxmenu-sep{background:#e2e6ee}
`;
    document.head.appendChild(st);
}

export function hideContextMenu() {
    if (!current) return;
    const { el, off } = current;
    current = null;
    try {
        off?.();
    } catch {
        /* ignore */
    }
    el.remove();
}

/**
 * 弹出右键菜单。
 * @param {MouseEvent} ev 原生 contextmenu 事件（用来定位）
 * @param {Array} items 菜单项；sep:true 为分隔线
 */
export function showContextMenu(ev, items) {
    try {
        ev?.preventDefault?.();
        ev?.stopPropagation?.();
    } catch {
        /* ignore */
    }
    hideContextMenu();
    const list = (items || []).filter(Boolean);
    if (!list.length) return null;

    injectCss();
    const el = document.createElement("div");
    el.className = `alber-ctxmenu ${isDarkTheme() ? "dark" : "light"}`;
    el.setAttribute("role", "menu");

    for (const it of list) {
        if (it.sep) {
            const s = document.createElement("div");
            s.className = "alber-ctxmenu-sep";
            el.appendChild(s);
            continue;
        }
        const row = document.createElement("button");
        row.type = "button";
        row.className =
            "alber-ctxmenu-item" +
            (it.danger ? " danger" : "") +
            (it.disabled ? " disabled" : "");
        row.disabled = !!it.disabled;
        const tick = document.createElement("span");
        tick.className = "alber-ctxmenu-tick";
        tick.textContent = it.checked ? "✓" : "";
        const label = document.createElement("span");
        label.className = "alber-ctxmenu-label";
        label.textContent = it.label || "";
        const hint = document.createElement("span");
        hint.className = "alber-ctxmenu-hint";
        hint.textContent = it.hint || "";
        row.append(tick, label, hint);
        row.title = it.title || "";
        if (!it.disabled) {
            row.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                hideContextMenu();
                try {
                    it.action?.();
                } catch (err) {
                    console.warn("[Alber] 右键菜单动作失败", err);
                }
            });
        }
        el.appendChild(row);
    }

    document.body.appendChild(el);

    // 先放到屏外量尺寸，再定位，避免贴边溢出（不用 visibility 切换，省得某些环境下不重绘）
    const pad = 6;
    const r = el.getBoundingClientRect();
    const px = Number(ev?.clientX);
    const py = Number(ev?.clientY);
    const x = Math.min(
        Math.max(pad, Number.isFinite(px) ? px : 40),
        Math.max(pad, window.innerWidth - r.width - pad)
    );
    const y = Math.min(
        Math.max(pad, Number.isFinite(py) ? py : 40),
        Math.max(pad, window.innerHeight - r.height - pad)
    );
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;

    const onDown = (e) => {
        if (!el.contains(e.target)) hideContextMenu();
    };
    const onKey = (e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            hideContextMenu();
        }
    };
    const onBlur = () => hideContextMenu();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    window.addEventListener("wheel", onBlur, { passive: true, capture: true });

    current = {
        el,
        off: () => {
            document.removeEventListener("pointerdown", onDown, true);
            document.removeEventListener("mousedown", onDown, true);
            document.removeEventListener("keydown", onKey, true);
            window.removeEventListener("blur", onBlur);
            window.removeEventListener("resize", onBlur);
            window.removeEventListener("wheel", onBlur, { capture: true });
        },
    };
    return el;
}

/** 复制到剪贴板，返回 Promise<boolean>。 */
export async function copyToClipboard(text) {
    const s = String(text ?? "");
    if (!s) return false;
    try {
        await navigator.clipboard.writeText(s);
        return true;
    } catch {
        try {
            const ta = document.createElement("textarea");
            ta.value = s;
            ta.style.cssText = "position:fixed;left:-9999px;top:0";
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand("copy");
            ta.remove();
            return ok;
        } catch {
            return false;
        }
    }
}

/** 读剪贴板文本，失败返回 null。 */
export async function readClipboard() {
    try {
        return await navigator.clipboard.readText();
    } catch {
        return null;
    }
}
