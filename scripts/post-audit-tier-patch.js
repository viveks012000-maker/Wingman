const fs = require('fs');

const appPath = 'app.js';
let app = fs.readFileSync(appPath, 'utf8');
const start = app.indexOf('            if (creditMap[tier]) {');
const endMarker = '        } catch (e) {';
const end = app.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('Tier activation block not found');
const before = app.slice(0, start);
const after = app.slice(end);
const replacement = `            if (creditMap[tier]) {
                // Payment processing is intentionally fail-closed. A tier query parameter
                // must never imply that credits were purchased or minted.
                window.simulateDemoPurchase(creditMap[tier]);

                // Remove the stale checkout parameter so refresh/back navigation cannot
                // repeatedly trigger purchase messaging.
                const cleanUrl = new URL(window.location.href);
                cleanUrl.searchParams.delete("tier");
                window.history.replaceState({}, document.title, cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
            }
`;
app = before + replacement + after;
if (app.includes('title.textContent = creditMap[tier] + " Credits Added"')) throw new Error('False Credits Added claim still present');
fs.writeFileSync(appPath, app);

const testPath = 'tests/credit_purchase_modal_regression.test.js';
let test = fs.readFileSync(testPath, 'utf8');
const anchor = "assert.ok(app.includes('currentBatchBytes > 25 * 1024 * 1024'), 'client screenshot total limit must match 25 MB invariant');\n";
if (!test.includes(anchor)) throw new Error('Test anchor not found');
if (!test.includes('tier URL must never falsely claim')) {
  test = test.replace(anchor, anchor +
    "assert.ok(!app.includes('title.textContent = creditMap[tier] + \\\" Credits Added\\\"'), 'tier URL must never falsely claim that credits were added while payments are fail-closed');\n" +
    "assert.ok(app.includes('cleanUrl.searchParams.delete(\\\"tier\\\")'), 'tier URL must be cleared after the unavailable-purchase notice');\n");
}
fs.writeFileSync(testPath, test);
console.log('Patched tier URL behavior and regression test.');
