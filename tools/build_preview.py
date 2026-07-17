#!/usr/bin/env python3
"""Create an elevation-only fallback preview."""
from pathlib import Path
import numpy as np
from PIL import Image

SEED = 7748490339196353958
SIZE = 1600
OUT = Path(__file__).resolve().parents[1] / "web" / "assets" / "terrain-preview.webp"


def octave(rng, grids, weights):
    out = np.zeros((SIZE, SIZE), np.float32)
    total = 0.0
    for g, w in zip(grids, weights):
        src = (rng.random((g, g)) * 255).astype(np.uint8)
        layer = np.asarray(Image.fromarray(src, "L").resize((SIZE, SIZE), Image.Resampling.BICUBIC), np.float32) / 255
        out += layer * w
        total += w
    return out / total


def main():
    rng = np.random.default_rng(SEED & ((1 << 63) - 1))
    base = octave(rng, [4, 8, 18, 40, 90], [1, .65, .34, .15, .06])
    ridge = np.abs(octave(rng, [10, 24, 58], [1, .36, .13]) - .5) * 2
    h = (base - .49) * 170 + np.maximum(base - .47, 0) * ridge * 160 + 63

    gy, gx = np.gradient(h)
    shade = (-gx*.56 - gy*.56 + 3.2) / np.sqrt(gx*gx + gy*gy + 3.2**2)
    shade = np.clip((shade+.55)/1.55, 0, 1)
    stops = np.array([-64,32,55,62,64,82,112,150,205,320], np.float32)
    colors = np.array([[18,42,60],[25,65,88],[42,91,112],[80,129,139],[170,160,116],[120,128,91],[116,108,84],[113,103,93],[153,151,146],[226,229,229]], np.float32)
    rgb = np.stack([np.interp(h, stops, colors[:,i]) for i in range(3)], axis=-1)
    rgb *= (0.58 + shade*.58)[...,None]
    contour=np.mod(np.maximum(h,63)-63,16)
    rgb *= np.where((h>=63)&((contour<.75)|(contour>15.25)),.90,1.0)[...,None]
    Image.fromarray(np.clip(rgb,0,255).astype(np.uint8), 'RGB').save(OUT,'WEBP',quality=86,method=6)

if __name__ == '__main__': main()
