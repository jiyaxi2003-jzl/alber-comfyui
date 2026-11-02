// Alber 导演台 · 批量出首尾帧
// ---------------------------------------------------------------------------
// 一次给整条时间轴出图：每个镜头一行，可单独改画面提示词、勾选要不要出，
// 串行提交给 ComfyUI 队列（一次一张，16G 显存最稳），出完自动回填槽位。
//
// 复用 alber_frame_gen.js 的 generateFrame()，所以和单张面板用的是同一套
// Qwen-Image 2.1 链路、同样的画幅。
//
// 几个约定：
//   · 画面提示词留空 = 用该镜头的「镜头提示词」，两样都空就跳过并标「无提示词」
//   · 尾帧默认带一句收尾后缀，否则首尾两张会是一模一样的图
//   · 「只补空槽」勾上时，已经有图的槽位不重出（默认勾上，最常用的就是补齐）
// ---------------------------------------------------------------------------

import {
    generateFrame,
    cancelFrameJob,
    nodeCanvasSize,
    framePromptOf,
} from "./alber_frame_gen.js";
import { isDarkTheme } from "./alber_palette.js";

const STYLE_ID = "alber-bf-style";
const TAIL_SUFFIX = "，这一镜动作收尾的瞬间，画面稳定，构图完整";

let panelEl = null;

export function isBatchFrameOpen() {
    return !!panelEl;
}

