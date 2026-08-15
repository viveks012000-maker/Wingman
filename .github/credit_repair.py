from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


app_path = Path("app.js")
app = app_path.read_text(encoding="utf-8")

app = replace_once(
    app,
    '''        // Authoritative numeric balance is confirmed
        if (state.credits < cost) {
            if (typeof window.showToast === 'function') {
                window.showToast("Insufficient credits. Current balance: " + state.credits + " credits. Please top up.", "warning");
            }
            if (typeof window.openPurchaseModal === 'function') {
                window.openPurchaseModal();
            }
            return false;
        }

        return true;''',
    '''        // Never trust a previously cached low numeric balance as sufficient evidence to sell credits.
        // A fresh authoritative balance check is mandatory immediately before opening the purchase UI.
        if (state.credits < cost) {
            const freshCreditCheck = await window.checkCreditBalance();
            if (!freshCreditCheck || !freshCreditCheck.success || typeof state.credits !== 'number') {
                if (typeof window.showToast === 'function') {
                    window.showToast("Unable to verify your current credit balance. Please retry after your account syncs.", "warning");
                }
                return false;
            }
            if (state.credits < cost) {
                if (typeof window.showToast === 'function') {
                    window.showToast("Insufficient credits. Current balance: " + state.credits + " credits. Please top up.", "warning");
                }
                if (typeof window.openPurchaseModal === 'function') {
                    window.openPurchaseModal();
                }
                return false;
            }
        }

        return true;''',
    "fresh balance before purchase modal",
)

app = replace_once(
    app,
    '''                    if (response.status === 401) {
                        window.updateUICredits(0);
                        if (typeof window.showToast === 'function') window.showToast("Authentication required. Please sign in.", "warning");''',
    '''                    if (response.status === 401) {
                        // Authentication failure does NOT mean the user's real wallet balance is zero.
                        state.credits = null;
                        state.creditsStatus = "idle";
                        if (typeof window.updateButtonStates === 'function') window.updateButtonStates();
                        if (typeof window.showToast === 'function') window.showToast("Authentication required. Please sign in.", "warning");''',
    "401 must not cache zero credits",
)

app = replace_once(
    app,
    '''                    if (response.status === 402) {
                        trackWingmanEvent('credits_exhausted', { endpoint: endpoint, currentCredits: state.credits || 0 });
                        await window.checkCreditBalance();
                        if (typeof window.showToast === 'function') {
                            window.showToast(errJson.error || ("Insufficient credits. Current balance: " + (state.credits || 0) + " credits. Please top up."), "warning");
                        }
                        if (typeof window.openPurchaseModal === 'function') window.openPurchaseModal();
                        return null;
                    }''',
    '''                    if (response.status === 402) {
                        trackWingmanEvent('credits_exhausted', { endpoint: endpoint, currentCredits: state.credits || 0 });
                        const requiredCreditCost = (endpoint === '/api/chat' || endpoint === '/api/simulator/chat' || endpoint === '/api/simulator/review') ? 2 : 10;
                        const authoritativeBalanceCheck = await window.checkCreditBalance();
                        if (!authoritativeBalanceCheck || !authoritativeBalanceCheck.success || typeof state.credits !== 'number') {
                            if (typeof window.showToast === 'function') {
                                window.showToast("The server rejected this request for credits, but your current wallet balance could not be verified. Please refresh or sign in again.", "warning");
                            }
                            return null;
                        }
                        if (state.credits >= requiredCreditCost) {
                            if (typeof window.showToast === 'function') {
                                window.showToast("Your wallet has enough credits, but this request was rejected by the credit service. Please refresh or sign in again; no purchase is required.", "warning");
                            }
                            return null;
                        }
                        if (typeof window.showToast === 'function') {
                            window.showToast(errJson.error || ("Insufficient credits. Current balance: " + state.credits + " credits. Please top up."), "warning");
                        }
                        if (typeof window.openPurchaseModal === 'function') window.openPurchaseModal();
                        return null;
                    }''',
    "generation 402 authoritative recheck",
)

app = replace_once(
    app,
    '''            } else if (chatResp.status === 402) {
                window.renderChatboxBubble("⚠️ Insufficient credits. Please top up credits to continue practicing.", "assistant");
                if (typeof window.openPurchaseModal === 'function') window.openPurchaseModal();
            } else {''',
    '''            } else if (chatResp.status === 402) {
                const errJson = await chatResp.json().catch(() => ({}));
                const authoritativeChatBalance = await window.checkCreditBalance();
                if (!authoritativeChatBalance || !authoritativeChatBalance.success || typeof state.credits !== 'number') {
                    window.renderChatboxBubble("The credit service rejected this message, but your wallet could not be verified. Please refresh or sign in again.", "assistant");
                } else if (state.credits >= 2) {
                    window.renderChatboxBubble("Your wallet has enough credits, but this message was rejected by the credit service. Please refresh or sign in again; no purchase is required.", "assistant");
                } else {
                    window.renderChatboxBubble(errJson.error || "⚠️ Insufficient credits. Please top up credits to continue practicing.", "assistant");
                    if (typeof window.openPurchaseModal === 'function') window.openPurchaseModal();
                }
            } else {''',
    "chat 402 authoritative recheck",
)

app = replace_once(
    app,
    '        if (currentBatchBytes > 20 * 1024 * 1024) {\n            window.showToast("These images are too large. Maximum total upload size: 20 MB.", "warning");',
    '        if (currentBatchBytes > 25 * 1024 * 1024) {\n            window.showToast("These images are too large. Maximum total upload size: 25 MB.", "warning");',
    "client screenshot total limit alignment",
)

