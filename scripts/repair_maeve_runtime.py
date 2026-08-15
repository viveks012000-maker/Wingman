from pathlib import Path

server_path = Path('server.js')
app_path = Path('app.js')
runner_path = Path('tests/run_all_tests.js')
server = server_path.read_text(encoding='utf-8')
app = app_path.read_text(encoding='utf-8')
runner = runner_path.read_text(encoding='utf-8')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Missing expected source block: {label}')
    return text.replace(old, new, 1)

# -----------------------------------------------------------------------------
# 1. Maeve: strict AICredits text-provider path + transient retries
# -----------------------------------------------------------------------------
provider_marker = '// Helper function to query OpenRouter dynamically with automatic key failover\n'
if provider_marker not in server:
    raise SystemExit('Missing provider insertion marker')

provider_helper = r'''// Strict Maeve provider path: exact AICredits endpoint/model with bounded transient retry.
// This keeps Maeve on the proven main text-provider path and never falls back to the vision key.
function getMaeveProviderFailureCode(error) {
    const status = Number(error && error.statusCode);
    if (error && error.isTimeout) return 'AI_PROVIDER_TIMEOUT';
    if (status === 401 || status === 403) return 'AI_PROVIDER_AUTH';
    if (status === 402) return 'AI_PROVIDER_BUDGET';
    if (status === 429) return 'AI_PROVIDER_RATE_LIMIT';
    if ([500, 502, 503, 504].includes(status)) return 'AI_PROVIDER_UPSTREAM';
    if (error && error.code === 'AI_PROVIDER_EMPTY_RESPONSE') return 'AI_PROVIDER_EMPTY_RESPONSE';
    if (error && error.code === 'AI_PROVIDER_CONFIG') return 'AI_PROVIDER_CONFIG';
    return 'AI_PROVIDER_FAILURE';
}

async function queryMaeveProvider(messagesArray, temperature = 0.7, maxTokens = 120, timeoutMs = 25000) {
    const keysToTry = [...new Set([
        process.env.AICREDITS_API_KEY_GENERAL,
        process.env.AICREDITS_API_KEY
    ].filter(Boolean))];
    const model = 'qwen/qwen3-235b-a22b-2507';
    const baseUrl = 'https://api.aicredits.in/v1';

    if (keysToTry.length === 0) {
        const err = new Error('Maeve provider key is not configured.');
        err.code = 'AI_PROVIDER_CONFIG';
        throw err;
    }

    const retryableStatuses = new Set([429, 500, 502, 503, 504]);
    let lastError = null;

    for (const apiKey of keysToTry) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            const controller = new AbortController();
            const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
            try {
                const response = await fetch(baseUrl + '/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://mywingman.com',
                        'X-Title': 'My Wingman App'
                    },
                    body: JSON.stringify({
                        model,
                        messages: messagesArray,
                        temperature,
                        max_tokens: maxTokens
                    }),
                    signal: controller.signal
                });

                if (!response.ok) {
                    const err = new Error(`Maeve provider request failed with HTTP ${response.status}.`);
                    err.statusCode = response.status;
                    lastError = err;
                    if (retryableStatuses.has(response.status) && attempt < 3) {
                        await new Promise(resolve => setTimeout(resolve, 300 * attempt));
                        continue;
                    }
                    break;
                }

                const data = await response.json();
                if (data && data.error) {
                    const err = new Error('Maeve provider returned an API error.');
                    err.statusCode = Number(data.error.status || data.error.code) || 502;
                    lastError = err;
                    if (retryableStatuses.has(err.statusCode) && attempt < 3) {
                        await new Promise(resolve => setTimeout(resolve, 300 * attempt));
                        continue;
                    }
                    break;
                }

                const msg = data && Array.isArray(data.choices) && data.choices[0] ? data.choices[0].message : null;
                const output = typeof msg === 'string' ? msg : (msg ? (msg.content || msg.reasoning || '') : '');
                if (!output || !String(output).trim()) {
                    const err = new Error('Maeve provider returned empty output.');
                    err.code = 'AI_PROVIDER_EMPTY_RESPONSE';
                    err.statusCode = 502;
                    lastError = err;
                    if (attempt < 2) {
                        await new Promise(resolve => setTimeout(resolve, 250));
                        continue;
                    }
                    break;
                }

                return String(output).trim();
            } catch (err) {
                if (err && err.name === 'AbortError') {
                    const timeoutErr = new Error('Maeve provider timed out.');
                    timeoutErr.isTimeout = true;
                    timeoutErr.statusCode = 504;
                    lastError = timeoutErr;
                    if (attempt < 3) {
                        await new Promise(resolve => setTimeout(resolve, 300 * attempt));
                        continue;
                    }
                    break;
                }

                lastError = err;
                if (attempt < 3 && (!err || !err.statusCode || retryableStatuses.has(Number(err.statusCode)))) {
                    await new Promise(resolve => setTimeout(resolve, 300 * attempt));
                    continue;
                }
                break;
            } finally {
                if (timer) clearTimeout(timer);
            }
        }
    }

    throw lastError || new Error('Maeve provider is unavailable.');
}

'''

