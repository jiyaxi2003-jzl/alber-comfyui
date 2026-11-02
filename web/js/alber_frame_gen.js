// Alber 导演台 · 单镜头 AI 首帧（Qwen-Image 2.1）
// ---------------------------------------------------------------------------
// 每个镜头卡片上一个「✦ AI 首帧」按钮：点开一个小面板，写「画面提示词」
// （独立于镜头提示词，存在 shot.framePrompt），按当前节点画幅出一张图，
// 满意就回填成该镜头的首帧。
//
// 实现走 ComfyUI 队列（api.queuePrompt），不自己加载模型：
//   UNETLoader(qwen_image_2.1) → CLIPLoader(qwen_image) → TextEncodeQwenImage21
//   → EmptyLatentImage(画幅) → KSampler(euler/simple, 25 步, cfg 1) → VAEDecode → SaveImage
// 出完图后再 /view 下载、/upload/image 传回 input，得到和手动上传一样的 imageRef。
// 这样不做任何 Python 改动，显存和排队全部交给 ComfyUI 自己管。
//
// 注意：模型名不写死，开面板时从 /object_info/<节点> 里挑当前存在的 qwen 权重，
// 这样以后换量化版本（int8 / quantfunc）不用改代码。
// ---------------------------------------------------------------------------

import { api } from "../../scripts/api.js";
import { isDarkTheme } from "./alber_palette.js";

const STYLE_ID = "alber-fg-style";
const SAVE_PREFIX = "alber_frames/frame";
const POLL_MS = 1200;
const TIMEOUT_MS = 15 * 60 * 1000;

let modelsCache = null;
let dialogEl = null;

/** 该镜头的画面提示词（生图用），与镜头提示词分开。 */
export function framePromptOf(shot) {
    return String(shot?.framePrompt || "");
}

