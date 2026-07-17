#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CUBIOMES_COMMIT="e61f90580cbdd883214a8054670dacae655e59c0"
VENDOR="$ROOT/vendor/cubiomes"
RAW="$ROOT/.build/raw"
DIST="$ROOT/dist"

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v make >/dev/null || { echo "make is required" >&2; exit 1; }
command -v cc >/dev/null || { echo "a C compiler is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

mkdir -p "$ROOT/vendor" "$RAW"
if [[ ! -d "$VENDOR/.git" ]]; then
  rm -rf "$VENDOR"
  git init -q "$VENDOR"
  git -C "$VENDOR" remote add origin https://github.com/Cubitect/cubiomes.git
fi
git -C "$VENDOR" fetch --depth 1 origin "$CUBIOMES_COMMIT"
git -C "$VENDOR" checkout --detach -q FETCH_HEAD

make -C "$VENDOR" -j2
cc -O3 -fwrapv -I"$VENDOR" "$ROOT/tools/render_map.c" "$VENDOR/libcubiomes.a" -lm -o "$ROOT/.build/render_map"
"$ROOT/.build/render_map" 7748490339196353958 -10000 10000 "$RAW"

rm -rf "$DIST"
cp -R "$ROOT/web" "$DIST"
mkdir -p "$DIST/assets/tiles"
python3 "$ROOT/tools/build_tiles.py" --raw-dir "$RAW" --output "$DIST/assets/tiles" --size 5000
touch "$DIST/.nojekyll"
echo "Exact site generated in: $DIST"