if 'async function queryMaeveProvider(' not in server:
    server = server.replace(provider_marker, provider_helper + provider_marker, 1)

server = replace_once(
    server,
    "app.post(['/api/chat', '/api/simulator/chat'], requireSupabaseAuth, requireActiveConsent, apiLimiter, async (req, res) => {\n    const reqId = req.headers['x-idempotency-key']",
    "app.post(['/api/chat', '/api/simulator/chat'], requireSupabaseAuth, requireActiveConsent, apiLimiter, async (req, res) => {\n    const uid = getUserIdFromReq(req);\n    if (!acquireUserConcurrencyLock(uid)) {\n        return res.status(429).json({ success: false, error: \"A generation is already in progress for your account. Please wait for it to complete.\" });\n    }\n    const reqId = req.headers['x-idempotency-key']",
    'Maeve concurrency route header'
)
server = replace_once(
    server,
    'let hotlineAdvice = await queryOpenRouter("qwen3-235b-a22b-2507", hotlinePayload, 0.7, 1500);',
    'let hotlineAdvice = await queryMaeveProvider(hotlinePayload, 0.7, 1500);',
    'Maeve hotline provider call'
)
server = replace_once(
    server,
    'let replyText = await queryOpenRouter("qwen3-235b-a22b-2507", openRouterMessages, 0.6, 120);',
    'let replyText = await queryMaeveProvider(openRouterMessages, 0.6, 120);',
    'Maeve roleplay provider call'
)
server = replace_once(
    server,
    '''        res.status(500).json({
            success: false,
            error: "Maeve AI Coach failed to respond. Your credits were restored.",
            credits: currentBal
        });''',
    '''        const providerCode = getMaeveProviderFailureCode(error);
        res.status(500).json({
            success: false,
            error: "Maeve AI Coach failed to respond. Your credits were restored.",
            code: providerCode,
            credits: currentBal
        });''',
    'Maeve safe provider diagnostic response'
)
server = replace_once(
    server,
    'module.exports = { app, startWingmanServer, supabaseAdmin };',
    'module.exports = { app, startWingmanServer, supabaseAdmin, queryMaeveProvider, getMaeveProviderFailureCode };',
    'server test exports'
)

# -----------------------------------------------------------------------------
# 2. Local preparation stays usable before authentication/credits/consent.
#    Backend submission checks remain authoritative.
# -----------------------------------------------------------------------------
app = replace_once(
    app,
    '''    window.updateTermsLockState = function () {
        try {
            const isLocked = !state.isTermsAccepted;''',
    '''    window.updateTermsLockState = function () {
        try {
            const isLocked = !state.isTermsAccepted;
            const isBusy = !!state.isLoading;''',
    'terms lock header'
)
app = replace_once(
    app,
    '''            if (dz) {
                dz.classList.toggle("opacity-40", isLocked);
                dz.classList.toggle("cursor-not-allowed", isLocked);
            }
            if (si) si.disabled = isLocked;''',
    '''            // Local preparation is allowed before login/consent; nothing is sent until submit preflight passes.
            if (dz) {
                dz.classList.remove("opacity-40", "cursor-not-allowed");
                dz.classList.toggle("pointer-events-none", isBusy);
                dz.classList.toggle("opacity-60", isBusy);
            }
            if (si) si.disabled = isBusy;''',
    'screenshot preparation lock'
)
app = app.replace('if (si && state.isTermsAccepted) si.disabled = false;', 'if (si && !state.isLoading) si.disabled = false;')

