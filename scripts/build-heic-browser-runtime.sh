#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${RUNNER_TEMP:-${ROOT}/.tmp}/wingman-heic-runtime"
OUT="${ROOT}/vendor/heic-runtime"

HEIC_TO_COMMIT="f37af866f9aa6212ddc84b67a279c9f2386aba4f"
LIBHEIF_TAG="v1.23.1"
LIBDE265_COMMIT="4dd701fffac01632ffd5cabc5ef10deb56accba1"
EMSDK_COMMIT="e3a0604c3d130d6ab2c40e14a1861accd939a255"
EMSCRIPTEN_VERSION="6.0.7"
EXPECTED_RUNTIME_SHA256="500a54dcdb7873c849548fa6ab4f95f9b2c93c2c7808f57f271da7ca84d278a4"
EXPECTED_RUNTIME_BYTES="1115318"

rm -rf "$WORK"
mkdir -p "$WORK"
cd "$WORK"

git clone -q https://github.com/emscripten-core/emsdk.git
cd emsdk
git checkout -q --detach "$EMSDK_COMMIT"
./emsdk install "$EMSCRIPTEN_VERSION"
./emsdk activate "$EMSCRIPTEN_VERSION"
# shellcheck disable=SC1091
# shellcheck disable=SC1091
source "./emsdk_env.sh"
cd "$WORK"

git clone -q --depth 1 --branch "$LIBHEIF_TAG" https://github.com/strukturag/libheif.git
python3 - <<'PY'
from pathlib import Path
path = Path('libheif/build-emscripten.sh')
text = path.read_text()
old_driver = 'emcc -Wl,--whole-archive "$LIBHEIFA"'
new_driver = 'em++ -Wl,--whole-archive "$LIBHEIFA"'
if text.count(old_driver) != 1:
    raise SystemExit('unexpected libheif final linker shape')
text = text.replace(old_driver, new_driver, 1)
old_modularize = '    -sMODULARIZE \\\n'
new_modularize = '    -sMODULARIZE \\\n    -sENVIRONMENT=web,worker \\\n'
if text.count(old_modularize) != 1:
    raise SystemExit('unexpected libheif MODULARIZE flag shape')
text = text.replace(old_modularize, new_modularize, 1)
path.write_text(text)
PY

git clone -q https://github.com/strukturag/libde265.git libde265-src
cd libde265-src
git checkout -q --detach "$LIBDE265_COMMIT"
cd "$WORK"
mkdir libde265-cmake
cd libde265-cmake
emcmake cmake ../libde265-src \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DENABLE_SDL=OFF \
  -DENABLE_DECODER=OFF \
  -DENABLE_ENCODER=OFF \
  -DENABLE_SHERLOCK265=OFF \
  -DENABLE_INTERNAL_DEVELOPMENT_TOOLS=OFF \
  -DWITH_FUZZERS=OFF \
  -DENABLE_SIMD=OFF
cmake --build . --target de265 --parallel 2
cd "$WORK"

test -s libde265-cmake/libde265/libde265.a
test -s libde265-cmake/libde265/de265-version.h
mkdir -p libheif-build/libde265-1.1.1/libde265/.libs
cp -R libde265-src/libde265/. libheif-build/libde265-1.1.1/libde265/
cp libde265-cmake/libde265/de265-version.h libheif-build/libde265-1.1.1/libde265/de265-version.h
cp libde265-cmake/libde265/libde265.a libheif-build/libde265-1.1.1/libde265/.libs/libde265.a

git clone -q https://github.com/hoppergee/heic-to.git
cd heic-to
git checkout -q --detach "$HEIC_TO_COMMIT"
python3 - <<'PY'
from pathlib import Path
path = Path('src/worker.js')
text = path.read_text()
old_factory = 'const libheif = buildLibheif()'
new_factory = 'const libheifPromise = buildLibheif()'
if text.count(old_factory) != 1:
    raise SystemExit('unexpected heic-to libheif factory shape')
text = text.replace(old_factory, new_factory, 1)
old_decode = 'const decodeBuffer = async (buffer) => {\n  let decoder, data;'
new_decode = 'const decodeBuffer = async (buffer) => {\n  const libheif = await libheifPromise;\n  let decoder, data;'
if text.count(old_decode) != 1:
    raise SystemExit('unexpected heic-to decodeBuffer shape')
text = text.replace(old_decode, new_decode, 1)
path.write_text(text)
PY
npm ci
npm audit --omit=dev
cd "$WORK"

cd libheif-build
LIBDE265_VERSION=1.1.1 USE_WASM=0 USE_UNSAFE_EVAL=0 USE_TYPESCRIPT=0 ../libheif/build-emscripten.sh ../libheif
test -s libheif.js
if grep -Eq 'node:(fs|crypto)' libheif.js; then
  echo 'Browser libheif payload unexpectedly contains Node built-ins.' >&2
  exit 1
