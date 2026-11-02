#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""高保真预览：先把插件原本的深色 CSS 原样导出，再叠加深色→浅色的覆盖层，
完全复刻浏览器里真实的层叠顺序（原样式在前，主题在后）。"""
import pathlib

JS = pathlib.Path(r"H:/Workbuddy/2026-11-01-09-40-50/Alber-ComfyUI-MiniMaxH3-Director/web/js")
ORIG = pathlib.Path(r"H:/tmp/orig_dark.css")
THEME = (JS / "alber_light_theme.css").as_uri()
OUT = pathlib.Path(r"H:/tmp/apb_light2.html")


def extract(anchor, path, subs=None):
    s = path.read_text(encoding="utf-8")
    i = s.find(anchor) + len(anchor)
    j = s.find("`;", i)
    css = s[i:j]
    for k, v in (subs or {}).items():
        css = css.replace("${%s}" % k, v)
    return css


tl = extract("const STYLES = `", JS / "minimax_timeline.js")
tl = tl.replace("${IMAGE_BATCH_STYLES}", extract("const IMAGE_BATCH_STYLES = `", JS / "minimax_image_batch.js"))
tl = tl.replace("${FL2V_STYLES}", extract("const FL2V_STYLES = `", JS / "minimax_fl2v.js"))
pb = extract("const CSS = `", JS / "alber_param_box.js", {"BOX_CLASS": "alber-param-box"})
pk = extract("const CSS = `", JS / "alber_pika_mode.js")
pv = extract("    st.textContent = `", JS / "alber_mp4_panel.js",
             {"COL_CLASS": "alber-preview-col", "HOST_CLASS": "alber-has-preview",
              "VAR_W": "--alber-prev-w"})
ORIG.write_text("\n".join([tl, pb, pk, pv]), encoding="utf-8")

GROUPS = [
    ("模型加载", "基座 · LoRA · 文本编码 · VAE", [
        ("UNET 基座", "select", ["minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors"]),
        ("权重量化", "select", ["default"]),
        ("LoRA", "select", ["pika_h3_flex_ref2va_v1_bf16.safetensors"]),
        ("LoRA 强度", "num", "1"),
        ("CLIP 文本编码", "select", ["qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"]),
        ("CLIP 类型", "select", ["minimax"]),
        ("视频 VAE", "select", ["minimax_h3_video_vae_fp16.safetensors"]),
        ("音频 VAE", "select", ["minimax_h3_audio_vae_fp32.safetensors"]),
    ]),
    ("采样", "调度 · 步数 · 采样器 · shift", [
        ("seed", "num", "124623113916"),
        ("pika_schedule", "select", ["自动（按 LoRA）"]),
        ("sage_attention", "bool", True),
        ("steps", "num", "25"),
        ("sample", "select", ["res_multistep"]),
        ("scheduler", "select", ["simple"]),
        ("shift_video", "num", "12"),
        ("shift_audio", "num", "3"),
    ]),
    ("导出 MP4", "直出 H.264 + H3 原生音轨", [
        ("save_mp4", "bool", True),
        ("mp4_dir", "text", "G:/PC/output/video2"),
        ("mp4_prefix", "text", "Alber导演台"),
        ("mp4_crf", "num", "18"),
        ("mp4_overwrite", "bool", True),
    ]),
    ("性能与缓存", "显存清理 · 分段缓存 · 调试图层", [
        ("clean_vram_between", "bool", True),
        ("clean_vram_before_second", "bool", True),
        ("cache_frames_format", "select", ["raw"]),
        ("export_source", "bool", False),
        ("export_pre_face", "bool", False),
        ("cache_name", "text", ""),
    ]),
]


def ctl(kind, val):
    if kind == "select":
        return "<select>" + "".join(f"<option>{v}</option>" for v in val) + "</select>"
    if kind == "bool":
        return f'<input type="checkbox"{" checked" if val else ""}>'
    return f'<input type="text" value="{val}">'


cards = []
for title, hint, items in GROUPS:
    rows = "".join(
        f'<div class="apb-row"><span class="apb-lbl">{n}</span><span class="apb-ctl">{ctl(k, v)}</span></div>'
        for n, k, v in items
    )
    cards.append(
        f'<div class="apb-group"><div class="apb-gtitle"><span>{title}</span>'
        f'<span class="apb-ghint">{hint}</span></div><div class="apb-grid">{rows}</div></div>'
    )

PARAMS = f"""
<div class="alber-param-box open">
  <div class="apb-head" role="button">
    <span class="apb-caret">▶</span>
    <span class="apb-title">参数面板</span>
    <span class="apb-sub">模型加载 · 采样 · 导出 MP4 · 性能与缓存</span>
    <span class="apb-badge">28 项</span>
    <button type="button" class="apb-portbtn">接口</button>
  </div>
  <div class="apb-body">{"".join(cards)}</div>