app = replace_once(app, 'const isBtn2Disabled = isLocked || !isBioValid || isLoading || isCreditsBlocked10;', 'const isBtn2Disabled = !isBioValid || isLoading;', 'Icebreaker button gate')
app = replace_once(app, 'btn2.classList.toggle("opacity-40", isLocked || !isBioValid || isCreditsBlocked10);', 'btn2.classList.toggle("opacity-40", !isBioValid);', 'Icebreaker opacity gate')
app = replace_once(app, 'const isBtn3Disabled = isLocked || !isAuditValid || isLoading || isCreditsBlocked10;', 'const isBtn3Disabled = !isAuditValid || isLoading;', 'Bio button gate')
app = replace_once(app, 'btn3.classList.toggle("opacity-40", isLocked || !isAuditValid || isCreditsBlocked10);', 'btn3.classList.toggle("opacity-40", !isAuditValid);', 'Bio opacity gate')
app = replace_once(app, 'const enabled = hasScreenshot && withinLimit && notLoading && !isCreditsBlocked10;', 'const enabled = hasScreenshot && withinLimit && notLoading;', 'Analyzer button gate')
app = replace_once(app, 'btn1.classList.toggle("opacity-40", !hasScreenshot || !withinLimit || isCreditsBlocked10);', 'btn1.classList.toggle("opacity-40", !hasScreenshot || !withinLimit);', 'Analyzer opacity gate')

# Strong visual state for Send; message entry remains available until a request is actually busy.
app = replace_once(
    app,
    '''            const chatSendBtn = $("chatbox-send-btn");
            if (chatSendBtn) {
                const isChatDisabled = isLoading || !(ci && ci.value.trim().length > 0);
                chatSendBtn.disabled = isChatDisabled;
                chatSendBtn.classList.toggle("opacity-40", isChatDisabled);
                chatSendBtn.classList.toggle("cursor-not-allowed", isChatDisabled);
                chatSendBtn.classList.toggle("cursor-pointer", !isChatDisabled);
            }''',
    '''            const chatSendBtn = $("chatbox-send-btn");
            if (chatSendBtn) {
                const hasChatText = Boolean(ci && ci.value.trim().length > 0);
                const isChatDisabled = isLoading || !hasChatText;
                chatSendBtn.disabled = isChatDisabled;
                chatSendBtn.setAttribute("aria-disabled", isChatDisabled ? "true" : "false");
                chatSendBtn.classList.toggle("opacity-40", isChatDisabled);
                chatSendBtn.classList.toggle("cursor-not-allowed", isChatDisabled);
                chatSendBtn.classList.toggle("cursor-pointer", !isChatDisabled);
                chatSendBtn.classList.toggle("chat-send-active", !isChatDisabled);
                chatSendBtn.style.setProperty("opacity", isChatDisabled ? "0.4" : "1", "important");
                chatSendBtn.style.setProperty("filter", isChatDisabled ? "saturate(0.65)" : "saturate(1.15)", "important");
                chatSendBtn.style.setProperty("transform", isChatDisabled ? "none" : "translateY(-1px)", "important");
                chatSendBtn.style.setProperty("box-shadow", isChatDisabled ? "none" : "0 8px 24px rgba(168, 85, 247, 0.58)", "important");
            }''',
    'chat send button visual state'
)

# Sample bio is local-only preparation and must not require legal consent.
app = replace_once(
    app,
    '''    window.loadPresetBio = function(btn) {
        if (!state.isTermsAccepted) {
            window.highlightTermsCheckbox();
            window.showToast("Please agree to the Terms of Service & Privacy Protocol box first!", "warning");
            return;
        }
        const bi = $("bioInput");''',
    '''    window.loadPresetBio = function(btn) {
        const bi = $("bioInput");''',
    'local preset bio consent gate'
)

# -----------------------------------------------------------------------------
# 3. Preflight order: valid local input -> auth -> authoritative balance -> consent -> AI.
# -----------------------------------------------------------------------------
old_consent = '''        if (!state.isTermsAccepted) {
            window.highlightTermsCheckbox();
            window.showToast("Please agree to the Terms of Service & Privacy Protocol box first!", "warning");
            return;
        }

'''
new_consent = '''        if (!state.isTermsAccepted) {
            window.highlightTermsCheckbox();
            if (typeof window.openInterstitialModal === 'function') window.openInterstitialModal();
            window.showToast("18+ verification and consent are required before AI processing.", "warning");
            return;
        }

'''

