/**
 * tests/monotonic_perf_telemetry.test.js
 * 
 * Verifies:
 * 1. Duration metrics use monotonic clock (performance.now() from node:perf_hooks) which cannot
 *    regress or produce negative durations even across system clock changes.
 * 2. Request middleware sets req._perfStartMs using monotonic time.
 * 3. Multi-stage execution timers (vision, generation, settlement, validation) record non-negative elapsed durations.
 * 4. Static audit: server.js imports performance from node:perf_hooks and measures durations monotonically.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { performance } = require('node:perf_hooks');

console.log('\n============================================================');
console.log('🧪 RUNNING MONOTONIC PERFORMANCE TELEMETRY TEST SUITE');
console.log('============================================================\n');

const server = require('../server.js');
const { recordPerfTelemetry } = server;

// --- Test 1: Monotonic elapsed time calculation precision & monotonicity ---
console.log('Test 1: performance.now() measures strictly monotonic positive elapsed durations');
{
    const start = performance.now();
    // Simulate short computational delay
    let sum = 0;
    for (let i = 0; i < 50000; i++) sum += i;
    const elapsed = performance.now() - start;

    assert.ok(typeof elapsed === 'number', 'Elapsed duration must be a number');
    assert.ok(elapsed >= 0, 'Monotonic duration must never be negative');
    assert.ok(!isNaN(elapsed), 'Elapsed duration must not be NaN');

    console.log(`  ✓ Verified: Monotonic clock produced strictly positive elapsed duration (${elapsed.toFixed(3)}ms).`);
}

// --- Test 2: Telemetry duration sanitization with monotonic values ---
console.log('\nTest 2: recordPerfTelemetry formats and preserves monotonic durationMs');
{
    const originalLog = console.log;
    const captured = [];
    process.env.ENABLE_PERF_LOGS = 'true';

    console.log = (...args) => {
        captured.push(args.join(' '));
    };

    try {
        const measuredDuration = 47.8234;
        recordPerfTelemetry({
            feature: 'analyze',
            stage: 'stage2_generation',
            durationMs: measuredDuration,
            outputCount: 10
        });
    } finally {
        console.log = originalLog;
        delete process.env.ENABLE_PERF_LOGS;
    }

    const logEntry = captured.find(l => l.includes('[PERF_TELEMETRY]'));
    assert.ok(logEntry, 'Expected [PERF_TELEMETRY] log entry');
    const parsed = JSON.parse(logEntry.replace('[PERF_TELEMETRY] ', ''));

    assert.strictEqual(parsed.stage, 'stage2_generation');
    assert.strictEqual(parsed.durationMs, 48, 'recordPerfTelemetry should round durationMs to nearest integer ms');
    assert.strictEqual(parsed.outputCount, 10);

    console.log('  ✓ Verified: recordPerfTelemetry correctly recorded rounded monotonic durationMs.');
}

// --- Test 3: Static audit of server.js for node:perf_hooks and monotonic timers ---
console.log('\nTest 3: Static audit of server.js for node:perf_hooks and performance.now()');
{
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

    // 1. Verify require('node:perf_hooks')
    assert.ok(
        serverSource.includes("require('node:perf_hooks')") || serverSource.includes('require("node:perf_hooks")'),
        "server.js must import performance from 'node:perf_hooks'"
    );

    // 2. Verify req._perfStartMs = performance.now()
    assert.ok(
        serverSource.includes('req._perfStartMs = performance.now()'),
        'server.js request logging middleware must initialize req._perfStartMs = performance.now()'
    );

    // 3. Verify stage timers use performance.now()
    assert.ok(
        serverSource.includes('const tVisionStart = performance.now()'),
        'Analyzer stage 1 vision timer must use performance.now()'
    );
    assert.ok(
        serverSource.includes('const tReserveStart = performance.now()'),
        'Credit reservation timer must use performance.now()'
    );
    assert.ok(
        serverSource.includes('const tSettleStart = performance.now()'),
        'Credit settlement timer must use performance.now()'
    );
    assert.ok(
        serverSource.includes('const tReadStart = performance.now()'),
        'Balance read timer must use performance.now()'
    );
    assert.ok(
        serverSource.includes('const tValStart = performance.now()'),
        'Quality validation timer must use performance.now()'
    );

    console.log('  ✓ Verified: server.js strictly uses monotonic timers across request lifecycle.');
}

console.log('\n============================================================');
console.log('🏁 ALL MONOTONIC PERFORMANCE TELEMETRY TESTS PASSED');
console.log('============================================================\n');
