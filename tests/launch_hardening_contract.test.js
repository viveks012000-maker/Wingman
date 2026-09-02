'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'verify-live-production.yml'), 'utf8');
const buildWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'build-netlify-production-artifact.yml'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const launchDoc = fs.readFileSync(path.join(root, 'docs', 'LAUNCH_HARDENING.md'), 'utf8');
const recoveryDoc = fs.readFileSync(path.join(root, 'docs', 'DISASTER_RECOVERY.md'), 'utf8');

assert.equal(packageJson.scripts['build:production'], 'npm run build:netlify');
assert.equal(packageJson.scripts['verify:migrations'], 'node tests/migration_replay.test.js');
assert.match(buildWorkflow, /run: npm run build:production/);
assert.match(workflow, /Input\.dispatchTouchEvent/);
assert.match(workflow, /for \(const route of \['\/', '\/app', '\/app\.html'\]\)/);
assert.match(workflow, /route === '\/app' \|\| route === '\/app\.html'/);
assert.match(workflow, /document\.scrollingElement\.scrollTop/);
assert.match(workflow, /window\.scrollY/);
assert.match(workflow, /wingman-scroll-locked/);
assert.match(workflow, /live_asset_integrity/);
assert.match(workflow, /npm run build:production/);
assert.match(workflow, /EXPECTED CLOUDFLARE TRANSFORMATION/);
assert.match(workflow, /CACHE\/STALE-ASSET ISSUE/);
assert.match(workflow, /cloudflareinsights/);
assert.match(workflow, /name !== '404\.html'/);
assert.match(workflow, /Pages special 404 response does not expose normal _headers CSP/);
assert.match(launchDoc, /mywingmanapp\.com/);
assert.match(launchDoc, /HTTP 200 alone is never treated as scroll proof/);
assert.match(recoveryDoc, /supabase db reset --linked/);

console.log('✔ Launch hardening contract passed: authoritative build, migration replay, and /app touch verification are checked in CI.');