# Analyzer early consent removal.
app = replace_once(
    app,
    '''        if (state.isLoading) return;
        if (!state.isTermsAccepted) {
            window.highlightTermsCheckbox();
            window.showToast("Please agree to the Terms of Service & Privacy Protocol box first!", "warning");
            return;
        }

        const useCache = (state.activeTranscriptCache && state.uploadedFiles.length === 0);''',
    '''        if (state.isLoading) return;

        const useCache = (state.activeTranscriptCache && state.uploadedFiles.length === 0);''',
    'Analyzer early consent gate'
)
app = replace_once(
    app,
    '''        if (!(await hasSufficientCredits(10))) return;

        state.isLoading = true;
        setButtonLoadingState("runAnalysisBtn", true, "Analyzing Context...", "Generate Perfect Replies");''',
    '''        if (!(await hasSufficientCredits(10))) return;

''' + new_consent + '''        state.isLoading = true;
        setButtonLoadingState("runAnalysisBtn", true, "Analyzing Context...", "Generate Perfect Replies");''',
    'Analyzer consent after auth/credits'
)

# Icebreaker and Bio: remove the first consent block inside each function and reinsert after credit preflight.
for fn_name, loading_block in [
    ('window.generateIcebreaker = async function', '''        state.isLoading = true;
        setButtonLoadingState("generateIcebreakerBtn", true, "Crafting Openers...", "Generate Icebreaker");'''),
    ('window.runAudit = async function', '''        state.isLoading = true;
        setButtonLoadingState("runAuditBtn", true, "Optimizing Bio...", "Optimize My Bio");''')
]:
    start = app.find(fn_name)
    if start < 0:
        raise SystemExit(f'Missing {fn_name}')
    consent_pos = app.find(old_consent, start)
    if consent_pos < 0:
        raise SystemExit(f'Missing early consent block in {fn_name}')
    app = app[:consent_pos] + app[consent_pos + len(old_consent):]
    start = app.find(fn_name)
    target = '        if (!(await hasSufficientCredits(10))) return;\n\n' + loading_block
    pos = app.find(target, start)
    if pos < 0:
        raise SystemExit(f'Missing credit insertion point in {fn_name}')
    replacement = '        if (!(await hasSufficientCredits(10))) return;\n\n' + new_consent + loading_block
    app = app[:pos] + replacement + app[pos + len(target):]

# Chat gets the same exact preflight ordering before its message is appended/rendered.
app = replace_once(
    app,
    '''        if (!(await hasSufficientCredits(2))) return;

        const sendBtn = $("chatbox-send-btn");''',
    '''        if (!(await hasSufficientCredits(2))) return;

''' + new_consent + '''        const sendBtn = $("chatbox-send-btn");''',
    'Chat consent after auth/credits'
)

