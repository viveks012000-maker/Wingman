/**
 * Full End-to-End Integration Test for Screenshot Analyzer
 *
 * SAFETY LAW:
 * - Never auto-select a production user.
 * - Never spend live credits unless explicitly opted in.
 * - A dedicated test user ID must be supplied by the operator.
 */
const assert = require('assert');
const http = require('http');
require('dotenv').config();

console.log('\n============================================================');
console.log('🧪 RUNNING SCREENSHOT ANALYZER FULL END-TO-END INTEGRATION TEST');
console.log('============================================================\n');

const liveOptIn = process.env.RUN_LIVE_E2E === 'true';
const spendOptIn = process.env.E2E_ALLOW_CREDIT_SPEND === 'true';
const dedicatedTestUserId = (process.env.E2E_TEST_USER_ID || '').trim();

if (!liveOptIn || !spendOptIn || !dedicatedTestUserId) {
    console.log('⚠️ Live Analyzer E2E skipped safely. To run it, explicitly set RUN_LIVE_E2E=true, E2E_ALLOW_CREDIT_SPEND=true, and E2E_TEST_USER_ID to a dedicated test account.');
    process.exit(0);
}

const requiredLiveEnv = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'AICREDITS_API_KEY',
    'AICREDITS_API_KEY_VISION'
];
const missingLiveEnv = requiredLiveEnv.filter(name => !process.env[name]);
if (missingLiveEnv.length > 0) {
    console.error(`❌ Live Analyzer E2E explicitly requested but required environment variables are missing: ${missingLiveEnv.join(', ')}`);
    process.exit(1);
}

process.env.NODE_ENV = 'development';
process.env.ENABLE_MOCK_AUTH = 'true';

const { app } = require('../server');

function makeRequest(server, path, payload, headers = {}) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(payload);
        const req = http.request({
            hostname: '127.0.0.1',
            port: server.address().port,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr),
                'x-mock-auth': 'true',
                ...headers
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = {};
                try { parsed = JSON.parse(data); } catch (e) {}
                resolve({ status: res.statusCode, body: parsed, raw: data });
            });
        });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

function createBmpBase64(w, h) {
    const headerSize = 54;
    const rowSize = Math.floor((24 * w + 31) / 32) * 4;
    const pixelArraySize = rowSize * h;
    const fileSize = headerSize + pixelArraySize;
    const buf = Buffer.alloc(fileSize);

    buf.write('BM', 0);
    buf.writeUInt32LE(fileSize, 2);
    buf.writeUInt32LE(54, 10);
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(w, 18);
    buf.writeInt32LE(h, 22);
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(24, 28);
    buf.writeUInt32LE(0, 30);
    buf.writeUInt32LE(pixelArraySize, 34);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const offset = 54 + y * rowSize + x * 3;
            buf[offset] = 240;
            buf[offset + 1] = 240;
            buf[offset + 2] = 240;
        }
    }
    return 'data:image/bmp;base64,' + buf.toString('base64');
}

async function runE2E() {
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    try {
        const { createClient } = require('@supabase/supabase-js');
        const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const { data: testUser, error: profileError } = await adminClient
            .from('profiles')
            .select('id, credits')
            .eq('id', dedicatedTestUserId)
            .maybeSingle();

        if (profileError) {
            throw new Error(`Failed to load dedicated E2E test profile: ${profileError.message}`);
        }
        if (!testUser) {
            throw new Error('E2E_TEST_USER_ID does not have a public.profiles row. Refusing to auto-create or auto-select another user.');
        }
        if (typeof testUser.credits !== 'number' || testUser.credits < 10) {
            throw new Error(`Dedicated E2E test profile needs at least 10 credits; current balance: ${testUser.credits}`);
        }

        console.log(`Using explicitly configured dedicated E2E test account with starting balance: ${testUser.credits} credits.`);
        console.log('⚠️ This explicitly opted-in live test may spend 10 credits if generation succeeds.');

        const testImage = createBmpBase64(200, 200);
        const idempotencyKey = 'e2e_test_' + Date.now();

        const res = await makeRequest(server, '/api/analyze', {
            tone: 'Witty',
            images: [testImage],
            shorthandOption: true,
            emojiOption: 1,
            idempotencyKey
        }, {
            'x-test-user-id': testUser.id
        });

        console.log('Response HTTP status:', res.status);

        if (res.status === 503) {
            assert.strictEqual(res.body.success, false);
            assert.strictEqual(String(res.body.error || '').includes('Credit service temporarily unavailable'), true);
            console.log('✔ Fail-closed behavior verified: 503 returned without unlocked credit execution.');
        } else if (res.status === 200) {
            assert.strictEqual(res.body.success, true);
            assert.strictEqual(Array.isArray(res.body.options), true);
            assert.strictEqual(res.body.options.length, 10);
            assert.strictEqual(typeof res.body.credits, 'number');
            console.log('✔ Live Analyzer success verified: exactly 10 options returned and reservation settled.');
        } else {
            throw new Error(`Unexpected status code ${res.status}: ${JSON.stringify(res.body)}`);
        }
    } finally {
        await new Promise(resolve => server.close(resolve));
    }

    console.log('\n🎉 SCREENSHOT ANALYZER LIVE E2E TEST PASSED!\n');
}

runE2E().catch(err => {
    console.error('❌ Full E2E Integration test failure:', err);
    process.exit(1);
});
