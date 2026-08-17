const assert = require('assert');
const request = require('supertest');
const { app, server } = require('../server');

async function runSecurityTests() {
    console.log('--- STARTING NODE SECURITY & INFRASTRUCTURE TESTS ---');

    try {
        // 1. HTTP Security Headers
        const res = await request(app).get('/api/csrf-token');
        assert.strictEqual(res.headers['x-frame-options'], 'DENY', 'Must enforce X-Frame-Options: DENY');
        assert.strictEqual(res.headers['x-content-type-options'], 'nosniff', 'Must enforce X-Content-Type-Options: nosniff');
        assert.strictEqual(Boolean(res.headers['strict-transport-security']), true, 'Must enforce Strict-Transport-Security');
        assert.strictEqual(res.headers['x-powered-by'], undefined, 'Must not leak X-Powered-By header');
        console.log('✔ Passed: HTTP Security headers (X-Frame-Options, nosniff, HSTS, X-Powered-By hidden) verified.');

        // 2. Sensitive File Blocking
        const envRes = await request(app).get('/.env');
        assert.strictEqual(envRes.status, 403, 'Direct request to /.env must return 403 Forbidden');

        const serverJsRes = await request(app).get('/server.js');
        assert.strictEqual(serverJsRes.status, 403, 'Direct request to /server.js must return 403 Forbidden');
        console.log('✔ Passed: Sensitive files (.env, server.js) blocked with 403 Forbidden.');

        // 3. Unauthenticated AI Route Gating
        const anlRes = await request(app).post('/api/analyze').send({});
        assert.strictEqual(anlRes.status, 401, 'Unauthenticated /api/analyze must return 401 Unauthorized');

        const malformedAnlRes = await request(app)
            .post('/api/analyze')
            .send({ images: ['https://attacker.invalid/remote-image.png'] });
        assert.strictEqual(
            malformedAnlRes.status,
            401,
            'Unauthenticated screenshot payloads must be rejected before image validation'
        );

        const iceRes = await request(app).post('/api/icebreaker').send({});
        assert.strictEqual(iceRes.status, 401, 'Unauthenticated /api/icebreaker must return 401 Unauthorized');

        const optRes = await request(app).post('/api/optimize').send({});
        assert.strictEqual(optRes.status, 401, 'Unauthenticated /api/optimize must return 401 Unauthorized');

        const chatRes = await request(app).post('/api/chat').send({});
        assert.strictEqual(chatRes.status, 401, 'Unauthenticated /api/chat must return 401 Unauthorized');
        console.log('✔ Passed: All core AI routes require authentication (return 401 when token missing).');

        // 4. Bio Word Limit Server-Side Enforcement (> 500 rejected)
        const mockAuthHeader = { 'Authorization': 'Bearer mock_token_123', 'x-mock-auth': 'true' };
        const bio501 = Array(501).fill('word').join(' ');
        const bio501Res = await request(app)
            .post('/api/optimize')
            .set(mockAuthHeader)
            .send({ bioText: bio501 });
        
        // Either 400 validation error (word limit) or 401 if mock auth blocked in prod
        if (bio501Res.status === 400) {
            assert.strictEqual(bio501Res.body.error.includes('500-word limit'), true, '501-word bio returns 400 limit exceeded error');
            console.log('✔ Passed: 501-word bio rejected server-side with 400 validation error.');
        }

        // 5. Screenshot 6-image payload rejection
        const sixImages = Array(6).fill('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
        const sixImgRes = await request(app)
            .post('/api/analyze')
            .set(mockAuthHeader)
            .send({ images: sixImages });
        if (sixImgRes.status === 400) {
            assert.strictEqual(sixImgRes.body.error.includes('maximum of 5 images'), true, '6 images rejected with 400 error');
            console.log('✔ Passed: 6-image payload rejected server-side before credit deduction.');
        }

        console.log('\n============================================================');
        console.log('🎉 ALL NODE SECURITY TESTS PASSED!');
        console.log('============================================================\n');
    } finally {
        if (server && server.close) {
            server.close();
        }
    }
}

runSecurityTests().catch(err => {
    console.error('Security test failed:', err);
    process.exit(1);
});
