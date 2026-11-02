/**
 * First/last-frame (fl2v) timeline — explicit shot groups.
 * Each shot = { startImage and/or endImage (neither = t2v; official allows end-only), durationSec }.
 * Total duration = sum of shot durations. Timeline shows one block per shot.
 */

import { api } from "../../scripts/api.js";
import { createLoraSection, normalizeLoraRows } from "./minimax_segment_loras.js";
import {
    defaultDurationSec,
    defaultFrameCount,
    durationToMiniMaxFrames,
    isContinuityMasterEnabled,
    isSegmentContinuityFromPrev,
    MAX_GEN_FRAMES,
    maxDurationSec,
    minDurationSec,
    minFrameCount,
    preferredDurationSecFromFrames,
    resolveTaskKey,
    roundDurationSec,
    segmentContinuityPinMode,
    fileForComfyUpload,
} from "./minimax_gen_timeline.js";
import { t } from "./minimax_i18n.js";
import { openFrameGenDialog } from "./alber_frame_gen.js";
import { openBatchFrameDialog } from "./alber_batch_frames.js";
import { openScriptBoard } from "./alber_script_board.js";
import { openEnhanceDialog } from "./alber_enhance.js";
import { mountPromptLibTriggers, installPromptLibAutoAttach } from "./alber_prompt_lib.js";
import { showContextMenu, copyToClipboard, readClipboard } from "./alber_ctx_menu.js";

export const FL2V_STYLES = `
.bd-fl2v-detail-wrap{width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:8px}
.bd-fl2v-group-bar{position:relative}
.bd-fl2v-help{margin-left:auto;position:relative;flex:0 0 auto;display:inline-flex;align-items:center}
.bd-fl2v-help-btn{width:22px;height:22px;border-radius:50%;border:1px solid #3a3a3a;background:#1c1c1c;color:#8d8;font-size:13px;font-weight:700;line-height:1;cursor:help;padding:0;display:inline-flex;align-items:center;justify-content:center}
.bd-fl2v-help-btn:hover,.bd-fl2v-help:focus-within .bd-fl2v-help-btn{border-color:#4fff8f;color:#4fff8f}
.bd-fl2v-help-pop{display:none;position:absolute;right:0;top:calc(100% + 6px);width:min(560px,72vw);z-index:30;color:#aaa;font-size:11px;line-height:1.45;background:#181818;border:1px solid #333;border-radius:6px;padding:8px 10px;box-shadow:0 8px 24px rgba(0,0,0,.45)}
/* 分镜面板是通长的，? 按钮就贴在节点最右边；弹层原来从那儿往左铺 560px，
   悬停时直接盖住右侧预览列（弹层 z-index 30 > 预览列的 auto），
   于是播放键、目录/刷新/弹出全都点不中，鼠标一移又"好了"。
   这里让它停在预览列左边界之外，两家谁也不压谁。 */
.mmx-host .bd-fl2v-help-pop{right:calc(var(--alber-prev-w, 0px) + 10px)}
/* 注意：这里不能写 max-width:calc(100% - var(--alber-prev-w))——
   .bd-fl2v-help 自己只有 22px 宽，百分比按它算会得到负值，弹层直接塌成 0。 */
.bd-fl2v-help:hover .bd-fl2v-help-pop,.bd-fl2v-help:focus-within .bd-fl2v-help-pop{display:block}
.bd-fl2v-help-pop b{color:#4fff8f;font-weight:600}
.bd-fl2v-workbench{display:flex;flex-wrap:nowrap;gap:12px;align-items:stretch;width:100%;box-sizing:border-box}
.bd-fl2v-workbench .bd-live-sample{flex:0 0 320px;min-width:280px;max-width:560px;min-height:320px;display:flex;flex-direction:column}
.bd-fl2v-workbench .bd-live-sample .bd-live-sample-body{flex:1 1 auto;min-height:260px;max-height:none}
.bd-fl2v-workbench .bd-live-sample .bd-live-sample-body img{width:100%;height:100%;max-height:420px;object-fit:contain}
.bd-fl2v-workbench .bd-fl2v-shots{flex:1 1 auto;min-width:0}
/* 镜头条：一行贯通、不换行，横向滚动；空白处按住可拖动平移 */
.bd-fl2v-shots{display:flex;flex-wrap:nowrap;gap:10px;align-items:stretch;overflow-x:auto;overflow-y:hidden;padding-bottom:6px;scrollbar-width:thin;scrollbar-color:#4a4a58 transparent;cursor:grab}
.bd-fl2v-shots.panning{cursor:grabbing;scroll-behavior:auto}
.bd-fl2v-shots::-webkit-scrollbar{height:8px}
.bd-fl2v-shots::-webkit-scrollbar-track{background:transparent}
.bd-fl2v-shots::-webkit-scrollbar-thumb{background:#4a4a58;border-radius:4px}
.bd-fl2v-shot{flex:0 0 248px;width:248px;box-sizing:border-box;background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:6px;cursor:default;transition:border-color .15s,opacity .15s}
.bd-fl2v-shot:hover{border-color:#555}
.bd-fl2v-shot.selected{border-color:#4fff8f;box-shadow:0 0 0 1px rgba(79,255,143,.35)}
.bd-fl2v-shot.shot-dragging{opacity:.4}
.bd-fl2v-shot.shot-drag-over{border-color:#5ec8ff;box-shadow:0 0 0 1px rgba(94,200,255,.45)}
.bd-fl2v-shot-head{display:flex;align-items:center;justify-content:flex-start;gap:6px;cursor:default;user-select:none;min-height:18px}
.bd-fl2v-shot-drag{display:flex;align-items:center;flex:0 1 auto;min-width:0;cursor:grab}
.bd-fl2v-shot-drag:active{cursor:grabbing}
.bd-fl2v-shot-head b{color:#ccc;font-size:12px}
.bd-fl2v-shot-cont{display:flex;align-items:center;position:relative;z-index:2;flex:0 0 auto;margin-left:2px}
.bd-fl2v-continuity{display:inline-flex;align-items:center;gap:3px;font-size:10px;color:#9ab;cursor:pointer;user-select:none;-webkit-user-drag:none;white-space:nowrap}
.bd-fl2v-continuity input{width:13px;height:13px;margin:0;cursor:pointer;accent-color:#6ab0ff;pointer-events:auto;-webkit-user-drag:none}
.bd-fl2v-pin-mode{margin-left:4px;height:18px;font-size:10px;padding:0 2px;border-radius:3px;border:1px solid #3a3a3a;background:#1c1c1c;color:#9ab;cursor:pointer;-webkit-user-drag:none}
.bd-fl2v-pin-mode:disabled{opacity:.4;cursor:default}
.bd-fl2v-shot-meta{color:#888;font-size:10px;flex-shrink:1;min-width:0;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bd-fl2v-slots{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.bd-fl2v-slot-wrap{position:relative;min-width:0}
.bd-fl2v-slot{position:relative;aspect-ratio:var(--fl2v-slot-ar,16/9);border:1px dashed #555;border-radius:4px;background:#111;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:pointer}
.bd-fl2v-slot.has-img{border-style:solid;border-color:#444;cursor:grab}
.bd-fl2v-slot.has-img:active{cursor:grabbing}
.bd-fl2v-slot.drag-over{border-color:#4fff8f;border-style:solid;background:#152018}
.bd-fl2v-slot.dragging{opacity:.45}
.bd-fl2v-slot img{height:100%;width:auto;max-height:100%;display:block;pointer-events:none;flex-shrink:0}
.bd-fl2v-slot .tag{position:absolute;top:4px;padding:1px 5px;border-radius:2px;font-size:9px;font-weight:700;line-height:1.4;pointer-events:none;z-index:2}
.bd-fl2v-slot .tag.start{left:4px;right:auto;background:rgba(79,255,143,.92);color:#111}
.bd-fl2v-slot .tag.end{left:auto;right:4px;background:rgba(240,160,48,.92);color:#111}
.bd-fl2v-slot .ph{color:#666;font-size:10px;text-align:center;padding:4px;line-height:1.35;pointer-events:none}
/* Clear sits outside the draggable slot so HTML5 DnD cannot steal the click. */
.bd-fl2v-slot-wrap .x{position:absolute;right:1px;top:1px;width:24px;height:24px;padding:0;margin:0;border:0;box-sizing:border-box;display:none;align-items:center;justify-content:center;border-radius:4px;background:rgba(0,0,0,.78);color:#ff8a8a;font-size:18px;font-weight:700;line-height:1;cursor:pointer;z-index:6;user-select:none;-webkit-user-select:none;font-family:inherit;appearance:none;-webkit-appearance:none}
/* End-slot clear stays top-left so it doesn't cover the top-right 尾帧 badge. */
.bd-fl2v-slot-wrap:has([data-slot="end"]) .x{left:1px;right:auto}
.bd-fl2v-slot-wrap.has-img:hover .x,
.bd-fl2v-slot-wrap:focus-within .x{display:flex}
@media (hover:none){.bd-fl2v-slot-wrap.has-img .x{display:flex}}
.bd-fl2v-slot-wrap .x:hover{background:rgba(160,30,30,.95);color:#fff}
.bd-fl2v-shot-foot{display:flex;align-items:center;justify-content:space-between;gap:8px}
.bd-fl2v-shot-row{display:flex;align-items:center;gap:6px;color:#ddd;font-size:11px;min-width:0}
.bd-fl2v-shot-row input{width:56px}
.bd-fl2v-shot-foot .bd-r2v-pick-existing{flex-shrink:0;cursor:pointer}
.bd-fl2v-detail{width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:10px}
.bd-fl2v-detail.hidden{display:none!important}
.bd-fl2v-detail .bd-label{color:#888;font-size:10px;margin-top:2px}
.bd-fl2v-detail textarea{width:100%;min-height:64px;background:#141414;border:1px solid #333;border-radius:4px;color:#eee;padding:6px;resize:vertical;font-size:11px;box-sizing:border-box;font-family:inherit;line-height:1.35}
.bd-fl2v-detail textarea:disabled{opacity:.45;cursor:not-allowed}
/* 提示词条：左边通用（对所有镜头生效），右边专属（当前选中镜头） */
.bd-fl2v-promptbar{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;width:100%;box-sizing:border-box}
.bd-fl2v-promptbar.single{grid-template-columns:minmax(0,1fr)}
.bd-fl2v-promptcell{display:flex;flex-direction:column;gap:4px;min-width:0}
.bd-fl2v-promptcell.hidden{display:none!important}
.bd-fl2v-promptcell .fp-head{display:flex;align-items:center;gap:6px;min-height:16px}
.bd-fl2v-promptcell .fp-title{font-size:11px;font-weight:650;color:#d5dbe8;letter-spacing:.02em;flex:0 0 auto}
.bd-fl2v-promptcell .fp-note{font-size:10px;color:#7f8698;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bd-fl2v-promptcell textarea{min-height:86px}
@media (max-width:720px){.bd-fl2v-promptbar{grid-template-columns:1fr}}
.bd-fl2v-total-wrap{display:inline-flex;align-items:center;gap:6px}
.bd-fl2v-total-wrap.hidden{display:none!important}
.bd-fl2v-total-wrap input:disabled{opacity:.75;cursor:default;color:#ccc}
.bd-fl2v-ai-frame{display:flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;box-sizing:border-box;
  padding:4px 6px;border-radius:6px;border:1px dashed #4a4a56;color:#9fd4ff;font-size:11px;
  background:rgba(47,111,208,.10);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bd-fl2v-ai-frame:hover{border-color:#5ec8ff;color:#cfe9ff;background:rgba(47,111,208,.2)}
.bd-fl2v-ai-frame.has-prompt{border-style:solid;border-color:rgba(94,200,255,.55)}
`;

const DEFAULT_TOTAL = defaultFrameCount("fl2v");
/** Same default as the node ``negative_prompt_unused`` widget. */
export const DEFAULT_FL2V_NEGATIVE = "bad video";
function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}

export function fl2vViewUrl(imageFile) {
    if (!imageFile) return "";
    const norm = String(imageFile).replace(/\\/g, "/");
    const slash = norm.lastIndexOf("/");
    const filename = slash >= 0 ? norm.slice(slash + 1) : norm;
    const subfolder = slash >= 0 ? norm.slice(0, slash) : "";
    const params = new URLSearchParams({ filename, type: "input" });
    if (subfolder) params.set("subfolder", subfolder);
    return api.apiURL(`/view?${params.toString()}`);
}

