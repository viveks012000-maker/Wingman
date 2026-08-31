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
assert.ok(!app.includes('title.textContent = creditMap[tier] + \" Credits Added\"'), 'tier URL must never falsely claim that credits were added while payments are fail-closed');
assert.ok(app.includes('cleanUrl.searchParams.delete(\"tier\")'), 'tier URL must be cleared after the unavailable-purchase notice');
assert.ok(app.includes('window.openPurchaseModal = function (requiredCredits)'), 'purchase popup must accept explicit required-credit context');
assert.ok(app.includes('window.openPurchaseModal(cost);'), 'client preflight must pass the exact feature cost into the purchase popup');
assert.ok(app.includes('window.openPurchaseModal(requiredCreditCost);'), 'authoritative 402 generation path must pass its exact route cost into the purchase popup');
assert.ok(app.includes('window.openPurchaseModal(2);'), 'Maeve HTTP 402 path must pass the exact 2-credit cost into the purchase popup');
assert.ok(app.includes('Insufficient credits: you have '), 'purchase popup must render an explicit shortage explanation');
const appHtml = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');
assert.ok(appHtml.includes('id=\"purchaseCreditContext\"'), 'purchase modal must contain a dedicated live shortage-context element');

console.log('✔ Credit purchase-modal regression guard passed.');