/** 当前是否有一批在跑（外部据此禁用按钮）。 */
let running = false;
export function isBatchFrameRunning() {
    return running;
}

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
.alber-bf-mask{position:fixed;inset:0;z-index:100210;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.58);font:12px/1.5 system-ui,"Microsoft YaHei",sans-serif}
.alber-bf-card{width:min(760px,95vw);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;
  border-radius:10px;box-shadow:0 18px 60px rgba(0,0,0,.55);border:1px solid #3a3a44;background:#1e1e22;color:#dcdce4}
.alber-bf-card.light{border-color:#d5d5de;background:#fff;color:#24242c}
.alber-bf-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #31313a;flex:0 0 auto}
.alber-bf-card.light .alber-bf-head{border-bottom-color:#e6e6ee}
.alber-bf-head b{font-size:13px}
.alber-bf-head .sub{opacity:.6;font-size:11px;margin-left:auto;white-space:nowrap}
.alber-bf-x{all:unset;cursor:pointer;width:22px;height:22px;line-height:22px;text-align:center;border-radius:6px;opacity:.7}
.alber-bf-x:hover{background:rgba(130,130,160,.22);opacity:1}

.alber-bf-opts{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;padding:10px 12px;
  border-bottom:1px solid #2b2b33;font-size:11px;flex:0 0 auto}
.alber-bf-card.light .alber-bf-opts{border-bottom-color:#e6e6ee}
.alber-bf-opts label{display:inline-flex;align-items:center;gap:5px;cursor:pointer;white-space:nowrap}
.alber-bf-opts select,.alber-bf-opts input[type=number]{font:11px/1.4 inherit;padding:3px 5px;border-radius:5px;
  background:#17171a;color:#dcdce4;border:1px solid #3a3a44;outline:none}
.alber-bf-card.light .alber-bf-opts select,.alber-bf-card.light .alber-bf-opts input[type=number]{
  background:#f7f7fa;color:#24242c;border-color:#d5d5de}
.alber-bf-opts .grow{flex:1 1 auto;min-width:150px}
.alber-bf-opts .grow input[type=text]{width:100%;box-sizing:border-box}
.alber-bf-opts .alber-bf-btn{padding:3px 9px;font-size:11px}

.alber-bf-list{flex:1 1 auto;min-height:120px;overflow:auto;padding:8px 12px;display:flex;flex-direction:column;gap:6px}
.alber-bf-row{display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border-radius:7px;
  border:1px solid #2e2e37;background:#1a1a1e}
.alber-bf-card.light .alber-bf-row{border-color:#e2e2ea;background:#fafafd}
.alber-bf-row.on{border-color:#3c6f52}
.alber-bf-card.light .alber-bf-row.on{border-color:#a8d8bf}
.alber-bf-row .no{flex:0 0 26px;font-size:11px;opacity:.75;padding-top:4px;text-align:right}
.alber-bf-row .ck{flex:0 0 auto;margin-top:5px;cursor:pointer}
.alber-bf-row .mid{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}
.alber-bf-row textarea{width:100%;box-sizing:border-box;min-height:34px;max-height:90px;resize:vertical;
  border-radius:6px;padding:5px 7px;font:11px/1.5 inherit;outline:none;
  background:#131316;color:#dcdce4;border:1px solid #343440}
.alber-bf-card.light .alber-bf-row textarea{background:#fff;color:#24242c;border-color:#d5d5de}
.alber-bf-row textarea:focus{border-color:#5ec8ff}
.alber-bf-row .tags{display:flex;gap:6px;align-items:center;font-size:10px;opacity:.7;flex-wrap:wrap}
.alber-bf-row .tags .slot{font-family:ui-monospace,Consolas,monospace;padding:0 4px;border-radius:4px;
  border:1px solid #3a3a44}
.alber-bf-row .tags .slot.has{border-color:#4a7c5c;color:#7fdca0}
.alber-bf-card.light .alber-bf-row .tags .slot.has{border-color:#4a9b6c;color:#1f7a45}
.alber-bf-row .st{flex:0 0 74px;text-align:right;font-size:10px;opacity:.7;padding-top:5px}
.alber-bf-row .st.busy{color:#5ec8ff;opacity:1}
.alber-bf-row .st.ok{color:#4fff8f;opacity:1}
.alber-bf-card.light .alber-bf-row .st.ok{color:#178a4b}
.alber-bf-row .st.err{color:#ff7b7b;opacity:1}
.alber-bf-row .st.skip{opacity:.5}

.alber-bf-foot{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid #31313a;flex:0 0 auto}
.alber-bf-card.light .alber-bf-foot{border-top-color:#e6e6ee}
.alber-bf-status{font-size:11px;opacity:.78;margin-right:auto;min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.alber-bf-btn{all:unset;cursor:pointer;padding:5px 12px;border-radius:7px;font-size:12px;border:1px solid #3f3f4a;
  background:#26262c;color:#dcdce4;white-space:nowrap}
.alber-bf-card.light .alber-bf-btn{background:#f2f2f7;color:#24242c;border-color:#d5d5de}
.alber-bf-btn:hover{border-color:#5ec8ff}
.alber-bf-btn[disabled]{opacity:.45;cursor:default;border-color:#3f3f4a}
.alber-bf-btn.primary{background:#2f6fd0;border-color:#2f6fd0;color:#fff}
.alber-bf-btn.primary:hover{background:#3a7de0}
.alber-bf-card.light .alber-bf-btn.primary{background:#2f6fd0;border-color:#2f6fd0;color:#fff}
.alber-bf-btn.danger{color:#ff8a8a}
.alber-bf-bar{height:3px;border-radius:2px;background:#2a2a33;overflow:hidden;margin:0 12px 8px;flex:0 0 auto}
.alber-bf-bar > i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2f6fd0,#4fff8f);
  transition:width .2s}
`;
    document.head.appendChild(st);
}

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

/** 该镜头这一行实际用的画面提示词：本行文本 > shot.framePrompt > 镜头提示词。 */
function promptForRow(row, shot) {
    return String(row?.ta?.value || "").trim() || framePromptOf(shot) || String(shot?.prompt || "").trim();
}

/**
 * 打开批量面板。
 * hooks.syncFromShots / refreshDetail 由 minimax_fl2v 注入。
 */
export function openBatchFrameDialog(editor, hooks = {}) {
    ensureStyle();
    if (panelEl) return panelEl;
    const shots = editor?.timeline?.shots || [];
    if (!shots.length) {
        alert("先添加至少一组镜头");
        return null;
    }

    const size = nodeCanvasSize(editor);
    const dark = isDarkTheme();

    const mask = el("div", "alber-bf-mask");
    const card = el("div", `alber-bf-card${dark ? "" : " light"}`);

    const head = el("div", "alber-bf-head");
    head.appendChild(el("b", null, "✦ 批量出首尾帧"));
    head.appendChild(el("span", "sub", `Qwen-Image 2.1 · ${size.width}×${size.height}`));
    const closeBtn = el("button", "alber-bf-x", "×");
    closeBtn.type = "button";
    head.appendChild(closeBtn);

    // ---- 选项区 ----
    const opts = el("div", "alber-bf-opts");
    const modeSel = document.createElement("select");
    for (const [v, label] of [["start", "只出首帧"], ["end", "只出尾帧"], ["both", "首帧 + 尾帧"]]) {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = label;
        modeSel.appendChild(o);
    }
    const modeWrap = document.createElement("label");
    modeWrap.append(el("span", null, "目标槽"), modeSel);

    const onlyEmpty = document.createElement("input");
    onlyEmpty.type = "checkbox";
    onlyEmpty.checked = true;
    const emptyWrap = el("label");
    emptyWrap.append(onlyEmpty, el("span", null, "只补空槽"));

    const tailSuffix = document.createElement("input");
    tailSuffix.type = "text";
    tailSuffix.value = TAIL_SUFFIX;
    tailSuffix.title = "出尾帧时接在画面提示词后面（留空 = 首尾同图）";
    const suffixWrap = el("label", "grow");
    suffixWrap.append(el("span", null, "尾帧后缀"), tailSuffix);

    const selAllBtn = el("button", "alber-bf-btn", "全选");
    const selNoneBtn = el("button", "alber-bf-btn", "全不选");
    const onlyMissingBtn = el("button", "alber-bf-btn", "只勾缺图");
    for (const b of [selAllBtn, selNoneBtn, onlyMissingBtn]) b.type = "button";
    opts.append(modeWrap, emptyWrap, suffixWrap, selAllBtn, selNoneBtn, onlyMissingBtn);

    // ---- 列表 ----
    const list = el("div", "alber-bf-list");
    const rows = [];

    shots.forEach((shot, i) => {
        const row = el("div", "alber-bf-row on");
        const ck = document.createElement("input");
        ck.type = "checkbox";
        ck.className = "ck";
        ck.checked = true;
        const no = el("div", "no", String(i + 1));
        const mid = el("div", "mid");

        const ta = document.createElement("textarea");
        ta.value = framePromptOf(shot);
        ta.placeholder = "留空 = 用镜头提示词";
        ta.spellcheck = false;
        ta.rows = 2;
        ta.addEventListener("input", () => {
            // 顺手记回镜头，关掉面板也不丢
            const live = editor?.timeline?.shots?.[i];
            const v = ta.value.trim();
            if (live) live.framePrompt = v;
            shot.framePrompt = v;
            editor.scheduleTimelineSync?.();
        });
        ta.addEventListener("keydown", (e) => e.stopPropagation());

        const tags = el("div", "tags");
        const startTag = el("span", "tags-slot slot", "首");
        const endTag = el("span", "tags-slot slot", "尾");
        const fc = el("span", null, `${shot.durationSec ?? ""}s`);
        tags.append(startTag, endTag, fc);

        mid.append(ta, tags);
        const st = el("div", "st", "");
        row.append(ck, no, mid, st);
        ck.addEventListener("change", () => row.classList.toggle("on", ck.checked));

        list.appendChild(row);
        rows.push({ row, ck, ta, st, shot, index: i, startTag, endTag });
    });

    // ---- 底部 ----
    const bar = el("div", "alber-bf-bar");
    const barFill = document.createElement("i");
    bar.appendChild(barFill);

    const foot = el("div", "alber-bf-foot");
    const status = el("span", "alber-bf-status", "");
    const startBtn = el("button", "alber-bf-btn primary", "开始生成");
    const stopBtn = el("button", "alber-bf-btn danger", "停止");
    stopBtn.disabled = true;
    for (const b of [startBtn, stopBtn]) b.type = "button";
    foot.append(status, stopBtn, startBtn);

    card.append(head, opts, list, bar, foot);
    mask.appendChild(card);
    document.body.appendChild(mask);
    panelEl = mask;

    const setStatus = (txt) => {
        status.textContent = txt || "";
    };

    // 槽位标记 + 状态刷新
    const refreshRowMeta = () => {
        for (const r of rows) {
            const live = editor?.timeline?.shots?.[r.index] || r.shot;
            const hasStart = !!live?.startImage?.imageFile;
            const hasEnd = !!live?.endImage?.imageFile;
            r.startTag.classList.toggle("has", hasStart);
            r.endTag.classList.toggle("has", hasEnd);
            r.startTag.textContent = hasStart ? "首✓" : "首";
            r.endTag.textContent = hasEnd ? "尾✓" : "尾";
        }
    };
    refreshRowMeta();

    const planFor = () => {
        const mode = modeSel.value;
        const jobs = [];
        for (const r of rows) {
            if (!r.ck.checked) continue;
            const live = editor?.timeline?.shots?.[r.index] || r.shot;
            const base = promptForRow(r, live);
            const wants = mode === "both" ? ["start", "end"] : [mode];
            for (const slot of wants) {
                const filled = slot === "start" ? !!live?.startImage?.imageFile : !!live?.endImage?.imageFile;
                if (onlyEmpty.checked && filled) continue;
                jobs.push({ row: r, slot, base, filled });
            }
        }
        return jobs;
    };

    const updatePlan = () => {
        const jobs = planFor();
        const noPrompt = jobs.filter((j) => !j.base).length;
        const parts = [`将生成 ${jobs.length} 张`];
        if (noPrompt) parts.push(`其中 ${noPrompt} 张缺提示词（会跳过）`);
        setStatus(parts.join(" · "));
        return jobs;
    };

    let cancelled = false;
    let currentPromptId = null;

    const teardown = () => {
        if (running) return;
        if (panelEl === mask) panelEl = null;
        mask.remove();
        document.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            teardown();
        }
    };
    document.addEventListener("keydown", onKey, true);
    closeBtn.addEventListener("click", teardown);
    mask.addEventListener("pointerdown", (e) => {
        if (e.target === mask) teardown();
    });

    modeSel.addEventListener("change", updatePlan);
    onlyEmpty.addEventListener("change", updatePlan);
    selAllBtn.addEventListener("click", () => {
        for (const r of rows) {
            r.ck.checked = true;
            r.row.classList.add("on");
        }
        updatePlan();
    });
    selNoneBtn.addEventListener("click", () => {
        for (const r of rows) {
            r.ck.checked = false;
            r.row.classList.remove("on");
        }
        updatePlan();
    });
    onlyMissingBtn.addEventListener("click", () => {
        for (const r of rows) {
            const live = editor?.timeline?.shots?.[r.index] || r.shot;
            const mode = modeSel.value;
            const need =
                (mode !== "end" && !live?.startImage?.imageFile) ||
                (mode !== "start" && !live?.endImage?.imageFile);
            r.ck.checked = need;
            r.row.classList.toggle("on", need);
        }
        updatePlan();
    });
    updatePlan();

    const setBusy = (on) => {
        running = on;
        startBtn.disabled = on;
        stopBtn.disabled = !on;
        for (const r of rows) r.ta.disabled = on;
        closeBtn.style.opacity = on ? ".35" : "";
    };

    stopBtn.addEventListener("click", () => {
        cancelled = true;
        setStatus("正在停止…（当前这张跑完就停）");
        void cancelFrameJob(currentPromptId);
    });

    startBtn.addEventListener("click", async () => {
        if (running) return;
        const jobs = planFor().filter((j) => j.base);
        if (!jobs.length) {
            setStatus("没有可生成的项（检查勾选和提示词）");
            return;
        }
        cancelled = false;
        setBusy(true);
        let done = 0;
        let failed = 0;
        const total = jobs.length;
        barFill.style.width = "0%";

        for (let k = 0; k < jobs.length; k++) {
            const job = jobs[k];
            if (cancelled) break;
            const live = editor?.timeline?.shots?.[job.row.index];
            if (!live) continue;
            const prompt = job.slot === "end" ? job.base + (tailSuffix.value || "") : job.base;
            job.row.st.classList.remove("ok", "err", "skip");
            job.row.st.classList.add("busy");
            job.row.st.textContent = "生成中";
            setStatus(`第 ${k + 1}/${total} 张 · 第 ${job.row.index + 1} 组${job.slot === "end" ? " 尾帧" : " 首帧"}`);

            try {
                const out = await generateFrame({
                    prompt,
                    negative: "",
                    width: size.width,
                    height: size.height,
                    steps: 25,
                    onStatus: (txt) => {
                        job.row.st.textContent = txt.slice(0, 6);
                    },
                    onQueued: (id) => {
                        currentPromptId = id;
                    },
                    isCancelled: () => cancelled,
                });
                currentPromptId = null;
                // 写到「活」的镜头对象上，syncFl2vFromShots 会重建 shots，所以两条都写
                live[job.slot === "end" ? "endImage" : "startImage"] = out.ref;
                job.row.shot[job.slot === "end" ? "endImage" : "startImage"] = out.ref;
                job.row.st.classList.remove("busy");
                job.row.st.classList.add("ok");
                job.row.st.textContent = "完成";
                done += 1;
                refreshRowMeta();
                hooks.syncFromShots?.(editor);
                editor.scheduleTimelineSync?.();
                editor.scheduleRender?.();
            } catch (err) {
                console.error("[Alber batch-frame]", err);
                currentPromptId = null;
                job.row.st.classList.remove("busy");
                job.row.st.classList.add("err");
                job.row.st.textContent = cancelled ? "已停" : "失败";
                if (!cancelled) failed += 1;
            }
            barFill.style.width = `${Math.round(((k + 1) / total) * 100)}%`;
        }

        setBusy(false);
        // 统一提交一次，别每张都重建整个面板
        editor.commit?.(false, { syncTimeline: true });
        hooks.refreshDetail?.(editor);
        editor.updateVideoNameLabel?.();
        editor.scheduleRender?.();
        editor.updateDomWidgetHeight?.();
        refreshRowMeta();
        setStatus(
            cancelled
                ? `已停止 · 完成 ${done} 张`
                : `完成 ${done} 张${failed ? ` · 失败 ${failed} 张` : ""}`,
        );
    });

    return mask;
}
