from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import numpy as np

try:
    import torch
    from suryakavach.models.survival import DeepDiscreteSurvival, hazard_to_cumulative_prob
    TORCH_AVAILABLE = True
except Exception as err:
    torch = None
    DeepDiscreteSurvival = None
    hazard_to_cumulative_prob = None
    TORCH_AVAILABLE = False

from suryakavach.engines.forecast import FEATURE_NAMES, DiscreteHazard, vectorize

logger = logging.getLogger(__name__)


class PyTorchSurvivalPredictor:
    """Predictor implementing PyTorch Deep Discrete Survival inference with clean baseline fallback."""

    def __init__(self, model_dir: Path | None = None) -> None:
        self.fallback = DiscreteHazard()
        self.is_loaded = False
        self.model: DeepDiscreteSurvival | None = None
        self.mean_vec: np.ndarray | None = None
        self.std_vec: np.ndarray | None = None
        self.seq_len = 60
        self.max_horizon = 40
        self.history_window: list[np.ndarray] = []

        if model_dir is not None:
            self.load(model_dir)

    def load(self, model_dir: Path) -> bool:
        """Loads model checkpoint and model-card from directory."""
        if not TORCH_AVAILABLE:
            logger.info("PyTorch is not available; using baseline fallback.")
            self.is_loaded = False
            return False

        ckpt_path = model_dir / "checkpoint.pt"
        card_path = model_dir / "model_card.json"

        if not ckpt_path.exists() or not card_path.exists():
            logger.info("Model checkpoint or model-card missing; using baseline fallback.")
            self.is_loaded = False
            return False

        try:
            card = json.loads(card_path.read_text(encoding="utf-8"))
            feat_names = card.get("feature_names", [])
            if list(feat_names) != list(FEATURE_NAMES):
                logger.warning("Feature schema mismatch in model card; falling back to baseline.")
                self.is_loaded = False
                return False

            ckpt = torch.load(ckpt_path, map_location="cpu")
            self.seq_len = ckpt.get("seq_len", 60)
            self.max_horizon = ckpt.get("max_horizon", 40)
            num_features = ckpt.get("num_features", len(FEATURE_NAMES))

            mean_vec = np.array(ckpt.get("mean_vec", []), dtype=np.float32)
            std_vec = np.array(ckpt.get("std_vec", []), dtype=np.float32)

            expected_len = len(FEATURE_NAMES)
            if (
                num_features != expected_len
                or len(mean_vec) != expected_len
                or len(std_vec) != expected_len
                or not np.all(np.isfinite(mean_vec))
                or not np.all(np.isfinite(std_vec))
                or not np.all(std_vec > 0)
            ):
                logger.warning("Invalid model checkpoint dimensions or normalization values; falling back to baseline.")
                self.is_loaded = False
                return False

            model = DeepDiscreteSurvival(
                num_features=num_features,
                hidden_dim=ckpt.get("hidden_dim", 32),
                seq_len=self.seq_len,
                max_horizon=self.max_horizon,
            )
            model.load_state_dict(ckpt["state_dict"])
            model.eval()

            self.model = model
            self.mean_vec = mean_vec
            self.std_vec = std_vec
            self.is_loaded = True
            return True

        except Exception as err:
            logger.warning("Error loading PyTorch survival model checkpoint: %s; falling back to baseline.", err)
            self.is_loaded = False
            return False

    def update_history(self, vec: np.ndarray) -> None:
        """Appends new minute feature vector to internal rolling window buffer."""
        self.history_window.append(vec)
        if len(self.history_window) > self.seq_len:
            self.history_window.pop(0)

    def predict(self, feat: dict[str, float], horizons: list[int]) -> dict[str, Any]:
        """Predicts hazard probabilities for requested horizons. Falls back if model unready."""
        # Always update baseline and fallback if not loaded
        if not self.is_loaded or self.model is None or self.mean_vec is None or self.std_vec is None:
            return self.fallback.predict(feat, horizons)

        vec = vectorize(feat)
        self.update_history(vec)

        # Build input tensor window of shape (1, seq_len, num_features)
        if len(self.history_window) < self.seq_len:
            pad_count = self.seq_len - len(self.history_window)
            padded = [self.history_window[0] if self.history_window else vec] * pad_count + self.history_window
            seq_arr = np.array(padded, dtype=np.float32)
        else:
            seq_arr = np.array(self.history_window[-self.seq_len :], dtype=np.float32)

        # Normalize
        norm_seq = (seq_arr - self.mean_vec) / self.std_vec
        x_tensor = torch.tensor(norm_seq, dtype=torch.float32).unsqueeze(0)  # (1, seq_len, F)

        try:
            with torch.no_grad():
                h_c, h_m = self.model(x_tensor)
                cum_c = hazard_to_cumulative_prob(h_c, horizons)
                cum_m = hazard_to_cumulative_prob(h_m, horizons)

            out_horizons = []
            for h in horizons:
                p_c = float(cum_c[h][0].item())
                p_m = float(cum_m[h][0].item())
                out_horizons.append({
                    "horizon_min": h,
                    "p_c1": round(min(max(p_c, 1e-4), 0.99), 3),
                    "p_m1": round(min(max(p_m, 1e-4), 0.99), 3),
                })

            p1_c = float(h_c[0, 0].item())
            p1_m = float(h_m[0, 0].item())

            return {
                "horizons": out_horizons,
                "p1_c": p1_c,
                "p1_m": p1_m,
                "model_provider": "deep_discrete_survival",
            }

        except Exception as err:
            logger.warning("Error during PyTorch model inference: %s; using baseline fallback.", err)
            return self.fallback.predict(feat, horizons)
