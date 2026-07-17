#!/usr/bin/env python3
"""Create a 20,000 × 20,000 terrain-relief tile pyramid from height samples."""

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
WORLD_SIZE = MAX_COORD - MIN_COORD
TILE_SIZE = 512
SEA_LEVEL = 63.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-size", type=int, default=5000)
    parser.add_argument("--output-size", type=int, default=20000)
    return parser.parse_args()


def biome_relief(heights: np.ndarray, biome_rgb: np.ndarray) -> np.ndarray:
    """Blend Minecraft biome colors with terrain hillshade, similar to seed-map renderers."""
    h = np.asarray(heights, dtype=np.float32)
    h = np.nan_to_num(h, nan=SEA_LEVEL, posinf=320.0, neginf=-64.0)
    rgb = np.asarray(biome_rgb, dtype=np.float32).copy()

    gx = np.empty_like(h)
    gz = np.empty_like(h)
    gx[:, 1:-1] = (h[:, 2:] - h[:, :-2]) * 0.5
    gx[:, 0] = h[:, 1] - h[:, 0]
    gx[:, -1] = h[:, -1] - h[:, -2]
    gz[1:-1, :] = (h[2:, :] - h[:-2, :]) * 0.5
    gz[0, :] = h[1, :] - h[0, :]
    gz[-1, :] = h[-1, :] - h[-2, :]

    # Strong north-west hillshade, matching the raised terrain look in Chunkbase-like maps.
    nz = np.full_like(h, 2.25)
    inv = 1.0 / np.sqrt(gx * gx + gz * gz + nz * nz)
    light = (-gx * 0.58 - gz * 0.58 + nz * 0.62) * inv
    shade = np.clip((light + 0.75) / 1.50, 0.0, 1.0)

    # Increase biome saturation/contrast before relief shading.
    gray = rgb.mean(axis=2, keepdims=True)
    rgb = gray + (rgb - gray) * 1.38
    rgb = (rgb - 128.0) * 1.10 + 128.0

    illumination = 0.45 + shade * 0.88
    rgb *= illumination[..., None]

    # Snow caps on high terrain and subtle pale rock on major peaks.
    snow = np.clip((h - 150.0) / 55.0, 0.0, 1.0)[..., None]
    rgb = rgb * (1.0 - snow * 0.72) + np.array([245, 248, 250], dtype=np.float32) * snow * 0.72

    # Emphasize shorelines and deep water while retaining biome colors.
    coast = np.abs(h - SEA_LEVEL) < 1.5
    rgb[coast] = np.clip(rgb[coast] * 1.18, 0, 255)
    underwater = h < SEA_LEVEL
    depth = np.clip((SEA_LEVEL - h) / 45.0, 0.0, 1.0)
    rgb[underwater] *= (1.0 - depth[underwater, None] * 0.28)

    return np.clip(rgb, 0, 255).astype(np.uint8)


def pyramid_sizes(max_size: int) -> list[int]:
    sizes = [max_size]
    while sizes[-1] > 360:
        sizes.append(max(1, math.ceil(sizes[-1] / 2)))
    return list(reversed(sizes))


def save_tile(tile: Image.Image, path: Path, use_webp: bool) -> None:
    if use_webp:
        tile.save(path, "WEBP", quality=84, method=5)
    else:
        tile.save(path, "PNG", optimize=True)


