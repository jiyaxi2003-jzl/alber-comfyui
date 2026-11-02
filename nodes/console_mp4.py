"""导演台内置 MP4 导出：跑完直接落一个 mp4，不需要再接 VHS_VideoCombine。

设计要点：
  * 复用 ``lib/video_export.write_frames_to_mp4``（ffmpeg + libx264 + faststart），
    与「分段导出」用的是同一套编码器，行为一致。
  * IMAGE / AUDIO 输出都是 ``OUTPUT_IS_LIST``，所以先把列表拼成一条完整时间线，
    再编码成一个 mp4（多段导出时就是整片）。
  * 落盘目录可自定义：``mp4_dir`` 留空 = ComfyUI 的 output 目录；
    填相对路径 = output 下的子目录；填绝对路径（如 ``G:/成片``）= 直接写那里。
  * 文件名由 ``mp4_prefix`` 决定：``牙膏从中间挤`` → ``牙膏从中间挤.mp4``；
    带 ``/`` 的前半段仍作为相对子目录。重名默认加 ``_2`` / ``_3``，勾了覆盖就直接盖掉。
  * 目录不可写时自动回退到 output 目录，绝不因为路径写错丢片。
  * 任何编码失败都只记日志、返回 None，绝不让出片流程挂掉。
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any

import folder_paths
import torch

from ..lib.video_export import write_frames_to_mp4

log = logging.getLogger("Alber-H3-Director-Console.mp4")

DEFAULT_PREFIX = "Alber导演台"
DEFAULT_DIR = ""
DEFAULT_CRF = 18


def _frame_items(images: Any) -> list[torch.Tensor]:
    if isinstance(images, torch.Tensor):
        items = [images]
    elif isinstance(images, (list, tuple)):
        items = list(images)
    else:
        return []
    out: list[torch.Tensor] = []
    for item in items:
        if isinstance(item, torch.Tensor) and item.ndim == 4 and item.shape[0] > 0:
            out.append(item)
    return out


def finite_ratio(frames: torch.Tensor | None) -> float:
    """帧里有限值（非 NaN/Inf）的占比。1.0 = 全部正常，0.0 = 整条都是 NaN。"""
    if not isinstance(frames, torch.Tensor) or frames.numel() == 0:
        return 0.0
    sample = frames
    # 大张量只抽帧采样，避免为了一条日志再算一遍几十 MB
    if sample.shape[0] > 8:
        step = sample.shape[0] // 8
        sample = sample[::step]
    try:
        finite = torch.isfinite(sample.reshape(-1)).sum().item()
        return float(finite) / float(sample.numel())
    except Exception:
        return 1.0


def pick_export_frames(result: tuple) -> tuple[Any, str]:
    """从导演台输出里挑一条能用的帧序列。

    正常情况用 ``images``（第 0 个）。但采样/VAE 解码发散时它会整条 NaN，
    直接编码就是纯黑 mp4（NaN→uint8 是 0）。这时退到 ``images_pre_refine``
    （第 6 个，二采/修脸之前的输出），它往往还是好的。
    """
    candidates: list[tuple[int, str]] = [(0, "images")]
    if len(result) > 6:
        candidates.append((6, "images_pre_refine"))
    if len(result) > 7:
        candidates.append((7, "images_pre_face_refine"))

    best: tuple[Any, str, float] = (None, "", -1.0)
    for index, label in candidates:
        try:
            frames = concat_frames(result[index])
        except Exception:
            continue
        if frames is None:
            continue
        ratio = finite_ratio(frames)
        torch_note = f"{label} 有限值 {ratio * 100:.1f}% shape={tuple(frames.shape)}"
        log.info("MP4 候选：%s", torch_note)
        if ratio > best[2]:
            best = (frames, label, ratio)
        if ratio >= 0.999:
            break
    if best[0] is None:
        return None, ""
    if best[2] < 0.999:
        log.warning(
            "导出的帧里有 %.1f%% 是 NaN/Inf（源：%s）—— 编码后画面会缺块或全黑，"
            "多半是采样发散或 VAE 解码溢出。",
            (1.0 - best[2]) * 100.0,
            best[1],
        )
    return best[0], best[1]


def concat_frames(images: Any) -> torch.Tensor | None:
    """把导演台 images 输出（列表）拼成一条连续帧序列。"""
    items = _frame_items(images)
    if not items:
        return None
    # 导出黑片时这里是最关键的一行日志：能看出尺寸/值域/dtype 到底哪一步不对
    log.info(
        "MP4 输入：%d 段，%s",
        len(items),
        "，".join(
            f"#{i} shape={tuple(t.shape)} dtype={t.dtype} "
            f"min={float(t.min()):.3f} max={float(t.max()):.3f}"
            for i, t in enumerate(items[:4])
        ),
    )
    if len(items) == 1:
        return items[0]
    try:
        return torch.cat(items, dim=0)
    except Exception as exc:  # 尺寸不一致的极端情况：退回第一段
        log.warning("帧序列拼接失败，只导出第一段：%s", exc)
        return items[0]


def _audio_items(audio: Any) -> list[dict]:
    if isinstance(audio, dict):
        return [audio]
    if isinstance(audio, (list, tuple)):
        return [a for a in audio if isinstance(a, dict)]
    return []


def concat_audio(audio: Any) -> dict | None:
    """把导演台 audio 输出（列表）拼成一条音轨。"""
    items = _audio_items(audio)
    if not items:
        return None
    first = items[0]
    waves: list[torch.Tensor] = []
    for item in items:
        wave = item.get("waveform")
        if isinstance(wave, torch.Tensor) and wave.numel() > 0:
            waves.append(wave)
    if not waves:
        return first
    if len(waves) == 1:
        return {"waveform": waves[0], "sample_rate": first.get("sample_rate")}
    try:
        return {
            "waveform": torch.cat(waves, dim=-1),
            "sample_rate": first.get("sample_rate"),
        }
    except Exception as exc:
        log.warning("音轨拼接失败，只导出第一段：%s", exc)
        return first


# 旧工作流控件索引错位时，这里会收到 True/False 之类被字符串化的值。
# 那显然不是文件名，直接回退默认名，别产出一个 false.mp4。
_BOGUS_NAMES = {"true", "false", "none", "null", "undefined", "nan", "0", "1"}


def _clean_name(prefix: str) -> str:
    text = str(prefix if prefix is not None else "").strip()
    if isinstance(prefix, bool) or text.lower() in _BOGUS_NAMES:
        log.warning("MP4 文件名收到非法值 %r，改用默认名 %s", prefix, DEFAULT_PREFIX)
        return DEFAULT_PREFIX
    # 保留 "/" 作为子目录分隔，其余非法字符替换成下划线
    text = re.sub(r'[<>:"\\|?*\x00-\x1f]', "_", text)
    text = "/".join(part.strip() for part in text.split("/") if part.strip())
    return text or DEFAULT_PREFIX


def output_root() -> Path:
    try:
        return Path(folder_paths.get_output_directory())
    except Exception:  # pragma: no cover - 极端环境下没有 folder_paths 配置
        return Path.cwd() / "output"


def resolve_save_dir(save_dir: str | None) -> Path:
    """把用户填的保存目录解析成绝对路径。

    * 空 → ComfyUI 的 output 目录
    * 相对路径 → output 目录下的子目录（``成片/牙膏`` → ``<output>/成片/牙膏``）
    * 绝对路径 → 原样使用（``G:/成片``、``D:\\\\交付`` 都行）
    """
    base = output_root()
    text = str(save_dir or "").strip().strip('"').strip("'")
    if not text:
        return base
    try:
        text = os.path.expandvars(os.path.expanduser(text))
    except Exception:
        pass
    path = Path(text)
    if not path.is_absolute():
        path = base / path
    return path


def _is_inside(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except (ValueError, OSError):
        return False


def allocate_mp4_path(
    prefix: str,
    save_dir: str | None = None,
    overwrite: bool = False,
) -> tuple[Path, str, str]:
    """返回 (绝对路径, 文件名, 相对 output 的子目录)。

    子目录只在该文件确实落在 output 里面时才非空（供 ``/view`` 使用）；
    写到自定义目录时返回空串，前端走 ``/alber/director/mp4_preview``。
    """
    folder = resolve_save_dir(save_dir)
    parts = [p for p in _clean_name(prefix).split("/") if p]
    name = parts[-1] if parts else DEFAULT_PREFIX
    if len(parts) > 1:
        folder = folder.joinpath(*parts[:-1])
    folder.mkdir(parents=True, exist_ok=True)

    candidate = folder / f"{name}.mp4"
    if not overwrite:
        index = 2
        while candidate.exists():
            candidate = folder / f"{name}_{index}.mp4"
            index += 1

    subfolder = ""
    root = output_root()
    if _is_inside(candidate, root):
        try:
            rel = candidate.parent.resolve().relative_to(root.resolve()).as_posix()
            subfolder = "" if rel == "." else rel
        except (ValueError, OSError):
            subfolder = ""
    return candidate, candidate.name, subfolder


def save_timeline_mp4(
    images: Any,
    audio: Any,
    *,
    fps: float,
    prefix: str = DEFAULT_PREFIX,
    crf: int = DEFAULT_CRF,
    save_dir: str | None = None,
    overwrite: bool = False,
    frames: torch.Tensor | None = None,
) -> dict | None:
    """把一整个时间线写成单个 MP4。返回 UI 需要的文件信息，失败返回 None。

    ``frames`` 可以直接给一条已经拼好的帧序列（调用方已挑过 NaN 情况）。
    """
    if frames is None:
        frames = concat_frames(images)
    if frames is None:
        log.warning("MP4 导出跳过：images 输出为空。")
        return None
    frame_count = int(frames.shape[0])
    if frame_count < 2:
        log.warning("MP4 导出跳过：只有 %d 帧（确认模式/预览帧不导出）。", frame_count)
        return None

    rate = float(fps or 0.0)
    if rate <= 0:
        rate = 24.0

    nan_ratio = finite_ratio(frames)

    # CRF 也可能被错位成布尔/0：0 等于无损，成片体积会爆，直接回默认。
    try:
        crf_int = int(crf)
    except (TypeError, ValueError):
        crf_int = DEFAULT_CRF
    if isinstance(crf, bool) or crf_int < 1 or crf_int > 51:
        log.warning("MP4 CRF 收到非法值 %r，改用默认 %s", crf, DEFAULT_CRF)
        crf_int = DEFAULT_CRF

    fallback = False
    try:
        path, filename, subfolder = allocate_mp4_path(prefix, save_dir, overwrite)
    except Exception as exc:
        log.warning("保存目录不可用（%s），回退到 output 目录：%s", save_dir, exc)
        fallback = True
        path, filename, subfolder = allocate_mp4_path(prefix, "", overwrite)

    try:
        write_frames_to_mp4(path, frames, fps=rate, audio=concat_audio(audio), crf=crf_int)
    except Exception as exc:
        log.warning("MP4 导出失败（不影响出片流程）：%s", exc)
        return None

    try:
        size_bytes = int(path.stat().st_size)
    except OSError:
        size_bytes = 0
    size_mb = size_bytes / (1024 * 1024)
    log.info(
        "MP4 已保存：%s（%d 帧 @ %.2f fps，%.1f MB，crf=%s）",
        path,
        frame_count,
        rate,
        size_mb,
        crf_int,
    )
    return {
        "filename": filename,
        "subfolder": subfolder,
        "type": "output",
        "path": str(path),
        "dir": str(path.parent),
        "size": size_bytes,
        "frames": frame_count,
        "fps": rate,
        "fallback": fallback,
        "width": int(frames.shape[2]),
        "height": int(frames.shape[1]),
        "nan_ratio": nan_ratio,
        "warning": (
            ""
            if nan_ratio >= 0.999
            else f"有 {(1.0 - nan_ratio) * 100:.1f}% 的像素是 NaN，画面会缺块或全黑（采样/解码发散）"
        ),
    }


__all__ = [
    "save_timeline_mp4",
    "concat_frames",
    "concat_audio",
    "allocate_mp4_path",
    "resolve_save_dir",
    "output_root",
    "DEFAULT_PREFIX",
    "DEFAULT_DIR",
]