async function uploadImage(file) {
    const uploadFile = fileForComfyUpload(file);
    const body = new FormData();
    body.append("image", uploadFile, uploadFile.name);
    body.append("type", "input");
    body.append("overwrite", "false");
    const resp = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!resp.ok) throw new Error((await resp.text()) || `Upload failed (${resp.status})`);
    return resp.json();
}

function imageDims(file) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
            URL.revokeObjectURL(url);
        };
        img.onerror = () => {
            resolve({ width: 0, height: 0 });
            URL.revokeObjectURL(url);
        };
        img.src = url;
    });
}

function fl2vFps(editor) {
    return Math.max(1, Number(editor?.getFrameRate?.() || editor?.timeline?.frameRate || 24) || 24);
}

export function normalizeImageRef(raw) {
    if (!raw) return null;
    if (typeof raw === "string") {
        const imageFile = raw.trim();
        return imageFile ? { imageFile, width: 0, height: 0 } : null;
    }
    const imageFile = String(raw.imageFile || raw.image_file || "").trim();
    if (!imageFile) return null;
    return {
        imageFile,
        width: parseInt(raw.width, 10) || 0,
        height: parseInt(raw.height, 10) || 0,
    };
}

/** Reusable start/end frame slots (standalone fl2v cards + mixed batch). */
export function createFl2vSlotPair({ startImage = null, endImage = null } = {}) {
    const startUrl = startImage?.imageFile ? fl2vViewUrl(startImage.imageFile) : "";
    const endUrl = endImage?.imageFile ? fl2vViewUrl(endImage.imageFile) : "";
    const slots = document.createElement("div");
    slots.className = "bd-fl2v-slots";
    slots.innerHTML = `
                <div class="bd-fl2v-slot-wrap${startUrl ? " has-img" : ""}">
                    <div class="bd-fl2v-slot${startUrl ? " has-img" : ""}" data-slot="start" title="${t("tooltip.fl2vStartSlot")}">
                        ${startUrl ? `<span class="tag start">${t("fl2v.tag.start")}</span>` : ""}
                        ${startUrl ? `<img src="${startUrl}" alt="">` : `<span class="ph">${t("panel.fl2v.startRequired")}</span>`}
                    </div>
                    ${startUrl ? `<button type="button" class="x" data-clear="start" title="${t("tooltip.fl2vClear")}" draggable="false">×</button>` : ""}
                </div>
                <div class="bd-fl2v-slot-wrap${endUrl ? " has-img" : ""}">
                    <div class="bd-fl2v-slot${endUrl ? " has-img" : ""}" data-slot="end" title="${t("tooltip.fl2vEndSlot")}">
                        ${endUrl ? `<span class="tag end">${t("fl2v.tag.end")}</span>` : ""}
                        ${endUrl ? `<img src="${endUrl}" alt="">` : `<span class="ph">${t("panel.fl2v.endOptional")}</span>`}
                    </div>
                    ${endUrl ? `<button type="button" class="x" data-clear="end" title="${t("tooltip.fl2vClear")}" draggable="false">×</button>` : ""}
                </div>`;
    return slots;
}

export function newFl2vShot(overrides = {}) {
    const fps = 24;
    let durationSec = overrides.durationSec != null && Number.isFinite(Number(overrides.durationSec))
        ? Number(overrides.durationSec)
        : defaultDurationSec("fl2v");
    durationSec = clamp(roundDurationSec(durationSec), minDurationSec(), maxDurationSec());
    const shot = {
        id: overrides.id || uid(),
        durationSec,
        prompt: overrides.prompt || "",
        negativePrompt: overrides.negativePrompt || DEFAULT_FL2V_NEGATIVE,
        startImage: normalizeImageRef(overrides.startImage || overrides.start_image) || null,
        endImage: normalizeImageRef(overrides.endImage || overrides.end_image) || null,
        // 生图用的画面提示词（和镜头提示词是两套：一个写「怎么动」，一个写「画面长什么样」）
        framePrompt: String(overrides.framePrompt || ""),
        ...(overrides.externalNodeId != null
            ? { externalNodeId: overrides.externalNodeId }
            : {}),
    };
    // Must survive syncFl2vFromShots → newFl2vShot(); dropping it made 引用上段
    // appear stuck (commit rebuilt shots and defaulted back to on).
    if (overrides.continuityFromPrev != null || overrides.continuity_from_prev != null) {
        shot.continuityFromPrev = overrides.continuityFromPrev ?? overrides.continuity_from_prev;
    }
    // 引用粒度 likewise must survive a shot rebuild.
    if (overrides.continuityPinMode != null || overrides.continuity_pin_mode != null) {
        shot.continuityPinMode = overrides.continuityPinMode ?? overrides.continuity_pin_mode;
    }
    if (Array.isArray(overrides.loras)) shot.loras = overrides.loras;
    return shot;
}

function shotFrameCount(shot, fps = 24) {
    const rate = Math.max(1, Number(fps) || 24);
    const sec = clamp(
        Number(shot?.durationSec) || defaultDurationSec("fl2v"),
        minDurationSec(rate),
        maxDurationSec(rate),
    );
    return clamp(durationToMiniMaxFrames(sec, rate), minFrameCount("fl2v"), MAX_GEN_FRAMES);
}

/** Migrate legacy flat segments/keyframes → shots[]. */
export function migrateLegacyFl2vToShots(timeline) {
    if (Array.isArray(timeline?.shots) && timeline.shots.length) {
        return timeline.shots.map((s) => newFl2vShot(s));
    }
    const raw = [...(timeline?.keyframes || timeline?.segments || [])]
        .map((s, i) => ({ s, i }))
        .sort((a, b) => {
            const as = parseInt(a.s.start, 10) || 0;
            const bs = parseInt(b.s.start, 10) || 0;
            return as - bs || a.i - b.i;
        })
        .map(({ s }) => s);
    if (!raw.length) return [];

    const n = raw.length;
    const flags = raw.map((s, i) => {
        let isStart = s.isStartFrame;
        let isEnd = s.isEndFrame;
        if (isStart === undefined && s.breakBefore !== undefined) {
            isStart = !!s.breakBefore || s.isEndFrame === false;
            isEnd = !s.breakBefore;
        }
        if (isStart === undefined) {
            const endOnlyLast = i > 0 && i === n - 1 && !s.breakBefore && s.isEndFrame !== false;
            isStart = !endOnlyLast;
        }
        if (isEnd === undefined) isEnd = i > 0 && !s.breakBefore;
        return { isStart: !!isStart, isEnd: !!isEnd };
    });

    const shots = [];
    for (let i = 0; i < raw.length; i++) {
        const s = raw[i];
        const f = flags[i];
        if (!f.isStart) continue;
        const startImage = normalizeImageRef(s.genImage || s) || normalizeImageRef(s.imageFile);
        let endImage = null;
        if (f.isEnd && startImage) {
            endImage = { ...startImage };
        } else {
            for (let j = i + 1; j < raw.length; j++) {
                if (flags[j].isStart) break;
                if (flags[j].isEnd && !flags[j].isStart) {
                    endImage = normalizeImageRef(raw[j].genImage || raw[j])
                        || normalizeImageRef(raw[j].imageFile);
                    break;
                }
            }
        }
        let durationSec = Number(s.durationSec);
        if (!(durationSec > 0)) {
            const fc = parseInt(s.frameCount ?? s.length, 10)
                || defaultFrameCount("fl2v", Math.max(1, Number(timeline?.frameRate) || 24));
            // Absorb end-only span for nicer migrate.
            let totalFc = Math.max(minFrameCount("fl2v"), fc);
            if (endImage && !f.isEnd) {
                for (let j = i + 1; j < raw.length; j++) {
                    if (flags[j].isStart) break;
                    if (flags[j].isEnd && !flags[j].isStart) {
                        const e = raw[j];
                        const endT = (parseInt(e.start, 10) || 0) + (parseInt(e.length ?? e.frameCount, 10) || 0);
                        const startT = parseInt(s.start, 10) || 0;
                        totalFc = Math.max(totalFc, endT - startT);
                        break;
                    }
                }
            }
            durationSec = preferredDurationSecFromFrames(
                totalFc,
                Math.max(1, Number(timeline?.frameRate) || 24),
            );
        }
        shots.push(newFl2vShot({
            id: s.id,
            durationSec,
            prompt: s.prompt || "",
            negativePrompt: s.negativePrompt || DEFAULT_FL2V_NEGATIVE,
            startImage,
            endImage,
            continuityFromPrev: s.continuityFromPrev ?? s.continuity_from_prev,
            continuityPinMode: s.continuityPinMode ?? s.continuity_pin_mode,
        }));
    }
    return shots;
}

/** Flatten shots → one timeline segment per shot (for canvas / legacy fields). */
export function flattenFl2vShotsToSegments(editor) {
    const fps = fl2vFps(editor);
    const shots = editor.timeline.shots || [];
    let cursor = 0;
    const segs = shots.map((shot, i) => {
        const fc = shotFrameCount(shot, fps);
        const startImage = shot.startImage || null;
        const endImage = shot.endImage || null;
        const seg = {
            id: shot.id || uid(),
            start: cursor,
            length: fc,
            frameCount: fc,
            durationSec: shot.durationSec,
            prompt: shot.prompt || "",
            negativePrompt: shot.negativePrompt || DEFAULT_FL2V_NEGATIVE,
            continuityFromPrev: isSegmentContinuityFromPrev(shot, i),
            continuityPinMode: segmentContinuityPinMode(shot),
            loras: normalizeLoraRows(shot.loras),
            taskType: "",
            refs: [],
            // Do not mark start when end-only — canvas badges / thumbs key off these.
            isStartFrame: !!startImage?.imageFile,
            isEndFrame: !!endImage?.imageFile,
            shotIndex: i,
            // genImage / imageFile = start only (never fall back to endImage).
            genImage: startImage?.imageFile
                ? {
                    imageFile: startImage.imageFile || "",
                    width: startImage.width || 0,
                    height: startImage.height || 0,
                }
                : { imageFile: "", width: 0, height: 0 },
            imageFile: startImage?.imageFile || "",
            endImage: endImage
                ? {
                    imageFile: endImage.imageFile || "",
                    width: endImage.width || 0,
                    height: endImage.height || 0,
                }
                : null,
        };
        cursor += fc;
        return seg;
    });
    editor.timeline.segments = segs;
    return segs;
}

/** Compat keyframes: Start + optional End-only pair per shot. */
export function flattenFl2vShotsToKeyframes(editor) {
    const fps = fl2vFps(editor);
    const shots = editor.timeline.shots || [];
    const keyframes = [];
    let cursor = 0;
    for (const shot of shots) {
        const fc = shotFrameCount(shot, fps);
        const startImage = shot.startImage;
        const endImage = shot.endImage;
        const hasStart = !!startImage?.imageFile;
        const hasEnd = !!endImage?.imageFile;
        if (hasEnd && hasStart) {
            const half = Math.max(minFrameCount("fl2v"), Math.floor(fc / 2));
            const eLen = Math.max(minFrameCount("fl2v"), fc - half);
            const sLen = fc - eLen;
            keyframes.push({
                id: `${shot.id || uid()}_s`,
                imageFile: startImage.imageFile || "",
                width: startImage.width || 0,
                height: startImage.height || 0,
                start: cursor,
                length: sLen,
                frameCount: sLen,
                durationSec: shot.durationSec,
                prompt: shot.prompt || "",
                negativePrompt: shot.negativePrompt || DEFAULT_FL2V_NEGATIVE,
                isStartFrame: true,
                isEndFrame: false,
            });
            keyframes.push({
                id: `${shot.id || uid()}_e`,
                imageFile: endImage.imageFile || "",
                width: endImage.width || 0,
                height: endImage.height || 0,
                start: cursor + sLen,
                length: eLen,
                frameCount: eLen,
                durationSec: shot.durationSec,
                prompt: "",
                negativePrompt: shot.negativePrompt || DEFAULT_FL2V_NEGATIVE,
                isStartFrame: false,
                isEndFrame: true,
            });
        } else if (hasEnd && !hasStart) {
            // Official last-only. Mark endOnly so legacy _expand_shots does not
            // treat this as 首尾同图 (image0=image1).
            keyframes.push({
                id: shot.id || uid(),
                imageFile: endImage.imageFile || "",
                width: endImage.width || 0,
                height: endImage.height || 0,
                start: cursor,
                length: fc,
                frameCount: fc,
                durationSec: shot.durationSec,
                prompt: shot.prompt || "",
                negativePrompt: shot.negativePrompt || DEFAULT_FL2V_NEGATIVE,
                isStartFrame: true,
                isEndFrame: true,
                endOnly: true,
            });
        } else {
            keyframes.push({
                id: shot.id || uid(),
                imageFile: startImage?.imageFile || "",
                width: startImage?.width || 0,
                height: startImage?.height || 0,
                start: cursor,
                length: fc,
                frameCount: fc,
                durationSec: shot.durationSec,
                prompt: shot.prompt || "",
                negativePrompt: shot.negativePrompt || DEFAULT_FL2V_NEGATIVE,
                isStartFrame: true,
                isEndFrame: false,
            });
        }
        cursor += fc;
    }
    editor.timeline.keyframes = keyframes;
    return keyframes;
}

