'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'netlify-dist');
const MANIFEST_PATH = path.join(OUT, 'release.json');

function fail(message) {
  throw new Error(`[finalize-release-manifest] ${message}`);
}

function walk(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`symlink is not allowed in the release artifact: ${relative}`);
    if (entry.isDirectory()) return walk(absolute, relative);
    if (!entry.isFile()) fail(`unsupported filesystem entry in the release artifact: ${relative}`);
    return relative === 'release.json' ? [] : [relative];
  });
}

function run() {
  if (!fs.existsSync(OUT) || !fs.statSync(OUT).isDirectory()) fail('netlify-dist is missing');
  if (!fs.existsSync(MANIFEST_PATH)) fail('initial release.json is missing');

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (_) {
    fail('initial release.json is not valid JSON');
  }
  if (!manifest || manifest.build !== 'frontend-only-netlify' || typeof manifest.sourceCommit !== 'string' || !manifest.sourceCommit) {
    fail('initial release.json is missing build/source metadata');
  }

  const files = walk(OUT).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const hashes = Object.fromEntries(files.map(relative => [
    relative,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, relative))).digest('hex')
  ]));
  const finalized = { ...manifest, files: hashes };
  const temporaryPath = `${MANIFEST_PATH}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(finalized, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, MANIFEST_PATH);
  console.log(`[finalize-release-manifest] Hashed ${files.length} final assets for source ${manifest.sourceCommit}.`);
}

if (require.main === module) run();

module.exports = { run };
