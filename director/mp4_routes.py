"""导演台 MP4 配套的 HTTP 路由：打开输出目录、成片预览、文件信息。

三条路由都只服务本机的 ComfyUI 前端，路径参数一律解析后校验：
  * ``/alber/director/open_folder``  在系统文件管理器里打开目录（传文件则打开其父目录）
  * ``/alber/director/mp4_preview``  按绝对路径回放 mp4，走 FileResponse（支持 Range 拖动）
  * ``/alber/director/mp4_info``     返回文件是否存在 / 大小 / 修改时间
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path

import folder_paths
from aiohttp import web

log = logging.getLogger("Alber-H3-Director-Console.mp4.routes")

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}


def _output_root() -> Path:
    try:
        return Path(folder_paths.get_output_directory())
    except Exception:  # pragma: no cover
        return Path.cwd() / "output"


def _resolve(raw: str | None) -> Path:
    """把用户填的路径解析成绝对路径（空 = output 目录，相对 = output 下）。"""
    base = _output_root()
    text = str(raw or "").strip().strip('"').strip("'")
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


def _open_in_explorer(folder: Path) -> None:
    if sys.platform.startswith("win"):
        os.startfile(str(folder))  # noqa: S606 - 本机桌面环境，用户主动点击
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(folder)])
    else:
        subprocess.Popen(["xdg-open", str(folder)])


async def alber_mp4_open_folder(request):
    raw = request.query.get("path") or request.query.get("dir") or ""
    target = _resolve(raw)
    # 传进来的是文件：打开它所在的目录
    if target.is_file() or target.suffix.lower() in VIDEO_EXTS:
        target = target.parent
    if not target.exists():
        return web.json_response(
            {"ok": False, "error": f"目录不存在：{target}", "path": str(target)},
            status=404,
        )
    if not target.is_dir():
        return web.json_response(
            {"ok": False, "error": f"不是目录：{target}", "path": str(target)},
            status=400,
        )
    try:
        _open_in_explorer(target)
    except Exception as exc:
        log.warning("打开目录失败 %s：%s", target, exc)
        return web.json_response({"ok": False, "error": str(exc), "path": str(target)}, status=500)
    return web.json_response({"ok": True, "path": str(target)})


async def alber_mp4_preview(request):
    raw = request.query.get("path") or ""
    if not raw.strip():
        return web.Response(status=400, text="Missing path.")
    target = _resolve(raw)
    if not target.exists():
        return web.Response(status=404, text="MP4 not found.")
    if not target.is_file():
        return web.Response(status=400, text="Not a file.")
    if target.suffix.lower() not in VIDEO_EXTS:
        return web.Response(status=400, text="Not a video file.")

    response = web.FileResponse(target)
    # 每次出片都可能覆盖同名文件，所以每次都要回源校验；
    # 但不能用 no-store —— 那会让浏览器连 Range 分片都不缓存，
    # 播放器每次 seek 都重新拉整段，大文件上表现为「点了播放半天没反应」、
    # 拖进度条一卡一卡的。no-cache + ETag 既保证拿到新文件，又允许复用分片。
    # 前端另外会带 ?v=<时间戳> 主动破缓存，双保险。
    response.headers["Cache-Control"] = "private, no-cache, max-age=0"
    response.headers["Content-Disposition"] = "inline"
    return response


async def alber_mp4_info(request):
    raw = request.query.get("path") or ""
    target = _resolve(raw)
    if not target.is_file():
        return web.json_response({"ok": False, "exists": False, "path": str(target)})
    try:
        stat = target.stat()
    except OSError as exc:
        return web.json_response(
            {"ok": False, "exists": False, "path": str(target), "error": str(exc)}
        )
    return web.json_response(
        {
            "ok": True,
            "exists": True,
            "path": str(target),
            "dir": str(target.parent),
            "filename": target.name,
            "size": int(stat.st_size),
            "mtime": int(stat.st_mtime),
        }
    )


def register_mp4_routes(routes, register_route) -> None:
    """由 ``director.http_routes.register_routes`` 调用。"""
    register_route(routes, "GET", "/alber/director/open_folder", alber_mp4_open_folder)
    register_route(routes, "GET", "/alber/director/mp4_preview", alber_mp4_preview)
    register_route(routes, "GET", "/alber/director/mp4_info", alber_mp4_info)


__all__ = [
    "alber_mp4_open_folder",
    "alber_mp4_preview",
    "alber_mp4_info",
    "register_mp4_routes",
]