</div>"""

HTML = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="{ORIG.as_uri()}">
<link rel="stylesheet" href="{THEME}">
<style>
body{{margin:0;background:#eef0f4;padding:24px;font-family:system-ui,"Microsoft YaHei",sans-serif}}
.node{{width:1180px;height:900px;background:#fff;border:1px solid #c9d0db;border-radius:8px;
  overflow:hidden;position:relative;box-shadow:0 8px 26px rgba(16,24,40,.12);display:flex;flex-direction:column}}
.title{{height:30px;flex:0 0 auto;background:#eef1f6;border-bottom:1px solid #d7dde7;display:flex;
  align-items:center;padding:0 12px;font-size:12px;font-weight:700;color:#1b1e24}}
.node>.mmx-host{{flex:1 1 auto;min-height:0}}
</style></head><body>
<div class="node">
  <div class="title">Alber 导演台</div>
  <div class="mmx-host alber-has-preview" style="--alber-prev-w:190px">
    <div class="alber-pika-bar">
      <span class="ttl">Pika 模式</span>
      <span class="seg"><button>参考主体 ref2va</button><button class="on">首尾帧/文生 fl2va</button></span>
      <span class="info">pika_h3_flex_fl2va_v1_bf16.safetensors</span>
      <button>刷新</button>
    </div>
    {PARAMS}
    <div class="bd-wrap" style="padding:0 8px 8px">
      <div class="bd-toolbar">
        <div class="bd-actions">
          <button class="bd-btn bd-btn-primary">全选</button>
          <button class="bd-btn">插入</button>
          <button class="bd-btn">导入素材组</button>
          <button class="bd-btn">智能拆分</button>
          <button class="bd-btn">删除选中组</button>
        </div>
        <div class="bd-right"><span class="bd-bounds">1.0s</span></div>
      </div>
      <div class="bd-viewport"><canvas id="tl" style="width:100%;height:74px"></canvas></div>
      <div class="bd-controls">
        <div class="bd-player">
          <button class="bd-icon-btn">▶</button><button class="bd-btn">◀</button>
          <span class="bd-timecode">0:00 / 0:05</span>
          <input class="bd-seek" type="range" value="0">
          <select class="bd-select"><option>适配窗口</option></select>
          <input class="bd-num" value="24">
          <span class="bd-meta">输出分辨率 864×480 · 0.14 MB · 5.0s</span>
        </div>
      </div>
      <div class="bd-run-select-bar">
        <span>全部动作</span>
        <label class="bd-run-select-all-wrap"><input type="checkbox" checked> 全选</label>
        <span class="bd-meta">已选 1 个片段</span>
      </div>
      <div class="bd-batch-card">
        <div class="bd-batch-head"><b>第1</b><span class="bd-meta">原始时长≈5.0s</span></div>
        <div class="bd-batch-prompts">
          <textarea class="bd-prompt">小女孩站在雪山顶上，风吹动头发，逆光…</textarea>
        </div>
        <div class="bd-row"><span class="bd-meta">时长</span><input class="bd-num" value="5">
          <span class="bd-meta">参考图 3/3</span></div>
      </div>
      <div class="bd-output">
        <label>音频</label><select class="bd-select"><option>H3 原生</option></select>
        <button class="bd-btn bd-btn-live-preview">实时预览</button>
      </div>
      <div class="bd-run-status done">
        <div class="bd-run-title">执行状态：全部完成</div>
        <div class="bd-run-detail">已渲染 1 个片段</div>
        <div class="bd-run-bars"><div class="bd-run-bar"><div class="bd-run-bar-fill" style="width:100%"></div></div></div>
      </div>
    </div>
    <div class="alber-preview-col">
      <div class="apc-head"><span class="apc-tag">成片</span><span class="apc-file has">Alber导演台.mp4 · 0.1 MB · 120 帧</span></div>
      <div class="apc-stage has"><video class="apc-video" style="display:block;width:60%;height:70%;background:#fff"></video></div>
      <div class="apc-actions">
        <button class="apc-btn primary">打开目录</button>
        <button class="apc-btn">刷新</button>
        <a class="apc-btn">新窗口</a>
      </div>
      <div class="apc-note"></div>
    </div>
  </div>
</div>
{{JS}}
</body></html>"""

