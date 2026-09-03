'use strict';

/**
 * LIVE-PROVIDER ORIGIN LOCK regression suite (CodeQL #31/#32).
 *
 * Vulnerability (fixed): tests/analyzer_ai_pipeline.test.js built its live
 * credential-bearing fetch destination from process.env.AICREDITS_BASE_URL, so a
 * hostile environment value could receive the real AICREDITS Authorization header.
 *
 * Proven here, with zero network traffic (fetch fully stubbed via preload):
 *  1. The test file no longer reads process.env.AICREDITS_BASE_URL at all.
 *  2. The live destination is the immutable official HTTPS origin constant.
 *  3. Executing the live path with AICREDITS_BASE_URL=https://attacker.invalid/v1
 *     and a dummy key contacts ONLY the official origin — attacker.invalid is never
 *     contacted and the Authorization header never leaves the official destination.
 *  4. Both Stage 1 and Stage 2 sinks obey the invariant.
 *  5. Malformed origin variants cannot appear or influence the destination.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TEST_FILE = path.join(__dirname, 'analyzer_ai_pipeline.test.js');
const source = fs.readFileSync(TEST_FILE, 'utf8').replace(/\r\n/g, '\n');

const OFFICIAL = 'https://api.aicredits.in/v1';

async function run() {
    // ---------- Static invariant: the taint source is gone ----------
    assert.strictEqual(
        source.includes('process.env.AICREDITS_BASE_URL'),
        false,
        'the test file must never read AICREDITS_BASE_URL (taint source removed)'
    );
    assert.ok(
        source.includes("const LIVE_AICREDITS_BASE_URL = 'https://api.aicredits.in/v1';"),
        'destination must be the immutable official HTTPS origin constant'
    );

    // Exactly two credential-bearing fetch sinks, both built from the constant.
    const fetchSites = source.match(/await fetch\([^)]*\)/g) || [];
    assert.strictEqual(fetchSites.length, 2, `exactly two live fetch sinks expected, found ${fetchSites.length}`);
    for (const site of fetchSites) {
        assert.ok(site.includes('LIVE_AICREDITS_BASE_URL'), `live fetch sink must use the immutable constant: ${site}`);
        assert.ok(site.includes("'/chat/completions'"), `live fetch sink must target the chat/completions path: ${site}`);
        assert.ok(!site.includes('env.') && !site.includes('${'), `no dynamic destination interpolation allowed: ${site}`);
    }
    // Both sinks are the credential-bearing Stage 1 and Stage 2 calls.
    assert.ok(source.includes("'Authorization': 'Bearer ' + visionKey"), 'Stage 1 credential sink present');
    assert.ok(source.includes("'Authorization': 'Bearer ' + textKey"), 'Stage 2 credential sink present');
    console.log('PASS | static invariant: env taint source removed; both sinks locked to the official origin');

    // ---------- Malformed variants cannot exist in or influence the destination ----------
    for (const hostile of [
        "http://api.aicredits.in/v1",
        "https://api.aicredits.in.evil.example/v1",
        "https://evil.example/?next=api.aicredits.in",
        "https://user@evil.example/v1",
        'https://attacker.invalid/v1'
    ]) {
        assert.ok(!source.includes(hostile), `hostile origin must never appear in the live test: ${hostile}`);
    }
    console.log('PASS | malformed/hostile origin variants absent from the destination construction');

    // ---------- Behavioral proof: env attack value + dummy key + full fetch stub ----------
    const logFile = path.join(os.tmpdir(), 'wingman-origin-lock-probe.json');
    const preloadPath = path.join(__dirname, 'fixtures', 'origin-lock-preload.js');
    const childEnv = {
        ...process.env,
        AICREDITS_BASE_URL: 'https://attacker.invalid/v1',
        AICREDITS_API_KEY: 'DUMMY_TEST_KEY_NOT_REAL',
        AICREDITS_API_KEY_VISION: 'DUMMY_TEST_KEY_NOT_REAL',
        NODE_OPTIONS: '--require ' + JSON.stringify(preloadPath),
        NODE_ENV: 'test'
    };
    delete childEnv.RAILWAY_ENVIRONMENT;

    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
    execFileSync(process.execPath, [TEST_FILE], { env: childEnv, stdio: 'ignore', timeout: 120000 });

    assert.ok(fs.existsSync(logFile), 'fetch interception log must exist');
    const attempts = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    assert.ok(attempts.length >= 2, `both live stages must have dispatched (got ${attempts.length} fetch attempts)`);

    for (const a of attempts) {
        assert.ok(
            a.url.startsWith(OFFICIAL + '/'),
            `credential-bearing request must only target the official origin, saw: ${a.url}`
        );
        assert.ok(!a.url.includes('attacker.invalid'), 'attacker host must never be contacted');
        assert.ok(a.hasAuth, 'live requests must still carry their (dummy) credentials to the official origin');
    }
    // The attacker-controlled env value must have been completely ignored.
    assert.ok(!attempts.some(a => a.url.includes('attacker.invalid')), 'AICREDITS_BASE_URL attack value must be inert');

    console.log(`PASS | behavioral: ${attempts.length} intercepted live dispatches, all locked to ${OFFICIAL}; attacker.invalid never contacted`);

    // ---------- Official provider destination documented ----------
    console.log('OFFICIAL PROVIDER DESTINATION: ' + OFFICIAL);
    console.log('LIVE-PROVIDER ORIGIN LOCK: ALL TESTS PASSED');
}

run().catch(error => {
    console.error(error && error.stack || error);
    process.exit(1);
});
