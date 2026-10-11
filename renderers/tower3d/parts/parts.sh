#!/bin/sh
# The parts kit (README.md beside it), with Blender headless:
#   kit            builds parts.blend (once: it refuses to write over one)
#   export         writes parts.glb from parts.blend's Wardrobe
#   shot           renders parts.blend to lineup.jpg and close.jpg beside it, the README's pictures
set -e
cd "$(dirname "$0")"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
blender() {
  log=$(mktemp)
  "$BLENDER" -b --python-exit-code 1 "$@" >"$log" 2>&1 || { cat "$log"; rm "$log"; exit 1; }
  grep -E '^exported|Saved' "$log" || true
  rm "$log"
}
case "$1" in
  kit) blender --factory-startup -P build.py -- parts.blend ;;
  export)
    out=$(mktemp -d)
    blender parts.blend -P export.py -- "$out/parts.glb"
    npx tsx ../../../scripts/tower3d-parts.ts "$out/parts.glb"
    rm -rf "$out"
    ;;
  shot) blender parts.blend -P shot.py -- "$PWD/lineup.jpg" "$PWD/close.jpg" ;;
  *) echo "parts.sh kit | export | shot" >&2; exit 1 ;;
esac
