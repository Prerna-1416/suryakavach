from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class DeepDiscreteSurvival(nn.Module):
    """PyTorch Deep Discrete-Time Survival Model for Solar Flare Forecast.

    Inputs:
        x: Tensor of shape (batch_size, seq_len, num_features)

    Outputs:
        hazard_c: Tensor of shape (batch_size, max_horizon) - Discrete hazard rates for C1+ flares
        hazard_m: Tensor of shape (batch_size, max_horizon) - Discrete hazard rates for M1+ flares
    """

    def __init__(
        self,
        num_features: int = 10,
        hidden_dim: int = 32,
        seq_len: int = 60,
        max_horizon: int = 40,
    ) -> None:
        super().__init__()
        self.num_features = num_features
        self.hidden_dim = hidden_dim
        self.seq_len = seq_len
        self.max_horizon = max_horizon

        # 1D Temporal Convolution feature extractor
        self.conv1 = nn.Conv1d(in_channels=num_features, out_channels=hidden_dim, kernel_size=5, padding=2)
        self.bn1 = nn.BatchNorm1d(hidden_dim)
        self.conv2 = nn.Conv1d(in_channels=hidden_dim, out_channels=hidden_dim, kernel_size=5, padding=2)
        self.bn2 = nn.BatchNorm1d(hidden_dim)

        # GRU Sequence Aggregator
        self.gru = nn.GRU(input_size=hidden_dim, hidden_size=hidden_dim, batch_first=True)

        # Multi-task Hazard Heads
        self.fc_shared = nn.Linear(hidden_dim, hidden_dim)
        self.head_c = nn.Linear(hidden_dim, max_horizon)
        self.head_m = nn.Linear(hidden_dim, max_horizon)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        # x shape: (B, L, F) -> permute to (B, F, L) for Conv1d
        x_conv = x.permute(0, 2, 1)
        h = F.relu(self.bn1(self.conv1(x_conv)))
        h = F.relu(self.bn2(self.conv2(h)))
        # permute back to (B, L, H) for GRU
        h = h.permute(0, 2, 1)

        out, _ = self.gru(h)
        last_hidden = out[:, -1, :]  # Take final sequence state (B, H)

        feat = F.relu(self.fc_shared(last_hidden))

        # Output hazard rates bounded in (1e-4, 0.95)
        hazard_c = torch.sigmoid(self.head_c(feat)) * 0.95 + 1e-4
        hazard_m = torch.sigmoid(self.head_m(feat)) * 0.95 + 1e-4

        return hazard_c, hazard_m


class DiscreteSurvivalLoss(nn.Module):
    """Censoring-aware discrete-time negative log-likelihood loss function.

    hazard: Tensor of shape (B, H) - discrete hazard rates lambda_t for t in 1..H
    events: Tensor of shape (B,) - 1.0 if event occurred, 0.0 if right-censored
    times: Tensor of shape (B,) - 1-indexed minute of event or censoring (1..H)
    """

    def __init__(self, eps: float = 1e-7) -> None:
        super().__init__()
        self.eps = eps

    def forward(self, hazard: torch.Tensor, events: torch.Tensor, times: torch.Tensor) -> torch.Tensor:
        batch_size, max_horizon = hazard.shape
        device = hazard.device

        # Create horizon time grid (1..H)
        grid = torch.arange(1, max_horizon + 1, device=device).unsqueeze(0)  # (1, H)
        t_mask = times.unsqueeze(1)  # (B, 1)

        # Before event/censoring time: log(1 - hazard_k) for k < t
        before_mask = (grid < t_mask).float()
        surv_log_prob = torch.sum(before_mask * torch.log(1.0 - hazard + self.eps), dim=1)

        # At event time t:
        # If event occurred (y=1): + log(hazard_t)
        # If censored (y=0): + log(1 - hazard_t)
        at_mask = (grid == t_mask).float()
        hazard_at = torch.sum(at_mask * hazard, dim=1)

        event_log_prob = events * torch.log(hazard_at + self.eps) + (1.0 - events) * torch.log(1.0 - hazard_at + self.eps)

        total_nll = -(surv_log_prob + event_log_prob)
        return torch.mean(total_nll)


def hazard_to_cumulative_prob(hazard: torch.Tensor, horizons: list[int]) -> dict[int, torch.Tensor]:
    """Converts discrete hazard rates lambda_t into cumulative probabilities P(T <= h).

    P(T <= h) = 1 - prod_{k=1}^h (1 - lambda_k)
    """
    # survival probability up to step k
    survival_k = torch.cumprod(1.0 - hazard, dim=1)
    cum_prob = 1.0 - survival_k

    out = {}
    max_h = hazard.shape[1]
    for h in horizons:
        idx = min(max(h - 1, 0), max_h - 1)
        out[h] = cum_prob[:, idx]
    return out