fi
cp libheif.js ../heic-to/src/lib/libheif-without-unsafe-eval.js
cd ../heic-to
npm run build
RUNTIME="dist/csp/heic-to.js"
test -s "$RUNTIME"

if grep -nE '(^|[^[:alnum:]_])(eval[[:space:]]*\(|new[[:space:]]+Function[[:space:]]*\()' "$RUNTIME"; then
  echo 'Generated runtime contains dynamic-code-generation marker.' >&2
  exit 1
fi

ACTUAL_SHA256="$(sha256sum "$RUNTIME" | awk '{print $1}')"
ACTUAL_BYTES="$(wc -c < "$RUNTIME" | tr -d ' ')"
if [[ "$ACTUAL_SHA256" != "$EXPECTED_RUNTIME_SHA256" ]]; then
  echo "HEIC runtime SHA-256 mismatch: expected $EXPECTED_RUNTIME_SHA256, got $ACTUAL_SHA256" >&2
  exit 1
fi
if [[ "$ACTUAL_BYTES" != "$EXPECTED_RUNTIME_BYTES" ]]; then
  echo "HEIC runtime byte-size mismatch: expected $EXPECTED_RUNTIME_BYTES, got $ACTUAL_BYTES" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT/source"
cp "$RUNTIME" "$OUT/heic-to-csp.js"
cp LICENSE "$OUT/LICENSE-heic-to.txt"
cp "$WORK/libheif/COPYING" "$OUT/LICENSE-libheif.txt"
cp "$WORK/libde265-src/COPYING" "$OUT/LICENSE-libde265.txt"
cp src/worker.js "$OUT/source/heic-to-worker.js"
cp "$WORK/libheif/build-emscripten.sh" "$OUT/source/libheif-build-emscripten.sh"

cat > "$OUT/NOTICE.txt" <<EOF
MyWingman HEIC browser converter third-party notice

This separately loaded browser module contains and/or is derived from:
- heic-to, commit $HEIC_TO_COMMIT — GNU LGPL v3 or later
- libheif $LIBHEIF_TAG — GNU LGPL v3 or later
- libde265, commit $LIBDE265_COMMIT (v1.1.1) — GNU LGPL v3 or later

The converter is loaded as a separate local ES module on first HEIC/HEIF use. It is not bundled into MyWingman's proprietary application JavaScript.
License texts, modified source files, exact source revisions and the reproducible build recipe are provided alongside this file.
EOF

cat > "$OUT/SOURCE.txt" <<EOF
HEIC browser runtime source and rebuild information

Runtime SHA-256: $EXPECTED_RUNTIME_SHA256
Runtime bytes: $EXPECTED_RUNTIME_BYTES

Pinned source revisions:
- heic-to: https://github.com/hoppergee/heic-to/commit/$HEIC_TO_COMMIT
- libheif: https://github.com/strukturag/libheif/releases/tag/$LIBHEIF_TAG
- libde265: https://github.com/strukturag/libde265/commit/$LIBDE265_COMMIT
- emsdk: https://github.com/emscripten-core/emsdk/commit/$EMSDK_COMMIT
- Emscripten: $EMSCRIPTEN_VERSION

MyWingman modifications are limited to browser-build compatibility:
1. libheif's Emscripten final link uses em++ instead of emcc and targets ENVIRONMENT=web,worker.
2. heic-to's worker awaits the Emscripten 6 modularized factory Promise before constructing HeifDecoder.
3. The build uses USE_WASM=0, USE_UNSAFE_EVAL=0, and only the libde265 HEVC decoder path required for HEIC.

The exact modified source files are in the source/ subdirectory. The complete unmodified upstream source is available at the pinned public revisions above. The repository build recipe is scripts/build-heic-browser-runtime.sh.
EOF

cat > "$OUT/build-info.json" <<EOF
{
  "runtime": "heic-to-csp.js",
  "sha256": "$EXPECTED_RUNTIME_SHA256",
  "bytes": $EXPECTED_RUNTIME_BYTES,
  "heicToCommit": "$HEIC_TO_COMMIT",
  "libheifTag": "$LIBHEIF_TAG",
  "libde265Commit": "$LIBDE265_COMMIT",
  "emsdkCommit": "$EMSDK_COMMIT",
  "emscriptenVersion": "$EMSCRIPTEN_VERSION",
  "unsafeEval": false,
  "environment": "web,worker"
}
EOF

printf 'Generated %s (%s bytes)\n' "$ACTUAL_SHA256" "$ACTUAL_BYTES"