export function recomputeFl2vTotals(editor) {
    const fps = fl2vFps(editor);
    const shots = editor.timeline.shots || [];
    let totalSec = 0;
    let totalFrames = 0;
    for (const shot of shots) {
        const sec = clamp(Number(shot.durationSec) || defaultDurationSec("fl2v"), minDurationSec(), maxDurationSec());
        shot.durationSec = roundDurationSec(sec);
        const fc = shotFrameCount(shot, fps);
        totalSec += shot.durationSec;
        totalFrames += fc;
    }
    if (!shots.length) {
        totalSec = defaultDurationSec("fl2v");
        totalFrames = defaultFrameCount("fl2v");
    }
    totalSec = roundDurationSec(totalSec);
    totalFrames = Math.max(minFrameCount("fl2v"), totalFrames);
    editor.timeline.durationSec = totalSec;
    editor.timeline.totalFrames = totalFrames;
    if (editor.totalFramesWidget) editor.totalFramesWidget.value = totalFrames;
    if (editor.fl2vUi?.totalInput && editor.fl2vUi.totalInput !== document.activeElement) {
        editor.fl2vUi.totalInput.value = String(totalSec);
    }
    return { totalSec, totalFrames };
}

/** Sync segments/keyframes/totals from shots (source of truth). */
export function syncFl2vFromShots(editor) {
    if (!editor?.timeline) return [];
    if (!Array.isArray(editor.timeline.shots)) editor.timeline.shots = [];
    editor.timeline.shots = editor.timeline.shots.map((s) => newFl2vShot(s));
    flattenFl2vShotsToSegments(editor);
    flattenFl2vShotsToKeyframes(editor);
    recomputeFl2vTotals(editor);
    return editor.timeline.segments;
}

export function getFl2vSampleFrames(editor) {
    const content = getFl2vContentEndFrames(editor);
    const t = parseInt(editor?.timeline?.totalFrames, 10);
    // Prefer content span when it exceeds stored total (heals old 512 clamp).
    if (content > 0 && (!Number.isFinite(t) || t < content)) {
        return Math.max(minFrameCount("fl2v"), content);
    }
    if (Number.isFinite(t) && t > 0) {
        return Math.max(minFrameCount("fl2v"), t);
    }
    return DEFAULT_TOTAL;
}

export function getFl2vTotalFrames(editor) {
    return getFl2vSampleFrames(editor);
}

export function getFl2vContentEndFrames(editor) {
    const segs = editor?._previewSegments || editor?.timeline?.segments || [];
    let end = 0;
    for (const s of segs) {
        end = Math.max(end, (parseInt(s.start, 10) || 0) + (parseInt(s.length ?? s.frameCount, 10) || 0));
    }
    if (end > 0) return end;
    const shots = editor?.timeline?.shots || [];
    if (shots.length) {
        return shots.reduce((a, s) => a + shotFrameCount(s, fl2vFps(editor)), 0);
    }
    return 0;
}

/** Visual length = content total (sum of shots; may exceed per-shot MAX_GEN_FRAMES). */
export function getFl2vVisualFrames(editor) {
    return Math.max(
        minFrameCount("fl2v"),
        getFl2vSampleFrames(editor),
        getFl2vContentEndFrames(editor),
    );
}

export function getFl2vTotalDurationSec(editor) {
    const shots = editor?.timeline?.shots;
    if (Array.isArray(shots) && shots.length) {
        const sum = shots.reduce((a, s) => a + (Number(s.durationSec) || 0), 0);
        if (sum > 0) return roundDurationSec(sum);
    }
    const stored = Number(editor?.timeline?.durationSec);
    if (Number.isFinite(stored) && stored > 0) return roundDurationSec(stored);
    return preferredDurationSecFromFrames(getFl2vSampleFrames(editor), fl2vFps(editor));
}

/** @deprecated — totals come from shot sum; keep for callers. */
export function setFl2vTotalFrames(editor, value, { durationSec } = {}) {
    editor.timeline.totalFrames = Math.max(
        minFrameCount("fl2v"),
        parseInt(value, 10) || DEFAULT_TOTAL,
    );
    if (durationSec != null && Number.isFinite(Number(durationSec))) {
        editor.timeline.durationSec = roundDurationSec(durationSec);
    }
    if (editor.totalFramesWidget) editor.totalFramesWidget.value = editor.timeline.totalFrames;
    syncFl2vFromShots(editor);
    return editor.timeline.totalFrames;
}

/** @deprecated — edit per-shot duration instead. */
export function setFl2vTotalDurationSec(editor, seconds) {
    const shots = editor.timeline.shots || [];
    if (!shots.length) {
        editor.timeline.durationSec = clamp(
            roundDurationSec(Number(seconds) || defaultDurationSec("fl2v")),
            minDurationSec(),
            maxDurationSec(),
        );
        syncFl2vFromShots(editor);
        return editor.timeline.totalFrames;
    }
    // Proportionally scale all shots to match requested total.
    const target = clamp(
        roundDurationSec(Number(seconds) || defaultDurationSec("fl2v")),
        minDurationSec(),
        maxDurationSec(),
    );
    const cur = getFl2vTotalDurationSec(editor) || 1;
    const scale = target / cur;
    for (const shot of shots) {
        shot.durationSec = clamp(
            roundDurationSec((Number(shot.durationSec) || defaultDurationSec("fl2v")) * scale),
            minDurationSec(),
            maxDurationSec(),
        );
    }
    syncFl2vFromShots(editor);
    return editor.timeline.totalFrames;
}

export function ensureFl2vTimeline(editor) {
    const t = editor.timeline;
    t.timelineMode = "fl2v";
    t.editMode = "segment";
    t.video = t.video || {};
    t.video.videoFile = "";
    t.video.fileName = "";
    t.video.frameMap = [];
    t.videoClips = [];

    if (Array.isArray(t.shots) && t.shots.length) {
        t.shots = t.shots.map((s) => newFl2vShot(s));
    } else {
        t.shots = migrateLegacyFl2vToShots(t);
    }
    syncFl2vFromShots(editor);
    if (!Number.isFinite(editor.selectedIndex) || editor.selectedIndex < 0) {
        editor.selectedIndex = 0;
    }
    editor.selectedIndex = clamp(editor.selectedIndex, 0, Math.max(0, (t.shots.length || 1) - 1));
    return t;
}

/** Alias used by timeline — shots are source of truth. */
export function normalizeFl2vSegments(editor) {
    return syncFl2vFromShots(editor);
}

export function syncFl2vKeyframesMirror(editor) {
    flattenFl2vShotsToKeyframes(editor);
    recomputeFl2vTotals(editor);
    return editor.timeline.keyframes;
}

export function packFl2vSegments(editor) {
    return syncFl2vFromShots(editor);
}

export function fl2vStartIndices(editor) {
    // Every shot is runnable (index = shot / segment index).
    return (editor.timeline.shots || editor.timeline.segments || [])
        .map((_, i) => i);
}

export function fl2vSampleFrameCount(editor, segIndex) {
    const shots = editor.timeline.shots || [];
    const shot = shots[segIndex];
    if (!shot) return 0;
    return shotFrameCount(shot, fl2vFps(editor));
}

export function fl2vShotDurationSec(editor, segIndex) {
    const shot = editor.timeline.shots?.[segIndex];
    if (!shot) return 0;
    const stored = Number(shot.durationSec);
    if (Number.isFinite(stored) && stored > 0) return roundDurationSec(stored);
    return defaultDurationSec("fl2v");
}

export function setFl2vShotDurationSec(editor, shotIndex, seconds) {
    const shots = editor.timeline.shots || [];
    const shot = shots[shotIndex];
    if (!shot) return;
    shot.durationSec = clamp(
        roundDurationSec(Number(seconds) || defaultDurationSec("fl2v")),
        minDurationSec(),
        maxDurationSec(),
    );
    syncFl2vFromShots(editor);
}

/** @deprecated alias */
export function setFl2vStartDurationSec(editor, segIndex, seconds) {
    return setFl2vShotDurationSec(editor, segIndex, seconds);
}

/**
 * Ripple-trim right edge of shot `index` by frame end, update that shot's durationSec,
 * rebuild layout from shots.
 */
export function rippleFl2vRightEdge(segments, index, newEndFrame, minLen, editor = null) {
    // When editor is available, update shot duration from frame delta.
    if (editor?.timeline?.shots) {
        const shot = editor.timeline.shots[index];
        const seg = (segments || editor.timeline.segments || [])[index];
        if (shot && seg) {
            const fps = fl2vFps(editor);
            const newLen = Math.max(minLen, Math.round(newEndFrame) - (parseInt(seg.start, 10) || 0));
            // Prefer nice seconds that map near this frame count.
            const roughSec = newLen / fps;
            let best = roundDurationSec(roughSec);
            for (const cand of [
                Math.round(roughSec),
                roundDurationSec(roughSec),
            ]) {
                if (cand < minDurationSec() || cand > maxDurationSec()) continue;
                if (Math.abs(durationToMiniMaxFrames(cand, fps) - newLen) <= Math.abs(durationToMiniMaxFrames(best, fps) - newLen)) {
                    best = cand;
                }
            }
            shot.durationSec = clamp(roundDurationSec(best), minDurationSec(), maxDurationSec());
            // Preview: temporarily layout segments without full sync (drag path).
            const fps2 = fps;
            let cursor = 0;
            for (let i = 0; i < editor.timeline.shots.length; i++) {
                const s = editor.timeline.shots[i];
                const fc = i === index
                    ? clamp(durationToMiniMaxFrames(shot.durationSec, fps2), minFrameCount("fl2v"), MAX_GEN_FRAMES)
                    : shotFrameCount(s, fps2);
                if (segments[i]) {
                    segments[i].start = cursor;
                    segments[i].length = fc;
                    segments[i].frameCount = fc;
                    segments[i].durationSec = s.durationSec;
                }
                cursor += fc;
            }
            return segments;
        }
    }
    // Fallback pure segment ripple (non-shot path).
    const segs = segments || [];
    const ordered = segs
        .map((seg, i) => ({ seg, i }))
        .sort((a, b) => a.seg.start - b.seg.start || a.i - b.i);
    const rank = ordered.findIndex((o) => o.i === index);
    if (rank < 0) return segs;
    const { seg } = ordered[rank];
    const oldEnd = seg.start + seg.length;
    const newLen = Math.max(minLen, Math.round(newEndFrame) - seg.start);
    const delta = (seg.start + newLen) - oldEnd;
    if (delta === 0) return segs;
    seg.length = newLen;
    seg.frameCount = newLen;
    for (let r = rank + 1; r < ordered.length; r++) {
        ordered[r].seg.start = Math.max(0, ordered[r].seg.start + delta);
    }
    return segs;
}

export function syncFl2vDurationSecAfterDrag(editor) {
    // After edge drag, shots already hold durationSec; just resync layout/totals.
    syncFl2vFromShots(editor);
}

export function addFl2vShot(editor, overrides = {}) {
    ensureFl2vTimeline(editor);
    const shot = newFl2vShot(overrides);
    editor.timeline.shots.push(shot);
    syncFl2vFromShots(editor);
    editor.selectedIndex = editor.timeline.shots.length - 1;
    return shot;
}

export function removeFl2vShot(editor, index) {
    const shots = editor.timeline.shots || [];
    const idx = clamp(parseInt(index, 10) || 0, 0, Math.max(0, shots.length - 1));
    if (!shots[idx]) return;
    shots.splice(idx, 1);
    syncFl2vFromShots(editor);
    editor.selectedIndex = clamp(idx, 0, Math.max(0, shots.length - 1));
    if (!shots.length) editor.selectedIndex = 0;
}

