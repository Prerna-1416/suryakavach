from __future__ import annotations

from pathlib import Path
from typing import Any

from suryakavach.config import load_config
from suryakavach.engines.forecast import DiscreteHazard
from suryakavach.models.infer import PyTorchSurvivalPredictor


class ModelRegistry:
    """Registry managing model selection, schema checking, and fallback resolution."""

    @staticmethod
    def get_provider(cfg: dict[str, Any] | None = None) -> Any:
        cfg = cfg or load_config()
        model_cfg = cfg.get("model", {})
        provider_type = model_cfg.get("provider", "auto")

        if provider_type == "baseline":
            return DiscreteHazard()

        # Try loading PyTorch survival predictor
        cache_p = Path(cfg.get("data", {}).get("cache_path", "./data"))
        model_dir = cache_p / "models"

        predictor = PyTorchSurvivalPredictor()
        if model_dir.exists() and predictor.load(model_dir):
            return predictor

        return DiscreteHazard()