JS_CODE = """
<script>
const cv = document.getElementById('tl');
const ctx = cv.getContext('2d');
const W = cv.clientWidth || 860, H = 74, dpr = 2;
cv.width = W * dpr; cv.height = H * dpr;
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
const RULER_H = 16, LABEL_H = 14, TRACK_Y = RULER_H + LABEL_H, TRACK_H = H - TRACK_Y;
ctx.fillStyle = '#eef1f6'; ctx.fillRect(0, 0, W, RULER_H);
ctx.font = '10px sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
ctx.fillStyle = '#b6bdc9';
for (let s = 0; s <= 5; s++) { if (s % 2) ctx.fillRect(s / 5 * W, RULER_H - 4, 1, 4); }
ctx.fillStyle = '#4b5563';
for (let s = 0; s <= 5; s += 2) {
  const x = s / 5 * W;
  ctx.fillRect(x, RULER_H - 7, 1, 7);
  ctx.fillText(s + 's', x + 3, 11);
}
ctx.fillStyle = '#f2f5f8'; ctx.fillRect(0, RULER_H, W, LABEL_H);
ctx.textBaseline = 'middle';
ctx.fillStyle = '#4b5563'; ctx.fillText('1-120', 4, RULER_H + LABEL_H / 2);
ctx.fillStyle = '#fafbfd'; ctx.fillRect(0, TRACK_Y, W, TRACK_H);
ctx.fillStyle = '#f7f8fa'; ctx.fillRect(0, TRACK_Y + 1, W, TRACK_H - 2);
ctx.fillStyle = '#c9d0db';
for (let i = 0; i < 5; i++) ctx.fillRect(6 + i * (W / 5), TRACK_Y + 5, W / 5 - 30, TRACK_H - 10);
ctx.fillStyle = 'rgba(22,163,74,0.12)'; ctx.fillRect(0, TRACK_Y + 1, W, TRACK_H - 2);
ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 1.5;
ctx.strokeRect(0.75, TRACK_Y + 0.75, W - 1.5, TRACK_H - 1.5);
ctx.fillStyle = '#ffffff'; ctx.fillRect(5, TRACK_Y + 3, 22, 13);
ctx.fillStyle = '#0f0f17'; ctx.font = 'bold 9px sans-serif'; ctx.fillText('✓', 11, TRACK_Y + 10);
ctx.fillStyle = '#ff4444'; ctx.fillRect(W * 0.32, 0, 2, TRACK_Y + TRACK_H);
</script>
"""

OUT.write_text(HTML.replace("{JS}", JS_CODE), encoding="utf-8")
print("written", OUT)