/** Copy the selected fl2v shot and insert the clone immediately after it. */
export function duplicateFl2vShot(editor) {
    if (editor?.hasExternalI2vGroups?.() || editor?.hasExternalR2vGroups?.()) return;
    flushFl2vPromptDraft(editor);
    ensureFl2vTimeline(editor);
    const shots = editor.timeline?.shots || [];
    if (!shots.length) return;
    const index = clamp(editor.selectedIndex ?? 0, 0, shots.length - 1);
    const src = shots[index];
    if (!src) return;
    const shot = newFl2vShot({
        durationSec: src.durationSec,
        prompt: src.prompt || "",
        negativePrompt: src.negativePrompt || "",
        startImage: src.startImage,
        endImage: src.endImage,
        continuityFromPrev: src.continuityFromPrev,
        continuityPinMode: src.continuityPinMode,
        loras: Array.isArray(src.loras) ? src.loras.map((row) => ({ ...row })) : [],
    });
    const insertAt = index + 1;
    shots.splice(insertAt, 0, shot);
    if (Array.isArray(editor.timeline.runSelection)) {
        const sourceOn = editor.timeline.runSelection.includes(index);
        editor.timeline.runSelection = editor.timeline.runSelection.map((i) => (i >= insertAt ? i + 1 : i));
        if (editor.timeline.runSelectEnabled && sourceOn) {
            editor.timeline.runSelection.push(insertAt);
            editor.timeline.runSelection.sort((a, b) => a - b);
        }
    }
    syncFl2vFromShots(editor);
    editor.selectedIndex = insertAt;
    updateFl2vDetailUI(editor);
    editor.commit?.(false, { syncTimeline: true });
    editor.updateVideoNameLabel?.();
    editor.scheduleRender?.();
    editor.updateDomWidgetHeight?.();
    editor.updateRunSelectUI?.();
}

export function openFl2vUpload(editor) {
    addFl2vShot(editor);
    updateFl2vDetailUI(editor);
    editor.commit?.(false, { syncTimeline: true });
    editor.updateVideoNameLabel?.();
    editor.scheduleRender?.();
    editor.updateDomWidgetHeight?.();
}

export function openFl2vAddShot(editor) {
    return openFl2vUpload(editor);
}

/** @deprecated — slots handle replace */
export function openFl2vReplace() {}
/** @deprecated */
export function openFl2vInsert() {}

export function mountFl2vPanel(parent) {
    const wrap = document.createElement("div");
    wrap.className = "bd-fl2v-detail-wrap";
    wrap.innerHTML = `
        <div class="bd-batch-toolbar bd-fl2v-group-bar">
            <button type="button" class="bd-btn bd-btn-primary" data-a="fl2v-add-shot" data-i18n="toolbar.addShot" data-i18n-title="tooltip.addShot">添加一组</button>
            <button type="button" class="bd-btn" data-a="fl2v-script-board" data-i18n="toolbar.scriptBoard" data-i18n-title="tooltip.scriptBoard">剧本分镜</button>
            <button type="button" class="bd-btn" data-a="fl2v-batch-frames" data-i18n="toolbar.batchFrames" data-i18n-title="tooltip.batchFrames">✦ 批量首尾帧</button>
            <button type="button" class="bd-btn" data-a="fl2v-enhance" data-i18n="toolbar.enhance" data-i18n-title="tooltip.enhance">✎ 扩写</button>
            <button type="button" class="bd-btn" data-a="fl2v-group-prev" data-i18n="toolbar.prevGroup" data-i18n-title="tooltip.prevGroup">上一组</button>
            <button type="button" class="bd-btn" data-a="fl2v-group-next" data-i18n="toolbar.nextGroup" data-i18n-title="tooltip.nextGroup">下一组</button>
            <button type="button" class="bd-btn" data-a="fl2v-duplicate" data-i18n="toolbar.duplicateGroup" data-i18n-title="tooltip.duplicateGroup">复制当前分组</button>
            <button type="button" class="bd-btn bd-btn-danger" data-a="fl2v-del" data-i18n="toolbar.deleteCurrentGroup" data-i18n-title="tooltip.deleteCurrentGroup">删除当前分组</button>
            <span class="bd-fl2v-help">
                <button type="button" class="bd-fl2v-help-btn" aria-label="怎么用">?</button>
                <div class="bd-fl2v-help-pop" role="tooltip">
                    <b data-i18n="panel.fl2v.howToTitle">怎么用</b>：
                    <span data-i18n-html="panel.fl2v.hint"></span>
                </div>
            </span>
        </div>
        <div class="bd-fl2v-workbench" data-r="fl2v-workbench">
            <div class="bd-fl2v-shots" data-r="fl2v-shots"></div>
        </div>
        <div class="bd-fl2v-detail" data-r="fl2v-detail">
            <div class="bd-fl2v-promptbar">
                <div class="bd-fl2v-promptcell">
                    <div class="fp-head">
                        <span class="fp-title" data-i18n="panel.fl2v.commonPrompt">通用提示词</span>
                        <span class="fp-note" data-i18n="tooltip.fl2vCommonPrompt">拼在每个镜头前面</span>
                    </div>
                    <textarea class="bd-prompt" data-r="fl2v-common-prompt" data-i18n-placeholder="placeholder.globalPrompt" placeholder=""></textarea>
                </div>
                <div class="bd-fl2v-promptcell" data-r="fl2v-shot-cell">
                    <div class="fp-head">
                        <span class="fp-title" data-i18n="panel.fl2v.shotPromptTitle">专属提示词</span>
                        <span class="fp-note" data-r="fl2v-shot-note"></span>
                    </div>
                    <textarea data-r="fl2v-prompt" data-i18n-placeholder="placeholder.fl2vShot" placeholder=""></textarea>
                </div>
            </div>
            <textarea data-r="fl2v-negative" class="hidden" hidden aria-hidden="true"></textarea>
        </div>
        <input type="file" accept="image/*" hidden data-r="fl2v-file">
    `;
    parent.appendChild(wrap);
    const hintBody = wrap.querySelector("[data-i18n-html]");
    if (hintBody) hintBody.innerHTML = t("panel.fl2v.hint");
    return {
        root: wrap,
        hint: wrap.querySelector(".bd-fl2v-help-pop"),
        workbench: wrap.querySelector('[data-r="fl2v-workbench"]'),
        shotsEl: wrap.querySelector('[data-r="fl2v-shots"]'),
        detail: wrap.querySelector('[data-r="fl2v-detail"]'),
        promptbar: wrap.querySelector(".bd-fl2v-promptbar"),
        shotCell: wrap.querySelector('[data-r="fl2v-shot-cell"]'),
        shotNote: wrap.querySelector('[data-r="fl2v-shot-note"]'),
        commonPrompt: wrap.querySelector('[data-r="fl2v-common-prompt"]'),
        prompt: wrap.querySelector('[data-r="fl2v-prompt"]'),
        negative: wrap.querySelector('[data-r="fl2v-negative"]'),
        totalInput: null,
        fileInput: wrap.querySelector('[data-r="fl2v-file"]'),
    };
}

export function stripFl2vPromptBody(text) {
    let out = String(text || "").trim();
    if (!out) return "";
    const wraps = [
        "完全保持首尾帧。",
        "完全保持首帧。",
        "完全保持尾帧。",
        "视频开始完全按照image0的画面，不修改，视频结束完全保持image1的画面。",
        "视频开始完全按照image0的画面，不修改，视频结束完全保持image1。",
        "视频开始完全按照image0的构图，不修改，视频结束完全保持image1。",
        "视频开始完全按照image0的画面，不修改。",
        "视频开始完全按照image0的构图，不修改。",
        "视频结束完全保持image1的画面。",
        "视频结束完全保持image1。",
        "完全保持首尾帧：开头必须是image0，结尾必须是image1。",
        "完全保持首帧：开头必须是image0。",
        "完全保持尾帧：结尾锁定尾帧。",
        "完全保持首尾帧：开头锁定首帧，结尾锁定尾帧。",
        "再次强调：开头锁定image0，结尾锁定image1。",
        "再次强调：开头锁定image0。",
        "再次强调：结尾锁定尾帧。",
        "中间过程：",
    ];
    let changed = true;
    while (changed && out) {
        changed = false;
        for (const w of wraps) {
            if (out.startsWith(w)) {
                out = out.slice(w.length).trim();
                changed = true;
            }
            if (out.endsWith(w)) {
                out = out.slice(0, -w.length).trim();
                changed = true;
            }
        }
    }
    return out
        .replace(/image0的构图/g, "image0的画面")
        .replace(/image1的构图/g, "image1的画面")
        .trim();
}

export function flushFl2vPromptDraft(editor) {
    if (editor?._suspendPromptFlush) return;
    const ui = editor?.fl2vUi;
    if (!ui?.prompt && !ui?.negative) return;
    const shots = editor.timeline?.shots || [];
    const idx = editor._fl2vPromptSegIndex;
    if (!Number.isFinite(idx) || idx < 0 || idx >= shots.length) return;
    const shot = shots[idx];
    if (!shot) return;
    if (ui.prompt) shot.prompt = ui.prompt.value || "";
    if (ui.negative) shot.negativePrompt = ui.negative.value || "";
}

/** Output canvas W/H for shot-slot aspect-ratio (matches 输出分辨率). */
export function getFl2vOutputSize(editor) {
    const out = editor?.timeline?.output || {};
    let w = parseInt(out.width, 10) || 0;
    let h = parseInt(out.height, 10) || 0;
    if (!(w > 0 && h > 0)) {
        w = parseInt(editor?.timeline?.width, 10) || parseInt(editor?.widthWidget?.value, 10) || 864;
        h = parseInt(editor?.timeline?.height, 10) || parseInt(editor?.heightWidget?.value, 10) || 480;
    }
    w = Math.max(1, w);
    h = Math.max(1, h);
    return { width: w, height: h };
}

export function applyFl2vSlotAspect(editor) {
    const ui = editor?.fl2vUi;
    if (!ui?.root) return;
    const { width, height } = getFl2vOutputSize(editor);
    ui.root.style.setProperty("--fl2v-slot-ar", `${width} / ${height}`);
}

const FL2V_SLOT_MIME = "application/x-minimax-fl2v-slot";
const FL2V_SHOT_MIME = "application/x-minimax-fl2v-shot";

/** Swap two shot groups in place (whole card: images + duration + prompts). */
export function swapFl2vShots(editor, fromIndex, toIndex) {
    const shots = editor.timeline?.shots || [];
    const a = clamp(parseInt(fromIndex, 10), 0, shots.length - 1);
    const b = clamp(parseInt(toIndex, 10), 0, shots.length - 1);
    if (!shots[a] || !shots[b] || a === b) return false;
    const tmp = shots[a];
    shots[a] = shots[b];
    shots[b] = tmp;
    syncFl2vFromShots(editor);
    editor.selectedIndex = b;
    editor.commit?.(false, { syncTimeline: true });
    updateFl2vDetailUI(editor);
    editor.updateVideoNameLabel?.();
    editor.scheduleRender?.();
    editor.updateDomWidgetHeight?.();
    return true;
}

