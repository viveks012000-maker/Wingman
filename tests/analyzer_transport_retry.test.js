'use strict';

const assert = require('assert');
const {
    ANALYZER_ENDPOINT,
    ANALYZER_VISION_MODEL,
    createAnalyzerRetryFetch,
    isAnalyzerVisionRequest
} = require('../middleware/analyzerTransportRetry');

function makeResponse(status, body = '') {
    let drained = false;
    return {
        status,
        ok: status >= 200 && status < 300,
        async arrayBuffer() {
            drained = true;
            return Buffer.from(body);
        },
        async text() {
            drained = true;
            return body;
        },
        get drained() {
            return drained;
        }
    };
}

function visionInit(extra = {}) {
    return {
        method: 'POST',
        headers: {
            Authorization: 'Bearer test-vision-key',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: ANALYZER_VISION_MODEL, messages: [{ role: 'user', content: 'x' }] }),
        ...extra
    };
}

async function run() {
    assert.strictEqual(isAnalyzerVisionRequest(ANALYZER_ENDPOINT, visionInit()), true, 'exact Analyzer vision request must be recognized');
    assert.strictEqual(isAnalyzerVisionRequest(ANALYZER_ENDPOINT, { ...visionInit(), body: JSON.stringify({ model: 'qwen/qwen3-235b-a22b-2507' }) }), false, 'text model must not be intercepted');
    assert.strictEqual(isAnalyzerVisionRequest('https://example.com/chat/completions', visionInit()), false, 'other endpoints must not be intercepted');

    {
        let calls = 0;
        let seenAuth = null;
        const delays = [];
        const wrapped = createAnalyzerRetryFetch(async (_url, init) => {
            calls += 1;
            seenAuth = init.headers.Authorization;
            if (calls === 1) throw new TypeError('fetch failed');
            return makeResponse(200, 'ok');
        }, { sleep: async ms => { delays.push(ms); } });
        const response = await wrapped(ANALYZER_ENDPOINT, visionInit());
        assert.strictEqual(response.status, 200);
        assert.strictEqual(calls, 2, 'one transient network failure must retry once');
        assert.strictEqual(seenAuth, 'Bearer test-vision-key', 'retry must preserve the exact Authorization header');
        assert.deepStrictEqual(delays, [250], 'first retry backoff must be bounded and deterministic');
    }

    {
        let calls = 0;
        const first = makeResponse(502, 'upstream');
        const wrapped = createAnalyzerRetryFetch(async () => {
            calls += 1;
            return calls === 1 ? first : makeResponse(200, 'ok');
        }, { sleep: async () => {} });
        const response = await wrapped(ANALYZER_ENDPOINT, visionInit());
        assert.strictEqual(response.status, 200);
        assert.strictEqual(calls, 2, 'HTTP 502 must retry');
        assert.strictEqual(first.drained, true, 'intermediate retry response must be drained');
    }

    for (const status of [429, 500, 504]) {
        let calls = 0;
        const wrapped = createAnalyzerRetryFetch(async () => {
            calls += 1;
            return calls < 3 ? makeResponse(status, 'transient') : makeResponse(200, 'ok');
        }, { sleep: async () => {} });
        const response = await wrapped(ANALYZER_ENDPOINT, visionInit());
        assert.strictEqual(response.status, 200);
        assert.strictEqual(calls, 3, `HTTP ${status} must use at most three total attempts`);
    }

    for (const status of [400, 401, 402, 403, 413, 503]) {
        let calls = 0;
        const wrapped = createAnalyzerRetryFetch(async () => {
            calls += 1;
            return makeResponse(status, 'non-retryable');
        }, { sleep: async () => {} });
        const response = await wrapped(ANALYZER_ENDPOINT, visionInit());
        assert.strictEqual(response.status, status);
        assert.strictEqual(calls, 1, `HTTP ${status} must not retry`);
    }

    {
        let calls = 0;
        const wrapped = createAnalyzerRetryFetch(async () => {
            calls += 1;
            return makeResponse(500, 'text-model failure');
        }, { sleep: async () => {} });
        const textInit = visionInit({ body: JSON.stringify({ model: 'qwen/qwen3-235b-a22b-2507', messages: [] }) });
        const response = await wrapped(ANALYZER_ENDPOINT, textInit);
        assert.strictEqual(response.status, 500);
        assert.strictEqual(calls, 1, 'Analyzer text stage must remain untouched by the vision transport wrapper');
    }

    {
        let calls = 0;
        const controller = new AbortController();
        controller.abort();
        const wrapped = createAnalyzerRetryFetch(async () => {
            calls += 1;
            return makeResponse(200, 'should-not-run');
        }, { sleep: async () => {} });
        await assert.rejects(
            () => wrapped(ANALYZER_ENDPOINT, visionInit({ signal: controller.signal })),
            err => err && err.name === 'AbortError'
        );
        assert.strictEqual(calls, 0, 'pre-aborted requests must not be sent or retried');
    }

    {
        let calls = 0;
        const wrapped = createAnalyzerRetryFetch(async () => {
            calls += 1;
            const err = new Error('deadline');
            err.name = 'AbortError';
            throw err;
        }, { sleep: async () => {} });
        await assert.rejects(
            () => wrapped(ANALYZER_ENDPOINT, visionInit()),
            err => err && err.name === 'AbortError'
        );
        assert.strictEqual(calls, 1, 'AbortError must never retry');
    }

    console.log('✅ Analyzer transient transport retry regression guard passed.');
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
