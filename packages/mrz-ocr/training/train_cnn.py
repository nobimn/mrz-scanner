#!/usr/bin/env python3
"""
Train a small CNN for MRZ character recognition and export to ONNX.

The model classifies 20x20 greyscale character images into one of 37 MRZ
symbols (0-9, A-Z, <).

Architecture:
  Conv2D(1, 32, 3x3) -> ReLU -> MaxPool(2x2)
  Conv2D(32, 64, 3x3) -> ReLU -> MaxPool(2x2)
  Flatten -> Dense(128) -> ReLU -> Dropout(0.3) -> Dense(37)

~75K parameters, ~300KB ONNX model.

Usage:
  python train_cnn.py --data-dir ./training_data --output ./models/mrz-cnn.onnx
  python train_cnn.py --generate --output ./models/mrz-cnn.onnx
"""

import argparse
import os
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset

# MRZ character set: 0-9, A-Z, <
MRZ_SYMBOLS = list("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<")
SYMBOL_TO_IDX = {s: i for i, s in enumerate(MRZ_SYMBOLS)}
NUM_CLASSES = len(MRZ_SYMBOLS)
INPUT_SIZE = 20


class MrzCNN(nn.Module):
    """Small CNN for MRZ character classification."""

    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2, 2),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2, 2),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(64 * 5 * 5, 128),
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(128, NUM_CLASSES),
        )

    def forward(self, x):
        x = self.features(x)
        x = self.classifier(x)
        return x


def generate_synthetic_data(num_per_class=200, noise_levels=(0.0, 0.1, 0.2)):
    """
    Generate synthetic training data using simple bitmap rendering.
    Each character is rendered as a binary pattern with noise augmentation.

    For production training, use real character crops from document scans
    (via the legacy run/writeCharacters.js script from mrz-detection).
    """
    from PIL import Image, ImageDraw, ImageFont

    images = []
    labels = []

    # Try to find a monospace font
    font = None
    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
        "/System/Library/Fonts/Menlo.ttc",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            font = ImageFont.truetype(fp, 16)
            break
    if font is None:
        font = ImageFont.load_default()

    for sym_idx, symbol in enumerate(MRZ_SYMBOLS):
        for _ in range(num_per_class):
            for noise in noise_levels:
                img = Image.new("L", (INPUT_SIZE, INPUT_SIZE), 255)
                draw = ImageDraw.Draw(img)
                bbox = draw.textbbox((0, 0), symbol, font=font)
                tw = bbox[2] - bbox[0]
                th = bbox[3] - bbox[1]
                x = (INPUT_SIZE - tw) // 2 - bbox[0]
                y = (INPUT_SIZE - th) // 2 - bbox[1]
                draw.text((x, y), symbol, fill=0, font=font)

                arr = np.array(img, dtype=np.float32) / 255.0
                if noise > 0:
                    arr += np.random.normal(0, noise, arr.shape).astype(np.float32)
                    arr = np.clip(arr, 0, 1)

                images.append(arr)
                labels.append(sym_idx)

    return np.array(images), np.array(labels)


def load_data_from_dir(data_dir):
    """Load character images from a directory structure: data_dir/<char>/*.png"""
    images = []
    labels = []

    for char_dir in sorted(Path(data_dir).iterdir()):
        if not char_dir.is_dir():
            continue
        char = char_dir.name
        if char == "lt":
            char = "<"
        if char not in SYMBOL_TO_IDX:
            continue
        label = SYMBOL_TO_IDX[char]

        for img_path in char_dir.glob("*.png"):
            from PIL import Image
            img = Image.open(img_path).convert("L").resize((INPUT_SIZE, INPUT_SIZE))
            arr = np.array(img, dtype=np.float32) / 255.0
            images.append(arr)
            labels.append(label)

    return np.array(images), np.array(labels)


def train(args):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    # Load or generate data
    if args.data_dir:
        print(f"Loading data from {args.data_dir}")
        X, y = load_data_from_dir(args.data_dir)
    else:
        print("Generating synthetic training data...")
        X, y = generate_synthetic_data(
            num_per_class=args.num_per_class,
            noise_levels=(0.0, 0.05, 0.1, 0.15, 0.2),
        )

    print(f"Dataset: {len(X)} samples, {NUM_CLASSES} classes")

    # Shuffle and split
    indices = np.random.permutation(len(X))
    X, y = X[indices], y[indices]
    split = int(0.9 * len(X))
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]

    # Create tensors (NCHW format)
    X_train_t = torch.from_numpy(X_train[:, np.newaxis]).to(device)
    y_train_t = torch.from_numpy(y_train).long().to(device)
    X_test_t = torch.from_numpy(X_test[:, np.newaxis]).to(device)
    y_test_t = torch.from_numpy(y_test).long().to(device)

    train_ds = TensorDataset(X_train_t, y_train_t)
    train_loader = DataLoader(train_ds, batch_size=64, shuffle=True)

    model = MrzCNN().to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=1e-3)
    scheduler = optim.lr_scheduler.StepLR(optimizer, step_size=10, gamma=0.5)

    # Train
    for epoch in range(args.epochs):
        model.train()
        total_loss = 0
        for X_batch, y_batch in train_loader:
            optimizer.zero_grad()
            output = model(X_batch)
            loss = criterion(output, y_batch)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
        scheduler.step()

        if (epoch + 1) % 5 == 0 or epoch == 0:
            model.eval()
            with torch.no_grad():
                test_out = model(X_test_t)
                preds = test_out.argmax(dim=1)
                acc = (preds == y_test_t).float().mean().item()
            print(
                f"Epoch {epoch+1}/{args.epochs}  "
                f"loss={total_loss/len(train_loader):.4f}  "
                f"test_acc={acc:.4f}"
            )

    # Final accuracy
    model.eval()
    with torch.no_grad():
        test_out = model(X_test_t)
        preds = test_out.argmax(dim=1)
        acc = (preds == y_test_t).float().mean().item()
    print(f"\nFinal test accuracy: {acc:.4f}")

    # Export to ONNX
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    dummy_input = torch.randn(1, 1, INPUT_SIZE, INPUT_SIZE, device=device)
    torch.onnx.export(
        model.cpu(),
        dummy_input.cpu(),
        str(output_path),
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={
            "input": {0: "batch_size"},
            "output": {0: "batch_size"},
        },
        opset_version=17,
    )

    file_size = output_path.stat().st_size / 1024
    print(f"\nModel exported to {output_path} ({file_size:.0f} KB)")

    # Save symbol mapping for reference
    meta_path = output_path.with_suffix(".json")
    with open(meta_path, "w") as f:
        json.dump(
            {
                "symbols": MRZ_SYMBOLS,
                "input_size": INPUT_SIZE,
                "num_classes": NUM_CLASSES,
                "accuracy": acc,
            },
            f,
            indent=2,
        )
    print(f"Metadata saved to {meta_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train MRZ character CNN")
    parser.add_argument("--data-dir", help="Directory with character images")
    parser.add_argument(
        "--output",
        default="models/mrz-cnn.onnx",
        help="Output ONNX model path",
    )
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument(
        "--num-per-class",
        type=int,
        default=200,
        help="Samples per class for synthetic data",
    )
    parser.add_argument(
        "--generate",
        action="store_true",
        help="Generate synthetic training data",
    )
    args = parser.parse_args()
    train(args)