app_path.write_text(app, encoding="utf-8")

server_path = Path("server.js")
server = server_path.read_text(encoding="utf-8")

server = replace_once(
    server,
    '''            if (error) {
                console.error('[settleCreditsDB RPC Error]:', error.message);
                return { success: false, error: error.message };
            }
            return { success: true, data };''',
    '''            if (error) {
                console.error('[settleCreditsDB RPC Error]:', error.message);
                return { success: false, error: error.message };
            }
            const row = Array.isArray(data) ? data[0] : data;
            if (!row || row.success !== true || row.settled !== true) {
                return { success: false, error: (row && row.error_message) || 'Credit settlement did not complete a pending transaction.' };
            }
            return { success: true, data: row };''',
    "settle RPC semantic validation",
)

server = replace_once(
    server,
    '''            if (!rpcErr && rpcRes) {
                const row = Array.isArray(rpcRes) ? rpcRes[0] : rpcRes;
                const rem = typeof row.new_balance === 'number' ? row.new_balance : (typeof row.remainingCredits === 'number' ? row.remainingCredits : 0);
                return { success: true, remainingCredits: rem };
            }
        }
    } catch (e) {
        console.error('[releaseCreditsDB Exception]:', e.message);
    }
    return { success: false, remainingCredits: 0 };''',
    '''            if (rpcErr) {
                console.error('[releaseCreditsDB RPC Error]:', rpcErr.message);
                return { success: false, remainingCredits: 0, error: rpcErr.message };
            }
            if (rpcRes) {
                const row = Array.isArray(rpcRes) ? rpcRes[0] : rpcRes;
                if (!row || row.success !== true) {
                    return { success: false, remainingCredits: 0, error: (row && row.error_message) || 'Credit release was rejected.' };
                }
                const rem = typeof row.new_balance === 'number' ? row.new_balance : (typeof row.remainingCredits === 'number' ? row.remainingCredits : 0);
                return { success: true, remainingCredits: rem };
            }
        }
    } catch (e) {
        console.error('[releaseCreditsDB Exception]:', e.message);
        return { success: false, remainingCredits: 0, error: e.message };
    }
    return { success: false, remainingCredits: 0, error: 'Credit release service returned no response.' };''',
    "release RPC semantic validation",
)

server = replace_once(
    server,
    '        res.status(500).json({ success: false, error: "Failed to fetch credit balance." });',
    '''        if (err.statusCode === 503) {
            return res.status(503).json({ success: false, error: "Credit service temporarily unavailable." });
        }
        res.status(500).json({ success: false, error: "Failed to fetch credit balance." });''',
    "credits endpoint preserve 503",
)

server = replace_once(
    server,
    '        res.status(500).json({ success: false, error: "Failed to verify credit balance." });',
    '''        if (err.statusCode === 503) {
            return res.status(503).json({ success: false, error: "Credit service temporarily unavailable." });
        }
        res.status(500).json({ success: false, error: "Failed to verify credit balance." });''',
    "credits verify preserve 503",
)

server_path.write_text(server, encoding="utf-8")

Path("tests/credit_purchase_modal_regression.test.js").write_text(
    '''const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

assert.ok(!app.includes('if (response.status === 401) {\\n                        window.updateUICredits(0);'), '401 must never convert authentication failure into a loaded zero-credit wallet');
assert.ok(app.includes('const freshCreditCheck = await window.checkCreditBalance();'), 'purchase gate must fresh-check wallet before opening purchase UI');
assert.ok(app.includes('const authoritativeBalanceCheck = await window.checkCreditBalance();'), 'HTTP 402 generation path must independently re-sync authoritative credits');
assert.ok(app.includes('if (state.credits >= requiredCreditCost)'), 'HTTP 402 must suppress purchase UI when fresh wallet has enough credits');
assert.ok(app.includes('const authoritativeChatBalance = await window.checkCreditBalance();'), 'chat HTTP 402 must re-sync authoritative credits');
assert.ok(app.includes('state.credits >= 2'), 'chat purchase UI must require a verified balance below the 2-credit threshold');
assert.ok(server.includes("row.success !== true || row.settled !== true"), 'settle helper must reject a semantic settled:false response');
assert.ok(server.includes("if (!row || row.success !== true)"), 'release helper must reject semantic RPC failures');
assert.ok((server.match(/err\\.statusCode === 503/g) || []).length >= 2, 'credit balance endpoints must preserve HTTP 503 service-unavailable semantics');
assert.ok(app.includes('currentBatchBytes > 25 * 1024 * 1024'), 'client screenshot total limit must match 25 MB invariant');

console.log('✔ Credit purchase-modal regression guard passed.');
''',
    encoding="utf-8",
)

runner_path = Path("tests/run_all_tests.js")
runner = runner_path.read_text(encoding="utf-8")
marker = "    { name: '21. Mobile Responsiveness & Viewport Audit', file: 'viewport_overflow_qa.test.js' },"
if "credit_purchase_modal_regression.test.js" not in runner:
    if marker not in runner:
        raise SystemExit("test runner insertion marker not found")
    runner = runner.replace(
        marker,
        "    { name: '21. Credit/Purchase Modal Regression Guard', file: 'credit_purchase_modal_regression.test.js' },\n    { name: '22. Mobile Responsiveness & Viewport Audit', file: 'viewport_overflow_qa.test.js' },",
    )
    runner = runner.replace(
        "{ name: '22. Headless Browser Live Viewport Overflow QA'",
        "{ name: '23. Headless Browser Live Viewport Overflow QA'",
    )
runner_path.write_text(runner, encoding="utf-8")

print("Guarded credit-state repair applied successfully.")
