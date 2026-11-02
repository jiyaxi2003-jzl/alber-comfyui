#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从现有深色 CSS 里机械推导出浅色主题，生成 web/js/alber_light_theme.js 里的样式表。

思路：不手改每个类（300+ 条规则改不完也容易漏），而是解析每条声明的颜色值，
按「这一步到底是什么」重新算一个浅色版本：
  · 背景：暗面 → 近白；中等饱和的强调色 → 同色系稍微提亮（保持是"有颜色的按钮"）
  · 边框：统一收到浅灰
  · 文字：如果这条规则的背景变浅了，文字就跟着变深；背景仍是深遮罩的（媒体角标）保留浅字
"""
import colorsys
import pathlib
import re

JS = pathlib.Path(r"H:/Workbuddy/2026-11-01-09-40-50/Alber-ComfyUI-MiniMaxH3-Director/web/js")
OUT = JS / "alber_light_theme.css"

NAMED = {"white": (255, 255, 255), "black": (0, 0, 0), "transparent": None}


def extract(anchor, path, subs=None, end="`;"):
    s = path.read_text(encoding="utf-8")
    i = s.find(anchor)
    if i < 0:
        raise SystemExit(f"找不到锚点 {anchor} @ {path}")
    i += len(anchor)
    j = s.find(end, i)
    css = s[i:j]
    for k, v in (subs or {}).items():
        css = css.replace("${%s}" % k, v)
    if "${" in css:
        left = re.findall(r"\$\{[^}]+\}", css)
        print(f"  ! 未替换的插值: {set(left)}")
    return css


def parse_color(tok):
    tok = tok.strip().lower()
    if tok in NAMED:
        c = NAMED[tok]
        return None if c is None else (*c, 1.0)
    m = re.fullmatch(r"#([0-9a-f]{3,8})", tok)
    if m:
        h = m.group(1)
        if len(h) == 3:
            r, g, b = (int(ch * 2, 16) for ch in h)
            return (r, g, b, 1.0)
        if len(h) == 4:
            r, g, b, a = (int(ch * 2, 16) for ch in h)
            return (r, g, b, a / 255)
        if len(h) == 6:
            return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0)
        if len(h) == 8:
            return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16) / 255)
    m = re.fullmatch(r"rgba?\(([^)]+)\)", tok)
    if m:
        parts = [p.strip() for p in re.split(r"[,\s/]+", m.group(1)) if p.strip()]
        try:
            r, g, b = (int(float(p)) for p in parts[:3])
            a = float(parts[3]) if len(parts) > 3 else 1.0
            return (r, g, b, a)
        except (ValueError, IndexError):
            return None
    return None


def fmt(rgb, a=1.0):
    r, g, b = (max(0, min(255, round(x))) for x in rgb)
    if a >= 0.999:
        return "#%02x%02x%02x" % (r, g, b)
    return "rgba(%d,%d,%d,%.3g)" % (r, g, b, a)


def hsl_of(c):
    r, g, b = (x / 255 for x in c[:3])
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return h, l, s


def from_hsl(h, l, s):
    r, g, b = colorsys.hls_to_rgb(h, max(0, min(1, l)), max(0, min(1, s)))
    return (r * 255, g * 255, b * 255)


def lum(rgb):
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def map_bg(c):
    h, l, s = hsl_of(c)
    if lum(c[:3]) > 200:
        # 本来就是浅色/白色（预览底衬已经是白的），别再往下压灰
        return c[:3]
    neutral = s < 0.18
    if neutral:
        # 单调翻转：原来的明暗层次保留，只是整体翻到浅色区。
        # 深色主题里 #111/#222/#333 是三档灰，翻过来仍然要是三档，不能全挤成纯白。
        nl = 1.0 - min(l, 0.62) * 0.46
        v = round(nl * 255)
        return (v, v, min(255, v + 2))
    # 有彩色的背景
    if l < 0.25:
        return from_hsl(h, 0.94, min(s, 0.55))
    if l < 0.50:
        # 中等明度的强调色（主按钮、选中态）：保留是"有颜色的实心块"
        return from_hsl(h, 0.44, min(max(s, 0.42), 0.72))
    return from_hsl(h, 0.90, min(s, 0.60))


def map_border(c):
    h, l, s = hsl_of(c)
    if s < 0.2:
        return (214, 219, 227) if l < 0.5 else (222, 227, 234)
    return from_hsl(h, 0.62, min(s, 0.55))


def map_text(c):
    h, l, s = hsl_of(c)
    if lum(c[:3]) < 70:
        # 本来就是深色文字，保持
        return c[:3]
    if s < 0.20:
        nl = 0.06 + (1.0 - l) * 0.56
        v = round(nl * 255)
        return (v, v, min(255, v + 8))
    # 有彩色的文字（强调绿/蓝）：压暗到白底能读，但别再顶满饱和度
    return from_hsl(h, 0.37, min(max(s, 0.50), 0.72))


COLOR_TOKEN = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b")


def transform_value(prop, value, bg_is_dark):
    def repl(m):
        c = parse_color(m.group(0))
        if c is None:
            return m.group(0)
        alpha = c[3]
        if alpha < 0.999:
            # 半透明：媒体角标 / 遮罩。白底上不需要再压黑，统一转成浅色描边式
            if prop.startswith("background"):
                if prop == "background" and "gradient" in value:
                    return fmt((255, 255, 255), min(0.9, alpha))
                return fmt((15, 23, 42), min(0.30, alpha * 0.55))
            return fmt((100, 108, 122), min(0.85, alpha))

        if prop.startswith("background"):
            return fmt(map_bg(c))
        if prop.startswith("border") or prop in ("outline-color", "column-rule-color"):
            return fmt(map_border(c))
        if prop == "box-shadow":
            return fmt((15, 23, 42), 0.10)
        if prop == "color" or prop == "caret-color" or prop.startswith("text-decoration"):
            if bg_is_dark:
                return m.group(0)
            return fmt(map_text(c))
        if prop == "scrollbar-color":
            return fmt(map_border(c))
        return m.group(0)

    if "gradient" in value:
        return COLOR_TOKEN.sub(repl, value)
    return COLOR_TOKEN.sub(repl, value)


COLOR_PROPS = {
    "background", "background-color", "background-image",
    "border", "border-color", "border-top", "border-bottom", "border-left", "border-right",
    "border-top-color", "border-bottom-color", "border-left-color", "border-right-color",
    "color", "outline", "outline-color", "box-shadow", "scrollbar-color",
    "border-top-left-radius", "accent-color",
}
COLOR_PROPS.discard("border-top-left-radius")


def split_decls(body):
    out = []
    for part in re.split(r";(?![^(]*\))", body):
        if ":" not in part:
            continue
        p, v = part.split(":", 1)
        out.append((p.strip(), v.strip()))
    return out


RULE = re.compile(r"([^{}@]+)\{([^{}]*)\}")


def transform_css(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    rules = []
    for sel, body in RULE.findall(css):
        sel = " ".join(sel.split())
        if not sel:
            continue
        decls = split_decls(body)
        # 先把背景转成浅色，再用「转完之后的亮度」决定文字该深还是该浅。
        # 实心强调色按钮（绿底白字）转完还是深色底，文字必须继续用白的。
        new = []
        bg_lum = None
        for p, v in decls:
            if p in ("background", "background-color"):
                nv = transform_value(p, v, False)
                toks = COLOR_TOKEN.findall(nv)
                if toks:
                    c = parse_color(toks[-1] if "gradient" in nv else toks[0])
                    if c:
                        bg_lum = lum(c[:3])
                if nv != v:
                    new.append((p, nv))
        keep_light_text = bg_lum is not None and bg_lum < 150
        for p, v in decls:
            if p in ("background", "background-color"):
                continue
            if p in COLOR_PROPS:
                if p == "color" and keep_light_text:
                    new.append((p, v if v.strip().lower() in ("#fff", "#ffffff", "white") else "#ffffff"))
                    continue
                nv = transform_value(p, v, keep_light_text)
                if nv != v:
                    new.append((p, nv))
            elif p == "accent-color":
                new.append((p, "#16a34a"))
        if new:
            rules.append((sel, new))
    return rules


HAND_TUNING = """
/* ==========================================================================
   手工微调 —— 机械映射只能保证"不再是黑的"，下面这些是层次感/可读性，
   纯靠颜色公式推不出来，只能手写。
   ========================================================================== */
