const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.AICREDITS_API_KEY = 'unit-test-main-key';
delete process.env.AICREDITS_API_KEY_GENERAL;

const originalFetch = global.fetch;
const { queryMaeveProvider } = require('../server');
const syntheticMessages = [{ role: 'user', content: 'synthetic request' }];

(async () => {
    let providerRequests = 0;
    global.fetch = async () => {
        providerRequests++;
        return new Response('temporary upstream failure', { status: 503 });
    };

    await assert.rejects(
        queryMaeveProvider(syntheticMessages, 0.6, 120, 1000, Date.now() + 65000),
        error => error && error.statusCode === 503,
        'Maeve must return an upstream 503 without replaying a potentially billable request'
    );
    assert.equal(providerRequests, 1, 'a 5xx response must not trigger a duplicate provider request');

    providerRequests = 0;
    global.fetch = async (_url, options) => {
        providerRequests++;
        return new Promise((_, reject) => {
            options.signal.addEventListener('abort', () => {
                reject(Object.assign(new Error('synthetic timeout'), { name: 'AbortError' }));
            }, { once: true });
        });
    };
    await assert.rejects(
        queryMaeveProvider(syntheticMessages, 0.6, 120, 25, Date.now() + 65000),
        error => error && error.isTimeout === true && error.statusCode === 504,
        'Maeve must report an upstream timeout'
    );
    assert.equal(providerRequests, 1, 'an ambiguous timeout must not be retried as another billable request');

    providerRequests = 0;
    global.fetch = async () => {
        providerRequests++;
        return new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    };
    await assert.rejects(
        queryMaeveProvider(syntheticMessages, 0.6, 120, 1000, Date.now() + 65000),
        error => error && error.code === 'AI_PROVIDER_EMPTY_RESPONSE',
        'Maeve must classify an empty provider response'
    );
    assert.equal(providerRequests, 1, 'an empty response must not cause another potentially billable request');

    providerRequests = 0;
    global.fetch = async () => {
        providerRequests++;
        throw new TypeError('synthetic connection reset');
    };
    await assert.rejects(
        queryMaeveProvider(syntheticMessages, 0.6, 120, 1000, Date.now() + 65000),
        error => error instanceof TypeError && error.message === 'synthetic connection reset',
        'Maeve must preserve a network error when provider completion is ambiguous'
    );
    assert.equal(providerRequests, 1, 'an ambiguous network failure must not be retried');

    providerRequests = 0;
    global.fetch = async () => {
        providerRequests++;
        await new Promise(resolve => setTimeout(resolve, 20));
        return new Response(JSON.stringify({ choices: [{ message: { content: 'synthetic slow success' } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    };
    assert.equal(
        await queryMaeveProvider(syntheticMessages, 0.6, 120, 1000, Date.now() + 65000),
        'synthetic slow success',
        'a slow but healthy provider response must complete successfully within its budget'
    );
    assert.equal(providerRequests, 1, 'a slow successful response must not be duplicated');

    providerRequests = 0;
    global.fetch = async () => {
        providerRequests++;
        return new Response('rate limited', { status: 429 });
    };
    await assert.rejects(
        queryMaeveProvider(syntheticMessages, 0.6, 120, 1000, Date.now() + 5600),
        error => error && error.isTimeout === true && error.statusCode === 504,
        'Maeve must stop before a rate-limit backoff when no safe attempt budget remains'
    );
    assert.equal(providerRequests, 1, 'Maeve must preserve cleanup time instead of starting a late retry');

    console.log('Maeve provider failure and retry guards passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    global.fetch = originalFetch;
});