function bindFl2vShotCardDnD(editor, cardEl, shotIndex) {
    // Drag only the title — never the header checkbox. Nearby draggable=true
    // swallows 引用上段 clicks on Windows.
    cardEl.draggable = false;
    const handles = cardEl.querySelectorAll(".bd-fl2v-shot-drag");
    if (handles.length) {
        const onDragStart = (e) => {
            editor._fl2vShotDrag = true;
            editor._fl2vShotDragFrom = shotIndex;
            const payload = JSON.stringify({ shotIndex });
            e.dataTransfer.setData(FL2V_SHOT_MIME, payload);
            e.dataTransfer.setData("text/plain", payload);
            e.dataTransfer.effectAllowed = "move";
            try {
                e.dataTransfer.setDragImage(cardEl, 24, 16);
            } catch (_) { /* ignore */ }
            cardEl.classList.add("shot-dragging");
            e.stopPropagation();
        };
        const onDragEnd = () => {
            cardEl.classList.remove("shot-dragging");
            editor._fl2vShotDragFrom = null;
            editor.fl2vUi?.shotsEl?.querySelectorAll(".bd-fl2v-shot.shot-drag-over")
                .forEach((el) => el.classList.remove("shot-drag-over"));
            setTimeout(() => { editor._fl2vShotDrag = false; }, 0);
        };
        handles.forEach((handle) => {
            handle.draggable = true;
            handle.title = t("tooltip.fl2vDragHandle");
            handle.addEventListener("dragstart", onDragStart);
            handle.addEventListener("dragend", onDragEnd);
        });
    }

    cardEl.addEventListener("dragover", (e) => {
        const types = [...(e.dataTransfer?.types || [])];
        // Slot transfers take priority when hovering a slot.
        if (e.target.closest?.("[data-slot]") && types.includes(FL2V_SLOT_MIME)) return;
        if (!types.includes(FL2V_SHOT_MIME) && !types.includes("text/plain")) return;
        if (editor._fl2vSlotDrag) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        cardEl.classList.add("shot-drag-over");
    });

    cardEl.addEventListener("dragleave", (e) => {
        if (!cardEl.contains(e.relatedTarget)) {
            cardEl.classList.remove("shot-drag-over");
        }
    });

    cardEl.addEventListener("drop", (e) => {
        // Let slot drop handler win when dropping onto a slot with slot payload.
        const types = [...(e.dataTransfer?.types || [])];
        if (e.target.closest?.("[data-slot]") && types.includes(FL2V_SLOT_MIME)) return;
        if (editor._fl2vSlotDrag) return;
        e.preventDefault();
        e.stopPropagation();
        cardEl.classList.remove("shot-drag-over");
        const raw = e.dataTransfer.getData(FL2V_SHOT_MIME)
            || e.dataTransfer.getData("text/plain");
        if (!raw) return;
        try {
            const data = JSON.parse(raw);
            if (!Number.isFinite(data.shotIndex)) return;
            editor._fl2vShotDrag = true;
            swapFl2vShots(editor, data.shotIndex, shotIndex);
        } catch (_) { /* ignore */ }
    });
}

function clearFl2vShotSlot(editor, shotIndex, kind) {
    const shot = editor.timeline?.shots?.[shotIndex];
    if (!shot) return;
    // Suppress the post-clear click that can land on the rebuilt empty slot.
    editor._fl2vIgnoreSlotClickUntil = Date.now() + 500;
    if (kind === "start") shot.startImage = null;
    else shot.endImage = null;
    syncFl2vFromShots(editor);
    editor.selectedIndex = shotIndex;
    editor.commit?.(false, { syncTimeline: true });
    updateFl2vDetailUI(editor);
    editor.updateVideoNameLabel?.();
    editor.scheduleRender?.();
}

function cloneFl2vImageRef(ref) {
    if (!ref?.imageFile) return null;
    return {
        imageFile: ref.imageFile,
        width: ref.width || 0,
        height: ref.height || 0,
    };
}

function getFl2vSlotImage(shot, slot) {
    if (!shot) return null;
    return slot === "end" ? (shot.endImage || null) : (shot.startImage || null);
}

function setFl2vSlotImage(shot, slot, ref) {
    if (!shot) return;
    if (slot === "end") shot.endImage = ref;
    else shot.startImage = ref;
}

async function pickFl2vSlotImage(editor, shotIndex, slotKind) {
    const shots = editor.timeline?.shots || [];
    const shot = shots[shotIndex];
    const currentValue = slotKind === "end"
        ? (shot?.endImage?.imageFile || "")
        : (shot?.startImage?.imageFile || "");
    const picked = await editor.chooseImageInput({
        title: t("mediaPicker.pickFl2vImage"),
        currentValue,
    });
    if (!picked?.imageFile) return false;
    let liveShot = shots[shotIndex];
    if (!liveShot) {
        addFl2vShot(editor);
        liveShot = editor.timeline?.shots?.[editor.timeline.shots.length - 1];
        editor.selectedIndex = (editor.timeline?.shots?.length || 1) - 1;
    }
    if (!liveShot) return false;
    setFl2vSlotImage(liveShot, slotKind, {
        imageFile: picked.imageFile,
        width: picked.width || 0,
        height: picked.height || 0,
    });
    syncFl2vFromShots(editor);
    editor.selectedIndex = Math.min(shotIndex, Math.max(0, (editor.timeline?.shots?.length || 1) - 1));
    editor.commit?.(false, { syncTimeline: true });
    updateFl2vDetailUI(editor);
    editor.updateVideoNameLabel?.();
    editor.scheduleRender?.();
    editor.updateDomWidgetHeight?.();
    return true;
}

/** Same group: swap/move; cross group: copy/replace target. */
export function transferFl2vSlotImage(editor, fromShot, fromSlot, toShot, toSlot) {
    const shots = editor.timeline?.shots || [];
    const src = shots[fromShot];
    const dst = shots[toShot];
    if (!src || !dst) return false;
    if (fromShot === toShot && fromSlot === toSlot) return false;
    const srcImg = getFl2vSlotImage(src, fromSlot);
    if (!srcImg?.imageFile) return false;

    if (fromShot === toShot) {
        // 组内：互换（目标空则等于移动）
        const dstImg = getFl2vSlotImage(dst, toSlot);
        setFl2vSlotImage(src, fromSlot, cloneFl2vImageRef(dstImg));
        setFl2vSlotImage(dst, toSlot, cloneFl2vImageRef(srcImg));
    } else {
        // 组间：复制到目标（源保留）
        setFl2vSlotImage(dst, toSlot, cloneFl2vImageRef(srcImg));
    }
    syncFl2vFromShots(editor);
    editor.selectedIndex = toShot;
    editor.commit?.(false, { syncTimeline: true });
    updateFl2vDetailUI(editor);
    editor.updateVideoNameLabel?.();
    editor.scheduleRender?.();
    editor.updateDomWidgetHeight?.();
    return true;
}

function bindFl2vSlotDnD(editor, slotEl, shotIndex, slotKind) {
    const hasImg = slotEl.classList.contains("has-img");
    slotEl.draggable = hasImg;

    slotEl.addEventListener("dragstart", (e) => {
        if (!hasImg) {
            e.preventDefault();
            return;
        }
        editor._fl2vSlotDrag = true;
        editor._fl2vDragFrom = { shotIndex, slot: slotKind };
        const payload = JSON.stringify({ shotIndex, slot: slotKind });
        e.dataTransfer.setData(FL2V_SLOT_MIME, payload);
        e.dataTransfer.setData("text/plain", payload);
        // copy+move so browsers allow both dropEffects
        e.dataTransfer.effectAllowed = "copyMove";
        slotEl.classList.add("dragging");
        e.stopPropagation();
    });

    slotEl.addEventListener("dragend", () => {
        slotEl.classList.remove("dragging");
        editor._fl2vDragFrom = null;
        editor.fl2vUi?.shotsEl?.querySelectorAll(".bd-fl2v-slot.drag-over")
            .forEach((el) => el.classList.remove("drag-over"));
        setTimeout(() => { editor._fl2vSlotDrag = false; }, 0);
    });

    slotEl.addEventListener("dragover", (e) => {
        const types = [...(e.dataTransfer?.types || [])];
        if (!types.includes(FL2V_SLOT_MIME) && !types.includes("Files") && !types.includes("text/plain")) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const from = editor._fl2vDragFrom;
        const sameGroup = from && from.shotIndex === shotIndex;
        e.dataTransfer.dropEffect = sameGroup ? "move" : "copy";
        slotEl.classList.add("drag-over");
    });

    slotEl.addEventListener("dragleave", (e) => {
        if (!slotEl.contains(e.relatedTarget)) {
            slotEl.classList.remove("drag-over");
        }
    });

    slotEl.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        slotEl.classList.remove("drag-over");
        const raw = e.dataTransfer.getData(FL2V_SLOT_MIME)
            || e.dataTransfer.getData("text/plain");
        if (raw) {
            try {
                const data = JSON.parse(raw);
                if (Number.isFinite(data.shotIndex) && (data.slot === "start" || data.slot === "end")) {
                    editor._fl2vSlotDrag = true;
                    transferFl2vSlotImage(editor, data.shotIndex, data.slot, shotIndex, slotKind);
                    return;
                }
            } catch (_) { /* fall through */ }
        }
        const f = e.dataTransfer.files?.[0];
        if (f?.type?.startsWith("image/")) {
            editor.selectedIndex = shotIndex;
            editor._fl2vUploadMode = "slot";
            editor._fl2vSlotKind = slotKind;
            editor._fl2vSlotShotIndex = shotIndex;
            // Reuse file input path via programmatic FileList isn't portable — upload directly.
            (async () => {
                try {
                    ensureFl2vTimeline(editor);
                    const up = await uploadImage(f);
                    const dims = await imageDims(f);
                    const name = up.name || up.filename;
                    const sub = (up.subfolder || "").replace(/\\/g, "/").replace(/\/$/, "");
                    const path = sub ? `${sub}/${name}` : name;
                    const ref = { imageFile: path, width: dims.width || 0, height: dims.height || 0 };
                    const shot = editor.timeline.shots?.[shotIndex];
                    if (!shot) return;
                    setFl2vSlotImage(shot, slotKind, ref);
                    syncFl2vFromShots(editor);
                    editor.selectedIndex = shotIndex;
                    editor.commit?.(false, { syncTimeline: true });
                    updateFl2vDetailUI(editor);
                    editor.updateVideoNameLabel?.();
                    editor.scheduleRender?.();
                } catch (err) {
                    console.error("[MiniMax H3 fl2v] drop upload failed", err);
                    alert(t("upload.alertFailed", { err: err?.message || err }));
                }
            })();
        }
    });
}

