from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch.utils.data import DataLoader, TensorDataset

from suryakavach.config import load_config
from suryakavach.engines.forecast import FEATURE_NAMES
from suryakavach.evaluate import compute_config_hash, compute_dataset_hash, get_git_revision
from suryakavach.ingest.synthetic import build_all_days
from suryakavach.models.dataset import SurvivalBatch, create_survival_dataset
from suryakavach.models.survival import DeepDiscreteSurvival, DiscreteSurvivalLoss, hazard_to_cumulative_prob


def train_survival_model(
    days_data: dict[str, Any] | None = None,
    cfg: dict[str, Any] | None = None,
    epochs: int = 15,
    batch_size: int = 64,
    lr: float = 1e-3,
    output_dir: Path | None = None,
) -> dict[str, Any]:
    """Trains PyTorch Deep Discrete-Time Survival Model and exports model artifacts."""
    cfg = cfg or load_config()
    seed = int(cfg.get("data", {}).get("seed", 42))
    days_data = days_data or build_all_days(seed)

    config_hash = compute_config_hash(cfg)
    dataset_hash = compute_dataset_hash(days_data)
    code_rev = get_git_revision()

    # Create dataset splits
    train_batch = create_survival_dataset(days_data, split="train")
    val_batch = create_survival_dataset(days_data, split="val")
    cal_batch = create_survival_dataset(days_data, split="calibration")

    if len(train_batch.sequences) == 0:
        raise ValueError("Insufficient sequence data for training.")
    if len(val_batch.sequences) == 0:
        raise ValueError("Insufficient validation data for training.")

    seq_len = train_batch.sequences.shape[1]
    num_features = train_batch.sequences.shape[2]
    max_horizon = 40

    # Normalization statistics
    flat_seqs = train_batch.sequences.reshape(-1, num_features)
    mean_vec = np.nanmean(flat_seqs, axis=0)
    std_vec = np.nanstd(flat_seqs, axis=0)
    mean_vec = np.where(np.isfinite(mean_vec), mean_vec, 0.0)
    std_vec = np.where(np.isfinite(std_vec) & (std_vec > 0), std_vec, 1.0)

    def normalize(seqs: np.ndarray) -> np.ndarray:
        seqs = np.where(np.isfinite(seqs), seqs, mean_vec)
        return (seqs - mean_vec) / std_vec

    norm_train_seqs = normalize(train_batch.sequences)
    norm_val_seqs = normalize(val_batch.sequences)

    # PyTorch DataLoaders with reproducible seed
    torch.manual_seed(seed)
    gen = torch.Generator()
    gen.manual_seed(seed)

    train_ds = TensorDataset(
        torch.tensor(norm_train_seqs, dtype=torch.float32),
        torch.tensor(train_batch.c_event, dtype=torch.float32),
        torch.tensor(train_batch.c_time, dtype=torch.long),
        torch.tensor(train_batch.m_event, dtype=torch.float32),
        torch.tensor(train_batch.m_time, dtype=torch.long),
    )
    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, generator=gen, drop_last=True)

    val_ds = TensorDataset(
        torch.tensor(norm_val_seqs, dtype=torch.float32),
        torch.tensor(val_batch.c_event, dtype=torch.float32),
        torch.tensor(val_batch.c_time, dtype=torch.long),
        torch.tensor(val_batch.m_event, dtype=torch.float32),
        torch.tensor(val_batch.m_time, dtype=torch.long),
    )
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False)

    model = DeepDiscreteSurvival(
        num_features=num_features,
        hidden_dim=32,
        seq_len=seq_len,
        max_horizon=max_horizon,
    )

    criterion = DiscreteSurvivalLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)

    best_val_loss = float("inf")
    best_state = None

    for epoch in range(epochs):
        model.train()
        train_loss = 0.0
        for b_seqs, b_ce, b_ct, b_me, b_mt in train_loader:
            optimizer.zero_grad()
            h_c, h_m = model(b_seqs)
            loss_c = criterion(h_c, b_ce, b_ct)
            loss_m = criterion(h_m, b_me, b_mt)
            loss = loss_c + 1.5 * loss_m

            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            train_loss += loss.item() * len(b_seqs)

        train_loss /= max(len(train_ds), 1)

        # Validation
        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for b_seqs, b_ce, b_ct, b_me, b_mt in val_loader:
                h_c, h_m = model(b_seqs)
                loss_c = criterion(h_c, b_ce, b_ct)
                loss_m = criterion(h_m, b_me, b_mt)
                val_loss += (loss_c + 1.5 * loss_m).item() * len(b_seqs)

        val_loss /= max(len(val_ds), 1)

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_state = copy.deepcopy(model.state_dict())

    if best_state is not None:
        model.load_state_dict(best_state)

    # Save artifacts
    out_dir = output_dir or Path(cfg["data"]["cache_path"]) / "models"
    out_dir.mkdir(parents=True, exist_ok=True)

    ckpt_path = out_dir / "checkpoint.pt"
    torch.save(
        {
            "state_dict": model.state_dict(),
            "mean_vec": mean_vec.tolist(),
            "std_vec": std_vec.tolist(),
            "num_features": num_features,
            "hidden_dim": 32,
            "seq_len": seq_len,
            "max_horizon": max_horizon,
        },
        ckpt_path,
    )

    model_card = {
        "model_version": "deep_survival_v1",
        "created_at": str(np.datetime64("now")),
        "config_hash": config_hash,
        "dataset_hash": dataset_hash,
        "code_revision": code_rev,
        "feature_names": list(FEATURE_NAMES),
        "seq_len": seq_len,
        "max_horizon": max_horizon,
        "seed": seed,
        "lr": lr,
        "batch_size": batch_size,
        "metrics": {
            "best_val_loss": float(best_val_loss),
            "epochs_trained": epochs,
        },
        "checkpoint_file": "checkpoint.pt",
    }

    card_path = out_dir / "model_card.json"
    card_path.write_text(json.dumps(model_card, indent=2), encoding="utf-8")

    return model_card


if __name__ == "__main__":
    card = train_survival_model()
    print("Survival Model Training Complete:")
    print(json.dumps(card, indent=2))
