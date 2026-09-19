from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import pytest

import subprocess
import sys


def _can_import_torch() -> bool:
    try:
        res = subprocess.run(
            [sys.executable, "-c", "import torch"],
            capture_output=True,
            timeout=5,
        )
        return res.returncode == 0
    except Exception:
        return False


try:
    import torch
except (ImportError, OSError):
    pytest.skip("PyTorch DLL dependencies are not loadable on this host", allow_module_level=True)




from suryakavach.config import load_config
from suryakavach.engines.forecast import DiscreteHazard, FEATURE_NAMES, get_model_provider
from suryakavach.ingest.synthetic import build_all_days
from suryakavach.models import (
    DeepDiscreteSurvival,
    DiscreteSurvivalLoss,
    ModelRegistry,
    PyTorchSurvivalPredictor,
    create_survival_dataset,
    train_survival_model,
)


def test_survival_dataset_windowing():
    days = build_all_days(seed=42)
    batch = create_survival_dataset(days, split="train", seq_len=60, max_horizon=40)

    assert batch.sequences.ndim == 3
    assert batch.sequences.shape[1] == 60  # seq_len
    assert batch.sequences.shape[2] == len(FEATURE_NAMES)
    assert len(batch.c_event) == len(batch.sequences)
    assert len(batch.c_time) == len(batch.sequences)
    assert np.all((batch.c_event == 0.0) | (batch.c_event == 1.0))
    assert np.all((batch.c_time >= 1) & (batch.c_time <= 40))


def test_deep_survival_model_forward():
    model = DeepDiscreteSurvival(num_features=10, hidden_dim=32, seq_len=60, max_horizon=40)
    x = torch.randn(8, 60, 10)  # Batch of 8 sequences
    h_c, h_m = model(x)

    assert h_c.shape == (8, 40)
    assert h_m.shape == (8, 40)
    assert torch.all(h_c >= 1e-4) and torch.all(h_c <= 1.0)
    assert torch.all(h_m >= 1e-4) and torch.all(h_m <= 1.0)


def test_survival_loss_computation():
    loss_fn = DiscreteSurvivalLoss()
    h_c = torch.full((4, 40), 0.05, requires_grad=True)
    events = torch.tensor([1.0, 0.0, 1.0, 0.0])
    times = torch.tensor([10, 40, 5, 40], dtype=torch.long)

    loss = loss_fn(h_c, events, times)
    assert loss.item() > 0.0
    loss.backward()
    assert h_c.grad is not None


def test_model_training_and_export():
    with TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        cfg = load_config()
        cfg["data"]["cache_path"] = str(tmp_path)

        days = build_all_days(seed=42)
        card = train_survival_model(days_data=days, cfg=cfg, epochs=2, batch_size=32, output_dir=tmp_path / "models")

        assert card["model_version"] == "deep_survival_v1"
        assert (tmp_path / "models" / "checkpoint.pt").exists()
        assert (tmp_path / "models" / "model_card.json").exists()

        # Test predictor loading
        predictor = PyTorchSurvivalPredictor(tmp_path / "models")
        assert predictor.is_loaded is True

        feat = {n: 1.0 for n in FEATURE_NAMES}
        pred_res = predictor.predict(feat, horizons=[5, 10, 20, 40])
        assert "horizons" in pred_res
        assert len(pred_res["horizons"]) == 4
        assert pred_res["model_provider"] == "deep_discrete_survival"


def test_model_training_handles_nan_observations_in_normalization_stats():
    with TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        cfg = load_config()
        cfg["data"]["cache_path"] = str(tmp_path)

        days = build_all_days(seed=42)
        first_key = sorted(days.keys())[0]
        days[first_key]["solexs"][10:25] = np.nan
        days[first_key]["hel1os"][10:25] = np.nan

        train_survival_model(days_data=days, cfg=cfg, epochs=2, batch_size=32, output_dir=tmp_path / "models")
        predictor = PyTorchSurvivalPredictor(tmp_path / "models")
        assert predictor.is_loaded is True
        assert np.all(np.isfinite(predictor.mean_vec))
        assert np.all(np.isfinite(predictor.std_vec))
        assert np.all(predictor.std_vec > 0)


def test_predictor_fallback_on_missing_or_corrupt_checkpoint():
    with TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        predictor = PyTorchSurvivalPredictor()

        # Missing checkpoint
        assert predictor.load(tmp_path) is False

        # Dummy feature prediction uses fallback DiscreteHazard
        feat = {n: 1.0 for n in FEATURE_NAMES}
        res = predictor.predict(feat, horizons=[5, 10, 20, 40])
        assert res["model_provider"] == "discrete_hazard_baseline"


def test_predictor_fallback_on_schema_mismatch():
    with TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        card = {"feature_names": ["invalid_feat_1", "invalid_feat_2"]}
        (tmp_path / "model_card.json").write_text(json.dumps(card), encoding="utf-8")
        (tmp_path / "checkpoint.pt").write_bytes(b"dummy")

        predictor = PyTorchSurvivalPredictor()
        assert predictor.load(tmp_path) is False


def test_model_registry_resolution():
    cfg = load_config()
    provider = ModelRegistry.get_provider(cfg)
    assert hasattr(provider, "predict")

    # Force baseline explicitly
    cfg_base = dict(cfg)
    cfg_base["model"] = {"provider": "baseline"}
    base_provider = ModelRegistry.get_provider(cfg_base)
    assert isinstance(base_provider, DiscreteHazard)
