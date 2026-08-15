from pathlib import Path
import re

app_path = Path('app.js')
app = app_path.read_text(encoding='utf-8')

pattern = re.compile(
    r'''        // If credits unknown or loading, fetch now\n.*?        return true;\n    }\n    window\.hasSufficientCredits = hasSufficientCredits;''',
    re.S,
)
replacement = '''        // Browser credit state is display-only. The backend/Supabase reserve RPC is the sole
        // authority for whether a feature may spend credits. Never block a valid feature call
        // because the browser has a stale, loading, or temporarily unavailable balance.
        if (state.creditsStatus === "missing_profile") {
            if (typeof window.showToast === 'function') {
                window.showToast("Your account profile could not be loaded. Please contact support or try again later.", "warning");
            }
            return false;
        }

        // Refresh the badge opportunistically, but do not await or gate feature execution on it.
        if (typeof window.checkCreditBalance === 'function') {
            Promise.resolve(window.checkCreditBalance())
                .then(function () {
                    if (typeof window.updateButtonStates === 'function') window.updateButtonStates();
                })
                .catch(function () {});
        }

        // The request now proceeds to the unchanged server route, where reserve_credits atomically
        // enforces the exact feature cost and insufficient balances return HTTP 402.
        return true;
    }
    window.hasSufficientCredits = hasSufficientCredits;'''
app, count = pattern.subn(replacement, app, count=1)
if count != 1:
    raise SystemExit(f'hasSufficientCredits guarded replacement expected 1 match, found {count}')

old10 = '''            const isCreditsBlocked10 = !isAuth || isLocked || state.creditsStatus === "loading" || state.creditsStatus === "error" || state.creditsStatus === "missing_profile" || state.creditsStatus === "idle" || state.credits === null || (typeof state.credits === 'number' && state.credits < 10);'''
new10 = '''            const isCreditsBlocked10 = !isAuth || isLocked;'''
if app.count(old10) != 1:
    raise SystemExit(f'isCreditsBlocked10 expected 1 match, found {app.count(old10)}')
app = app.replace(old10, new10, 1)

old2 = '''            const isCreditsBlocked2 = !isAuth || isLocked || state.creditsStatus === "loading" || state.creditsStatus === "error" || state.creditsStatus === "missing_profile" || state.creditsStatus === "idle" || state.credits === null || (typeof state.credits === 'number' && state.credits < 2);'''
new2 = '''            const isCreditsBlocked2 = !isAuth || isLocked;'''
if app.count(old2) != 1:
    raise SystemExit(f'isCreditsBlocked2 expected 1 match, found {app.count(old2)}')
app = app.replace(old2, new2, 1)

app_path.write_text(app, encoding='utf-8')

test_path = Path('tests/server_authoritative_credit_gate.test.js')
test_path.write_text(r'''const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

assert.ok(app.includes('const isCreditsBlocked10 = !isAuth || isLocked;'), '10-credit UI controls must not be disabled by stale browser credit state');
assert.ok(app.includes('const isCreditsBlocked2 = !isAuth || isLocked;'), '2-credit UI controls must not be disabled by stale browser credit state');

const gateStart = app.indexOf('async function hasSufficientCredits(cost)');
const gateEnd = app.indexOf('window.hasSufficientCredits = hasSufficientCredits;', gateStart);
assert.ok(gateStart >= 0 && gateEnd > gateStart, 'hasSufficientCredits gate must exist');
const gate = app.slice(gateStart, gateEnd);
assert.ok(!gate.includes('state.credits < cost'), 'browser numeric balance must not be authoritative feature gate');
assert.ok(!gate.includes('openPurchaseModal'), 'preflight gate must never open purchase modal');
assert.ok(gate.includes('The request now proceeds to the unchanged server route'), 'gate must explicitly defer spending authority to backend');

assert.ok(server.includes("verifyAndDeductCreditsDB(req, 10, 'analyze', reqId)"), 'Analyzer must remain 10 credits server-side');
assert.ok(server.includes("verifyAndDeductCreditsDB(req, 10, 'icebreaker', reqId)"), 'Icebreaker must remain 10 credits server-side');
assert.ok(server.includes("verifyAndDeductCreditsDB(req, 10, 'optimize', reqId)"), 'Bio Optimizer must remain 10 credits server-side');
assert.ok(server.includes("verifyAndDeductCreditsDB(req, 2, 'chat', reqId)"), 'Practice Chat must remain 2 credits server-side');
assert.ok(server.includes("verifyAndDeductCreditsDB(req, 2, 'simulator_review', reqId)"), 'Simulator Review must remain 2 credits server-side');

assert.ok(server.includes("const model = isVisionStage ? 'qwen/qwen3.5-flash-02-23' : 'qwen/qwen3-235b-a22b-2507';"), 'Screenshot Analyzer models must remain unchanged');
assert.ok(server.includes("const baseUrl = 'https://api.aicredits.in/v1';"), 'Screenshot Analyzer provider must remain unchanged');

for (const endpoint of ['/api/analyze', '/api/icebreaker', '/api/optimize', '/api/chat']) {
    assert.ok(app.includes(endpoint), `Frontend feature endpoint must remain present: ${endpoint}`);
}

console.log('✔ Server-authoritative credit gate + feature preservation regression passed.');
''', encoding='utf-8')

runner_path = Path('tests/run_all_tests.js')
runner = runner_path.read_text(encoding='utf-8')
old_tail = "    { name: '23. Headless Browser Live Viewport Overflow QA', file: 'browser_viewport_live_qa.js' }\n];"
new_tail = "    { name: '23. Headless Browser Live Viewport Overflow QA', file: 'browser_viewport_live_qa.js' },\n    { name: '24. Server-Authoritative Credit Gate & Feature Preservation', file: 'server_authoritative_credit_gate.test.js' }\n];"
if runner.count(old_tail) != 1:
    raise SystemExit(f'test runner tail expected 1 match, found {runner.count(old_tail)}')
runner = runner.replace(old_tail, new_tail, 1)
runner_path.write_text(runner, encoding='utf-8')

print('Server-authoritative credit gate patch applied without touching feature/backend code.')
