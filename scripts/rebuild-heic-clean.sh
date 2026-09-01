#!/bin/bash
set -euo pipefail

ROOT="/mnt/c/Users/sumit/Wingman/.tmp/wingman-heic-runtime"
cd "$ROOT"

# Activate emsdk
cd emsdk
source ./emsdk_env.sh 2>/dev/null
cd "$ROOT"

# Clean rebuild of libheif
rm -rf libheif-build
mkdir libheif-build
cd libheif-build

LIBDE265_VERSION=1.1.1 \
USE_WASM=0 \
USE_UNSAFE_EVAL=0 \
USE_TYPESCRIPT=0 \
ENABLE_AOM=0 \
ENABLE_WEBCODECS=0 \
../libheif/build-emscripten.sh ../libheif 2>&1 | tail -30

echo "---LIBHEIF-JS-SIZE---"
wc -c libheif.js
sha256sum libheif.js

echo "---CHECK-AOM-IN-OUTPUT---"
grep -c 'aom_decoder\|aom_encoder\|av1_decode' libheif.js || echo "0"
