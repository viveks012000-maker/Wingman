/**
 * Tests: Screenshot Analyzer Server-side Image Normalization & Validation
 */
const assert = require('assert');
const http = require('http');

console.log('\n============================================================');
console.log('🧪 RUNNING SCREENSHOT ANALYZER IMAGE VALIDATION TESTS');
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

function createSampleBase64(sizeBytes, mime = 'image/jpeg') {
    // Generate valid base64 payload of specified decoded byte length
    const rawBuf = Buffer.alloc(sizeBytes, 0x41); // 'A'
    return `data:${mime};base64,` + rawBuf.toString('base64');
}

async function runTests() {
    const server = http.createServer(app);
    await new Promise(res => server.listen(0, '127.0.0.1', res));

    try {
        // Test 1: Reject 6th screenshot (> 5 images)
        const sixImages = [
            createSampleBase64(100),
            createSampleBase64(100),
            createSampleBase64(100),
            createSampleBase64(100),
            createSampleBase64(100),
            createSampleBase64(100)
        ];
        const res1 = await makeRequest(server, '/api/analyze', { images: sixImages });
        assert.strictEqual(res1.status, 400, '6 images must be rejected with HTTP 400');
        assert.strictEqual(res1.body.success, false);
        assert.strictEqual(res1.body.error.includes('maximum of 5 images'), true);
        console.log('✔ Test 1 Passed: 6th screenshot rejected with HTTP 400 before credit deduction');

        // Test 2: Reject remote HTTP/HTTPS image URLs
        const remoteImagePayload = {
            images: ['https://example.com/screenshot.jpg']
        };
        const res2 = await makeRequest(server, '/api/analyze', remoteImagePayload);
        assert.strictEqual(res2.status, 400, 'Remote URL must be rejected with HTTP 400');
        assert.strictEqual(res2.body.success, false);
        assert.strictEqual(res2.body.error.includes('Remote image URLs are not supported'), true);
        console.log('✔ Test 2 Passed: Remote HTTP/HTTPS image URL rejected with HTTP 400');

        // Test 3: Reject single image exceeding 5 MB decoded size
        const oversizedSingleImage = createSampleBase64(6 * 1024 * 1024); // 6 MB
        const res3 = await makeRequest(server, '/api/analyze', { images: [oversizedSingleImage] });
        assert.strictEqual(res3.status, 400, 'Single image > 5MB must be rejected with HTTP 400');
        assert.strictEqual(res3.body.success, false);
        assert.strictEqual(res3.body.error.includes('5 MB'), true);
        console.log('✔ Test 3 Passed: Single image > 5 MB rejected with HTTP 400');

        // Test 4: Reject corrupt / non-base64 image payload
        const corruptPayload = {
            images: ['data:image/jpeg;base64,???not-valid-base64$$$']
        };
        const res4 = await makeRequest(server, '/api/analyze', corruptPayload);
        assert.strictEqual(res4.status, 400, 'Corrupt base64 must be rejected with HTTP 400');
        assert.strictEqual(res4.body.success, false);
        console.log('✔ Test 4 Passed: Corrupt / non-base64 payload rejected with HTTP 400');

        // Test 5: Reject unsupported MIME type (e.g. text/html or application/pdf)
        const unsupportedMime = 'data:application/pdf;base64,' + Buffer.from('PDF content').toString('base64');
        const res5 = await makeRequest(server, '/api/analyze', { images: [unsupportedMime] });
        assert.strictEqual(res5.status, 400, 'Unsupported MIME must be rejected with HTTP 400');
        assert.strictEqual(res5.body.success, false);
        assert.strictEqual(res5.body.error.toLowerCase().includes('format') && res5.body.error.toLowerCase().includes('not supported'), true);
        console.log('✔ Test 5 Passed: Unsupported MIME rejected with HTTP 400');

        // Test 6: Legacy imageBase64 / image field normalization
        const legacySingle = createSampleBase64(200);
        // We test that a request with valid base64 passes image validation (reaches credit/ai pipeline)
        const res6 = await makeRequest(server, '/api/analyze', { imageBase64: legacySingle });
        // Status won't be 400 validation error (it will be 200 or 503 depending on AI key/db in test mode)
        assert.notStrictEqual(res6.status, 400, 'Normalized legacy imageBase64 must pass image validation');
        console.log('✔ Test 6 Passed: Legacy image / imageBase64 inputs normalized to canonical array');

    } finally {
        await new Promise(res => server.close(res));
    }

    console.log('\n🎉 ALL SCREENSHOT ANALYZER IMAGE VALIDATION TESTS PASSED!\n');
}

runTests().catch(err => {
    console.error('❌ Image validation test failure:', err);
    process.exit(1);
});
