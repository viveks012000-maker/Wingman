const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.AICREDITS_API_KEY = 'unit-test-main-key';
delete process.env.AICREDITS_API_KEY_GENERAL;

const originalFetch = global.fetch;
const { queryMaeveProvider } = require('../server');

(async () => {
    let providerRequests = 0;
    global.fetch = async () => {
        providerRequests++;
        return new Response(JSON.stringify({ choices: [{ message: { content: 'should not run' } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    };

    await assert.rejects(
        queryMaeveProvider([{ role: 'user', content: 'synthetic request' }], 0.6, 120, 1000, Date.now() - 1),
        error => error && error.isTimeout === true && error.statusCode === 504,
        'Maeve must fail with a timeout when its operation deadline is already exhausted'
    );
    assert.equal(providerRequests, 0, 'Maeve must not start a provider request after the operation deadline');

    console.log('Maeve operation-wide deadline guard passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    global.fetch = originalFetch;
});
