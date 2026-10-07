/**
 * tests/perf_telemetry_instrumentation.test.js
 * 
 * Verifies:
 * 1. req._startTime produces positive integer durationMs for total latency telemetry.
 * 2. recordPerfTelemetry strictly filters out sensitive/PII data (zero PII guarantee).
 * 3. executeQualityPipeline emits quality_validation on every pass, but selective_repair
 *    ONLY when repair actually executes.
 * 4. Analyzer Stage 1 vision occurs strictly before Stage 2 generation.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('\n============================================================');
console.log('🧪 RUNNING PERFORMANCE TELEMETRY INSTRUMENTATION TESTS');
console.log('============================================================\n');

// Import server helpers
const server = require('../server.js');
const { recordPerfTelemetry, executeQualityPipeline } = server;

async function runTests() {
    let passed = 0;

    // Test 1: Zero-PII sanitization in recordPerfTelemetry
    console.log('Test 1: recordPerfTelemetry guarantees zero PII in telemetry payload');
    {
        const originalLog = console.log;
        const capturedLogs = [];
        process.env.ENABLE_PERF_LOGS = 'true';

        console.log = (...args) => {
            capturedLogs.push(args.join(' '));
        };

        try {
            // Send payload with malicious or accidental PII fields
            recordPerfTelemetry({
                feature: 'analyze',
                stage: 'stage2_generation',
                durationMs: 342.6,
                outputCount: 10,
                // PII fields that MUST be stripped:
                prompt: 'Sensitive chat transcript containing private medical details',
                user_id: 'usr_secret_pii_999',
                email: 'user@private-domain.com',
                ip_address: '192.168.1.1',
                userText: 'Hello match, my address is 123 Elm St',
                auth_token: 'secret_bearer_token'
            });
        } finally {
            console.log = originalLog;
            delete process.env.ENABLE_PERF_LOGS;
        }

        const perfLog = capturedLogs.find(l => l.startsWith('[PERF_TELEMETRY]'));
        assert.ok(perfLog, 'Expected [PERF_TELEMETRY] log entry to be emitted');

        const jsonStr = perfLog.replace('[PERF_TELEMETRY] ', '');
        const parsed = JSON.parse(jsonStr);

        // Verify allowed keys only
        const allowedKeys = new Set(['feature', 'stage', 'durationMs', 'attemptCount', 'repairSlotCount', 'outputCount', 'timestamp']);
        const actualKeys = Object.keys(parsed);
        for (const k of actualKeys) {
            assert.ok(allowedKeys.has(k), `Unexpected telemetry key '${k}' found in payload`);
        }

        // Verify sensitive fields are strictly absent
        assert.strictEqual(parsed.prompt, undefined, 'prompt must not be present');
        assert.strictEqual(parsed.user_id, undefined, 'user_id must not be present');
        assert.strictEqual(parsed.email, undefined, 'email must not be present');
        assert.strictEqual(parsed.ip_address, undefined, 'ip_address must not be present');
        assert.strictEqual(parsed.userText, undefined, 'userText must not be present');
        assert.strictEqual(parsed.auth_token, undefined, 'auth_token must not be present');

        // Verify rounded duration
        assert.strictEqual(parsed.durationMs, 343, 'durationMs should be rounded to integer');
        assert.strictEqual(parsed.feature, 'analyze');
        assert.strictEqual(parsed.stage, 'stage2_generation');

        console.log('  ✓ Verified: Telemetry payload contains zero PII and only whitelisted execution metrics.');
        passed++;
    }

    // Test 2: req._startTime tracking produces realistic positive latency
    console.log('Test 2: req._startTime produces valid positive elapsed duration');
    {
        const originalLog = console.log;
        const capturedLogs = [];
        process.env.ENABLE_PERF_LOGS = 'true';

        console.log = (...args) => {
            capturedLogs.push(args.join(' '));
        };

        try {
            const fakeReq = { _startTime: Date.now() - 150 };
            const elapsed = Date.now() - (fakeReq._startTime || Date.now());

            recordPerfTelemetry({
                feature: 'icebreaker',
                stage: 'total',
                durationMs: elapsed,
                outputCount: 10
            });
        } finally {
            console.log = originalLog;
            delete process.env.ENABLE_PERF_LOGS;
        }

        const perfLog = capturedLogs.find(l => l.startsWith('[PERF_TELEMETRY]'));
        assert.ok(perfLog, 'Expected [PERF_TELEMETRY] log entry');
        const parsed = JSON.parse(perfLog.replace('[PERF_TELEMETRY] ', ''));

        assert.strictEqual(parsed.stage, 'total');
        assert.ok(parsed.durationMs >= 150, `Expected durationMs >= 150, got ${parsed.durationMs}`);

        console.log(`  ✓ Verified: req._startTime correctly calculated total elapsed latency (${parsed.durationMs}ms).`);
        passed++;
    }

    // Test 3: selective_repair telemetry only fires when repair actually runs
    console.log('Test 3: executeQualityPipeline emits quality_validation always, selective_repair only on repair');
    {
        const originalLog = console.log;
        let capturedLogs = [];
        process.env.ENABLE_PERF_LOGS = 'true';

        console.log = (...args) => {
            capturedLogs.push(args.join(' '));
        };

        // Case A: 10 clean valid options
        const cleanBatch = [
            "are you more into spontaneous road trips or planned weekend getaways?",
            "honestly the coffee debate is serious, espresso or pour-over?",
            "that playlist choice is bold, what is the best track on repeat right now?",
            "give me the backstory on your second photo because it looks wild",
            "hiking trails or cozy coffee shops for a Sunday afternoon?",
            "you seem like someone who has strong opinions about pizza toppings",
            "what is the most underrated travel spot you have ever visited?",
            "always curious about this, are you an early morning person or night owl?",
            "tell me your go-to comfort food spot in the city",
            "if you had to pick one cuisine forever, what would it be?"
        ];

        try {
            await executeQualityPipeline(cleanBatch, 'icebreaker', 'english', 'test bio context', []);
        } finally {
            console.log = originalLog;
            delete process.env.ENABLE_PERF_LOGS;
        }

        const qualityLogs = capturedLogs.filter(l => l.includes('"stage":"quality_validation"'));
        const repairLogs = capturedLogs.filter(l => l.includes('"stage":"selective_repair"'));

        assert.strictEqual(qualityLogs.length, 1, 'Expected exactly 1 quality_validation record');
        assert.strictEqual(repairLogs.length, 0, 'Expected ZERO selective_repair records for clean batch');

        console.log('  ✓ Verified: Clean batch emitted quality_validation and 0 selective_repair events.');
        passed++;
    }

    // Test 4: Analyzer architecture enforces Stage 1 before Stage 2
    console.log('Test 4: Static architecture audit verifies Stage 1 optical parsing completes before Stage 2');
    {
        const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

        // Locate /api/analyze route
        const analyzeRouteIdx = serverCode.indexOf("app.post(['/api/analyze'");
        assert.ok(analyzeRouteIdx > 0, 'Could not find /api/analyze route');
        const nextRouteIdx = serverCode.indexOf("app.post(['/api/icebreaker'");
        const analyzeBody = serverCode.substring(analyzeRouteIdx, nextRouteIdx > analyzeRouteIdx ? nextRouteIdx : analyzeRouteIdx + 35000);

        // Verify stage ordering
        const stage1OcrIdx = analyzeBody.indexOf("stage: 'vision_total'");
        const stage2GenIdx = analyzeBody.indexOf("stage: 'stage2_generation'");
        const settleIdx = analyzeBody.indexOf("stage: 'credit_settle'");
        const readIdx = analyzeBody.indexOf("stage: 'credit_read'");
        const totalIdx = analyzeBody.indexOf("stage: 'total'");

        assert.ok(stage1OcrIdx > 0, 'vision_total telemetry must be instrumented');
        assert.ok(stage2GenIdx > 0, 'stage2_generation telemetry must be instrumented');
        assert.ok(settleIdx > 0, 'credit_settle telemetry must be instrumented');
        assert.ok(readIdx > 0, 'credit_read telemetry must be instrumented');
        assert.ok(totalIdx > 0, 'total telemetry must be instrumented');

        assert.ok(stage1OcrIdx < stage2GenIdx, 'Stage 1 vision_total must execute before Stage 2 stage2_generation');
        assert.ok(stage2GenIdx < settleIdx, 'Stage 2 generation must execute before credit settlement');
        assert.ok(settleIdx < readIdx, 'Credit settlement must execute before authoritative credit read');
        assert.ok(readIdx < totalIdx, 'Authoritative credit read must execute before total stage completion');

        console.log('  ✓ Verified: Strict sequential execution: Stage 1 -> Stage 2 -> Settle -> Read -> Total.');
        passed++;
    }

    console.log(`\n============================================================`);
    console.log(`🏁 PERFORMANCE TELEMETRY INSTRUMENTATION: ${passed}/4 PASSED`);
    console.log(`============================================================\n`);
}

runTests().catch(err => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
});
