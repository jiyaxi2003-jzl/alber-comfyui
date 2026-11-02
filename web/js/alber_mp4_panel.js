// Alber 导演台 · 右侧成片预览列
// ---------------------------------------------------------------------------
// 预览不再塞进参数框（那样会跟参数一起折叠、还占纵向空间），改成节点右侧的
// 独立一列：
//   · 与时间轴区域等高（host 高度 - 上下留白）
//   · 宽度按节点里的 width / height 控件算 —— 竖屏就窄、横屏就宽，画面不留黑边
//   · 出片后自动载入，走 /alber/director/mp4_preview（FileResponse + Range，能拖进度）
//   · 「打开目录」走 /alber/director/open_folder，在资源管理器里定位
//
// 实现方式：host 加右内边距，预览列绝对定位在 padding 区里。
// 这样不动 .mmx-host 的 DOM 结构，时间轴自己的布局逻辑一点没碰。
// ---------------------------------------------------------------------------

import { app } from "../../scripts/app.js";

const STYLE_ID = "alber-preview-col-css";
const HOST_CLASS = "alber-has-preview";
const COL_CLASS = "alber-preview-col";
const VAR_W = "--alber-prev-w";
const PROP_PATH = "alberMp4Path";
const PROP_DIR = "alberMp4Dir";

// 预览列最小宽度：一行要并排放下「目录 / 刷新 / 弹出」三个按钮，
// 再加左右内距和间隙，低于 200 就必然把文字压成省略号、热区也小到点不准。
const MIN_W = 208;
const MAX_RATIO = 0.46; // 预览列最多占节点宽度的 46%，剩下的留给时间轴
// 预览框最小高度：再小原生控制条就铺不开了（播放键会被挤没）
const MIN_STAGE_H = 110;

function widgetByName(node, name) {
    return (node?.widgets || []).find((w) => w && w.name === name) || null;
}

