'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifyProductionCss, normalizeCss } = require('./verify-production-css');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'tmp');
const CANDIDATE = path.join(TMP, 'output.candidate.css');
const WATCH = process.argv.includes('--watch');

const before = verifyProductionCss();
fs.mkdirSync(TMP, { recursive: true });
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['@tailwindcss/cli', '-i', './input.css', '-o', './tmp/output.candidate.css'];
if (!WATCH) args.push('--minify');
if (WATCH) args.push('--watch');

console.log(`[css-candidate] Writing only ${path.relative(ROOT, CANDIDATE)}; audited output.css will not be modified.`);
const result = spawnSync(npx, args, { cwd: ROOT, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

const after = verifyProductionCss();
if (before.hash !== after.hash || before.bytes !== after.bytes) {
  throw new Error('[css-candidate] production output.css changed during candidate generation.');
}
if (!WATCH) {
  if (!fs.existsSync(CANDIDATE)) throw new Error('[css-candidate] candidate file was not generated.');
  const raw = fs.readFileSync(CANDIDATE);
  const normalized = normalizeCss(raw);
  const bytes = normalized.length;
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  fs.writeFileSync(CANDIDATE, normalized);
  console.log(`[css-candidate] candidate bytes=${bytes} sha256=${hash}`);
}
