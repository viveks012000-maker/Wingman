const fs = require('fs');

let build = fs.readFileSync('scripts/build-netlify-dist.js', 'utf8');
const oldFn = `function currentGitSha() {
  if (process.env.GITHUB_SHA && /^[0-9a-f]{40}$/i.test(process.env.GITHUB_SHA)) return process.env.GITHUB_SHA.toLowerCase();
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (_) {
    return 'unknown';
  }
}`;
const newFn = `function currentGitSha() {
  // The checked-out Git HEAD is the artifact source of truth. GitHub reserves GITHUB_SHA
  // for the workflow-triggering commit, which can differ from an explicitly checked-out SHA.
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (/^[0-9a-f]{40}$/i.test(head)) return head.toLowerCase();
  } catch (_) {}

  // Fallback for build environments where Git metadata is unavailable.
  if (process.env.SOURCE_COMMIT && /^[0-9a-f]{40}$/i.test(process.env.SOURCE_COMMIT)) {
    return process.env.SOURCE_COMMIT.toLowerCase();
  }
  if (process.env.GITHUB_SHA && /^[0-9a-f]{40}$/i.test(process.env.GITHUB_SHA)) {
    return process.env.GITHUB_SHA.toLowerCase();
  }
  return 'unknown';
}`;
if (!build.includes(oldFn)) throw new Error('Expected currentGitSha implementation not found');
build = build.replace(oldFn, newFn);
fs.writeFileSync('scripts/build-netlify-dist.js', build);

const test = `const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const buildSource = fs.readFileSync(path.join(root, 'scripts', 'build-netlify-dist.js'), 'utf8');
assert.ok(buildSource.indexOf("git', ['rev-parse', 'HEAD']") < buildSource.indexOf('process.env.GITHUB_SHA'),
  'artifact source must prefer checked-out Git HEAD over GitHub workflow trigger SHA');
assert.ok(buildSource.includes('process.env.SOURCE_COMMIT'), 'builder must retain an explicit source fallback when Git metadata is unavailable');

const actualHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().toLowerCase();
const fakeWorkflowSha = '1111111111111111111111111111111111111111';
execFileSync(process.execPath, ['scripts/build-netlify-dist.js'], {
  cwd: root,
  stdio: 'pipe',
  env: { ...process.env, GITHUB_SHA: fakeWorkflowSha }
});
const release = JSON.parse(fs.readFileSync(path.join(root, 'netlify-dist', 'release.json'), 'utf8'));
assert.strictEqual(release.sourceCommit, actualHead,
  'release manifest must identify the actual checked-out source commit, not GITHUB_SHA from the triggering workflow');
assert.notStrictEqual(release.sourceCommit, fakeWorkflowSha,
  'reserved GitHub workflow SHA must not override the artifact checkout SHA');

console.log('✔ Netlify release manifest source-commit truth guard passed.');
`;
fs.writeFileSync('tests/release_manifest_source.test.js', test);

let runner = fs.readFileSync('tests/run_all_tests.js', 'utf8');
const anchor = `    { name: '32. Public Health Endpoint Minimal-Disclosure Guard', file: 'health_endpoint_minimal.test.js' }\n`;
if (!runner.includes(anchor)) throw new Error('Suite 32 anchor not found');
runner = runner.replace(anchor, `    { name: '32. Public Health Endpoint Minimal-Disclosure Guard', file: 'health_endpoint_minimal.test.js' },\n    { name: '33. Netlify Release Manifest Source-Commit Truth Guard', file: 'release_manifest_source.test.js' }\n`);
fs.writeFileSync('tests/run_all_tests.js', runner);

console.log('Release manifest source-commit patch applied.');
