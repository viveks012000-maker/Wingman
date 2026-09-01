'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifyProductionCss } = require('./verify-production-css');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'tmp');
const CANDIDATE = path.join(TMP, 'output.candidate.css');
const WATCH = process.argv.includes('--watch');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const before = verifyProductionCss();
fs.mkdirSync(TMP, { recursive: true });
const tailwindCli = path.join(ROOT, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs');
const args = [tailwindCli, '-i', './input.css', '-o', './tmp/output.candidate.css'];
if (!WATCH) args.push('--minify');
if (WATCH) args.push('--watch');

console.log(`[css-candidate] Writing only ${path.relative(ROOT, CANDIDATE)}; audited output.css will not be modified.`);
const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

const after = verifyProductionCss();
if (before.hash !== after.hash || before.bytes !== after.bytes) {
  throw new Error('[css-candidate] production output.css changed during candidate generation.');
}
if (!WATCH) {
  if (!fs.existsSync(CANDIDATE)) throw new Error('[css-candidate] candidate file was not generated.');
  console.log(`[css-candidate] candidate bytes=${fs.statSync(CANDIDATE).size} sha256=${sha256(CANDIDATE)}`);
}
