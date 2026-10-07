/**
 * tests/production_log_privacy.test.js
 * 
 * Verifies:
 * 1. Zero user PII in recordPerfTelemetry: user_id, email, ip, tokens, and prompt text are rejected.
 * 2. Server logs across all paid AI routes (/api/analyze, /api/icebreaker, /api/optimize, /api/chat, /api/simulator/review)
 *    never output raw opKey (which embeds userId).
 * 3. executeQualityPipeline logs only validation metadata (index, reason) and never prints user option text.
 * 4. Static audit: server.js contains zero console logs printing opKey.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('\n============================================================');
console.log('🧪 RUNNING PRODUCTION LOG PRIVACY TEST SUITE');
console.log('============================================================\n');

const server = require('../server.js');
const {
    recordPerfTelemetry,
    executeQualityPipeline,
    logRef
} = server;

async function runTests() {
    // --- Test 1: recordPerfTelemetry filters out all sensitive user data and PII ---
    console.log('Test 1: recordPerfTelemetry filters out all sensitive user data and PII');
    {
        const originalLog = console.log;
        const capturedLogs = [];
        process.env.ENABLE_PERF_LOGS = 'true';

        console.log = (...args) => {
            capturedLogs.push(args.join(' '));
        };

        try {
            recordPerfTelemetry({
                feature: 'analyze',
                stage: 'stage1_vision',
                durationMs: 120.5,
                // Sensitive fields that MUST be stripped:
                user_id: 'usr_secret_pii_12345',
                email: 'private_user@example.com',
                ip_address: '203.0.113.195',
                prompt: 'Private conversation with sensitive details',
                auth_token: 'secret_jwt_token',
                text: 'User profile bio with personal telephone number 555-0199'
            });
        } finally {
            console.log = originalLog;
            delete process.env.ENABLE_PERF_LOGS;
        }

        const logEntry = capturedLogs.find(l => l.includes('[PERF_TELEMETRY]'));
        assert.ok(logEntry, 'Expected [PERF_TELEMETRY] log entry');

        assert.ok(!logEntry.includes('usr_secret_pii_12345'), 'Must NOT contain user_id');
        assert.ok(!logEntry.includes('private_user@example.com'), 'Must NOT contain email');
        assert.ok(!logEntry.includes('203.0.113.195'), 'Must NOT contain ip_address');
        assert.ok(!logEntry.includes('Private conversation'), 'Must NOT contain prompt');
        assert.ok(!logEntry.includes('secret_jwt_token'), 'Must NOT contain auth_token');
        assert.ok(!logEntry.includes('555-0199'), 'Must NOT contain text');

        console.log('  ✓ Verified: recordPerfTelemetry stripped all sensitive parameters.');
    }

    // --- Test 2: executeQualityPipeline logs only metadata, never option text ---
    console.log('\nTest 2: executeQualityPipeline logs only metadata (index, reason) and zero option text');
    {
        const originalWarn = console.warn;
        const capturedWarns = [];

        console.warn = (...args) => {
            capturedWarns.push(args.join(' '));
        };

        const privateOptionText = "Private user detail with secret phone 9876543210 and sensitive medical info";
        const invalidBatch = [
            "Normal compliant casual greeting for testing purposes here",
            privateOptionText, // Will fail profile or length validation
            "Another clean option with adequate length and proper tone",
            "Fourth clean option with good quality wording for test",
            "Fifth clean option with good structure and natural rhythm",
            "Sixth clean option with nice conversation angle",
            "Seventh clean option with observational question",
            "Eighth clean option with playful curiosity",
            "Ninth clean option with relaxed signoff",
            "Tenth clean option with fun banter"
        ];

        try {
            await executeQualityPipeline(
                invalidBatch,
                "icebreaker",
                "en",
                "bio context",
                [],
                Date.now() + 10000
            );
        } catch (e) {
            // Pipeline may reject or throw when reaching repair if external mock is unset
        } finally {
            console.warn = originalWarn;
        }

        // Check all captured warnings
        for (const msg of capturedWarns) {
            assert.ok(!msg.includes(privateOptionText), `Log warning leaked user option text: ${msg}`);
            assert.ok(!msg.includes("9876543210"), `Log warning leaked sensitive phone number: ${msg}`);
        }

        console.log('  ✓ Verified: executeQualityPipeline warnings contain zero raw option text.');
    }

    // --- Test 3: Static audit of server.js for opKey log leakage ---
    console.log('\nTest 3: Static audit of server.js verifies opKey is never passed to console logging');
    {
        const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

        // Regex checking for console.log/warn/error logging opKey
        const opKeyLogRegex = /console\.(?:log|warn|error|info)\([^)]*opKey[^)]*\)/g;
        const matches = serverSource.match(opKeyLogRegex) || [];

        // Filter out comments if any
        const codeMatches = matches.filter(m => !m.trim().startsWith('//'));

        assert.strictEqual(
            codeMatches.length,
            0,
            `Found ${codeMatches.length} console log statements logging opKey: ${codeMatches.join(', ')}`
        );

        console.log('  ✓ Verified: Zero occurrences of opKey logged in server.js.');
    }

    // --- Test 4: Static audit of executeQualityPipeline logging ---
    console.log('\nTest 4: Static audit of executeQualityPipeline in server.js');
    {
        const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

        const fnMatch = serverSource.match(/async function executeQualityPipeline\([\s\S]*?\n\}/);
        assert.ok(fnMatch, 'executeQualityPipeline must exist in server.js');

        const fnBody = fnMatch[0];

        // Ensure we log { index: ..., reason: ... } and not opt or options
        assert.ok(fnBody.includes('index: d.index'), 'Must log index property');
        assert.ok(fnBody.includes('reason: d.reason'), 'Must log reason property');
        assert.ok(!fnBody.includes('text: d.opt') && !fnBody.includes('text: d.text'), 'Must NOT log text in validation details');

        console.log('  ✓ Verified: executeQualityPipeline only logs index and reason metadata.');
    }

    // --- Test 5: logRef helper produces 12-char irreversible hashes and audits server.js ---
    console.log('\nTest 5: logRef produces 12-char irreversible hash and audits server.js logs');
    {
        assert.strictEqual(typeof logRef, 'function', 'logRef must be exported');
        const hash1 = logRef('usr_sensitive_user_id_123');
        const hash2 = logRef('req_client_request_id_456');
        assert.strictEqual(hash1.length, 12, 'logRef must produce 12-char hash');
        assert.strictEqual(hash2.length, 12, 'logRef must produce 12-char hash');
        assert.notStrictEqual(hash1, 'usr_sensitive_user_id_123');
        assert.notStrictEqual(hash2, 'req_client_request_id_456');
        assert.strictEqual(logRef(null), 'none', 'logRef(null) must return "none"');
        assert.strictEqual(logRef(undefined), 'none', 'logRef(undefined) must return "none"');
        assert.strictEqual(logRef(''), 'none', 'logRef("") must return "none"');

        const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
        assert.ok(!serverSource.includes('safeLogValue(uid)'), 'server.js must NOT pass raw uid to safeLogValue');
        assert.ok(!serverSource.includes('safeLogValue(reqId)'), 'server.js must NOT pass raw reqId to safeLogValue');
        assert.ok(serverSource.includes('logRef(uid)'), 'server.js must use logRef(uid)');
        assert.ok(serverSource.includes('logRef(reqId)'), 'server.js must use logRef(reqId)');

        console.log('  ✓ Verified: Zero raw uid/reqId passed to safeLogValue in server.js.');
    }

    console.log('\n============================================================');
    console.log('🏁 ALL PRODUCTION LOG PRIVACY TESTS PASSED');
    console.log('============================================================\n');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
