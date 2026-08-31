const assert = require('assert');
const fs = require('fs');
process.env.NODE_ENV = 'test';
process.env.AICREDITS_API_KEY = 'unit-test-main-key';
delete process.env.AICREDITS_API_KEY_GENERAL;

const serverSource = fs.readFileSync('server.js', 'utf8');
const appSource = fs.readFileSync('app.js', 'utf8');
assert(serverSource.includes('const lockState = acquireUserConcurrencyLock(uid, reqId);'));
assert(serverSource.includes('releaseUserConcurrencyLock(uid, reqId);'));
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
