#!/usr/bin/env python3
"""
Extract OCR-B character images from the legacy ocrb.json fingerprint data
and generate augmented training data for the CNN.

Each fingerprint is a 12x12 binary image packed as 18 bytes (144 bits).
We unpack them, scale to 20x20, and apply augmentations.
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

MRZ_SYMBOLS = list("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<")


def unpack_fingerprint(data: list[int], width: int = 12, height: int = 12) -> np.ndarray:
    """Unpack a byte array into a binary bitmap."""
    bits = []
    for byte_val in data:
        for bit in range(7, -1, -1):
            bits.append(1 if (byte_val >> bit) & 1 else 0)
    pixels = np.array(bits[: width * height], dtype=np.float32).reshape(height, width)
    # Invert: in fingerprints 1=ink(dark), we want 0=ink, 255=background for image
    return (1.0 - pixels) * 255.0


def augment(img_array: np.ndarray, num_augments: int = 20) -> list[np.ndarray]:
    """Generate augmented versions of a character image."""
    results = [img_array]
    h, w = img_array.shape

    for _ in range(num_augments):
        img = Image.fromarray(img_array.astype(np.uint8), mode="L")

        # Random small rotation (-3 to +3 degrees)
        angle = np.random.uniform(-3, 3)
        img = img.rotate(angle, fillcolor=255, resample=Image.BILINEAR)

        # Random slight translation (-1 to +1 pixel)
        dx = np.random.randint(-1, 2)
        dy = np.random.randint(-1, 2)
        img = img.transform(img.size, Image.AFFINE, (1, 0, dx, 0, 1, dy), fillcolor=255)

        # Random blur (0 to 0.5 radius)
        if np.random.random() < 0.5:
            img = img.filter(ImageFilter.GaussianBlur(radius=np.random.uniform(0.1, 0.8)))

        # Add noise
        arr = np.array(img, dtype=np.float32)
        noise = np.random.normal(0, np.random.uniform(2, 15), arr.shape)
        arr = np.clip(arr + noise, 0, 255)

        # Random contrast/brightness adjustment
        contrast = np.random.uniform(0.8, 1.2)
        brightness = np.random.uniform(-15, 15)
        arr = np.clip(arr * contrast + brightness, 0, 255)

        results.append(arr.astype(np.float32))

    return results


def main():
    ocrb_path = Path(__file__).parent / "../../../alsenet-mrz-detection/fontData/12x12/mrz/ocrb.json"
    if not ocrb_path.exists():
        # Try alternate path
        ocrb_path = Path("/home/llm/alsenet-mrz-detection/fontData/12x12/mrz/ocrb.json")

    if not ocrb_path.exists():
        print(f"ERROR: Cannot find ocrb.json at {ocrb_path}", file=sys.stderr)
        sys.exit(1)

    with open(ocrb_path) as f:
        data = json.load(f)

    output_dir = Path(__file__).parent / "ocrb_chars"
    output_dir.mkdir(exist_ok=True)

    target_size = 20
    total = 0

    for entry in data["fingerprint"]:
        symbol = entry["symbol"]
        if symbol not in MRZ_SYMBOLS:
            continue

        # Safe directory name
        dir_name = symbol if symbol != "<" else "lt"
        char_dir = output_dir / dir_name
        char_dir.mkdir(exist_ok=True)

        idx = 0
        for fingerprint in entry["fingerprints"]:
            # Unpack 12x12 bitmap
            bitmap = unpack_fingerprint(fingerprint)

            # Scale to 20x20
            img = Image.fromarray(bitmap.astype(np.uint8), mode="L")
            img = img.resize((target_size, target_size), Image.BILINEAR)
            base = np.array(img, dtype=np.float32)

            # Generate augmented versions
            augmented = augment(base, num_augments=15)

            for aug in augmented:
                out_path = char_dir / f"{idx:04d}.png"
                Image.fromarray(aug.astype(np.uint8), mode="L").save(out_path)
                idx += 1
                total += 1

    print(f"Generated {total} character images in {output_dir}")
    print(f"Characters: {len(list(output_dir.iterdir()))}")


if __name__ == "__main__":
    main()
