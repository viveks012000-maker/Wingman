#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.tmp/wingman-heic-runtime/libheif-build"
source ../emsdk/emsdk_env.sh 2>/dev/null
LIBHEIFA="$(pwd)/libheif/libheif.a"
echo "LIBHEIFA: $LIBHEIFA"
ls -la "$LIBHEIFA"
echo "---LINKING---"
em++ -Wl,--whole-archive "$LIBHEIFA" -Wl,--no-whole-archive \
    -lembind -o libheif.js \
    --post-js ../libheif/post.js \
    -sWASM=0 \
    -sDYNAMIC_EXECUTION=0 \
    -sEXPORTED_FUNCTIONS='["_free","_malloc","_memcpy"]' \
    -sMODULARIZE \
    -sENVIRONMENT=web,worker \
    -sWASM_ASYNC_COMPILATION=0 \
    -sALLOW_MEMORY_GROWTH=1 \
    -sASSERTIONS=0 \
    -sDISABLE_EXCEPTION_CATCHING=1 \
    -O3 2>&1 | tail -20
echo "---SIZE---"
wc -c libheif.js
sha256sum libheif.js