.mmx-host{background:#ffffff !important}
.mmx-host .bd-wrap{background:transparent !important}
.mmx-host .bd-btn{background:#ffffff !important;color:#2b3140 !important}
.mmx-host .bd-btn:hover{background:#f1f4f9 !important;border-color:#c3cbd8 !important}
.mmx-host .bd-panel{background:#ffffff !important}
.mmx-host .bd-batch-card{background:#ffffff !important}
.mmx-host .bd-run-status{background:#fbfcfe !important}
.mmx-host .bd-stage{background:#f5f7fa !important}
.mmx-host .bd-controls{background:#ffffff !important}
.mmx-host .bd-viewport{background:#ffffff !important}
.mmx-host .bd-prompt{background:#ffffff !important}
.mmx-host .bd-select,.mmx-host .bd-num{background:#ffffff !important}
.mmx-host .alber-param-box{background:#ffffff !important}
.mmx-host .alber-param-box .apb-head{background:#f7f9fc !important}
.mmx-host .alber-param-box .apb-group{background:#fbfcfe !important}
.mmx-host .alber-param-box .apb-body{background:#ffffff !important}
.mmx-host .alber-param-box select,
.mmx-host .alber-param-box input[type=text],
.mmx-host .alber-param-box input[type=number]{background:#ffffff !important;color:#232833 !important}
.mmx-host .alber-param-box input[type=checkbox]{background:#dfe4ec !important;border-color:#c3cbd8 !important}
.mmx-host .alber-param-box input[type=checkbox]::after{background:#ffffff !important}
.mmx-host .alber-param-box input[type=checkbox]:checked{background:#2f6fd0 !important;border-color:#2f6fd0 !important}
.mmx-host .alber-pika-bar{background:linear-gradient(180deg,#fbfcfe,#f4f7fb) !important;color:#26303d !important}
.mmx-host .alber-pika-bar button{background:#eef1f6 !important;color:#333b4a !important}
.mmx-host .alber-pika-bar button:hover{background:#e2e7ef !important}
.mmx-host .alber-pika-bar button.on{background:#2f6fd0 !important;color:#ffffff !important}
.mmx-host .alber-preview-col .apc-stage{background:#ffffff !important}
/* 预览列会被分辨率压窄（竖屏只有 150-190px），三个按钮挤一行会把"打开目录"折成两行 */
.mmx-host .alber-preview-col .apc-actions{flex-wrap:wrap !important}
.mmx-host .alber-preview-col .apc-btn{white-space:nowrap !important;flex:1 1 auto !important;min-width:62px}
.mmx-host .alber-preview-col .apc-video{background:#ffffff !important}
/* 滚动条也换成浅色，否则一条深色竖条横在白面板里很扎眼 */
.mmx-host ::-webkit-scrollbar{width:10px;height:10px}
.mmx-host ::-webkit-scrollbar-track{background:#f2f4f8}
.mmx-host ::-webkit-scrollbar-thumb{background:#cfd6e0;border-radius:5px}
.mmx-host ::-webkit-scrollbar-thumb:hover{background:#b8c2d0}
"""


def main():
    parts = []
    parts.append(extract("const STYLES = `", JS / "minimax_timeline.js"))
    # 展开嵌套的两个样式常量
    batch = extract("const IMAGE_BATCH_STYLES = `", JS / "minimax_image_batch.js")
    fl2v = extract("const FL2V_STYLES = `", JS / "minimax_fl2v.js")
    parts[0] = parts[0].replace("${IMAGE_BATCH_STYLES}", batch).replace("${FL2V_STYLES}", fl2v)

    parts.append(extract("const CSS = `", JS / "alber_param_box.js", {"BOX_CLASS": "alber-param-box"}))
    parts.append(extract("const CSS = `", JS / "alber_pika_mode.js"))
    parts.append(extract("    st.textContent = `", JS / "alber_mp4_panel.js",
                         {"COL_CLASS": "alber-preview-col", "HOST_CLASS": "alber-has-preview",
                          "VAR_W": "--alber-prev-w", "STYLE_ID": "x"}))

    seen = {}
    for css in parts:
        for sel, decls in transform_css(css):
            key = sel
            bucket = seen.setdefault(key, [])
            for p, v in decls:
                bucket.append((p, v))

    lines = []
    for sel, decls in seen.items():
        if sel.startswith(".mmx-host"):
            scoped = sel
        else:
            scoped = f".mmx-host {sel}"
        body = ";".join(f"{p}:{v} !important" for p, v in decls)
        lines.append(f"{scoped}{{{body}}}")

    lines.append(HAND_TUNING)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print("规则数", len(lines))
    print("\n".join(lines[:12]))


if __name__ == "__main__":
    main()
