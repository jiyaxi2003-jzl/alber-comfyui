"""H3 Director Console — a full MiniMax H3 timeline director plugin.

Derived from AIMixer's ComfyUI_MiniMaxH3_Director (Apache-2.0):
https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director

The main ``H3DirectorConsole`` node keeps the complete upstream timeline UI and
execution path, and adds built-in MiniMax H3 base / LoRA / CLIP / VAE loaders so
it can be used as a single node.  External model/clip/VAE connections still take
priority when present.
"""

from .nodes.conditioning import (
    MiniMaxH3DirectorConditioning,
    MiniMaxH3DirectorPlannerConditioning,
)
from .nodes.director_console import H3DirectorConsole
from .nodes.director_refine import MiniMaxH3DirectorRefine
from .nodes.director_selflift import MiniMaxH3DirectorSelfLift
from .nodes.director_semantic_bridge import MiniMaxH3DirectorSemanticBridge
from .nodes.director_face_refine import MiniMaxH3DirectorFaceRefine
from .nodes.director_groups import (
    MiniMaxH3DirectorGroupImageToVideo,
    MiniMaxH3DirectorGroupReferenceToVideo,
    MiniMaxH3DirectorGroupsCombine,
)

NODE_CLASS_MAPPINGS = {
    # Main console
    "AlberH3DirectorConsole": H3DirectorConsole,
    # Optional companion nodes (same upstream implementations, new type ids).
    "AlberH3ConsoleRefine": MiniMaxH3DirectorRefine,
    "AlberH3ConsoleSelfLift": MiniMaxH3DirectorSelfLift,
    "AlberH3ConsoleSemanticBridge": MiniMaxH3DirectorSemanticBridge,
    "AlberH3ConsoleFaceRefine": MiniMaxH3DirectorFaceRefine,
    "AlberH3ConsoleConditioning": MiniMaxH3DirectorConditioning,
    "AlberH3ConsolePlannerConditioning": MiniMaxH3DirectorPlannerConditioning,
    "AlberH3ConsoleGroupImageToVideo": MiniMaxH3DirectorGroupImageToVideo,
    "AlberH3ConsoleGroupReferenceToVideo": MiniMaxH3DirectorGroupReferenceToVideo,
    # Must stay in NODE_CLASS_MAPPINGS: ComfyUI skips comfy_entrypoint when
    # NODE_CLASS_MAPPINGS is present (if/elif in load_custom_node).
    "AlberH3ConsoleGroupsCombine": MiniMaxH3DirectorGroupsCombine,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AlberH3DirectorConsole": "Alber 导演台 (Director Console)",
    "AlberH3ConsoleRefine": "Alber 导演台 · Refine",
    "AlberH3ConsoleSelfLift": "Alber 导演台 · SelfLift",
    "AlberH3ConsoleSemanticBridge": "Alber 导演台 · Semantic Bridge",
    "AlberH3ConsoleFaceRefine": "Alber 导演台 · FaceRefine",
    "AlberH3ConsoleConditioning": "Alber 导演台 · Conditioning",
    "AlberH3ConsolePlannerConditioning": "Alber 导演台 · Planner Conditioning",
    "AlberH3ConsoleGroupImageToVideo": "Alber 导演台 · 分组（图生视频）",
    "AlberH3ConsoleGroupReferenceToVideo": "Alber 导演台 · 分组（参考生视频）",
    "AlberH3ConsoleGroupsCombine": "Alber 导演台 · 合并分组",
}

WEB_DIRECTORY = "./web/js"

import logging

_log = logging.getLogger("Alber-H3-Director-Console")

try:
    from .director.http_routes import register_routes as _register_director_routes

    if not _register_director_routes():
        _log.warning(
            "H3 Director Console HTTP routes deferred (PromptServer not ready). "
            "Restart ComfyUI if /alber/director/* returns 404."
        )
except Exception as _director_routes_exc:
    _log.warning("H3 Director Console HTTP routes failed to load: %s", _director_routes_exc)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
