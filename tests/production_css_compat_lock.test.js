'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'output.css');
const candidate = path.join(root, 'tmp', 'output.candidate.css');
const verifierSource = fs.readFileSync(path.join(root, 'scripts', 'verify-production-css.js'), 'utf8');
const candidateSource = fs.readFileSync(path.join(root, 'scripts', 'build-css-candidate.js'), 'utf8');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

console.log('Running production CSS compatibility artifact guard...');

assert.strictEqual(packageJson.scripts['build:css'], 'node scripts/verify-production-css.js', 'build:css must no longer overwrite production output.css');
assert.strictEqual(packageJson.scripts['build:css:candidate'], 'node scripts/build-css-candidate.js', 'candidate build command must be explicit');
assert.strictEqual(packageJson.scripts['watch:css'], 'node scripts/build-css-candidate.js --watch', 'CSS watch mode must write only the candidate path');
assert(packageJson.scripts['build:netlify'].startsWith('node scripts/verify-production-css.js && '), 'production artifact build must fail closed on CSS drift before packaging');
assert(!packageJson.scripts['build:css'].includes('-o ./output.css'), 'build:css must never target output.css');
assert(!packageJson.scripts['watch:css'].includes('-o ./output.css'), 'watch:css must never target output.css');
assert(candidateSource.includes("'./tmp/output.candidate.css'"), 'candidate build must target ignored tmp/output.candidate.css');
assert(!candidateSource.includes("'-o', './output.css'"), 'candidate helper must not write output.css');
assert(verifierSource.includes('EXPECTED_SHA256'), 'production CSS verifier must use an exact SHA-256 lock');
assert(verifierSource.includes('EXPECTED_BYTES'), 'production CSS verifier must use an exact byte-size lock');

const beforeHash = sha256(output);
const beforeBytes = fs.statSync(output).size;
execFileSync(process.execPath, [path.join(root, 'scripts', 'verify-production-css.js')], { cwd: root, stdio: 'inherit' });
fs.rmSync(candidate, { force: true });
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-css-candidate.js')], { cwd: root, stdio: 'inherit' });
assert(fs.existsSync(candidate), 'candidate CSS must be generated in ignored tmp directory');
assert.strictEqual(sha256(output), beforeHash, 'candidate generation must not change production output.css hash');
assert.strictEqual(fs.statSync(output).size, beforeBytes, 'candidate generation must not change production output.css size');
assert.notStrictEqual(sha256(candidate), beforeHash, 'current Tailwind regeneration must remain visibly distinct from the locked compatibility artifact until migration debt is resolved');

console.log('✅ Production output.css is byte-locked; candidate generation cannot overwrite it.');
