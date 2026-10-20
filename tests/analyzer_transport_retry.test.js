'use strict';

const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.AICREDITS_API_KEY = 'analyzer-main-test-key';
process.env.AICREDITS_API_KEY_VISION = 'analyzer-vision-test-key';
process.env.AICREDITS_API_KEY_GENERAL = 'general-test-key';
delete process.env.OPENROUTER_API_KEY;

const { queryAnalyzerProvider, queryOpenRouter } = require('../server');

const originalFetch = global.fetch;
const originalLog = console.log;
const originalWarn = console.warn;
const logs = [];
console.log = (...args) => logs.push(args.join(' '));
console.warn = (...args) => logs.push(args.join(' '));

function response(status, body, headers = {}) {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers }
    });
}

async function runAnalyzerCases() {
    const messages = [{ role: 'user', content: 'synthetic test input' }];
    let calls = 0;

    global.fetch = async () => {
        calls += 1;
        return calls === 1
            ? response(429, { error: { status: 429 } }, { 'retry-after': '0' })
            : response(200, { choices: [{ message: { content: 'synthetic response' } }] });
    };
    assert.equal(await queryAnalyzerProvider('vision', messages, 0.2, 10, 1000), 'synthetic response');
    assert.equal(calls, 2, 'Analyzer may retry an explicit provider rate-limit rejection once it is safe to do so');
    const analyzerAttempts = logs
        .filter(line => line.startsWith('[PERF_TELEMETRY]'))
        .map(line => JSON.parse(line.slice('[PERF_TELEMETRY] '.length)))
        .filter(item => item.stage === 'vision_provider_attempt');
    assert.equal(analyzerAttempts.length, 2, 'each actual Analyzer provider request must get its own timing sample');
    assert(analyzerAttempts.every(item => item.attemptCount >= 1));
    assert(!logs.some(line => line.includes('synthetic test input') || line.includes('analyzer-vision-test-key')),
        'provider timing logs must not include prompts or credentials');

    for (const scenario of [
        {
            name: '5xx response',
            fetch: async () => response(503, { error: { status: 503 } }),
            check: error => error && error.statusCode === 503
        },
        {
            name: 'ambiguous network failure',
            fetch: async () => { throw new TypeError('synthetic connection reset'); },
            check: error => error instanceof TypeError
        },
        {
            name: 'provider timeout',
            fetch: async () => { throw Object.assign(new Error('synthetic timeout'), { name: 'AbortError' }); },
            check: error => error && error.isTimeout === true
        },
        {
            name: 'empty successful response',
            fetch: async () => response(200, { choices: [] }),
            check: error => error && error.code === 'AI_PROVIDER_EMPTY_RESPONSE'
        }
    ]) {
        calls = 0;
        global.fetch = async (...args) => { calls += 1; return scenario.fetch(...args); };
        await assert.rejects(queryAnalyzerProvider('main', messages, 0.2, 10, 1000), scenario.check, scenario.name);
        assert.equal(calls, 1, `${scenario.name} must not replay potentially completed inference`);
    }
}

async function runGeneralProviderCases() {
    const messages = [{ role: 'user', content: 'synthetic test input' }];
    let calls = 0;

    global.fetch = async () => {
        calls += 1;
        return calls === 1
            ? response(429, 'rate limited', { 'retry-after': '0' })
            : response(200, { choices: [{ message: { content: 'synthetic response' } }] });
    };
    assert.equal(await queryOpenRouter('qwen/qwen3-235b-a22b-2507', messages, 0.2, 10, 1000), 'synthetic response');
    assert.equal(calls, 2, 'general AI requests may retry an explicit 429 rejection');

    for (const scenario of [
        { name: '5xx response', fetch: async () => response(503, 'upstream failure') },
        { name: 'ambiguous network failure', fetch: async () => { throw new TypeError('synthetic connection reset'); } },
        { name: 'empty successful response', fetch: async () => response(200, { choices: [] }) }
    ]) {
        calls = 0;
        global.fetch = async (...args) => { calls += 1; return scenario.fetch(...args); };
        await assert.rejects(
            queryOpenRouter('qwen/qwen3-235b-a22b-2507', messages, 0.2, 10, 1000),
            scenario.name
        );
        assert.equal(calls, 1, `${scenario.name} must not trigger key/model failover retries`);
    }
}

(async () => {
    try {
        await runAnalyzerCases();
        await runGeneralProviderCases();
        console.log('✅ AI provider retry safety and per-request telemetry checks passed.');
    } finally {
        global.fetch = originalFetch;
        console.log = originalLog;
        console.warn = originalWarn;
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
