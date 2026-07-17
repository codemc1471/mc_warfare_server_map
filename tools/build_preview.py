#!/usr/bin/env python3
"""Create a deterministic bundled preview used before exact Cubiomes tiles exist."""

from __future__ import annotations

from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

SEED = 7748490339196353958
SIZE = 1600
OUT = Path(__file__).resolve().parents[1] / "web" / "assets" / "terrain-preview.webp"


def octave_noise(rng: np.random.Generator, size: int, grids: list[int], weights: list[float]) -> np.ndarray:
    result = np.zeros((size, size), dtype=np.float32)
    total = 0.0
    for grid, weight in zip(grids, weights):
        data = rng.random((grid, grid), dtype=np.float32)
        image = Image.fromarray((data * 255).astype(np.uint8), "L").resize((size, size), Image.Resampling.BICUBIC)
        layer = np.asarray(image, dtype=np.float32) / 255.0
        result += layer * weight
        total += weight
    return result / total


def main() -> None:
    rng = np.random.default_rng(SEED & ((1 << 63) - 1))
    continent = octave_noise(rng, SIZE, [5, 9, 18, 38, 78], [1.0, .72, .38, .18, .08])
    temp = octave_noise(rng, SIZE, [4, 11, 29], [1.0, .45, .16])
    wet = octave_noise(rng, SIZE, [6, 15, 42], [1.0, .5, .15])
    ridge = octave_noise(rng, SIZE, [12, 30, 74], [1.0, .35, .12])

    continent = (continent - .5) * 2.2
    ridge = np.abs(ridge - .5) * 2.0
    height = continent * 95 + np.maximum(0, continent + .05) * ridge * 120 + 62

    rgb = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    deep = height < 42
    ocean = (height >= 42) & (height < 61)
    beach = (height >= 61) & (height < 66)
    land = height >= 66
    mountain = height > 132
    peak = height > 174

    rgb[deep] = (39, 83, 121)
    rgb[ocean] = (51, 111, 148)
    rgb[beach] = (194, 183, 125)
    rgb[land] = (104, 143, 78)

    forest = land & (wet > .50) & (temp > .26)
    jungle = land & (wet > .63) & (temp > .60)
    desert = land & (wet < .38) & (temp > .57)
    savanna = land & (wet >= .38) & (wet < .49) & (temp > .57)
    taiga = land & (temp < .33)
    snow = land & (temp < .20)
    swamp = land & (wet > .66) & (height < 82)

    rgb[forest] = (65, 116, 68)
    rgb[jungle] = (47, 105, 62)
    rgb[desert] = (211, 188, 116)
    rgb[savanna] = (166, 164, 83)
    rgb[taiga] = (75, 119, 101)
    rgb[snow] = (213, 224, 216)
    rgb[swamp] = (76, 105, 74)
    rgb[mountain] = (115, 125, 113)
    rgb[peak] = (205, 211, 205)

    gy, gx = np.gradient(height.astype(np.float32))
    shade = (-gx * .43 - gy * .43 + 5.0) / np.sqrt(gx * gx + gy * gy + 25.0)
    shade = np.clip(.77 + (shade + .4) / 1.4 * .35, .68, 1.2)
    rgb *= shade[..., None]
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)

    image = Image.fromarray(rgb, "RGB").filter(ImageFilter.GaussianBlur(.35))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUT, "WEBP", quality=88, method=6)
    print(OUT)


if __name__ == "__main__":
    main()
