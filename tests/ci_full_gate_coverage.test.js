'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const workflowPath = path.join(ROOT, '.github', 'workflows', 'build-netlify-production-artifact.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');

assert(/^name:\s*MyWingman Production Verification Gate\s*$/m.test(workflow), 'workflow must use the production-verification name');

const onBlockMatch = workflow.match(/^on:\n([\s\S]*?)\npermissions:/m);
assert(onBlockMatch, 'workflow trigger block must be present');
const onBlock = onBlockMatch[1];

assert(/^[ ]{2}push:\n[ ]{4}branches:\s*\[main\]\s*$/m.test(onBlock), 'every push to main must trigger the production gate');
assert(/^[ ]{2}pull_request:\n[ ]{4}branches:\s*\[main\]\s*$/m.test(onBlock), 'every PR targeting main must trigger the production gate');
assert(/^[ ]{2}workflow_dispatch:\s*$/m.test(onBlock), 'manual production verification must remain available');
assert(!/^\s*paths(?:-ignore)?:/m.test(onBlock), 'production gate must not use path filters that can skip backend-only changes');

assert(/permissions:\n\s+contents:\s+read/m.test(workflow), 'workflow token must remain read-only for repository contents');
assert(/group:\s*production-gate-\$\{\{ github\.ref \}\}/.test(workflow), 'concurrency group must use the production-gate namespace');
assert(workflow.includes('EXPECTED_SOURCE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}'), 'workflow must select the exact pull request head SHA instead of a potentially stale merge ref');
assert(workflow.includes('ref: ${{ github.event.pull_request.head.sha || github.sha }}'), 'checkout must use the exact expected source SHA');
assert(workflow.includes('test "$actual" = "$EXPECTED_SOURCE_SHA"'), 'workflow must verify checkout equals the exact expected source SHA');
assert(/npm test/.test(workflow), 'full regression suite must remain mandatory');
assert(/npm audit --omit=dev --audit-level=high/.test(workflow), 'production dependency audit must remain mandatory');
assert(/npm run build:production/.test(workflow), 'authoritative strict public artifact build must remain mandatory');
assert(workflow.includes('test "$(jq -r .sourceCommit netlify-dist/release.json)" = "$EXPECTED_SOURCE_SHA"'), 'artifact source-commit truth must remain enforced for the exact source SHA');

console.log('✅ Production verification workflow covers every main PR/push with no path-filter bypass.');