/** 注入一次样式。 */
function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
.alber-fg-mask{position:fixed;inset:0;z-index:100200;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.55);font:12px/1.5 system-ui,"Microsoft YaHei",sans-serif}
.alber-fg-card{width:min(520px,94vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;
  border-radius:10px;box-shadow:0 18px 60px rgba(0,0,0,.55);border:1px solid #3a3a44;background:#1e1e22;color:#dcdce4}
.alber-fg-card.light{border-color:#d5d5de;background:#fff;color:#24242c}
.alber-fg-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #31313a;flex:0 0 auto}
.alber-fg-card.light .alber-fg-head{border-bottom-color:#e6e6ee}
.alber-fg-head b{font-size:13px}
.alber-fg-head .sub{opacity:.6;font-size:11px;margin-left:auto;white-space:nowrap}
.alber-fg-x{all:unset;cursor:pointer;width:22px;height:22px;line-height:22px;text-align:center;border-radius:6px;opacity:.7}
.alber-fg-x:hover{background:rgba(130,130,160,.22);opacity:1}
.alber-fg-body{padding:12px;overflow:auto;display:flex;flex-direction:column;gap:10px}
.alber-fg-label{font-size:11px;opacity:.7;margin-bottom:4px;display:flex;gap:6px;align-items:center}
.alber-fg-label .hint{opacity:.6;font-weight:400}
.alber-fg-body textarea{width:100%;box-sizing:border-box;min-height:96px;resize:vertical;border-radius:7px;
  padding:8px 9px;font:12px/1.6 inherit;outline:none;background:#17171a;color:#dcdce4;border:1px solid #3a3a44}
.alber-fg-card.light .alber-fg-body textarea{background:#f7f7fa;color:#24242c;border-color:#d5d5de}
.alber-fg-body textarea:focus{border-color:#5ec8ff}
.alber-fg-meta{display:flex;flex-wrap:wrap;gap:10px;font-size:11px;opacity:.72}
.alber-fg-meta code{font-family:ui-monospace,Consolas,monospace;opacity:.9}
.alber-fg-preview{display:none;border-radius:7px;overflow:hidden;background:#0e0e11;border:1px solid #2c2c34;
  align-self:center;max-height:52vh}
.alber-fg-preview.on{display:block}
.alber-fg-preview img{display:block;max-width:100%;max-height:52vh;object-fit:contain}
.alber-fg-foot{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid #31313a;flex:0 0 auto}
.alber-fg-card.light .alber-fg-foot{border-top-color:#e6e6ee}
.alber-fg-status{font-size:11px;opacity:.75;margin-right:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.alber-fg-btn{all:unset;cursor:pointer;padding:5px 12px;border-radius:7px;font-size:12px;border:1px solid #3f3f4a;
  background:#26262c;color:#dcdce4;white-space:nowrap}
.alber-fg-card.light .alber-fg-btn{background:#f2f2f7;color:#24242c;border-color:#d5d5de}
.alber-fg-btn:hover{border-color:#5ec8ff}
.alber-fg-btn[disabled]{opacity:.45;cursor:default;border-color:#3f3f4a}
.alber-fg-btn.primary{background:#2f6fd0;border-color:#2f6fd0;color:#fff}
.alber-fg-btn.primary:hover{background:#3a7de0}
.alber-fg-btn[disabled].primary{background:#2a4a78;border-color:#2a4a78}
/* 浅色主题下 .alber-fg-card.light .alber-fg-btn 特异性更高，主按钮要单独压回来 */
.alber-fg-card.light .alber-fg-btn.primary{background:#2f6fd0;border-color:#2f6fd0;color:#fff}
.alber-fg-card.light .alber-fg-btn.primary:hover{background:#3a7de0}
.alber-fg-card.light .alber-fg-btn[disabled].primary{background:#9db8e0;border-color:#9db8e0;color:#fff}
.alber-fg-card.light .alber-fg-btn[disabled]{border-color:#d5d5de}
.alber-fg-btn.hidden{display:none}
`;
    document.head.appendChild(st);
}

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

/** 节点画幅（16 的倍数，Qwen 的 latent 要 16 对齐）。 */
export function nodeCanvasSize(editor) {
    const read = (name, dflt) => {
        const w = editor?.node?.widgets?.find?.((x) => x?.name === name);
        const v = Number(w?.value);
        return Number.isFinite(v) && v > 0 ? v : dflt;
    };
    const w = read("width", 768);
    const h = read("height", 1344);
    return {
        width: Math.max(256, Math.round(w / 16) * 16),
        height: Math.max(256, Math.round(h / 16) * 16),
    };
}

async function fetchNodeDef(cls) {
    try {
        const r = await api.fetchApi(`/object_info/${encodeURIComponent(cls)}`);
        if (!r.ok) return null;
        const d = await r.json();
        return d?.[cls] || null;
    } catch {
        return null;
    }
}

function pickModel(list, patterns, fallback) {
    const arr = Array.isArray(list) ? list : [];
    for (const re of patterns) {
        const hit = arr.find((n) => typeof n === "string" && re.test(n));
        if (hit) return hit;
    }
    return fallback;
}

/** 从当前 ComfyUI 里挑一套能用的 qwen-image 权重（结果缓存）。 */
export async function resolveFrameModels() {
    if (modelsCache) return modelsCache;
    const [unet, clip, vae] = await Promise.all([
        fetchNodeDef("UNETLoader"),
        fetchNodeDef("CLIPLoader"),
        fetchNodeDef("VAELoader"),
    ]);
    modelsCache = {
        unet: pickModel(
            unet?.input?.required?.unet_name?.[0],
            [/qwen_image_2\.1.*(int8|convrot)/i, /qwen_image_2\.1/i, /qwen_image/i],
            "qwen_image_2.1_bf16.safetensors",
        ),
        clip: pickModel(
            clip?.input?.required?.clip_name?.[0],
            [/qwen3vl_8b.*(int8|convrot)/i, /qwen3vl_8b/i, /qwen3\.5_9b/i],
            "qwen3vl_8b_fp8_scaled.safetensors",
        ),
        vae: pickModel(
            vae?.input?.required?.vae_name?.[0],
            [/qwen_image_2\.1_vae/i, /qwen_image_vae/i],
            "qwen_image_2.1_vae_bf16.safetensors",
        ),
    };
    return modelsCache;
}

function buildPrompt({ models, prompt, negative, width, height, seed, steps }) {
    return {
        2: { class_type: "UNETLoader", inputs: { unet_name: models.unet, weight_dtype: "default" } },
        3: {
            class_type: "CLIPLoader",
            inputs: { clip_name: models.clip, type: "qwen_image", device: "default" },
        },
        4: { class_type: "VAELoader", inputs: { vae_name: models.vae } },
        5: {
            class_type: "TextEncodeQwenImage21",
            inputs: {
                clip: ["3", 0],
                prompt: prompt || "",
                negative_prompt: negative || "",
                resolution: 1024,
                images: {},
            },
        },
        6: { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
        7: {
            class_type: "KSampler",
            inputs: {
                model: ["2", 0],
                seed: seed >>> 0,
                steps,
                cfg: 1.0,
                sampler_name: "euler",
                scheduler: "simple",
                positive: ["5", 0],
                negative: ["5", 1],
                latent_image: ["6", 0],
                denoise: 1.0,
            },
        },
        8: { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["4", 0] } },
        9: { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: SAVE_PREFIX } },
    };
}

function firstImage(outputs) {
    for (const out of Object.values(outputs || {})) {
        for (const img of out?.images || []) {
            if (img?.filename) return img;
        }
    }
    return null;
}

/** 这张图还在队列里吗（running + pending）。查不到就当还在跑，避免误杀。 */
async function isPromptQueued(promptId) {
    try {
        const r = await api.fetchApi("/queue");
        if (!r.ok) return true;
        const q = await r.json();
        const all = [...(q?.queue_running || []), ...(q?.queue_pending || [])];
        return all.some((it) => Array.isArray(it) && it[1] === promptId);
    } catch {
        return true;
    }
}

/** 等队列跑完，返回 SaveImage 的输出信息。 */
async function waitForResult(promptId, onTick, isCancelled) {
    const t0 = Date.now();
    while (Date.now() - t0 < TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        // 被用户「停止」时这一张可能已经出队，/history 永远不会有它的条目，
        // 只靠超时就会白等 15 分钟——这里主动确认它还在不在队列里。
        if (isCancelled?.() && !(await isPromptQueued(promptId))) {
            throw new Error("已取消");
        }
        let hist;
        try {
            const resp = await api.fetchApi(`/history/${encodeURIComponent(promptId)}`);
            if (!resp.ok) continue;
            hist = await resp.json();
        } catch {
            continue;
        }
        const entry = hist?.[promptId];
        if (!entry) {
            onTick?.(Math.round((Date.now() - t0) / 1000), "排队/生成中");
            continue;
        }
        const status = entry.status || {};
        if (status.status_str === "error") {
            const msg = (status.messages || []).find((m) => m?.[0] === "execution_error");
            const detail = msg?.[1]?.exception_message || "生成失败";
            throw new Error(String(detail).slice(0, 300));
        }
        const img = firstImage(entry.outputs);
        if (img) return img;
        if (status.completed === true) throw new Error("生成完成但没有输出图片");
        onTick?.(Math.round((Date.now() - t0) / 1000), "解码中");
    }
    throw new Error("等待超时（15 分钟）");
}

/** 把 output 目录里的图搬到 input 目录，得到普通上传那样可用的 imageRef。 */
export async function adoptOutputImage(img) {
    const params = new URLSearchParams({
        filename: img.filename,
        subfolder: img.subfolder || "",
        type: img.type || "output",
    });
    const resp = await api.fetchApi(`/view?${params.toString()}`);
    if (!resp.ok) throw new Error(`读取生成图失败 (${resp.status})`);
    const blob = await resp.blob();
    const name = `alber_ai_frame_${Date.now()}.png`;
    const file = new File([blob], name, { type: blob.type || "image/png" });

    const body = new FormData();
    body.append("image", file, name);
    body.append("type", "input");
    body.append("overwrite", "false");
    const upResp = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!upResp.ok) throw new Error((await upResp.text()) || `上传失败 (${upResp.status})`);
    const up = await upResp.json();

    const sub = String(up.subfolder || "").replace(/\\/g, "/").replace(/\/$/, "");
    const fname = up.name || up.filename || name;

    const dims = await new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const im = new Image();
        im.onload = () => {
            resolve({ width: im.naturalWidth || 0, height: im.naturalHeight || 0 });
            URL.revokeObjectURL(url);
        };
        im.onerror = () => {
            resolve({ width: 0, height: 0 });
            URL.revokeObjectURL(url);
        };
        im.src = url;
    });

    return {
        ref: { imageFile: sub ? `${sub}/${fname}` : fname, width: dims.width, height: dims.height },
        viewUrl: api.apiURL(`/view?${new URLSearchParams({ filename: fname, subfolder: sub, type: "input" })}`),
    };
}

/**
 * 跑一次「文/参考 → 一张图」，返回 { ref, viewUrl, promptId }。
 * 单张面板和批量面板都走这里，避免两套生成逻辑各修一遍。
 */
export async function generateFrame({
    prompt,
    negative = "",
    width,
    height,
    seed,
    steps = 25,
    onStatus,
    onQueued,
    isCancelled,
} = {}) {
    const models = await resolveFrameModels();
    const apiPrompt = buildPrompt({
        models,
        prompt,
        negative,
        width,
        height,
        seed: seed == null ? Math.floor(Math.random() * 0x7fffffff) : seed,
        steps,
    });
    if (isCancelled?.()) throw new Error("已取消");
    onStatus?.("已提交，等待队列…");
    const resp = await api.queuePrompt(0, { output: apiPrompt, workflow: { nodes: [], links: [] } });
    const promptId = resp?.prompt_id;
    if (!promptId) {
        const errs = resp?.node_errors && Object.keys(resp.node_errors);
        throw new Error(errs?.length ? `节点报错：${errs.join(", ")}` : "提交失败");
    }
    onQueued?.(promptId);
    const img = await waitForResult(
        promptId,
        (sec, what) => onStatus?.(`${what} ${sec}s`),
        isCancelled,
    );
    onStatus?.("回传图片…");
    const adopted = await adoptOutputImage(img);
    return { ...adopted, promptId };
}

/** 把队列里还没跑完的这一张撤掉（批量面板「停止」用）。 */
export async function cancelFrameJob(promptId) {
    if (!promptId) return;
    try {
        await api.fetchApi("/queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ delete: [promptId] }),
        });
    } catch {
        /* 已经跑完/找不到就算了 */
    }
}

/**
 * 打开「AI 首帧」面板。
 * hooks.syncFromShots / hooks.refreshDetail 由 minimax_fl2v 注入，避免循环依赖。
 */
export function openFrameGenDialog(editor, shotIndex, hooks = {}) {
    ensureStyle();
    const shot = editor?.timeline?.shots?.[shotIndex];
    if (!shot) return null;

    const size = nodeCanvasSize(editor);
    const dark = isDarkTheme();

    const mask = el("div", "alber-fg-mask");
    const card = el("div", `alber-fg-card${dark ? "" : " light"}`);

    const head = el("div", "alber-fg-head");
    head.appendChild(el("b", null, `第 ${shotIndex + 1} 组 · AI 首帧`));
    head.appendChild(el("span", "sub", "Qwen-Image 2.1"));
    const closeBtn = el("button", "alber-fg-x", "×");
    closeBtn.type = "button";
    head.appendChild(closeBtn);

    const body = el("div", "alber-fg-body");
    const label = el("div", "alber-fg-label");
    label.appendChild(el("span", null, "画面提示词"));
    label.appendChild(el("span", "hint", "（静态画面描述，和镜头提示词分开存）"));
    const ta = document.createElement("textarea");
    ta.value = framePromptOf(shot) || String(shot.prompt || "");
    ta.placeholder = "例：一个年轻女人站在雨夜便利店门口，暖黄灯光从背后打在头发上，穿深蓝风衣，电影感浅景深";
    ta.spellcheck = false;

    const meta = el("div", "alber-fg-meta");
    const metaSize = el("span", null, "");
    metaSize.innerHTML = `画幅 <code>${size.width}×${size.height}</code>`;
    const metaSteps = el("span", null, "");
    metaSteps.innerHTML = `步数 <code>25</code> · euler / simple`;
    const metaModel = el("span", null, "");
    metaModel.innerHTML = "模型 <code>读取中…</code>";
    meta.append(metaSize, metaSteps, metaModel);

    const preview = el("div", "alber-fg-preview");
    const previewImg = document.createElement("img");
    previewImg.alt = "";
    preview.appendChild(previewImg);

    body.append(label, ta, meta, preview);

    const foot = el("div", "alber-fg-foot");
    const status = el("span", "alber-fg-status", "");
    const reuseBtn = el("button", "alber-fg-btn hidden", "重新生成");
    const applyBtn = el("button", "alber-fg-btn primary hidden", "用这张作首帧");
    const genBtn = el("button", "alber-fg-btn primary", "生成");
    for (const b of [reuseBtn, applyBtn, genBtn]) b.type = "button";
    foot.append(status, reuseBtn, applyBtn, genBtn);

    card.append(head, body, foot);
    mask.appendChild(card);
    document.body.appendChild(mask);
    dialogEl = mask;

    let pending = null; // { ref, viewUrl }
    let busy = false;

    const setStatus = (txt) => {
        status.textContent = txt || "";
    };

    const teardown = () => {
        // 只改了提示词没生成也要记住，不然下次打开又回到旧文案
        const v = ta.value.trim();
        if (v && v !== framePromptOf(shot)) {
            shot.framePrompt = v;
            const live = editor?.timeline?.shots?.[shotIndex];
            if (live) live.framePrompt = v;
            editor.scheduleTimelineSync?.();
        }
        if (dialogEl === mask) dialogEl = null;
        mask.remove();
        document.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            if (!busy) teardown();
        }
    };
    document.addEventListener("keydown", onKey, true);
    closeBtn.addEventListener("click", () => {
        if (!busy) teardown();
    });
    mask.addEventListener("pointerdown", (e) => {
        if (e.target === mask && !busy) teardown();
    });

    // 模型名异步补上，顺便预热后续生成
    resolveFrameModels().then((m) => {
        metaModel.innerHTML = `模型 <code>${m.unet.replace(/\.safetensors$/, "")}</code>`;
    });

    const runGenerate = async () => {
        if (busy) return;
        const text = ta.value.trim();
        if (!text) {
            setStatus("先写一句画面描述");
            ta.focus();
            return;
        }
        busy = true;
        pending = null;
        reuseBtn.classList.add("hidden");
        applyBtn.classList.add("hidden");
        genBtn.disabled = true;
        reuseBtn.disabled = true;
        preview.classList.remove("on");
        setStatus("准备模型…");

        // 画面提示词立刻记到镜头上，下次打开还在
        shot.framePrompt = text;
        const liveShot = editor?.timeline?.shots?.[shotIndex];
        if (liveShot) liveShot.framePrompt = text;

        try {
            const adopted = await generateFrame({
                prompt: text,
                negative: "",
                width: size.width,
                height: size.height,
                steps: 25,
                onStatus: setStatus,
            });
            pending = adopted;
            previewImg.src = adopted.viewUrl;
            preview.classList.add("on");
            applyBtn.classList.remove("hidden");
            reuseBtn.classList.remove("hidden");
            setStatus(`完成 · ${adopted.ref.width}×${adopted.ref.height}`);
        } catch (err) {
            console.error("[Alber frame-gen]", err);
            setStatus(`失败：${err?.message || err}`);
        } finally {
            busy = false;
            genBtn.disabled = false;
            reuseBtn.disabled = false;
            // 出过图之后交给「重新生成 / 用这张」，主按钮就不用占位了
            if (pending) {
                genBtn.classList.add("hidden");
            } else {
                genBtn.classList.remove("hidden");
                genBtn.textContent = "生成";
            }
        }
    };

    genBtn.addEventListener("click", runGenerate);
    reuseBtn.addEventListener("click", runGenerate);

    applyBtn.addEventListener("click", () => {
        if (!pending) return;
        const target = editor?.timeline?.shots?.[shotIndex];
        if (!target) return;
        target.startImage = pending.ref;
        target.framePrompt = ta.value.trim();
        hooks.syncFromShots?.(editor);
        editor.commit?.(false, { syncTimeline: true });
        hooks.refreshDetail?.(editor);
        editor.updateVideoNameLabel?.();
        editor.scheduleRender?.();
        editor.updateDomWidgetHeight?.();
        teardown();
    });

    setTimeout(() => ta.focus(), 30);
    return mask;
}

/** 当前是否有面板开着（给外部判断用）。 */
export function isFrameGenOpen() {
    return !!dialogEl;
}
