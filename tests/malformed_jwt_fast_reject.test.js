'use strict';

const assert = require('assert');

// Keep this suite independent from production secrets and prove the REST fallback behavior.
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.RAILWAY_ENVIRONMENT;
delete process.env.ENABLE_MOCK_AUTH;
process.env.NODE_ENV = 'test';

let fetchCalls = 0;
const requestedUrls = [];
global.fetch = async (url) => {
    fetchCalls += 1;
    requestedUrls.push(String(url));
    return {
        ok: false,
        status: 401,
        json: async () => ({})
    };
};

const {
    verifySupabaseToken,
    isStructurallyValidJwt,
    supabaseAdmin
} = require('../middleware/supabaseAuth');

assert.strictEqual(supabaseAdmin, null, 'test must exercise the REST verification fallback only');

function runMiddleware(authorization) {
    const req = { headers: {} };
    if (authorization !== undefined) req.headers.authorization = authorization;
    return new Promise((resolve, reject) => {
        let completed = false;
        const timer = setTimeout(() => {
            if (!completed) reject(new Error('verifySupabaseToken did not call next()'));
        }, 1000);
        verifySupabaseToken(req, {}, () => {
            completed = true;
            clearTimeout(timer);
            resolve(req);
        }).catch(reject);
    });
}

(async () => {
    assert.strictEqual(isStructurallyValidJwt('header.payload.signature'), true);
    assert.strictEqual(isStructurallyValidJwt('not-a-jwt'), false);
    assert.strictEqual(isStructurallyValidJwt('a.b'), false);
    assert.strictEqual(isStructurallyValidJwt('a.b.c.d'), false);
    assert.strictEqual(isStructurallyValidJwt('a..c'), false);
    assert.strictEqual(isStructurallyValidJwt('.b.c'), false);
    assert.strictEqual(isStructurallyValidJwt('a.b.'), false);

    const malformedCases = [
        undefined,
        'Bearer undefined',
        'Bearer null',
        'Bearer not-a-jwt',
        'Bearer a.b',
        'Bearer a.b.c.d',
        'Bearer a..c'
    ];

    for (const authHeader of malformedCases) {
        const before = fetchCalls;
        const req = await runMiddleware(authHeader);
        assert.strictEqual(req.user, null, `malformed auth must remain unauthenticated: ${authHeader}`);
        assert.strictEqual(fetchCalls, before, `malformed auth must make zero remote verification calls: ${authHeader}`);
    }

    // Shape validation is never authorization. A structurally valid JWT must still reach
    // Supabase's authoritative verifier and remain unauthenticated when Supabase rejects it.
    const shapedButInvalid = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.invalidsignature';
    const beforeValidShape = fetchCalls;
    const req = await runMiddleware(`Bearer ${shapedButInvalid}`);
    assert.strictEqual(fetchCalls, beforeValidShape + 1, 'valid JWT shape must still call Supabase verification');
    assert.strictEqual(req.user, null, 'a remotely rejected JWT must remain unauthenticated');
    assert(
        requestedUrls.some(url => url.endsWith('/auth/v1/user')),
        'valid JWT shape must use the existing Supabase /auth/v1/user verification path'
    );

    console.log('✅ Malformed JWT fast-reject and authoritative remote-verification guard passed.');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
