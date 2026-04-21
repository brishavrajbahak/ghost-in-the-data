from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np


@dataclass
class AutoencoderResult:
    scores: np.ndarray  # shape (n_samples,)
    per_feature_error: np.ndarray  # shape (n_samples, n_features)


def _require_torch():
    try:
        import torch  # type: ignore

        return torch
    except Exception as e:
        raise ImportError("PyTorch is not installed") from e


def _build_model(torch, n_features: int):
    hidden = int(max(16, min(128, n_features * 4)))
    bottleneck = int(max(2, min(24, n_features // 2)))

    return torch.nn.Sequential(
        torch.nn.Linear(n_features, hidden),
        torch.nn.ReLU(),
        torch.nn.Linear(hidden, bottleneck),
        torch.nn.ReLU(),
        torch.nn.Linear(bottleneck, hidden),
        torch.nn.ReLU(),
        torch.nn.Linear(hidden, n_features),
    )


def compute_reconstruction_error(
    X: np.ndarray,
    *,
    epochs: int = 30,
    batch_size: int = 256,
    lr: float = 1e-3,
    weight_decay: float = 1e-5,
    seed: int = 42,
) -> AutoencoderResult:
    """
    Train a small PyTorch autoencoder on X (standardized outside) and return per-row reconstruction scores.
    CPU-only by default.
    """
    torch = _require_torch()

    if X.ndim != 2:
        raise ValueError("X must be 2D")
    n_samples, n_features = X.shape
    if n_samples < 10 or n_features < 2:
        raise ValueError("Not enough data for autoencoder")

    device = torch.device("cpu")
    torch.manual_seed(seed)

    X_tensor = torch.tensor(X, dtype=torch.float32, device=device)

    # Train/val split
    rng = np.random.RandomState(seed)
    idx = np.arange(n_samples)
    rng.shuffle(idx)
    split = int(max(5, n_samples * 0.85))
    train_idx = idx[:split]
    val_idx = idx[split:] if split < n_samples else idx[: max(1, n_samples // 10)]

    model = _build_model(torch, n_features).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=weight_decay)
    loss_fn = torch.nn.MSELoss()

    best_val = float("inf")
    patience = 6
    patience_left = patience

    def batches(indices: np.ndarray):
        for start in range(0, len(indices), batch_size):
            yield indices[start : start + batch_size]

    for _ in range(int(max(1, epochs))):
        model.train()
        for b in batches(train_idx):
            xb = X_tensor[b]
            opt.zero_grad(set_to_none=True)
            out = model(xb)
            loss = loss_fn(out, xb)
            loss.backward()
            opt.step()

        model.eval()
        with torch.no_grad():
            out = model(X_tensor[val_idx])
            val_loss = float(loss_fn(out, X_tensor[val_idx]).item())

        if val_loss + 1e-6 < best_val:
            best_val = val_loss
            patience_left = patience
        else:
            patience_left -= 1
            if patience_left <= 0:
                break

    model.eval()
    with torch.no_grad():
        recon = model(X_tensor).cpu().numpy()

    per_feature = (X - recon) ** 2
    scores = per_feature.mean(axis=1)
    return AutoencoderResult(scores=scores, per_feature_error=per_feature)