def tile_level_from_source(
    source: Image.Image,
    source_size: int,
    level_size: int,
    level_dir: Path,
    extension: str,
    use_webp: bool,
) -> tuple[int, int]:
    cols = math.ceil(level_size / TILE_SIZE)
    rows = math.ceil(level_size / TILE_SIZE)
    ratio = source_size / level_size

    for row in range(rows):
        for col in range(cols):
            out_left = col * TILE_SIZE
            out_top = row * TILE_SIZE
            out_right = min(level_size, out_left + TILE_SIZE)
            out_bottom = min(level_size, out_top + TILE_SIZE)
            out_w = out_right - out_left
            out_h = out_bottom - out_top

            # One-source-pixel margin prevents seams after resampling.
            src_left_f = out_left * ratio
            src_top_f = out_top * ratio
            src_right_f = out_right * ratio
            src_bottom_f = out_bottom * ratio
            src_left = max(0, math.floor(src_left_f) - 2)
            src_top = max(0, math.floor(src_top_f) - 2)
            src_right = min(source_size, math.ceil(src_right_f) + 2)
            src_bottom = min(source_size, math.ceil(src_bottom_f) + 2)

            crop = source.crop((src_left, src_top, src_right, src_bottom))
            scale_x = out_w / max(1e-9, src_right_f - src_left_f)
            scale_y = out_h / max(1e-9, src_bottom_f - src_top_f)
            resized_w = max(1, round((src_right - src_left) * scale_x))
            resized_h = max(1, round((src_bottom - src_top) * scale_y))
            crop = crop.resize((resized_w, resized_h), Image.Resampling.BICUBIC)

            trim_left = round((src_left_f - src_left) * scale_x)
            trim_top = round((src_top_f - src_top) * scale_y)
            tile = crop.crop((trim_left, trim_top, trim_left + out_w, trim_top + out_h))
            save_tile(tile, level_dir / f"{col}_{row}.{extension}", use_webp)

    return cols, rows


def main() -> None:
    args = parse_args()
    source_size = args.source_size
    output_size = args.output_size
    if output_size != WORLD_SIZE:
        raise SystemExit(f"output-size must be {WORLD_SIZE} for one pixel per block")

    height_path = args.raw_dir / "height.f32"
    biome_path = args.raw_dir / "biome.rgb"
    expected_height = source_size * source_size * 4
    expected_biome = source_size * source_size * 3
    if not height_path.is_file() or height_path.stat().st_size != expected_height:
        actual = height_path.stat().st_size if height_path.exists() else 0
        raise SystemExit(f"Unexpected height.f32 size: {actual} != {expected_height}")
    if not biome_path.is_file() or biome_path.stat().st_size != expected_biome:
        actual = biome_path.stat().st_size if biome_path.exists() else 0
        raise SystemExit(f"Unexpected biome.rgb size: {actual} != {expected_biome}")

    heights = np.memmap(height_path, dtype="<f4", mode="r", shape=(source_size, source_size))
    biome_rgb = np.memmap(biome_path, dtype=np.uint8, mode="r", shape=(source_size, source_size, 3))
    relief = biome_relief(heights, biome_rgb)
    source = Image.fromarray(relief, mode="RGB")

    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    use_webp = bool(features.check("webp"))
    extension = "webp" if use_webp else "png"
    levels: list[dict[str, int]] = []

    for level_index, level_size in enumerate(pyramid_sizes(output_size)):
        level_dir = output / str(level_index)
        level_dir.mkdir(parents=True, exist_ok=True)
        cols, rows = tile_level_from_source(
            source, source_size, level_size, level_dir, extension, use_webp
        )
        levels.append({"level": level_index, "size": level_size, "cols": cols, "rows": rows})
        print(f"level {level_index}: {level_size}x{level_size}, {cols * rows} tiles")

    manifest = {
        "formatVersion": 2,
        "seed": SEED,
        "minecraftVersion": VERSION,
        "generator": "cubiomes approximate elevation",
        "generatorCommit": "e61f90580cbdd883214a8054670dacae655e59c0",
        "terrainMode": "biome colors with elevation hillshade; no structures",
        "bounds": {"minX": MIN_COORD, "maxX": MAX_COORD, "minZ": MIN_COORD, "maxZ": MAX_COORD},
        "sourceHeightSamples": source_size,
        "blocksPerHeightSample": 4,
        "displayPixels": output_size,
        "displayPixelsPerBlock": 1,
        "tileSize": TILE_SIZE,
        "format": extension,
        "levels": levels,
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
