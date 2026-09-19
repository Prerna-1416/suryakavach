from __future__ import annotations

from pathlib import Path
from typing import Any

from suryakavach.config import load_config
from suryakavach.engines.forecast import DiscreteHazard
from suryakavach.models.infer import PyTorchSurvivalPredictor


class ModelRegistry:
    """Registry managing model selection, schema checking, and fallback resolution."""

    _cached_predictor: PyTorchSurvivalPredictor | None = None
    _cached_model_dir: Path | None = None

    @classmethod
    def get_provider(cls, cfg: dict[str, Any] | None = None) -> Any:
        cfg = cfg or load_config()
        model_cfg = cfg.get("model", {})
        provider_type = model_cfg.get("provider", "auto")

        if provider_type == "baseline":
            return DiscreteHazard()

        # Try loading PyTorch survival predictor
        cache_p = Path(cfg.get("data", {}).get("cache_path", "./data"))
        model_dir = cache_p / "models"

        if cls._cached_predictor is not None and cls._cached_model_dir == model_dir:
            return cls._cached_predictor

        predictor = PyTorchSurvivalPredictor()
        if model_dir.exists() and predictor.load(model_dir):
            cls._cached_predictor = predictor
            cls._cached_model_dir = model_dir
            return predictor

        return DiscreteHazard()
