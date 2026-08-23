'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSS = path.join(ROOT, 'output.css');
const EXPECTED_BYTES = 113877;
const EXPECTED_SHA256 = 'f513634da85c3b6248efedb2a70605d10552cb251e73bfccd0b3b5dc6af87f56';

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function normalizeCss(buf) {
  let s = buf.toString('utf8');
  s = s.replace(/\r\n/g, '\n');
  s = s.replace(/\r/g, '\n');
  s = s.replace(/\n+$/, '');
  return Buffer.from(s, 'utf8');
}

function verifyProductionCss() {
  if (!fs.existsSync(CSS) || !fs.statSync(CSS).isFile()) {
    throw new Error('[production-css-lock] output.css is missing.');
  }
  const raw = fs.readFileSync(CSS);
  const normalized = normalizeCss(raw);
  const bytes = normalized.length;
  const hash = sha256(normalized);
  if (bytes !== EXPECTED_BYTES || hash !== EXPECTED_SHA256) {
    throw new Error(`[production-css-lock] output.css drifted from the audited compatibility artifact. expected bytes=${EXPECTED_BYTES} sha256=${EXPECTED_SHA256}; found bytes=${bytes} sha256=${hash}. Generate a candidate with npm run build:css:candidate and validate it before intentionally updating this lock.`);
  }
  console.log(`[production-css-lock] output.css verified: ${bytes} bytes sha256=${hash}`);
  return { bytes, hash };
}

function normalizeAndWriteCss(inputPath, outputPath) {
  const raw = fs.readFileSync(inputPath);
  const normalized = normalizeCss(raw);
  fs.writeFileSync(outputPath, normalized);
  return { bytes: normalized.length, hash: sha256(normalized) };
}

if (require.main === module) verifyProductionCss();
module.exports = { EXPECTED_BYTES, EXPECTED_SHA256, verifyProductionCss, normalizeCss, normalizeAndWriteCss };
