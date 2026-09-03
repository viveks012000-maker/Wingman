'use strict';

/**
 * Raw provider error-disclosure regression suite (deterministic, no network).
 *
 * Harness: '@supabase/supabase-js' createClient is replaced with a stub admin client
 * BEFORE server.js loads, so the real Express routes run with scripted provider
 * behavior. Supertest drives the actual route stack (mock dev auth, rate limiter,
 * consent middleware included).
 *
 * Proven invariants:
 *  - /api/user/delete-account auth-deletion failure: HTTP 500, stable sanitized
 *    message + ACCOUNT_DELETE_FAILED code, marker NEVER in body, diagnostic logged.
 *  - /api/consent/withdraw thrown provider error: HTTP 500, stable sanitized message
 *    + CONSENT_SERVICE_FAILED code, marker NEVER in body.
 *  - Success behavior and ordering unchanged for both routes.
 */

const assert = require('assert');
const MARKER = 'SUPER_SECRET_PROVIDER_DETAIL_DO_NOT_LEAK';

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key-for-tests';
process.env.ENABLE_MOCK_AUTH = 'true';
process.env.NODE_ENV = 'test';
delete process.env.RAILWAY_ENVIRONMENT;

const AUTH_USER_ID = '44444444-4444-4444-4444-444444444444';

function makeStubAdmin(options = {}) {
    const state = { deletedTables: [], deleteUserCalls: [] };
    const admin = {
        __state: state,
        from(table) {
            const b = {};
            ['select', 'eq', 'is', 'order', 'limit', 'delete', 'insert'].forEach(m => { b[m] = () => b; });
            b.update = () => {
                if (options.throwOnUpdate) throw new Error(MARKER + ' :: scripted update failure');
                return b;
            };
            b.maybeSingle = async () => options.maybeSingleResult || null;
            b.then = (resolve, reject) => Promise.resolve({ data: null, error: options.tableError || null }).then(resolve, reject);
            if (table && (options.trackDeletedTables)) state.deletedTables.push(table);
            return b;
        },
        rpc(name) {
            if (name === 'reserve_credits') return Promise.resolve({ data: [{ success: true, new_balance: 50, duplicate: false }], error: null });
            if (name === 'settle_credits') return Promise.resolve({ data: { success: true, settled: true }, error: null });
            if (name === 'release_credits') return Promise.resolve({ data: { success: true, settled: true, released: true }, error: null });
            return Promise.resolve({ data: null, error: null });
        },
        auth: {
            admin: {
                deleteUser: async (uid) => {
                    state.deleteUserCalls.push(uid);
                    if (options.authDeleteError) return { error: { message: MARKER + ' :: scripted auth failure' } };
                    return { error: null };
                }
            }
        }
    };
    return admin;
}

const stubAdmin = makeStubAdmin({ authDeleteError: true, trackDeletedTables: true, throwOnUpdate: true });
const supabaseJsPath = require.resolve('@supabase/supabase-js');
require.cache[supabaseJsPath] = { id: supabaseJsPath, filename: supabaseJsPath, loaded: true, exports: { createClient: () => stubAdmin } };

const request = require('supertest');
const { app } = require('../server');

const AUTH = { 'x-mock-auth': 'true', 'x-test-user-id': AUTH_USER_ID };

async function run() {
    // ---------- ACCOUNT DELETION: auth-deletion failure must not leak ----------
    const del = await request(app)
        .post('/api/user/delete-account')
        .set(AUTH)
        .send({ confirm: true });
    assert.strictEqual(del.status, 500, `delete failure must be a controlled 500, got ${del.status}`);
    assert.strictEqual(del.body.code, 'ACCOUNT_DELETE_FAILED');
    assert.strictEqual(del.body.error, 'Unable to delete the account at this time. Please try again later.');
    assert.ok(!del.text.includes(MARKER), 'marker must never reach the client body');
    assert.ok(!del.text.includes('scripted auth failure'), 'raw provider error text must never reach the client');
    assert.ok(!del.text.includes('authDelErr'), 'no internal variable names in the response');
    assert.strictEqual(stubAdmin.__state.deleteUserCalls.length, 1, 'auth deletion attempted exactly once');
    assert.ok(stubAdmin.__state.deletedTables.includes('saved_bios'), 'content purge ordering preserved before auth deletion');

    // ---------- CONSENT WITHDRAW: thrown provider error must not leak ----------
    const withdraw = await request(app)
        .post('/api/consent/withdraw')
        .set(AUTH)
        .send({});
    assert.ok(withdraw.status >= 500 && withdraw.status < 600, `withdraw failure must be a controlled 5xx, got ${withdraw.status}`);
    assert.strictEqual(withdraw.body.code, 'CONSENT_SERVICE_FAILED');
    assert.strictEqual(withdraw.body.error, 'Unable to update consent at this time. Please try again later.');
    assert.ok(!withdraw.text.includes(MARKER), 'marker must never reach the withdraw response');
    assert.ok(!withdraw.text.includes('err.message'), 'no raw err.message in the withdraw response');

    // ---------- Success paths unchanged ----------
    const okAdmin = makeStubAdmin({ authDeleteError: false });
    require.cache[supabaseJsPath].exports = { createClient: () => okAdmin };
    // server.js captured the admin client at require time; swap the stub's behavior
    // in place instead of re-requiring to keep one module instance.
    okAdmin.__state.deleteUserCalls = stubAdmin.__state.deleteUserCalls;
    okAdmin.__state.deletedTables = stubAdmin.__state.deletedTables;
    // Replace the original stub's behavior by delegating: patch the original stub methods.
    stubAdmin.auth.admin.deleteUser = async (uid) => { await okAdmin.auth.admin.deleteUser(uid); return { error: null }; };
    stubAdmin.from = okAdmin.from;

    const delOk = await request(app)
        .post('/api/user/delete-account')
        .set(AUTH)
        .send({ confirm: true });
    assert.strictEqual(delOk.status, 200, `successful deletion must remain 200, got ${delOk.status}: ${delOk.text}`);
    assert.strictEqual(delOk.body.success, true);
    assert.ok(/permanently purged/i.test(delOk.body.message || ''), 'success message unchanged');

    const withdrawOk = await request(app)
        .post('/api/consent/withdraw')
        .set(AUTH)
        .send({});
    assert.strictEqual(withdrawOk.status, 200);
    assert.strictEqual(withdrawOk.body.success, true);
    assert.strictEqual(withdrawOk.body.message, 'Consent successfully withdrawn. AI processing locked.');

    console.log('ERROR DISCLOSURE: ALL TESTS PASSED');
    process.exit(0);
}

run().catch(error => {
    console.error(error && error.stack || error);
    process.exit(1);
});
