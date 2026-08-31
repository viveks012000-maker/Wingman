const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveGitExecutable } = require('../scripts/process-tools');

const root = path.join(__dirname, '..');
const buildSource = fs.readFileSync(path.join(root, 'scripts', 'build-netlify-dist.js'), 'utf8');
const processToolsSource = fs.readFileSync(path.join(root, 'scripts', 'process-tools.js'), 'utf8');
assert(buildSource.includes("require('./process-tools')"), 'artifact builder must use the portable process resolver');
assert(buildSource.includes('currentGitSha(ROOT)'), 'artifact builder must prefer the checked-out Git HEAD through the resolver');
assert.ok(processToolsSource.includes('env.SOURCE_COMMIT'), 'process resolver must retain an explicit source fallback when Git metadata is unavailable');

let actualHead = null;
try {
  const git = resolveGitExecutable();
  if (git) actualHead = execFileSync(git, ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().toLowerCase();
} catch (_) {
  // Local source archives may not include Git metadata. Exercise the explicit
  // source fallback instead of requiring Git to be installed on the machine.
}
const fakeWorkflowSha = '1111111111111111111111111111111111111111';
const sourceFallback = '2222222222222222222222222222222222222222';
execFileSync(process.execPath, ['scripts/build-netlify-dist.js'], {
  cwd: root,
  stdio: 'pipe',
  env: { ...process.env, GITHUB_SHA: fakeWorkflowSha, ...(actualHead ? {} : { SOURCE_COMMIT: sourceFallback }) }
});
const release = JSON.parse(fs.readFileSync(path.join(root, 'netlify-dist', 'release.json'), 'utf8'));
assert.strictEqual(release.sourceCommit, actualHead || sourceFallback,
  'release manifest must identify the checked-out source commit or explicit source fallback, not GITHUB_SHA from the triggering workflow');
assert.notStrictEqual(release.sourceCommit, fakeWorkflowSha,
  'reserved GitHub workflow SHA must not override the artifact checkout SHA');

console.log(`✔ Netlify release manifest source-commit truth guard passed (${actualHead ? 'Git HEAD' : 'SOURCE_COMMIT fallback'}).`);
