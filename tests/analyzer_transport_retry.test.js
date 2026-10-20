'use strict';

const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.AICREDITS_API_KEY = 'analyzer-main-test-key';
process.env.AICREDITS_API_KEY_VISION = 'analyzer-vision-test-key';
process.env.AICREDITS_API_KEY_GENERAL = 'general-test-key';
delete process.env.OPENROUTER_API_KEY;

const { queryAnalyzerProvider, queryOpenRouter, queryMaeveProvider } = require('../server');

const originalFetch = global.fetch;
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const logs = [];
console.log = (...args) => logs.push(args.join(' '));
console.warn = (...args) => logs.push(args.join(' '));
console.error = (...args) => logs.push(args.join(' '));

function assertSafeProviderFailure(stage, expectedCode) {
    const line = logs.findLast(item => item.startsWith('[AI_PROVIDER_FAILURE] '));
    assert(line, `a structured provider failure diagnostic should be recorded for ${stage}`);
    const diagnostic = JSON.parse(line.slice('[AI_PROVIDER_FAILURE] '.length));
    assert.equal(diagnostic.provider, 'aicredits');
    assert.equal(diagnostic.stage, stage);
    assert.equal(diagnostic.failureCode, expectedCode);
    assert.equal(typeof diagnostic.requestDurationMs, 'number');
    assert(diagnostic.requestDurationMs >= 0);
    assert.equal(diagnostic.upstreamStatus ?? null, null);
    assert.equal(diagnostic.errorName, 'TypeError');
    assert.equal(diagnostic.causeChain[1].code, 'ECONNRESET');
    assert.equal(diagnostic.causeChain[1].syscall, 'connect');
    const serialized = JSON.stringify(diagnostic);
    assert(!serialized.includes('synthetic private provider detail'));
    assert(!serialized.includes('203.0.113.40'));
    assert(!serialized.includes('synthetic test input'));
    assert(!serialized.includes('analyzer-vision-test-key'));
    return diagnostic;
}

function response(status, body, headers = {}) {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers }
    });
}

async function runAnalyzerCases() {
    const messages = [{ role: 'user', content: 'synthetic test input' }];
    const networkError = new TypeError('fetch failed', {
        cause: Object.assign(new Error('synthetic private provider detail'), {
            code: 'ECONNRESET',
            syscall: 'connect',
            address: '203.0.113.40'
        })
    });
    let calls = 0;

    global.fetch = async () => {
        calls += 1;
        return calls === 1
            ? response(429, { error: { status: 429 } }, { 'retry-after': '0' })
            : response(200, { choices: [{ message: { content: 'synthetic response' } }] });
    };
    assert.equal(await queryAnalyzerProvider('vision', messages, 0.2, 10, 1000), 'synthetic response');
    assert.equal(calls, 2, 'Analyzer may retry an explicit provider rate-limit rejection once it is safe to do so');
    const rateLimitDiagnostic = logs
        .filter(item => item.startsWith('[AI_PROVIDER_FAILURE] '))
        .map(item => JSON.parse(item.slice('[AI_PROVIDER_FAILURE] '.length)))
        .findLast(item => item.stage === 'analyzer_vision' && item.upstreamStatus === 429);
    assert(rateLimitDiagnostic, 'provider diagnostics must include an upstream HTTP status when present');
    assert.equal(rateLimitDiagnostic.failureCode, 'AI_PROVIDER_RATE_LIMIT');
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
            fetch: async () => { throw networkError; },
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
        if (scenario.name === 'ambiguous network failure') {
            assertSafeProviderFailure('analyzer_main', 'AI_PROVIDER_NETWORK');
        }
    }
}

async function runProviderCauseClassificationCases() {
    const scenarios = [
        { code: 'ENOTFOUND', syscall: 'getaddrinfo', expected: 'AI_PROVIDER_DNS' },
        { code: 'ERR_TLS_CERT_ALTNAME_INVALID', syscall: null, expected: 'AI_PROVIDER_TLS' },
        { code: 'ERR_SSL_WRONG_VERSION_NUMBER', syscall: null, expected: 'AI_PROVIDER_TLS' },
        { code: 'UND_ERR_CONNECT_TIMEOUT', syscall: 'connect', expected: 'AI_PROVIDER_CONNECT_TIMEOUT' }
    ];

    for (const scenario of scenarios) {
        const cause = Object.assign(new Error('synthetic private provider detail'), { code: scenario.code });
        if (scenario.syscall) cause.syscall = scenario.syscall;
        const networkError = new TypeError('fetch failed', { cause });
        const previousLogCount = logs.length;
        global.fetch = async () => { throw networkError; };
        await assert.rejects(
            queryAnalyzerProvider('vision', [{ role: 'user', content: 'synthetic test input' }], 0.2, 10, 1000),
            error => error === networkError,
            `${scenario.code} should not replay an ambiguous provider request`
        );
        const line = logs.slice(previousLogCount).find(item => item.startsWith('[AI_PROVIDER_FAILURE] '));
        assert(line, `${scenario.code} should produce a structured diagnostic`);
        const diagnostic = JSON.parse(line.slice('[AI_PROVIDER_FAILURE] '.length));
        assert.equal(diagnostic.failureCode, scenario.expected);
        assert.equal(diagnostic.causeChain[1].code, scenario.code);
        if (scenario.syscall) assert.equal(diagnostic.causeChain[1].syscall, scenario.syscall);
        assert(!JSON.stringify(diagnostic).includes('synthetic private provider detail'));
    }
}

async function runGeneralProviderCases() {
    const messages = [{ role: 'user', content: 'synthetic test input' }];
    const networkError = new TypeError('fetch failed', {
        cause: Object.assign(new Error('synthetic private provider detail'), {
            code: 'ECONNRESET',
            syscall: 'connect',
            address: '203.0.113.40'
        })
    });
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
        { name: 'ambiguous network failure', fetch: async () => { throw networkError; } },
        { name: 'empty successful response', fetch: async () => response(200, { choices: [] }) }
    ]) {
        calls = 0;
        global.fetch = async (...args) => { calls += 1; return scenario.fetch(...args); };
        await assert.rejects(
            queryOpenRouter('qwen/qwen3-235b-a22b-2507', messages, 0.2, 10, 1000),
            scenario.name
        );
        assert.equal(calls, 1, `${scenario.name} must not trigger key/model failover retries`);
        if (scenario.name === 'ambiguous network failure') {
            assertSafeProviderFailure('generic_text_generation', 'AI_PROVIDER_NETWORK');
        }
    }
}

async function runMaeveProviderCases() {
    const networkError = new TypeError('fetch failed', {
        cause: Object.assign(new Error('synthetic private provider detail'), {
            code: 'ECONNRESET',
            syscall: 'connect',
            address: '203.0.113.40'
        })
    });
    let calls = 0;
    global.fetch = async () => {
        calls += 1;
        throw networkError;
    };
    await assert.rejects(
        queryMaeveProvider([{ role: 'user', content: 'synthetic test input' }], 0.6, 120, 1000),
        error => error === networkError,
        'Maeve must preserve an ambiguous transport error without replaying it'
    );
    assert.equal(calls, 1, 'Maeve must not retry an ambiguous potentially billable request');
    assertSafeProviderFailure('maeve_generation', 'AI_PROVIDER_NETWORK');
}

(async () => {
    try {
        await runAnalyzerCases();
        await runProviderCauseClassificationCases();
        await runGeneralProviderCases();
        await runMaeveProviderCases();
        console.log('✅ AI provider retry safety and per-request telemetry checks passed.');
    } finally {
        global.fetch = originalFetch;
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
