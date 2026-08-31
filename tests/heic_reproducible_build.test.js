'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const buildScript = fs.readFileSync(path.join(ROOT, 'scripts', 'build-heic-browser-runtime.sh'), 'utf8');

assert.match(
    buildScript,
    /export CORES="\$\{CORES:-1\}"/,
    'HEIC builds must default to one stable build worker so generated archives do not depend on runner parallelism.'
);

console.log('HEIC reproducible-build worker setting regression guard passed.');
