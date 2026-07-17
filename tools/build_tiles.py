#!/usr/bin/env python3
"""Build a GitHub-Pages-friendly terrain tile pyramid from Cubiomes raw output."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, features

SEED = "7748490339196353958"
VERSION = "Java 1.20.1"
MIN_COORD = -10000
MAX_COORD = 10000
TILE_SIZE = 512


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--size", type=int, default=5000)
    return parser.parse_args()


def hillshade(rgb: np.ndarray, heights: np.ndarray) -> np.ndarray:
    """Apply restrained NW lighting while preserving the biome palette."""
    h = np.asarray(heights, dtype=np.float32)
    h = np.nan_to_num(h, nan=63.0, posinf=320.0, neginf=-64.0)

    gx = np.empty_like(h)
    gy = np.empty_like(h)
    gx[:, 1:-1] = (h[:, 2:] - h[:, :-2]) * 0.5
    gx[:, 0] = h[:, 1] - h[:, 0]
    gx[:, -1] = h[:, -1] - h[:, -2]
    gy[1:-1, :] = (h[2:, :] - h[:-2, :]) * 0.5
    gy[0, :] = h[1, :] - h[0, :]
    gy[-1, :] = h[-1, :] - h[-2, :]

    # Unit surface normal dotted with a north-west, elevated light vector.
    nz = np.full_like(h, 5.4)
    inv_len = 1.0 / np.sqrt(gx * gx + gy * gy + nz * nz)
    shade = (-gx * 0.46 - gy * 0.46 + nz * 0.76) * inv_len
    shade = np.clip(shade, -0.45, 1.0)
    factor = 0.79 + (shade + 0.45) / 1.45 * 0.34

    # Small elevation lift makes high terrain legible without exposing blocks.
    elevation = np.clip((h - 63.0) / 150.0, -0.08, 0.10)
    factor = np.clip(factor + elevation, 0.68, 1.22)

    out = np.asarray(rgb, dtype=np.float32) * factor[..., None]
    return np.clip(out, 0, 255).astype(np.uint8)


def pyramid_sizes(max_size: int) -> list[int]:
    sizes = [max_size]
    while sizes[-1] > 360:
        sizes.append(max(1, math.ceil(sizes[-1] / 2)))
    return list(reversed(sizes))


def main() -> None:
    args = parse_args()
    size = args.size
    rgb_path = args.raw_dir / "terrain.rgb"
    height_path = args.raw_dir / "height.f32"
    if not rgb_path.is_file() or not height_path.is_file():
        raise SystemExit(f"Missing raw files in {args.raw_dir}")

    expected_rgb = size * size * 3
    expected_height = size * size * 4
    if rgb_path.stat().st_size != expected_rgb:
        raise SystemExit(f"Unexpected terrain.rgb size: {rgb_path.stat().st_size} != {expected_rgb}")
    if height_path.stat().st_size != expected_height:
        raise SystemExit(f"Unexpected height.f32 size: {height_path.stat().st_size} != {expected_height}")

    rgb = np.memmap(rgb_path, dtype=np.uint8, mode="r", shape=(size, size, 3))
    heights = np.memmap(height_path, dtype="<f4", mode="r", shape=(size, size))
    shaded = hillshade(rgb, heights)
    source = Image.fromarray(shaded, mode="RGB")

    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    use_webp = bool(features.check("webp"))
    image_format = "webp" if use_webp else "png"
    levels: list[dict[str, int]] = []

    sizes = pyramid_sizes(size)
    for level_index, level_size in enumerate(sizes):
        level_dir = output / str(level_index)
        level_dir.mkdir(parents=True, exist_ok=True)
        if level_size == size:
            level_image = source
        else:
            level_image = source.resize((level_size, level_size), Image.Resampling.LANCZOS)

        cols = math.ceil(level_size / TILE_SIZE)
        rows = math.ceil(level_size / TILE_SIZE)
        levels.append({"level": level_index, "size": level_size, "cols": cols, "rows": rows})

        for row in range(rows):
            for col in range(cols):
                left = col * TILE_SIZE
                top = row * TILE_SIZE
                right = min(level_size, left + TILE_SIZE)
                bottom = min(level_size, top + TILE_SIZE)
                tile = level_image.crop((left, top, right, bottom))
                target = level_dir / f"{col}_{row}.{image_format}"
                if use_webp:
                    tile.save(target, "WEBP", quality=88, method=6)
                else:
                    tile.save(target, "PNG", optimize=True)
        print(f"level {level_index}: {level_size}x{level_size}, {cols * rows} tiles")

    manifest = {
        "formatVersion": 1,
        "seed": SEED,
        "minecraftVersion": VERSION,
        "generator": "cubiomes",
        "generatorCommit": "e61f90580cbdd883214a8054670dacae655e59c0",
        "terrainMode": "biome colors + Cubiomes approximate surface-height hillshade",
        "bounds": {"minX": MIN_COORD, "maxX": MAX_COORD, "minZ": MIN_COORD, "maxZ": MAX_COORD},
        "blocksPerSourcePixel": 4,
        "biomeSampleY": 320,
        "tileSize": TILE_SIZE,
        "format": image_format,
        "levels": levels,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {output / 'manifest.json'}")


if __name__ == "__main__":
    main()