function renderFl2vShotCards(editor) {
    const ui = editor.fl2vUi;
    if (!ui?.shotsEl) return;
    applyFl2vSlotAspect(editor);
    const shots = editor.timeline.shots || [];
    // 横向条每次重建都会把滚动位置打回 0，选中后面的镜头时很跳
    const keepLeft = ui.shotsEl.scrollLeft;
    const selChanged = editor._fl2vLastRenderedSel !== editor.selectedIndex;
    ui.shotsEl.innerHTML = "";
    shots.forEach((shot, i) => {
        const card = document.createElement("div");
        card.className = "bd-fl2v-shot" + (i === editor.selectedIndex ? " selected" : "");
        card.dataset.shotIndex = String(i);
        const fc = shotFrameCount(shot, fl2vFps(editor));
        const badge = shot.startImage?.imageFile && shot.endImage?.imageFile
            ? t("fl2v.badge.startEnd")
            : (shot.endImage?.imageFile && !shot.startImage?.imageFile
                ? t("fl2v.badge.endOnly")
                : (shot.startImage?.imageFile
                    ? t("fl2v.badge.i2v")
                    : t("fl2v.badge.t2v")));
        const masterCont = isContinuityMasterEnabled(editor.timeline?.output);
        const showCont = masterCont && i > 0 && (shots.length >= 2);
        const contChecked = isSegmentContinuityFromPrev(shot, i);
        const pinMode = segmentContinuityPinMode(shot);
        const pinTitle = t("tooltip.segmentContinuityPinMode");
        const pinModeSelect = `<select class="bd-fl2v-pin-mode" data-r="shot-pin-mode" draggable="false" title="${pinTitle}" ${contChecked ? "" : "disabled"}>
                    <option value="motion" ${pinMode === "motion" ? "selected" : ""}>${t("batch.pinModeMotion")}</option>
                    <option value="tail" ${pinMode === "tail" ? "selected" : ""}>${t("batch.pinModeTail")}</option>
                </select>`;
        card.innerHTML = `
            <div class="bd-fl2v-shot-head">
                <span class="bd-fl2v-shot-drag"><b>${t("panel.fl2v.shotN", { n: i + 1 })}</b></span>
                ${showCont ? `<div class="bd-fl2v-shot-cont"><label class="bd-fl2v-continuity" draggable="false" title="${t("tooltip.segmentContinuityFromPrev")}"><input type="checkbox" data-r="shot-continuity" ${contChecked ? "checked" : ""}><span>${t("batch.continuityFromPrev")}</span></label>${pinModeSelect}</div>` : ""}
                <span class="bd-fl2v-shot-meta">${badge} · ${fc}f</span>
            </div>
            ${createFl2vSlotPair({ startImage: shot.startImage, endImage: shot.endImage }).outerHTML}
            <button type="button" class="bd-fl2v-ai-frame${shot.framePrompt ? " has-prompt" : ""}" data-a="fl2v-ai-frame" draggable="false" title="${t("tooltip.fl2vAiFrame")}">✦ ${t("panel.fl2v.aiFrame")}</button>
            <div class="bd-fl2v-shot-foot">
                <label class="bd-fl2v-shot-row" title="${t("tooltip.fl2vShotDuration")}">
                    ${t("panel.fl2v.duration")}
                    <input type="number" class="bd-num" data-r="shot-sec" min="${minDurationSec()}" max="${maxDurationSec()}" step="0.1" value="${shot.durationSec}">
                    ${t("panel.fl2v.seconds")}
                </label>
                <button type="button" class="bd-r2v-pick-existing" data-a="fl2v-pick-existing" title="${t("mediaPicker.pickExistingHint")}">${t("mediaPicker.pickExisting")}</button>
            </div>
        `;
        card.addEventListener("click", (e) => {
            if (e.target.closest("[data-slot], [data-clear], input, .bd-fl2v-slot-wrap, .bd-fl2v-continuity, .bd-fl2v-shot-cont, [data-a='fl2v-pick-existing'], [data-a='fl2v-ai-frame']")) return;
            if (editor._fl2vShotDrag || editor._fl2vSlotDrag) return;
            if (editor.selectedIndex !== i) flushFl2vPromptDraft(editor);
            editor.selectedIndex = i;
            updateFl2vDetailUI(editor);
            editor.scheduleRender?.();
        });
        const contInput = card.querySelector('[data-r="shot-continuity"]');
        const pinSelect = card.querySelector('[data-r="shot-pin-mode"]');
        if (contInput) {
            const applyCont = (enabled) => {
                contInput.checked = !!enabled;
                if (pinSelect) pinSelect.disabled = !enabled;
                // syncFl2vFromShots() replaces shot objects without re-rendering cards,
                // so the captured `shot` may be stale — always write the live one too.
                shot.continuityFromPrev = !!enabled;
                const liveShot = editor.timeline?.shots?.[i];
                if (liveShot) liveShot.continuityFromPrev = !!enabled;
                if (Array.isArray(editor.timeline?.segments) && editor.timeline.segments[i]) {
                    editor.timeline.segments[i].continuityFromPrev = !!enabled;
                }
                // Do not commit() here: that rebuilds every shot card and eats the click.
                editor.scheduleTimelineSync?.();
                editor.scheduleRender?.();
            };
            const contLabel = contInput.closest("label");
            // Same as slot clear: click is unreliable next to HTML5 drag sources.
            const onToggle = (e) => {
                e.preventDefault();
                e.stopPropagation();
                applyCont(!contInput.checked);
            };
            contLabel?.addEventListener("pointerdown", onToggle);
            // Swallow the leftover click so the native checkbox does not toggle back.
            contLabel?.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            contInput.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        }
        if (pinSelect) {
            const applyPinMode = (mode) => {
                const next = mode === "tail" ? "tail" : "motion";
                shot.continuityPinMode = next;
                const liveShot = editor.timeline?.shots?.[i];
                if (liveShot) liveShot.continuityPinMode = next;
                if (Array.isArray(editor.timeline?.segments) && editor.timeline.segments[i]) {
                    editor.timeline.segments[i].continuityPinMode = next;
                }
                editor.scheduleTimelineSync?.();
                editor.scheduleRender?.();
            };
            pinSelect.addEventListener("change", (e) => {
                e.stopPropagation();
                applyPinMode(pinSelect.value);
            });
            for (const evt of ["pointerdown", "click"]) {
                pinSelect.addEventListener(evt, (e) => e.stopPropagation());
            }
        }
        const loraSection = createLoraSection(editor, shot, () => editor.timeline.shots?.[i]);
        for (const evt of ["pointerdown", "click"]) {
            loraSection.addEventListener(evt, (e) => e.stopPropagation());
        }
        card.appendChild(loraSection);
        bindFl2vShotCardDnD(editor, card, i);
        const aiFrameBtn = card.querySelector('[data-a="fl2v-ai-frame"]');
        if (aiFrameBtn) {
            aiFrameBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (editor.selectedIndex !== i) flushFl2vPromptDraft(editor);
                openFrameGenDialog(editor, i, {
                    syncFromShots: syncFl2vFromShots,
                    refreshDetail: updateFl2vDetailUI,
                });
            });
        }
        const pickBtn = card.querySelector('[data-a="fl2v-pick-existing"]');
        if (pickBtn) {
            const bothFilled = !!(shot.startImage?.imageFile && shot.endImage?.imageFile);
            pickBtn.disabled = bothFilled;
            pickBtn.title = bothFilled ? t("mediaPicker.slotsFull") : t("mediaPicker.pickExistingHint");
            pickBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (editor.selectedIndex !== i) flushFl2vPromptDraft(editor);
                editor.selectedIndex = i;
                const kind = shot.startImage?.imageFile ? "end" : "start";
                try {
                    await pickFl2vSlotImage(editor, i, kind);
                } catch (err) {
                    console.error("[MiniMax H3Director] fl2v pick failed:", err);
                }
            });
        }
        card.querySelectorAll("[data-slot]").forEach((slot) => {
            const kind = slot.dataset.slot;
            bindFl2vSlotDnD(editor, slot, i, kind);
            slot.addEventListener("click", (e) => {
                if (Date.now() < (editor._fl2vIgnoreSlotClickUntil || 0)) return;
                if (editor._fl2vSlotDrag) return;
                e.stopPropagation();
                if (editor.selectedIndex !== i) flushFl2vPromptDraft(editor);
                editor.selectedIndex = i;
                editor._fl2vUploadMode = "slot";
                editor._fl2vSlotKind = kind;
                editor._fl2vSlotShotIndex = i;
                const input = ui.fileInput;
                if (!input) return;
                input.multiple = false;
                input.click();
            });
        });
        card.querySelectorAll("[data-clear]").forEach((btn) => {
            // Clear on pointerdown: click is unreliable next to HTML5 drag sources.
            btn.addEventListener("pointerdown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                clearFl2vShotSlot(editor, i, btn.dataset.clear);
            });
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });
        const secInput = card.querySelector('[data-r="shot-sec"]');
        secInput?.addEventListener("click", (e) => e.stopPropagation());
        secInput?.addEventListener("keydown", (e) => e.stopPropagation());
        const applySec = () => {
            setFl2vShotDurationSec(editor, i, secInput.value);
            editor.commit?.(false, { syncTimeline: true });
            updateFl2vDetailUI(editor);
            editor.updateVideoNameLabel?.();
            editor.scheduleRender?.();
            editor.updateDomWidgetHeight?.();
        };
        secInput?.addEventListener("change", applySec);
        ui.shotsEl.appendChild(card);
    });

    // 重建后把滚动位置还回去；若是换了选中镜头，把它滚进可视区
    ui.shotsEl.scrollLeft = keepLeft;
    if (selChanged) {
        const sel = ui.shotsEl.querySelector(".bd-fl2v-shot.selected");
        sel?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        editor._fl2vLastRenderedSel = editor.selectedIndex;
    }
}

export function updateFl2vDetailUI(editor) {
    const ui = editor.fl2vUi;
    if (!ui) return;
    if (!editor.isFl2vMode?.()) {
        ui.detail?.classList.add("hidden");
        return;
    }
    // 底部提示词条常驻（通用提示词不依赖有没有镜头），只切换右侧专属格子
    ui.detail?.classList.remove("hidden");
    if (ui.totalInput && ui.totalInput !== document.activeElement) {
        ui.totalInput.value = String(getFl2vTotalDurationSec(editor));
        ui.totalInput.disabled = true;
        ui.totalInput.title = t("tooltip.fl2vTotalInput");
    }
    renderFl2vShotCards(editor);
    updateFl2vToolbarBtns(editor);

    const shots = editor.timeline.shots || [];
    const idx = editor.selectedIndex;
    const shot = shots[idx];

    // 左侧：通用提示词，和全局提示词框共享同一份数据
    if (ui.commonPrompt && document.activeElement !== ui.commonPrompt) {
        const common =
            editor.timeline?.global?.prompt ??
            editor.globalPrompt?.value ??
            "";
        if (ui.commonPrompt.value !== common) ui.commonPrompt.value = common;
        ui.commonPrompt.disabled = false;
    }

    if (!shot) {
        flushFl2vPromptDraft(editor);
        editor._fl2vPromptSegIndex = null;
        ui.shotCell?.classList.add("hidden");
        ui.promptbar?.classList.add("single");
        return;
    }
    ui.shotCell?.classList.remove("hidden");
    ui.promptbar?.classList.remove("single");
    if (ui.shotNote) {
        ui.shotNote.textContent = t("panel.fl2v.shotN", { n: idx + 1 });
    }
    const prevIdx = editor._fl2vPromptSegIndex;
    const selectionChanged = prevIdx !== idx;
    if (selectionChanged) flushFl2vPromptDraft(editor);
    editor._fl2vPromptSegIndex = idx;
    if (ui.prompt) {
        ui.prompt.disabled = false;
        if (selectionChanged || ui.prompt !== document.activeElement) {
            ui.prompt.value = shot.prompt || "";
        }
    }
    if (ui.negative) {
        ui.negative.disabled = false;
        if (selectionChanged || ui.negative !== document.activeElement) {
            ui.negative.value = shot.negativePrompt || DEFAULT_FL2V_NEGATIVE;
        }
    }
}

/**
 * 镜头条横向拖动平移。
 * 只接管「空白/卡片本体」上的拖动；勾选框、下拉、上传槽、拖拽手柄都放行，
 * 免得把原有的拖拽排序和点击吃掉。
 */
const PAN_BLOCKERS = [
    "input",
    "select",
    "button",
    "a",
    "textarea",
    ".bd-fl2v-shot-drag",
    ".bd-fl2v-slot",
    ".bd-fl2v-slot-wrap .x",
    "[data-slot]",
    "[data-clear]",
    "[data-a]",
].join(",");

export function installShotsDragScroll(el) {
    if (!el || el._alberPanBound) return;
    el._alberPanBound = true;

    let dragging = false;
    let startX = 0;
    let startLeft = 0;
    let moved = false;

    const onDown = (e) => {
        if (e.button !== 0) return;
        if (e.target?.closest?.(PAN_BLOCKERS)) return;
        dragging = true;
        moved = false;
        startX = e.clientX;
        startLeft = el.scrollLeft;
        el.classList.add("panning");
    };

    const onMove = (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        if (!moved && Math.abs(dx) < 3) return;
        moved = true;
        el.scrollLeft = startLeft - dx;
        // 拖起来就别让浏览器再去做 HTML5 拖拽/选中
        e.preventDefault();
        e.stopPropagation();
    };

    const onUp = (e) => {
        if (!dragging) return;
        dragging = false;
        el.classList.remove("panning");
        if (moved) {
            // 拖完这一下不算点击，别顺手把镜头选中了
            e.stopPropagation();
            e.preventDefault();
            const swallow = (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
            };
            window.addEventListener("click", swallow, { capture: true, once: true });
            setTimeout(() => window.removeEventListener("click", swallow, true), 60);
        }
    };

    el.addEventListener("pointerdown", onDown);
    // 捕获阶段拦住原生拖拽
    el.addEventListener("dragstart", (e) => {
        if (dragging) e.preventDefault();
    });
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp, true);

    // 竖向滚轮转成横向滚动，鼠标不用按住 shift
    el.addEventListener(
        "wheel",
        (e) => {
            if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // 已经是横向
            const max = el.scrollWidth - el.clientWidth;
            if (max <= 1) return;
            const next = el.scrollLeft + e.deltaY;
            if ((next <= 0 && e.deltaY < 0) || (next >= max && e.deltaY > 0)) return;
            el.scrollLeft = next;
            e.preventDefault();
            e.stopPropagation();
        },
        { passive: false }
    );
}