# -----------------------------------------------------------------------------
# 4. Dedicated regression tests and canonical runner registration
# -----------------------------------------------------------------------------
maeve_test = r'''const assert = require('assert');
const fs = require('fs');
process.env.NODE_ENV = 'test';
process.env.AICREDITS_API_KEY = 'unit-test-main-key';
delete process.env.AICREDITS_API_KEY_GENERAL;

const serverSource = fs.readFileSync('server.js', 'utf8');
const appSource = fs.readFileSync('app.js', 'utf8');
assert(serverSource.includes("const uid = getUserIdFromReq(req);\n    if (!acquireUserConcurrencyLock(uid))"));
assert(serverSource.includes('queryMaeveProvider(hotlinePayload, 0.7, 1500)'));
assert(serverSource.includes('queryMaeveProvider(openRouterMessages, 0.6, 120)'));
assert(serverSource.includes("const model = 'qwen/qwen3-235b-a22b-2507';"));
assert(serverSource.includes("const baseUrl = 'https://api.aicredits.in/v1';"));
assert(serverSource.includes('code: providerCode'));
assert(appSource.includes('chatSendBtn.classList.toggle("chat-send-active", !isChatDisabled)'));

const originalFetch = global.fetch;
const { queryMaeveProvider, getMaeveProviderFailureCode } = require('../server');
(async () => {
    let calls = 0;
    global.fetch = async (url, options) => {
        calls++;
        assert.strictEqual(url, 'https://api.aicredits.in/v1/chat/completions');
        const payload = JSON.parse(options.body);
        assert.strictEqual(payload.model, 'qwen/qwen3-235b-a22b-2507');
        assert.strictEqual(options.headers.Authorization, 'Bearer unit-test-main-key');
        if (calls === 1) return new Response('temporary', { status: 503 });
        return new Response(JSON.stringify({ choices: [{ message: { content: 'working reply' } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    };
    const result = await queryMaeveProvider([{ role: 'user', content: 'hi' }], 0.6, 120, 2000);
    assert.strictEqual(result, 'working reply');
    assert.strictEqual(calls, 2, '503 must retry and then succeed');
    assert.strictEqual(getMaeveProviderFailureCode({ statusCode: 402 }), 'AI_PROVIDER_BUDGET');
    assert.strictEqual(getMaeveProviderFailureCode({ statusCode: 429 }), 'AI_PROVIDER_RATE_LIMIT');
    assert.strictEqual(getMaeveProviderFailureCode({ isTimeout: true }), 'AI_PROVIDER_TIMEOUT');
    console.log('Maeve runtime repair guard passed.');
})().catch(err => {
    console.error(err);
    process.exitCode = 1;
}).finally(() => {
    global.fetch = originalFetch;
});
'''
Path('tests/maeve_runtime_repair.test.js').write_text(maeve_test, encoding='utf-8')

preflight_test = r'''const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync('app.js', 'utf8');

assert(src.includes('const isBtn2Disabled = !isBioValid || isLoading;'));
assert(src.includes('const isBtn3Disabled = !isAuditValid || isLoading;'));
assert(src.includes('const enabled = hasScreenshot && withinLimit && notLoading;'));
assert(!src.includes('if (si) si.disabled = isLocked;'));
assert(src.includes('if (si) si.disabled = isBusy;'));
assert(src.includes('chatSendBtn.style.setProperty("opacity", isChatDisabled ? "0.4" : "1", "important")'));

const authMessage = src.indexOf('Authentication required to use AI features. Please sign in.');
const authModal = src.indexOf('window.openAuthRequiredModal()', authMessage);
assert(authMessage >= 0 && authModal > authMessage, 'Logged-out users must receive sign-in UI');
const insufficient = src.indexOf('Insufficient credits. Current balance: ');
const purchase = src.indexOf('window.openPurchaseModal()', insufficient);
assert(insufficient >= 0 && purchase > insufficient, 'Insufficient-credit users must receive exact balance + purchase UI');

for (const fn of [
    'window.runAnalysis = async function',
    'window.generateIcebreaker = async function',
    'window.runAudit = async function',
    'window.submitChatboxMessage = async function'
]) {
    const start = src.indexOf(fn);
    assert(start >= 0, fn + ' missing');
    const next = src.indexOf('\n    window.', start + fn.length);
    const section = src.slice(start, next > start ? next : start + 16000);
    const credit = section.indexOf('await hasSufficientCredits(');
    const consent = section.indexOf('18+ verification and consent are required before AI processing.');
    assert(credit >= 0, fn + ' must invoke auth/credit preflight');
    assert(consent > credit, fn + ' must report auth/credit before consent');
}
console.log('Feature access preflight UX guard passed.');
'''
Path('tests/feature_access_preflight.test.js').write_text(preflight_test, encoding='utf-8')

runner_marker = "    { name: '33. Netlify Release Manifest Source-Commit Truth Guard', file: 'release_manifest_source.test.js' }\n];"
runner_replacement = "    { name: '33. Netlify Release Manifest Source-Commit Truth Guard', file: 'release_manifest_source.test.js' },\n    { name: '34. Maeve Provider Runtime & Retry Guard', file: 'maeve_runtime_repair.test.js' },\n    { name: '35. Feature Access Preflight UX Guard', file: 'feature_access_preflight.test.js' }\n];"
if runner_marker not in runner:
    raise SystemExit('Missing canonical test runner marker')
runner = runner.replace(runner_marker, runner_replacement, 1)

server_path.write_text(server, encoding='utf-8')
app_path.write_text(app, encoding='utf-8')
runner_path.write_text(runner, encoding='utf-8')
print('Guarded source transformation completed.')
