/**
 * Full End-to-End Integration Test for Screenshot Analyzer
 */
const assert = require('assert');
const http = require('http');
require('dotenv').config();

console.log('\n============================================================');
console.log('🧪 RUNNING SCREENSHOT ANALYZER FULL END-TO-END INTEGRATION TEST');
console.log('============================================================\n');

process.env.NODE_ENV = 'development';
process.env.ENABLE_MOCK_AUTH = 'true';

const { app } = require('../server');

function makeRequest(server, path, payload, headers = {}) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(payload);
        const req = http.request({
            hostname: '127.0.0.1',
            port: server.address().port,
            path: path,
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
                try { parsed = JSON.parse(data); } catch(e) {}
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
    await new Promise(res => server.listen(0, '127.0.0.1', res));

    try {
        const { createClient } = require('@supabase/supabase-js');
        const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const { data: profiles } = await adminClient.from('profiles').select('id, credits').gte('credits', 10).limit(1);
        const testUser = profiles && profiles[0] ? profiles[0] : null;

        if (!testUser) {
            console.log('⚠️ No profile with >= 10 credits found in Supabase. Skipping live end-to-end call.');
            return;
        }

        console.log(`Using live test user ID: ${testUser.id} with initial balance: ${testUser.credits} credits.`);
        const testImage = createBmpBase64(200, 200);
        const idempotencyKey = 'e2e_test_' + Date.now();

        console.log('Sending POST /api/analyze request with valid screenshot payload...');
        const res = await makeRequest(server, '/api/analyze', {
            tone: 'Witty',
            images: [testImage],
            shorthandOption: true,
            emojiOption: 1,
            idempotencyKey: idempotencyKey
        }, {
            'x-test-user-id': testUser.id
        });

        console.log('Response HTTP status:', res.status);
        console.log('Response body success:', res.body.success);

        assert.strictEqual(res.status, 200, `Expected HTTP 200 from /api/analyze, got ${res.status}: ${JSON.stringify(res.body)}`);
        assert.strictEqual(res.body.success, true, 'Response must indicate success: true');
        assert.strictEqual(Array.isArray(res.body.options), true, 'Response must include options array');
        assert.strictEqual(res.body.options.length, 10, `Response must return EXACTLY 10 options, got ${res.body.options.length}`);
        assert.strictEqual(typeof res.body.text, 'string', 'Response must include formatted text');
        assert.strictEqual(typeof res.body.credits, 'number', 'Response must return updated credit balance');

        console.log('\n--- 10 Generated Options Sample ---');
        res.body.options.forEach((opt, i) => console.log(`${i + 1}. ${opt}`));
        console.log('-----------------------------------');
        console.log('Updated balance returned:', res.body.credits);

        console.log('\n✔ Step 1-20: Full End-to-End Analysis Pipeline verified with real AI models!');
    } finally {
        await new Promise(res => server.close(res));
    }

    console.log('\n🎉 ALL SCREENSHOT ANALYZER FULL E2E INTEGRATION TESTS PASSED!\n');
}

runE2E().catch(err => {
    console.error('❌ Full E2E Integration test failure:', err);
    process.exit(1);
});
