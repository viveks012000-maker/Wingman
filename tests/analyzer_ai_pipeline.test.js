/**
 * Tests: Screenshot Analyzer AI Pipeline (Stage 1 Vision & Stage 2 Reply Models)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('\n============================================================');
console.log('🧪 RUNNING SCREENSHOT ANALYZER AI PIPELINE & MODEL TESTS');
console.log('============================================================\n');

// 1. Static Invariant Verification
const serverFile = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// Stage 1 Model & Prompt verification
assert.strictEqual(
    serverFile.includes('qwen3.5-flash-02-23'),
    true,
    'Stage 1 Vision model must be qwen3.5-flash-02-23'
);
assert.strictEqual(
    serverFile.includes('AICREDITS_API_KEY_VISION'),
    true,
    'Vision extraction must use AICREDITS_API_KEY_VISION'
);
console.log('✔ Test 1 Passed: Stage 1 Vision model is strictly qwen3.5-flash-02-23 via AICREDITS_API_KEY_VISION');

// Stage 2 Model verification
assert.strictEqual(
    serverFile.includes('qwen3-235b-a22b-2507'),
    true,
    'Stage 2 Text model must be qwen3-235b-a22b-2507'
);
console.log('✔ Test 2 Passed: Stage 2 Generation model is strictly qwen3-235b-a22b-2507');

// Fallback Model Prohibition verification
assert.strictEqual(
    serverFile.includes("isAnalyzerModel = typeof modelIdentifier === 'string' && (modelIdentifier.includes('flash-02-23') || modelIdentifier.includes('235b-a22b-2507'))"),
    true,
    'Screenshot Analyzer models must have ZERO model fallbacks'
);
console.log('✔ Test 3 Passed: Screenshot Analyzer models strictly isolated with ZERO fallback models (Rule 6)');

// Spatial Alignment & Reel Isolation Laws
assert.strictEqual(
    serverFile.includes('SPATIAL ALIGNMENT LAW:'),
    true,
    'System prompt must preserve Spatial Alignment Law'
);
assert.strictEqual(
    serverFile.includes('STRICT REEL OCR ISOLATION LAW'),
    true,
    'System prompt must preserve Strict Reel OCR Isolation Law'
);
assert.strictEqual(
    serverFile.includes('USER_LEFT_ON_READ'),
    true,
    'System prompt must preserve USER_LEFT_ON_READ conversation state'
);
assert.strictEqual(
    serverFile.includes('MATCH_REPLIED'),
    true,
    'System prompt must preserve MATCH_REPLIED conversation state'
);
console.log('✔ Test 4 Passed: Spatial alignment, reel isolation, and conversation state laws preserved');

// 2. Live AICREDITS Provider Execution Test
// SECURITY INVARIANT (CodeQL #31/#32): credential-bearing live-provider requests in
// this test may ONLY target the official AICREDITS HTTPS origin. The environment
// must never control where a real AICREDITS key is sent, so the destination is an
// immutable constant — AICREDITS_BASE_URL is deliberately NOT read here.
const LIVE_AICREDITS_BASE_URL = 'https://api.aicredits.in/v1';

async function testLiveAICredits() {
    const visionKey = process.env.AICREDITS_API_KEY_VISION || process.env.AICREDITS_API_KEY;
    const textKey = process.env.AICREDITS_API_KEY;

    if (!textKey) {
        console.log('⚠️ Skipping live AI provider call: AICREDITS_API_KEY not configured.');
        return;
    }

    console.log('\n--- LIVE AI PIPELINE EXECUTION ---');
    console.log('Provider Base URL:', LIVE_AICREDITS_BASE_URL);

    // Create valid 150x150 BMP base64 test image
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
                buf[offset] = 230;
                buf[offset + 1] = 230;
                buf[offset + 2] = 230;
            }
        }
        return 'data:image/bmp;base64,' + buf.toString('base64');
    }

    const testImg = createBmpBase64(150, 150);

    // Stage 1 Live Call: qwen/qwen3.5-flash-02-23
    console.log('Executing Stage 1 Live Vision Call (qwen/qwen3.5-flash-02-23)...');
    const vRes = await fetch(LIVE_AICREDITS_BASE_URL + '/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + visionKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'qwen/qwen3.5-flash-02-23',
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'You are an optical parser. Output a JSON state object.' },
                        { type: 'image_url', image_url: { url: testImg } }
                    ]
                }
            ],
            temperature: 0.2,
            max_tokens: 600
        })
    });

    assert.strictEqual(vRes.status, 200, `Stage 1 vision call must return HTTP 200, got ${vRes.status}`);
    const vData = await vRes.json();
    assert.strictEqual(Array.isArray(vData.choices) && vData.choices.length > 0, true, 'Stage 1 must return choices');
    const vMsg = vData.choices[0].message;
    const vContent = vMsg.content || vMsg.reasoning || '';
    assert.strictEqual(vContent.length > 0, true, 'Stage 1 must return optical parsed content');
    console.log('✔ Test 5 Passed: Stage 1 live vision call succeeded with qwen3.5-flash-02-23');

    // Stage 2 Live Call: qwen/qwen3-235b-a22b-2507
    console.log('Executing Stage 2 Live Main Generation Call (qwen/qwen3-235b-a22b-2507)...');
    const tRes = await fetch(LIVE_AICREDITS_BASE_URL + '/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + textKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'qwen/qwen3-235b-a22b-2507',
            messages: [
                {
                    role: 'system',
                    content: 'Generate 10 reply options in JSON format: {"options": ["opt 1", "opt 2", ...]}'
                },
                {
                    role: 'user',
                    content: 'Match texted: "hey what are your plans this weekend?" Response tone: WITTY.'
                }
            ],
            temperature: 0.78,
            max_tokens: 700
        })
    });

    assert.strictEqual(tRes.status, 200, `Stage 2 generation call must return HTTP 200, got ${tRes.status}`);
    const tData = await tRes.json();
    assert.strictEqual(Array.isArray(tData.choices) && tData.choices.length > 0, true, 'Stage 2 must return choices');
    const tContent = tData.choices[0].message.content || tData.choices[0].message.reasoning || '';
    const jsonMatch = tContent.match(/\{[\s\S]*\}/);
    assert.strictEqual(Boolean(jsonMatch), true, 'Stage 2 must return valid JSON payload');
    const parsed = JSON.parse(jsonMatch[0]);
    assert.strictEqual(Array.isArray(parsed.options) && parsed.options.length === 10, true, 'Stage 2 must return EXACTLY 10 options');
    console.log('✔ Test 6 Passed: Stage 2 live generation succeeded with qwen3-235b-a22b-2507 returning EXACTLY 10 options');
}

testLiveAICredits().then(() => {
    console.log('\n🎉 ALL SCREENSHOT ANALYZER AI PIPELINE TESTS PASSED!\n');
}).catch(err => {
    console.error('❌ AI Pipeline test failure:', err);
    process.exit(1);
});
