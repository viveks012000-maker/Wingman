'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSS = path.join(ROOT, 'output.css');
const EXPECTED_BYTES = 113878;
const EXPECTED_SHA256 = 'd4be791e92f9063eb67140a2913ae0418cf15ee29861b258a34f9aaa689d9211';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verifyProductionCss() {
  if (!fs.existsSync(CSS) || !fs.statSync(CSS).isFile()) {
    throw new Error('[production-css-lock] output.css is missing.');
  }
  const bytes = fs.statSync(CSS).size;
  const hash = sha256(CSS);
  if (bytes !== EXPECTED_BYTES || hash !== EXPECTED_SHA256) {
    throw new Error(`[production-css-lock] output.css drifted from the audited compatibility artifact. expected bytes=${EXPECTED_BYTES} sha256=${EXPECTED_SHA256}; found bytes=${bytes} sha256=${hash}. Generate a candidate with npm run build:css:candidate and validate it before intentionally updating this lock.`);
  }
  console.log(`[production-css-lock] output.css verified: ${bytes} bytes sha256=${hash}`);
  return { bytes, hash };
}

if (require.main === module) verifyProductionCss();
module.exports = { EXPECTED_BYTES, EXPECTED_SHA256, verifyProductionCss };