export function bindFl2vEvents(editor) {
    const ui = editor.fl2vUi;
    if (!ui) return;

    // Total is read-only (sum of shots); ignore edits.
    ui.totalInput?.addEventListener("keydown", (e) => e.stopPropagation());

    const promptTargetShot = () => {
        const shots = editor.timeline.shots || [];
        const idx = Number.isFinite(editor._fl2vPromptSegIndex)
            ? editor._fl2vPromptSegIndex
            : editor.selectedIndex;
        return shots[idx] || null;
    };
    const bindPromptField = (el, field) => {
        if (!el) return;
        el.addEventListener("change", () => {
            const shot = promptTargetShot();
            if (!shot) return;
            shot[field] = el.value || "";
            syncFl2vFromShots(editor);
            editor.commit(false, { syncTimeline: true });
            editor.scheduleRender();
        });
        el.addEventListener("input", () => {
            const shot = promptTargetShot();
            if (!shot) return;
            shot[field] = el.value || "";
            editor._schedulePromptRender();
        });
        el.addEventListener("focus", () => {
            if (!Number.isFinite(editor._fl2vPromptSegIndex)) {
                editor._fl2vPromptSegIndex = editor.selectedIndex;
            }
        });
    };
    bindPromptField(ui.prompt, "prompt");
    bindPromptField(ui.negative, "negativePrompt");

    // 左侧「通用提示词」：和全局提示词框共享同一份数据，改哪边都一样
    if (ui.commonPrompt) {
        const el = ui.commonPrompt;
        const push = () => {
            const v = el.value || "";
            editor.timeline.global = editor.timeline.global || { refs: [] };
            editor.timeline.global.prompt = v;
            if (editor.globalPrompt && editor.globalPrompt !== el) editor.globalPrompt.value = v;
            if (editor.globalPromptWidget) editor.globalPromptWidget.value = v;
            editor.onGlobalField?.("prompt", v);
        };
        el.addEventListener("input", push);
        el.addEventListener("change", () => {
            push();
            editor.commit?.(false, { syncTimeline: true });
        });
        // 输入时别让画布的快捷键吃掉按键
        el.addEventListener("keydown", (e) => e.stopPropagation());
    }

    // 剧本 → 分镜表：贴剧本、拆成镜头、一次写进时间轴
    const scriptBoardBtn = ui.root?.querySelector?.('[data-a="fl2v-script-board"]');
    if (scriptBoardBtn) {
        scriptBoardBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (editor.hasExternalI2vGroups?.() || editor.hasExternalR2vGroups?.()) return;
            flushFl2vPromptDraft(editor);
            openScriptBoard(editor, {
                newShot: newFl2vShot,
                syncFromShots: syncFl2vFromShots,
                refreshDetail: updateFl2vDetailUI,
            });
        });
    }
    // 批量出首尾帧：一次把整条时间轴的首帧/尾帧补齐
    const batchFramesBtn = ui.root?.querySelector?.('[data-a="fl2v-batch-frames"]');
    if (batchFramesBtn) {
        batchFramesBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (editor.hasExternalI2vGroups?.() || editor.hasExternalR2vGroups?.()) return;
            flushFl2vPromptDraft(editor);
            openBatchFrameDialog(editor, {
                syncFromShots: syncFl2vFromShots,
                refreshDetail: updateFl2vDetailUI,
            });
        });
    }

    // 提示词扩写：按 H3 官方 task 模板扩写，支持批量 + 多语言
    const enhanceBtn = ui.root?.querySelector?.('[data-a="fl2v-enhance"]');
    if (enhanceBtn) {
        enhanceBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (editor.hasExternalI2vGroups?.() || editor.hasExternalR2vGroups?.()) return;
            flushFl2vPromptDraft(editor);
            openEnhanceDialog(editor, {
                syncFromShots: syncFl2vFromShots,
                refreshDetail: updateFl2vDetailUI,
                stripPrompt: stripFl2vPromptBody,
            });
        });
    }

    // 提示词模板库：通用 / 专属两个提示词框右上角各挂一个「▤ 模板」按钮
    mountPromptLibTriggers(editor, { flushDraft: () => flushFl2vPromptDraft(editor) });
    // 主面板（t2v / 混合 / 分段）的提示词框也挂上（观察器，碰到才挂，可重复调用）
    installPromptLibAutoAttach();

    installShotsDragScroll(ui.shotsEl);
    installFl2vContextMenus(editor);

    ui.fileInput?.addEventListener("change", async () => {
        const files = [...(ui.fileInput.files || [])];
        const mode = editor._fl2vUploadMode || "slot";
        const slotKind = editor._fl2vSlotKind || "start";
        const shotIndex = editor._fl2vSlotShotIndex ?? editor.selectedIndex;
        editor._fl2vUploadMode = "slot";
        editor._fl2vSlotKind = null;
        editor._fl2vSlotShotIndex = null;
        if (ui.fileInput) ui.fileInput.multiple = false;
        if (!files.length) return;
        ensureFl2vTimeline(editor);
        try {
            const file = files[0];
            const up = await uploadImage(file);
            const dims = await imageDims(file);
            const name = up.name || up.filename;
            const sub = (up.subfolder || "").replace(/\\/g, "/").replace(/\/$/, "");
            const path = sub ? `${sub}/${name}` : name;
            const ref = { imageFile: path, width: dims.width || 0, height: dims.height || 0 };
            let shots = editor.timeline.shots || [];
            if (mode === "slot") {
                let shot = shots[shotIndex];
                if (!shot) {
                    addFl2vShot(editor);
                    shots = editor.timeline.shots;
                    editor.selectedIndex = shots.length - 1;
                    shot = shots[editor.selectedIndex];
                }
                if (slotKind === "end") shot.endImage = ref;
                else shot.startImage = ref;
                editor.selectedIndex = shotIndex < shots.length ? shotIndex : shots.length - 1;
            } else {
                addFl2vShot(editor, { startImage: ref });
            }
            syncFl2vFromShots(editor);
            editor.commit(false, { syncTimeline: true });
            updateFl2vDetailUI(editor);
            editor.updateVideoNameLabel?.();
            editor.scheduleRender();
            editor.updateDomWidgetHeight?.();
        } catch (err) {
            console.error("[MiniMax H3 fl2v] upload failed", err);
            alert(t("upload.alertFailed", { err: err?.message || err }));
        } finally {
            ui.fileInput.value = "";
        }
    });
}

/**
 * Draw shot block: start image full width; with end → left/right halves 50/50.
 */
export function drawFl2vSegmentThumbnails(editor, ctx, seg, startX, pxWidth, y0, h) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(startX, y0 + 1, pxWidth, h - 2);
    ctx.clip();
    ctx.fillStyle = "#f7f8fa";
    ctx.fillRect(startX, y0 + 1, pxWidth, h - 2);

    // Start and end are independent — never treat end as a fake start thumb.
    const startFile = seg.genImage?.imageFile || seg.imageFile || "";
    const endFile = seg.endImage?.imageFile || "";
    if (!startFile && !endFile) {
        ctx.fillStyle = "#8b929f";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(t("canvas.fl2vT2v"), startX + pxWidth / 2, y0 + h / 2);
        ctx.restore();
        return;
    }

    const drawImg = (img, x, w, y, hh) => {
        if (!img?.naturalWidth || w <= 0.5) return;
        const natW = img.naturalWidth;
        const natH = Math.max(1, img.naturalHeight);
        const aspect = natW / natH;
        const tileH = Math.max(1, hh);
        const tileW = tileH * aspect;
        const endX = x + w;
        for (let px = x; px < endX - 0.5; px += tileW) {
            const remain = endX - px;
            if (remain >= tileW - 0.5) {
                ctx.drawImage(img, 0, 0, natW, natH, px, y, tileW, tileH);
            } else {
                const srcW = Math.max(1, (remain / tileW) * natW);
                ctx.drawImage(img, 0, 0, srcW, natH, px, y, remain, tileH);
            }
        }
    };

    const ensureThumb = (file) => {
        const key = `fl2v:${file}`;
        let cached = editor._thumbCache.get(key);
        if (cached?.naturalWidth) return cached;
        if (!editor._thumbPending.has(key)) {
            editor._thumbPending.add(key);
            const el = new Image();
            el.crossOrigin = "anonymous";
            el.onload = () => {
                editor._thumbCache.set(key, el);
                editor._thumbPending.delete(key);
                editor.scheduleRender();
            };
            el.onerror = () => editor._thumbPending.delete(key);
            el.src = fl2vViewUrl(file);
        }
        return null;
    };

    const startImg = startFile ? ensureThumb(startFile) : null;
    const endImg = endFile ? ensureThumb(endFile) : null;
    if ((startFile && !startImg) || (endFile && !endImg && !startFile)) {
        ctx.restore();
        return;
    }

    const trackH = Math.max(1, h - 2);
    const drawY = y0 + 1;
    const hasStart = !!startFile;
    const hasEnd = !!endFile;
    // Split only when both endpoints exist; end-only / start-only fill the full strip.
    const split = hasStart && hasEnd && pxWidth > 24;
    const halfW = split ? pxWidth / 2 : pxWidth;
    const mainW = halfW;
    const endW = split ? pxWidth - halfW : 0;

    if (hasStart && startImg) {
        drawImg(startImg, startX, mainW, drawY, trackH);
    } else if (hasEnd && endImg) {
        drawImg(endImg, startX, pxWidth, drawY, trackH);
    }

    if (split) {
        const ex = startX + mainW;
        if (endImg) {
            drawImg(endImg, ex, endW, drawY, trackH);
        }
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ex + 0.5, drawY);
        ctx.lineTo(ex + 0.5, drawY + trackH);
        ctx.stroke();
    }

    const badgeY = y0 + 6;
    const startTag = t("fl2v.tag.start");
    const endTag = t("fl2v.tag.end");
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    if (hasStart) {
        const startBadgeW = Math.max(38, Math.ceil(ctx.measureText(startTag).width) + 12);
        ctx.fillStyle = "rgba(79,255,143,0.92)";
        ctx.fillRect(startX + 4, badgeY, startBadgeW, 14);
        ctx.fillStyle = "#111";
        ctx.fillText(startTag, startX + 8, badgeY + 7);
    }
    if (hasEnd) {
        // Always top-right of the end region (right half when split, full strip when end-only).
        const endBadgeW = Math.max(30, Math.ceil(ctx.measureText(endTag).width) + 10);
        const endBadgeX = startX + pxWidth - endBadgeW - 4;
        ctx.fillStyle = "rgba(240,160,48,0.92)";
        ctx.fillRect(endBadgeX, badgeY, endBadgeW, 14);
        ctx.fillStyle = "#111";
        ctx.fillText(endTag, endBadgeX + 5, badgeY + 7);
    }

    ctx.restore();
}

export function getFl2vUiHeight(editor) {
    const n = editor.timeline?.shots?.length || 0;
    const rows = Math.max(1, Math.ceil(n / 3));
    return 420 + rows * 150 + 80;
}

export function buildFl2vPayloadFields(editor) {
    ensureFl2vTimeline(editor);
    syncFl2vFromShots(editor);
    const total = getFl2vSampleFrames(editor);
    const shots = (editor.timeline.shots || []).map((s, i) => ({
        id: s.id,
        durationSec: s.durationSec,
        prompt: s.prompt || "",
        // 生图用的画面提示词。必须一起存进 timeline_data，否则刷新页面就没了
        // （它是 AI 首帧 / 批量首帧唯一的输入）。
        framePrompt: String(s.framePrompt || ""),
        negativePrompt: s.negativePrompt || DEFAULT_FL2V_NEGATIVE,
        continuityFromPrev: isSegmentContinuityFromPrev(s, i),
        continuityPinMode: segmentContinuityPinMode(s),
        loras: normalizeLoraRows(s.loras),
        startImage: s.startImage
            ? {
                imageFile: s.startImage.imageFile || "",
                width: s.startImage.width || 0,
                height: s.startImage.height || 0,
            }
            : null,
        endImage: s.endImage
            ? {
                imageFile: s.endImage.imageFile || "",
                width: s.endImage.width || 0,
                height: s.endImage.height || 0,
            }
            : null,
    }));
    return {
        timelineMode: "fl2v",
        editMode: "segment",
        shots,
        keyframes: editor.timeline.keyframes || [],
        segments: (editor.timeline.segments || []).map((s, i) => ({
            id: s.id,
            start: s.start,
            length: s.length,
            frameCount: s.length,
            durationSec: s.durationSec,
            prompt: s.prompt || "",
            negativePrompt: s.negativePrompt || DEFAULT_FL2V_NEGATIVE,
            continuityFromPrev: isSegmentContinuityFromPrev(s, i),
            loras: normalizeLoraRows(s.loras),
            isStartFrame: !!(s.genImage?.imageFile || s.imageFile),
            isEndFrame: !!s.endImage?.imageFile,
            genImage: {
                imageFile: s.genImage?.imageFile || s.imageFile || "",
                width: s.genImage?.width || 0,
                height: s.genImage?.height || 0,
            },
            endImage: s.endImage || null,
            taskType: "",
            refs: [],
        })),
        totalFrames: total,
        durationSec: getFl2vTotalDurationSec(editor),
    };
}

export function isFl2vTaskValue(taskTypeValue) {
    return resolveTaskKey(taskTypeValue) === "fl2v";
}

