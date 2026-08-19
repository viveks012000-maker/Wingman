'use strict';

const assert = require('assert');
const request = require('supertest');
const { app } = require('../railway-server');

async function run() {
    const root = await request(app).get('/');
    assert.strictEqual(root.status, 200, 'Railway root probe must remain available.');
    assert.deepStrictEqual(root.body, { status: 'ok', service: 'mywingman-api' });
    assert.strictEqual(root.headers['x-powered-by'], undefined, 'Railway gateway must not expose X-Powered-By.');
    assert.strictEqual(root.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(Boolean(root.headers['strict-transport-security']), true, 'Railway root must retain HSTS.');

    const blockedPaths = [
        '/package.json',
        '/package-lock.json',
        '/server.js',
        '/app.html',
        '/app.js',
        '/logo.png',
        '/tests/security_node.test.js',
        '/scripts/build-netlify-dist.js',
        '/migrations/001_initial.sql',
        '/middleware/security.js',
        '/config/promptSystem.js',
        '/.github/workflows/build-netlify-production-artifact.yml'
    ];

    for (const pathname of blockedPaths) {
        const response = await request(app).get(pathname);
        assert.strictEqual(response.status, 404, `${pathname} must not be publicly served by Railway.`);
        assert.deepStrictEqual(response.body, { success: false, error: 'Not found.' }, `${pathname} must return only the minimal API gateway 404.`);
    }

    const config = await request(app).get('/api/config');
    assert.strictEqual(config.status, 200, 'Existing API routes must still pass through the Railway gateway.');
    assert.strictEqual(config.body.success, true);
    assert.ok(typeof config.body.supabaseUrl === 'string' && config.body.supabaseUrl.includes('.supabase.co'));
    assert.ok(typeof config.body.supabaseAnonKey === 'string' && config.body.supabaseAnonKey.length > 10);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(config.body, 'serviceRoleKey'), false, 'Public config must never expose the Supabase service role key.');

    const encoded = await request(app).get('/package%2Ejson');
    assert.strictEqual(encoded.status, 404, 'Encoded sensitive paths must also remain outside the API surface.');

    console.log('✅ Railway API-only public surface regression guard passed.');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