function widgetNumber(node, name, fallback) {
    const w = widgetByName(node, name);
    const n = Number(w?.value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function fmtSize(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function previewUrl(path, bump = 0) {
    const q = new URLSearchParams({ path: String(path || "") });
    if (bump) q.set("v", String(bump));
    return `/alber/director/mp4_preview?${q.toString()}`;
}

function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
.mmx-host.${HOST_CLASS}{position:relative}
/* 右侧让位不再挂在 host 的 padding 上——那样整块面板都被挤窄，
   分镜操作区/提示词区就永远撑不满节点宽度。
   改成只给「和预览列并排」的那些行加右边距，预览列下方的行（分镜、提示词、
   运行状态）由 syncFlowInsets 逐行放开到整宽，横向贯通到节点右边。
   这里的默认收窄是 JS 没跑起来时的安全兜底（宁可窄，也不能钻到预览框底下）。
   弹窗遮罩 .bd-modal-overlay 故意不列进来——它要盖满整块。 */
.mmx-host.${HOST_CLASS}> :not(.${COL_CLASS}):not(.bd-wrap),
.mmx-host.${HOST_CLASS} .bd-main> *,
.mmx-host.${HOST_CLASS}> .bd-wrap> .bd-toolbar-wrap,
.mmx-host.${HOST_CLASS}> .bd-wrap> .bd-run-status{
  margin-right:calc(var(${VAR_W}, 320px) + 16px);
  /* 这些行原本多写死 width:100%，跟 margin-right 一起用会顶出节点右边，
     改成 auto 交给 flex 的 stretch 算（= 可用宽度 - 右边距）。 */
  width:auto;
}
.${COL_CLASS}{
  position:absolute;top:6px;right:6px;
  width:var(${VAR_W}, 320px);box-sizing:border-box;
  /* 列高不能超过节点：以前列是纯内容高度，出片提示一多行就把底下那排
     按钮顶出 host，被 .mmx-host 的 overflow:hidden 裁掉——看着像按钮
     「点不中」，其实是被切走了一半。这里限高，剩下的交给 stage 收缩。 */
  max-height:calc(100% - 12px);
  /* 抬层：.bd-wrap 里有一堆 position:relative/absolute 的小件（帮助气泡 z-index 30、
     悬浮缩略图等），预览列原来 z-index:auto 会被它们压住，看着是「按钮在那里
     但点不动」。60 高于这些局部浮层，又低于弹窗遮罩 .bd-modal-overlay(200)。 */
  z-index:60;
  display:flex;flex-direction:column;gap:6px;
  padding-left:8px;border-left:1px solid #3d3d48;
  font-family:system-ui,"Microsoft YaHei",sans-serif;color:#e2e2e8;
  user-select:none;
}
.${COL_CLASS} .apc-head{display:flex;align-items:center;gap:6px;flex:0 0 auto;min-width:0}
.${COL_CLASS} .apc-tag{
  flex:none;font-size:10px;font-weight:700;letter-spacing:.4px;color:#8fa8ff;
  padding:1px 7px;border-radius:9px;background:#232336;border:1px solid #3a3a52;
}
.${COL_CLASS} .apc-file{
  flex:1;min-width:0;font-size:11px;color:#8f8f9e;cursor:pointer;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.${COL_CLASS} .apc-file.has{color:#b9c6e8}
/* 预览底衬：深色主题下近黑（浅色主题由 alber_light_theme.css 强制刷白）。
   不用纯黑是为了跟「片子是黑的」区分开——空态有文字，一眼能看出没片。 */
/* 预览框钉在顶部：高度按视频比例算好（JS 写 --alber-prev-stage-h），
   不再被拉伸到整列高——否则竖屏视频四周全是空白。 */
.${COL_CLASS} .apc-stage{
  /* 高度优先用 JS 算好的比例值；空间不够时允许收缩（flex-shrink），
     但守住 min-height，别缩到原生控制条放不下。 */
  flex:1 1 auto;
  height:var(--alber-prev-stage-h, 220px);min-height:110px;position:relative;
  display:flex;align-items:center;justify-content:center;
  background:#0d0d0d;border:1px solid #3d3d48;border-radius:6px;overflow:hidden;
}
/* 【关键】video 必须铺满 stage，不能让它按视频比例自己缩成一条窄柱。
   浏览器原生控制条是按 <video> 元素宽度布局的：9:16 竖屏以前只拿到
   ~60px 宽的盒子，控制条挤不下，播放键被压没/叠在一起，就是「点不了」。
   铺满 + object-fit:contain 之后，画面仍按比例居中，但控制条拿到整列宽。 */
.${COL_CLASS} .apc-video{
  display:none;position:absolute;inset:0;width:100%;height:100%;
  object-fit:contain;background:#000;
}
.${COL_CLASS} .apc-stage.has .apc-video{display:block}
/* 自绘播放键：原生 control 在「小尺寸 + 画布 transform:scale」下会挤没或点击
   偏移，这里在画面正中放一个大的，任何时候都点得中。原生控制条照样在底部，
   拖进度不受影响；播放中这个键自动隐藏。 */
.${COL_CLASS} .apc-play{
  all:unset;box-sizing:border-box;position:absolute;left:50%;top:50%;
  transform:translate(-50%,-50%);z-index:2;
  width:52px;height:52px;display:none;align-items:center;justify-content:center;
  border-radius:50%;background:rgba(16,20,30,.72);color:#fff;
  font-size:19px;line-height:1;cursor:pointer;
  border:1px solid rgba(255,255,255,.3);
  transition:background .12s,transform .12s;
  touch-action:manipulation;
}
.${COL_CLASS} .apc-stage.has .apc-play{display:flex}
.${COL_CLASS} .apc-stage.is-playing .apc-play{display:none}
.${COL_CLASS} .apc-play:hover{background:rgba(36,74,124,.92)}
.${COL_CLASS} .apc-play:active{transform:translate(-50%,-50%) scale(.94)}
.${COL_CLASS} .apc-empty{
  display:flex;flex-direction:column;align-items:center;gap:4px;
  padding:14px 10px;text-align:center;line-height:1.7;
  color:#7a7d8a;font-size:11px;
}
.${COL_CLASS} .apc-stage.has .apc-empty{display:none}
.${COL_CLASS} .apc-empty b{color:#3f4a63;font-weight:600}
.${COL_CLASS} .apc-actions{display:flex;gap:5px;flex:0 0 auto;flex-wrap:nowrap}
.${COL_CLASS} .apc-btn{
  all:unset;box-sizing:border-box;flex:1 1 0;min-width:0;cursor:pointer;text-align:center;
  /* 热区加大：原来 4px 上下内距 + 15px 行高 ≈ 23px 高，在画布缩放后
     实测只有十几像素，很容易点偏。抬到 26px 左右。 */
  padding:5px 6px;border-radius:5px;
  border:1px solid #43435a;background:#2a2a38;color:#c3c3d2;
  font-size:11px;line-height:16px;font-family:inherit;transition:background .12s,color .12s,border-color .12s;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  /* 别让画布的触摸/拖拽手势把点击吃掉 */
  touch-action:manipulation;
}
.${COL_CLASS} .apc-btn:hover{background:#34344a;color:#dfe6ff;border-color:#5b5b78}
.${COL_CLASS} .apc-btn:active{transform:translateY(1px)}
.${COL_CLASS} .apc-btn.primary{background:#2b4a72;border-color:#3f7fd6;color:#d7e7ff}
.${COL_CLASS} .apc-btn.primary:hover{background:#356095}
/* 「正在打开」不再用 disabled——disabled 会让按钮完全收不到指针事件，
   连 hover 反馈都没有，手感上就是「点不动」。改用忙碌态。 */
.${COL_CLASS} .apc-btn.busy{opacity:.55;cursor:progress}
.${COL_CLASS} .apc-btn[disabled]{opacity:.4;cursor:not-allowed;transform:none}
.${COL_CLASS} .apc-note{flex:0 0 auto;font-size:10px;color:#c98a5a;line-height:1.5}
.${COL_CLASS} .apc-note.bad{color:#ff8a8a}
.${COL_CLASS} .apc-note:empty{display:none}
`;
    document.head.appendChild(st);
}

/** 面板里所有「整行」元素，按从上到下的 DOM 顺序（.bd-wrap / .bd-main 展开成它们的子级）。 */
function flowRows(node) {
    const host = node?._minimaxDomWidget?.element;
    if (!host) return [];
    const out = [];
    const walk = (el) => {
        if (!el || !el.classList) return;
        if (el.classList.contains(COL_CLASS)) return;
        if (el.classList.contains("bd-wrap") || el.classList.contains("bd-main")) {
            for (const child of el.children) walk(child);
            return;
        }
        out.push(el);
    };
    for (const el of host.children) walk(el);
    return out;
}

/** 分镜面板（分镜操作区 + 提示词区）——它必须横向贯通，预览列不许压到它头上。 */
function forcedFullRow(rows) {
    return rows.find((el) => el?.classList?.contains("bd-fl2v-detail-wrap") && el.offsetHeight > 2) || null;
}

/**
 * 逐行决定要不要给右侧预览列让位。
 * 有分镜面板时，它和它下面的行（运行状态）一律放开到整宽 —— 预览列的高度在
 * syncPreviewGeometry 里已经被压到它上沿之上，所以不会互相压；
 * 没有分镜面板时才退到「按预览列下沿做几何判断」。
 */
export function syncFlowInsets(node) {
    const host = node?._minimaxDomWidget?.element;
    if (!host || !host.classList.contains(HOST_CLASS)) return;
    const col = host.querySelector(`:scope > .${COL_CLASS}`);
    if (!col) return;
    const rows = flowRows(node);
    if (!rows.length) return;

    let openFrom = rows.length; // 默认全部收窄（安全侧）
    const forced = forcedFullRow(rows);
    if (forced) {
        openFrom = rows.indexOf(forced);
    } else {
        const bottom = col.getBoundingClientRect().bottom;
        for (let i = 0; i < rows.length; i++) {
            const el = rows[i];
            if (!el || el.offsetParent === null) continue;
            const r = el.getBoundingClientRect();
            if (r.height < 2) continue;
            if (r.top >= bottom + 4) {
                openFrom = i;
                break;
            }
        }
    }
    for (let i = 0; i < rows.length; i++) {
        const el = rows[i];
        if (!el) continue;
        const want = i >= openFrom ? "0px" : "";
        if (el.style.marginRight !== want) el.style.marginRight = want;
    }
}

/**
 * 按节点里的 width / height 算预览列宽度和画面高度。
 * 宽度：先按「与时间轴等高」求理想宽度 availH * (w / h)；超过节点宽度上限时收到上限。
 * 高度：预览框钉在顶部，高度就是「这个宽度下的视频比例高」，再按可用高度封顶。
 * 另外：分镜面板要整宽，所以预览列高度还要被它的上沿压一压，再倒推列宽。
 */
export function syncPreviewGeometry(node) {
    const host = node?._minimaxDomWidget?.element;
    if (!host || !host.classList.contains(HOST_CLASS)) return;

    const availH = Math.max(120, (host.clientHeight || 600) - 12);
    const vw = widgetNumber(node, "width", 768);
    const vh = widgetNumber(node, "height", 1344);
    const ratio = vw / Math.max(1, vh);

    // 画布缩放（在画布上滚轮）会让 getBoundingClientRect 返回屏幕 px，
    // 而 clientWidth/Height 永远是布局 px。算纵向距离时要用画布 scale 换回来。
    const cScale = (() => {
        const s = Number((globalThis.app || globalThis.comfyAPI?.app?.app)?.canvas?.ds?.scale);
        return Number.isFinite(s) && s > 0 ? s : 1;
    })();

    const nodeW = Math.round(host.clientWidth || node?.size?.[0] || 1000);
    const maxW = Math.max(MIN_W, Math.round(nodeW * MAX_RATIO));

    // 头部（标签 + 文件名）≈ 20，按钮行 ≈ 28，提示 ≈ 0~16，间距 ≈ 12
    const chrome = 72;
    let capH = Math.max(MIN_STAGE_H, availH - chrome);

    // 分镜面板的上沿 = 预览列的硬下界（留 12px 呼吸）。列宽跟着倒推，
    // 竖屏视频于是自己变窄，而不是把镜头卡片压到视频底下。
    const forced = forcedFullRow(flowRows(node));
    if (forced) {
        const raw =
            forced.getBoundingClientRect().top - host.getBoundingClientRect().top;
        const top = raw / cScale;
        // 只在上沿确实「够用」时才拿它压高度；压到比播放器最小值还小就没意义了，
        // 那个位置留给 max-height + stage 收缩去兜。
        if (top > 150) capH = Math.max(MIN_STAGE_H, Math.min(capH, top - 18 - chrome));
    }

    const colW = Math.max(
        MIN_W,
        Math.round(Math.min(availH * ratio, maxW, Math.max(MIN_W, capH * ratio)))
    );
    host.style.setProperty(VAR_W, `${colW}px`);

    const stageH = Math.max(MIN_STAGE_H, Math.round(Math.min(colW / Math.max(0.05, ratio), capH)));
    host.style.setProperty("--alber-prev-stage-h", `${stageH}px`);

    // 列宽变了，哪些行还能整宽就跟着变
    syncFlowInsets(node);
    return colW;
}

function targetDir(node) {
    const typed = String(widgetByName(node, "mp4_dir")?.value ?? "").trim();
    if (typed) return typed;
    const last = node?.properties?.[PROP_DIR];
    return last ? String(last) : "";
}

/** 更新面板显示。rec = {path, dir, size, frames, fallback} */
export function setMp4Result(node, rec, force = false) {
    if (!node || !rec) return;
    const path = String(rec.path || "");
    if (!path) return;

    // onExecuted 和全局 executed 事件可能都会触发一次，同一路径短时间只处理一次
    const now = Date.now();
    if (!force && node._alberMp4Last === path && now - (node._alberMp4LastAt || 0) < 3000) return;
    node._alberMp4Last = path;
    node._alberMp4LastAt = now;

    if (!node.properties) node.properties = {};
    node.properties[PROP_PATH] = path;
    if (rec.dir) node.properties[PROP_DIR] = String(rec.dir);

    const col = node._alberPreviewCol;
    if (!col) return;
    const stage = col.querySelector(".apc-stage");
    const video = col.querySelector(".apc-video");
    const file = col.querySelector(".apc-file");
    const note = col.querySelector(".apc-note");
    const newTab = col.querySelector(".apc-newtab");

    const parts = [rec.filename || path.split(/[\\/]/).pop() || path];
    const size = fmtSize(rec.size);
    if (size) parts.push(size);
    if (rec.frames) parts.push(`${rec.frames} 帧`);
    file.dataset.label = parts.join(" · ");
    file.textContent = file.dataset.label;
    file.title = `${path}\n（点击复制路径）`;
    file.classList.add("has");

    const url = previewUrl(path, Date.now());
    video.src = url;
    try {
        video.load();
    } catch {
        /* ignore */
    }
    stage.classList.add("has");
    stage.classList.remove("is-playing");

    if (newTab) {
        newTab.href = url;
        newTab.style.pointerEvents = "";
        newTab.style.opacity = "";
        newTab.removeAttribute("aria-disabled");
    }
    const notes = [];
    if (rec.fallback) notes.push("保存目录不可用，已回退到 ComfyUI output 目录。");
    // 帧里有 NaN 时编码出来就是缺块/全黑，这里直接说明，别让人以为是播放器的问题
    if (rec.warning) notes.push(String(rec.warning));
    note.textContent = notes.join(" ");
    note.classList.toggle("bad", !!rec.warning);
    try {
        node.setDirtyCanvas?.(true, true);
    } catch {
        /* ignore */
    }
}

/** 从 ui 消息里捞出 mp4 记录。 */
export function captureMp4Message(node, message) {
    if (!node || !message) return;
    const list = message.alber_mp4 ?? message.alberMp4 ?? null;
    if (!list) {
        const texts = message.text;
        const arr = Array.isArray(texts) ? texts : texts ? [texts] : [];
        for (const t of arr) {
            const m = /^MP4:\s*(.+)$/.exec(String(t || "").trim());
            if (m) {
                setMp4Result(node, { path: m[1].trim() });
                return;
            }
        }
        return;
    }
    const rec = Array.isArray(list) ? list[0] : list;
    if (rec && rec.path) setMp4Result(node, rec);
}

/** 构建右侧预览列 DOM。 */
function buildColumn(node) {
    injectCss();

    const col = document.createElement("div");
    col.className = COL_CLASS;
    col.innerHTML = `
      <div class="apc-head">
        <span class="apc-tag">成片</span>
        <span class="apc-file">尚未出片</span>
      </div>
      <div class="apc-stage">
        <video class="apc-video" controls playsinline preload="metadata"></video>
        <button type="button" class="apc-play" title="播放">&#9654;</button>
        <div class="apc-empty">
          <b>跑完自动保存并在这里预览</b>
          <span>保存目录留空 = output 目录</span>
        </div>
      </div>
      <div class="apc-actions">
        <button type="button" class="apc-btn primary apc-open" title="在资源管理器里打开保存目录">目录</button>
        <button type="button" class="apc-btn apc-reload" title="重新读取文件信息并刷新预览">刷新</button>
        <a class="apc-btn apc-newtab" target="_blank" rel="noopener" title="浏览器里新窗口全屏播放">弹出</a>
      </div>
      <div class="apc-note"></div>`;

    const file = col.querySelector(".apc-file");
    const note = col.querySelector(".apc-note");
    const stage = col.querySelector(".apc-stage");
    const video = col.querySelector(".apc-video");
    const playBtn = col.querySelector(".apc-play");
    const openBtn = col.querySelector(".apc-open");
    const reloadBtn = col.querySelector(".apc-reload");
    const newTab = col.querySelector(".apc-newtab");

    // 自绘播放键 + 点画面本身都能播/停
    playBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            video.play();
        } catch {
            /* 浏览器可能因自动播放策略拒绝，用户再点一次即可 */
        }
    });
    video.addEventListener("click", (e) => {
        // 底部 44px 是原生控制条的地盘：那里点播放/暂停由浏览器处理，
        // 这里再切一次会「按一下播了又立刻停」，看着就像点了没反应。
        const r = video.getBoundingClientRect();
        if (e.clientY - r.top > r.height - 44) return;
        if (video.paused) {
            try {
                video.play();
            } catch {
                /* ignore */
            }
        } else {
            video.pause();
        }
    });
    const syncPlaying = () => stage.classList.toggle("is-playing", !video.paused);
    video.addEventListener("play", syncPlaying);
    video.addEventListener("playing", syncPlaying);
    video.addEventListener("pause", syncPlaying);
    video.addEventListener("ended", syncPlaying);
    // 文件被移动/正在写入时 <video> 是空的，光看画面会以为是「播放键坏了」，
    // 这里把原因说出来。
    video.addEventListener("error", () => {
        if (!node?.properties?.[PROP_PATH]) return;
        note.textContent = "预览加载失败：文件可能已被移动、正在写入，或路径已失效。点「刷新」重试。";
        note.classList.add("bad");
    });

    newTab.style.pointerEvents = "none";
    newTab.style.opacity = ".4";
    newTab.setAttribute("aria-disabled", "true");

    // 列内的交互一律不要冒泡到画布。
    // 补上 pointerup / auxclick：ComfyUI 画布有些版本在 pointerup 上收尾拖拽，
    // 只挡 pointerdown 会让上层以为「按到了画布」，顺手把选中/拖拽状态改掉。
    ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick"].forEach(
        (ev) => {
            col.addEventListener(ev, (e) => e.stopPropagation());
        }
    );
    col.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    col.addEventListener("contextmenu", (e) => e.stopPropagation());

    openBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 不用 disabled：调 explorer 有 1~2 秒延迟，禁用了连 hover 都没了，
        // 用户会以为按钮坏了、反复点。改成忙碌标记，静默忽略重复点击。
        if (node._alberOpenBusy) return;
        node._alberOpenBusy = true;
        openBtn.classList.add("busy");
        try {
            const res = await fetch(
                `/alber/director/open_folder?path=${encodeURIComponent(targetDir(node))}`,
                { cache: "no-store" }
            );
            const data = await res.json();
            note.textContent = data?.ok ? "" : data?.error || "打开目录失败。";
        } catch (err) {
            note.textContent = `打开目录失败：${err?.message || err}`;
        } finally {
            setTimeout(() => {
                node._alberOpenBusy = false;
                openBtn.classList.remove("busy");
            }, 300);
        }
    });

    reloadBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (node._alberReloadBusy) return;
        const path = node?.properties?.[PROP_PATH];
        if (!path) {
            note.textContent = "还没有出过片。";
            return;
        }
        node._alberReloadBusy = true;
        reloadBtn.classList.add("busy");
        try {
            const res = await fetch(`/alber/director/mp4_info?path=${encodeURIComponent(path)}`, {
                cache: "no-store",
            });
            const info = await res.json();
            if (!info?.exists) {
                stage.classList.remove("has");
                file.textContent = "文件已不存在";
                file.classList.remove("has");
                note.textContent = `找不到：${path}`;
                return;
            }
            setMp4Result(node, { ...info, path: info.path }, true);
            note.textContent = "";
        } catch (err) {
            note.textContent = `刷新失败：${err?.message || err}`;
        } finally {
            setTimeout(() => {
                node._alberReloadBusy = false;
                reloadBtn.classList.remove("busy");
            }, 250);
        }
    });

    // 点文件名复制完整路径（ComfyUI 跑在 127.0.0.1，属于安全上下文）
    file.addEventListener("click", async (e) => {
        e.stopPropagation();
        const path = node?.properties?.[PROP_PATH];
        if (!path) return;
        try {
            await navigator.clipboard.writeText(path);
            file.textContent = "已复制完整路径";
            setTimeout(() => {
                file.textContent = file.dataset.label || "尚未出片";
            }, 1200);
        } catch {
            file.textContent = path;
        }
    });

    node._alberPreviewCol = col;

    // 工作流重新打开：恢复上次的路径
    const saved = node?.properties?.[PROP_PATH];
    if (saved) setMp4Result(node, { path: saved, dir: node?.properties?.[PROP_DIR] });

    return col;
}

/** 把预览列挂到 host 右侧（幂等）。 */
export function installPreviewColumn(node) {
    const host = node?._minimaxDomWidget?.element;
    if (!host) return false;

    if (!host.classList.contains(HOST_CLASS)) host.classList.add(HOST_CLASS);

    const existing = host.querySelector(`:scope > .${COL_CLASS}`);
    if (!existing) {
        const col = buildColumn(node);
        host.appendChild(col);
        // 首次挂载：按当前分辨率定宽，并把节点补宽一次，
        // 否则时间轴会被硬生生挤窄（只补一次，记在 properties 里）。
        syncPreviewGeometry(node);
        const colW = parseInt(host.style.getPropertyValue(VAR_W) || "320", 10) || 320;
        const cur = Math.round(node?.size?.[0] || 1000);
        if (!node.properties) node.properties = {};
        if (!node.properties.alberPreviewWidened && cur < 1400) {
            node.properties.alberPreviewWidened = true;
            try {
                node.setSize([cur + colW + 16, node.size?.[1] || 680]);
            } catch {
                /* ignore */
            }
        }
    } else {
        node._alberPreviewCol = existing;
    }

    syncPreviewGeometry(node);

    // host 尺寸变了（用户拖节点边缘）就重算列宽
    if (!host._alberPrevObserver) {
        let lastW = 0;
        let lastH = 0;
        const mo = new ResizeObserver(() => {
            // 只对「真的变了」的尺寸重算。1~2px 的抖动（滚动条出现/消失、
            // 文字换行）如果也触发重排，会和下面的 .bd-main 观察器互相喂养，
            // 界面持续抖动时鼠标按下的元素会移位——这就是「有时候点不中」。
            const w = host.clientWidth;
            const h = host.clientHeight;
            if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2) return;
            lastW = w;
            lastH = h;
            if (node._alberPrevRaf) return;
            node._alberPrevRaf = requestAnimationFrame(() => {
                node._alberPrevRaf = 0;
                syncPreviewGeometry(node);
            });
        });
        mo.observe(host);
        host._alberPrevObserver = mo;
    }

    // 内容行增减（切模式、加镜头、展开参数）会改 .bd-main 的高度：
    // 分镜面板的上沿动了，预览列的高度/宽度就得重新压一次。
    // 收窄↔放开会互相影响，所以每帧只跑一次，并给一串连续重算设上限，防止来回抖。
    const wrap = host.querySelector(":scope > .bd-wrap");
    const main = wrap?.querySelector(":scope > .bd-main");
    if (main && main._alberFlowObserver !== host) {
        if (host._alberFlowObserver) host._alberFlowObserver.disconnect();
        let lastMainH = 0;
        const mo = new ResizeObserver(() => {
            const h = main.offsetHeight;
            if (Math.abs(h - lastMainH) < 4) return; // 阈值：小抖动不重排
            lastMainH = h;
            if (node._alberFlowRaf) return;
            node._alberFlowRaf = requestAnimationFrame(() => {
                node._alberFlowRaf = 0;
                const n = (node._alberFlowBurst || 0) + 1;
                node._alberFlowBurst = n;
                clearTimeout(node._alberFlowTimer);
                node._alberFlowTimer = setTimeout(() => {
                    node._alberFlowBurst = 0;
                }, 500);
                if (n > 8) return; // 收不住了就先停手，避免无限重排
                syncPreviewGeometry(node);
            });
        });
        mo.observe(main);
        host._alberFlowObserver = mo;
        main._alberFlowObserver = host;
    }
    // DOM 刚建好时行可能还没排版完，隔一帧再补一次
    if (!node._alberFlowOnce) {
        node._alberFlowOnce = true;
        requestAnimationFrame(() => syncPreviewGeometry(node));
        setTimeout(() => syncPreviewGeometry(node), 260);
    }
    return true;
}

let GLOBAL_HOOKED = false;

/** 兜底：部分前端版本不派发 node.onExecuted，这里按 node id 直接找。 */
function installGlobalListener() {
    if (GLOBAL_HOOKED) return;
    GLOBAL_HOOKED = true;
    try {
        app.api?.addEventListener?.("executed", (e) => {
            const d = e?.detail || {};
            const id = d.node ?? d.display_node;
            const target = app.graph?.getNodeById?.(id);
            if (target?._alberPreviewCol) captureMp4Message(target, d.output);
        });
    } catch (err) {
        console.warn("[Alber] MP4 全局监听注册失败", err);
    }
}

/** 包装 node.onExecuted（同时监听 width/height，改了立刻重排列宽）。 */
export function hookMp4Panel(node) {
    if (!node || node._alberMp4Hooked) return;
    node._alberMp4Hooked = true;
    installGlobalListener();

    const orig = node.onExecuted;
    node.onExecuted = function (message) {
        const out = orig?.apply(this, arguments);
        try {
            captureMp4Message(this, message);
        } catch (err) {
            console.warn("[Alber] MP4 预览处理失败", err);
        }
        return out;
    };

    // 改分辨率 = 预览列宽度跟着变
    const origChanged = node.onWidgetChanged;
    node.onWidgetChanged = function (name, ...rest) {
        const out = origChanged?.apply(this, [name, ...rest]);
        if (name === "width" || name === "height") {
            syncPreviewGeometry(this);
        }
        return out;
    };
}