export function setFl2vToolbar(editor, enabled) {
    const disable = [
        editor.btnVideo,
        editor.btnVideoExisting,
        editor.btnVideoAppend,
        editor.root?.querySelector('[data-a="split"]'),
        editor.root?.querySelector('[data-a="smart-split"]'),
        editor.root?.querySelector('[data-a="equal"]'),
        editor.root?.querySelector('[data-a="mode-global"]'),
        editor.root?.querySelector('[data-a="mode-segment"]'),
    ];
    for (const btn of disable) {
        if (!btn) continue;
        btn.disabled = enabled;
        btn.classList.toggle("bd-disabled", enabled);
        btn.classList.toggle("hidden", enabled);
    }
    if (editor.equalCountInput) {
        editor.equalCountInput.disabled = enabled;
        editor.equalCountInput.classList.toggle("hidden", enabled);
    }
    const externalLocked = !!(editor.hasExternalI2vGroups?.() || editor.hasExternalR2vGroups?.());
    const del = editor.root?.querySelector('[data-a="del"]');
    if (del && enabled) {
        // fl2v uses the button beside 复制当前分组; keep the old top-toolbar delete hidden.
        del.classList.add("hidden");
        del.disabled = true;
    } else if (del && !externalLocked) {
        del.disabled = false;
        del.classList.remove("bd-disabled", "hidden");
        del.textContent = t("toolbar.deleteSegment");
        del.title = t("tooltip.deleteSegment");
        del.setAttribute("data-i18n", "toolbar.deleteSegment");
        del.setAttribute("data-i18n-title", "tooltip.deleteSegment");
    } else if (del) {
        del.classList.add("hidden");
        del.disabled = true;
    }
    for (const sel of ['[data-a="fl2v-insert-before"]', '[data-a="fl2v-insert-after"]', '[data-a="fl2v-replace"]']) {
        const btn = editor.root?.querySelector(sel);
        if (btn) {
            btn.classList.add("hidden");
            btn.disabled = true;
        }
    }
    const addBtn = editor.root?.querySelector('[data-a="fl2v-add-shot"]');
    if (addBtn) {
        addBtn.classList.toggle("hidden", !enabled || externalLocked);
        addBtn.disabled = !enabled || externalLocked;
    }
    for (const sel of ['[data-a="fl2v-group-prev"]', '[data-a="fl2v-group-next"]']) {
        const btn = editor.root?.querySelector(sel);
        if (!btn) continue;
        btn.classList.toggle("hidden", !enabled);
    }
    for (const sel of ['[data-a="fl2v-duplicate"]', '[data-a="fl2v-del"]']) {
        const btn = editor.root?.querySelector(sel);
        if (!btn) continue;
        btn.classList.toggle("hidden", !enabled || externalLocked);
        btn.disabled = !enabled || externalLocked;
    }
    updateFl2vToolbarBtns(editor);
}

export function updateFl2vToolbarBtns(editor) {
    const externalLocked = !!(editor?.hasExternalI2vGroups?.() || editor?.hasExternalR2vGroups?.());
    const show = !!editor?.isFl2vMode?.();
    const showEdit = show && !externalLocked;
    for (const sel of ['[data-a="fl2v-add-shot"]', '[data-a="fl2v-duplicate"]', '[data-a="fl2v-del"]']) {
        const btn = editor?.root?.querySelector?.(sel);
        if (!btn) continue;
        btn.classList.toggle("hidden", !showEdit);
        btn.disabled = !showEdit;
    }
    for (const sel of ['[data-a="fl2v-group-prev"]', '[data-a="fl2v-group-next"]']) {
        const btn = editor?.root?.querySelector?.(sel);
        if (!btn) continue;
        btn.classList.toggle("hidden", !show);
    }
    editor?.syncGroupNavButtons?.();
}

/** @deprecated */
export function updateFl2vReplaceBtn(editor) {
    updateFl2vToolbarBtns(editor);
}
/** @deprecated */
export function updateFl2vInsertBtns(editor) {
    updateFl2vToolbarBtns(editor);
}

/** Stubs for removed both-role seam API (timeline may still import briefly). */
export function isFl2vBothRole() {
    return false;
}
export function getFl2vSeamRatio() {
    return 0.5;
}

// ---------------------------------------------------------------------------
// 右键菜单：上方分镜（时间轴画布 / 镜头卡片区）+ 下方提示词区
// ---------------------------------------------------------------------------

function ctxSelectShot(editor, i) {
    if (!Number.isFinite(i) || i < 0) return;
    const shots = editor.timeline?.shots || [];
    if (i >= shots.length) return;
    if (editor.selectedIndex === i) return;
    flushFl2vPromptDraft(editor);
    editor.selectedIndex = i;
    updateFl2vDetailUI(editor);
    editor.scheduleRender?.();
}

function ctxPatchShot(editor, i, patch) {
    const shot = editor.timeline?.shots?.[i];
    if (shot) Object.assign(shot, patch);
    const seg = Array.isArray(editor.timeline?.segments) ? editor.timeline.segments[i] : null;
    if (seg) Object.assign(seg, patch);
    editor.scheduleTimelineSync?.();
    editor.scheduleRender?.();
}

/** 写值并触发原有 input/change 逻辑，让数据模型跟着更新。 */
function ctxApplyValue(el, value) {
    if (!el) return;
    el.value = String(value ?? "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function ctxPasteInto(el) {
    if (!el) return;
    const text = await readClipboard();
    if (text == null) {
        // 浏览器不给读剪贴板时，退回「聚焦 + 自己按 Ctrl+V」
        try {
            el.focus();
            el.select();
        } catch {
            /* ignore */
        }
        return;
    }
    ctxApplyValue(el, text);
}

function fl2vShotMenuItems(editor, shotIndex) {
    const shots = editor.timeline?.shots || [];
    const hasShot = Number.isFinite(shotIndex) && shotIndex >= 0 && shotIndex < shots.length;
    const shot = hasShot ? shots[shotIndex] : null;
    const n = hasShot ? shotIndex + 1 : 0;
    const locked = !!(editor.hasExternalI2vGroups?.() || editor.hasExternalR2vGroups?.());
    const cont = !!shot?.continuityFromPrev;
    const pin = segmentContinuityPinMode(shot || {});
    const masterOn = isContinuityMasterEnabled(editor.timeline?.output);
    const canCont = hasShot && shotIndex > 0 && shots.length >= 2 && masterOn;
    const promptText = String(shot?.prompt || "");
    const ui = editor.fl2vUi;

    return [
        {
            label: "添加一组镜头",
            hint: "选首帧",
            disabled: locked,
            action: () => openFl2vUpload(editor),
        },
        {
            label: n ? `复制第 ${n} 组` : "复制当前分组",
            disabled: !hasShot || locked,
            action: () => {
                ctxSelectShot(editor, shotIndex);
                duplicateFl2vShot(editor);
            },
        },
        {
            label: n ? `删除第 ${n} 组` : "删除当前分组",
            danger: true,
            disabled: !hasShot || locked,
            action: () => {
                ctxSelectShot(editor, shotIndex);
                editor.deleteSelectedSegment?.();
            },
        },
        { sep: true },
        {
            label: "复制本组提示词",
            hint: promptText ? `${promptText.length} 字` : "",
            disabled: !promptText,
            action: () => {
                void copyToClipboard(promptText);
            },
        },
        {
            label: "粘贴提示词到本组",
            disabled: !hasShot,
            action: () => {
                ctxSelectShot(editor, shotIndex);
                void ctxPasteInto(ui?.prompt);
            },
        },
        {
            label: "清空本组提示词",
            danger: true,
            disabled: !promptText,
            action: () => {
                ctxSelectShot(editor, shotIndex);
                ctxApplyValue(ui?.prompt, "");
            },
        },
        { sep: true },
        {
            label: "引用上一段：不引用",
            checked: hasShot && !cont,
            disabled: !canCont,
            hint: canCont ? "" : (masterOn ? "需第 2 段起" : "需开总开关"),
            action: () => ctxPatchShot(editor, shotIndex, { continuityFromPrev: false }),
        },
        {
            label: "引用上一段：运动引导",
            checked: canCont && cont && pin !== "tail",
            disabled: !canCont,
            action: () =>
                ctxPatchShot(editor, shotIndex, {
                    continuityFromPrev: true,
                    continuityPinMode: "motion",
                }),
        },
        {
            label: "引用上一段：尾帧",
            checked: canCont && cont && pin === "tail",
            disabled: !canCont,
            action: () =>
                ctxPatchShot(editor, shotIndex, {
                    continuityFromPrev: true,
                    continuityPinMode: "tail",
                }),
        },
        { sep: true },
        {
            label: "上一组",
            disabled: !hasShot || shotIndex <= 0,
            action: () => ctxSelectShot(editor, shotIndex - 1),
        },
        {
            label: "下一组",
            disabled: !hasShot || shotIndex >= shots.length - 1,
            action: () => ctxSelectShot(editor, shotIndex + 1),
        },
    ];
}

function fl2vPromptMenuItems(editor, target) {
    const ui = editor.fl2vUi;
    const el =
        (target?.closest?.("textarea") || null) ||
        (target?.closest?.('[data-r="fl2v-detail"]') ? ui?.prompt : null) ||
        ui?.prompt ||
        null;
    const isCommon = !!el && el === ui?.commonPrompt;
    const value = String(el?.value || "");
    const selStart = Number(el?.selectionStart);
    const selEnd = Number(el?.selectionEnd);
    const sel =
        Number.isFinite(selStart) && Number.isFinite(selEnd) && selEnd > selStart
            ? value.slice(selStart, selEnd)
            : "";
    const scopeLabel = isCommon
        ? "通用提示词（对所有镜头生效）"
        : `第 ${(editor.selectedIndex ?? 0) + 1} 组专属提示词`;

    return [
        {
            label: sel ? "复制选中内容" : "复制本框全部",
            hint: sel || value ? `${(sel || value).length} 字` : "",
            disabled: !(sel || value),
            action: () => {
                void copyToClipboard(sel || value);
            },
        },
        {
            label: "粘贴到本框",
            action: () => {
                void ctxPasteInto(el);
            },
        },
        {
            label: "全选本框",
            disabled: !el,
            action: () => {
                try {
                    el.focus();
                    el.select();
                } catch {
                    /* ignore */
                }
            },
        },
        {
            label: "清空本框",
            danger: true,
            disabled: !value,
            action: () => ctxApplyValue(el, ""),
        },
        { sep: true },
        {
            label: "清空通用提示词",
            danger: true,
            disabled: !ui?.commonPrompt?.value,
            action: () => ctxApplyValue(ui?.commonPrompt, ""),
        },
        {
            label: "清空专属提示词",
            danger: true,
            disabled: !ui?.prompt?.value,
            action: () => ctxApplyValue(ui?.prompt, ""),
        },
        { sep: true },
        { label: scopeLabel, disabled: true },
    ];
}

/**
 * 给上方分镜区（时间轴画布 + 镜头卡片条）和下方提示词区挂右键菜单。
 * 幂等；非 fl2v 模式一律不接管，避免和时间轴的「右键加分镜点」打架。
 */
export function installFl2vContextMenus(editor) {
    if (!editor || editor._alberFl2vCtx) return;
    editor._alberFl2vCtx = true;
    const ui = editor.fl2vUi;
    if (!ui) return;

    const onShotsMenu = (ev) => {
        if (!editor.isFl2vMode?.()) return;
        const card = ev.target?.closest?.(".bd-fl2v-shot");
        let idx = card ? parseInt(card.dataset.shotIndex, 10) : NaN;
        if (Number.isFinite(idx)) ctxSelectShot(editor, idx);
        else idx = editor.selectedIndex;
        showContextMenu(ev, fl2vShotMenuItems(editor, idx));
    };

    // 上方的镜头卡片条（含右侧实时预览）
    (ui.workbench || ui.shotsEl)?.addEventListener("contextmenu", onShotsMenu);
    // 上方的时间轴画布：fl2v 模式下原本右键什么都不做，这里也给它一份
    editor.canvas?.addEventListener("contextmenu", (ev) => {
        if (!editor.isFl2vMode?.()) return;
        showContextMenu(ev, fl2vShotMenuItems(editor, editor.selectedIndex));
    });

    // 下方的提示词区
    ui.detail?.addEventListener("contextmenu", (ev) => {
        if (!editor.isFl2vMode?.()) return;
        showContextMenu(ev, fl2vPromptMenuItems(editor, ev.target));
    });
}