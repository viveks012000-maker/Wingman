const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

assert.ok(!app.includes('if (response.status === 401) {\n                        window.updateUICredits(0);'), '401 must never convert authentication failure into a loaded zero-credit wallet');
assert.ok(app.includes('const freshCreditCheck = await window.checkCreditBalance();'), 'purchase gate must fresh-check wallet before opening purchase UI');
assert.ok(app.includes('const authoritativeBalanceCheck = await window.checkCreditBalance();'), 'HTTP 402 generation path must independently re-sync authoritative credits');
assert.ok(app.includes('if (state.credits >= requiredCreditCost)'), 'HTTP 402 must suppress purchase UI when fresh wallet has enough credits');
assert.ok(app.includes('const authoritativeChatBalance = await window.checkCreditBalance();'), 'chat HTTP 402 must re-sync authoritative credits');
assert.ok(app.includes('state.credits >= 2'), 'chat purchase UI must require a verified balance below the 2-credit threshold');
assert.ok(server.includes("row.success !== true || row.settled !== true"), 'settle helper must reject a semantic settled:false response');
assert.ok(server.includes("if (!row || row.success !== true)"), 'release helper must reject semantic RPC failures');
assert.ok((server.match(/err\.statusCode === 503/g) || []).length >= 2, 'credit balance endpoints must preserve HTTP 503 service-unavailable semantics');
assert.ok(app.includes('currentBatchBytes > 25 * 1024 * 1024'), 'client screenshot total limit must match 25 MB invariant');

console.log('✔ Credit purchase-modal regression guard passed.');
