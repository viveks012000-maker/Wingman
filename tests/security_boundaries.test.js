'use strict';

const assert = require('node:assert/strict');
const {
    AICREDITS_HOST,
    DEFAULT_SUPABASE_HOST,
    appendConfiguredPath,
    configuredOrigin,
    safeLogValue
} = require('../middleware/securityBoundaries');

assert.equal(configuredOrigin('provider', `https://${AICREDITS_HOST}/v1/`, {
    production: true,
    allowedHost: AICREDITS_HOST,
    allowedPath: '/v1'
}), `https://${AICREDITS_HOST}/v1`);
assert.equal(configuredOrigin('supabase', `https://${DEFAULT_SUPABASE_HOST}/`, {
    production: true,
    supabase: true
}), `https://${DEFAULT_SUPABASE_HOST}`);
assert.equal(appendConfiguredPath(`https://${AICREDITS_HOST}/v1`, '/chat/completions'), `https://${AICREDITS_HOST}/v1/chat/completions`);

for (const value of [
    'http://api.aicredits.in/v1',
    'https://evil.example/v1',
    'https://api.aicredits.in:443/v1',
    'https://user:pass@api.aicredits.in/v1',
    'https://api.aicredits.in/v1?next=evil',
    'https://api.aicredits.in/v2'
]) {
    assert.throws(() => configuredOrigin('provider', value, {
        production: true,
        allowedHost: AICREDITS_HOST,
        allowedPath: '/v1'
    }), /must|unapproved|credentials|HTTPS/);
}

assert.equal(configuredOrigin('local', 'http://127.0.0.1:8787', { production: false }), 'http://127.0.0.1:8787');
assert.throws(() => configuredOrigin('supabase', 'https://other.supabase.co', { production: true, supabase: true }), /unapproved/);
assert.equal(safeLogValue('normal-value'), 'normal-value');
assert.equal(safeLogValue('line\nforged-entry'), '[invalid-log-value]');
assert.equal(safeLogValue('x'.repeat(200), 10), 'xxxxxxxxxx');

console.log('✔ Security boundary tests passed: fixed production origins, local-only exceptions, and log-value integrity are enforced.');
