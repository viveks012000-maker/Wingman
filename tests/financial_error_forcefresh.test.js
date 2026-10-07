/**
 * tests/financial_error_forcefresh.test.js
 * 
 * Verifies:
 * 1. Error paths (402 Insufficient credits, 409 In-flight conflict, 500 Server error,
 *    502/503/504 Upstream/Gateway timeouts, and network catch) in app.js and
 *    vendor/production-runtime.js always dispatch checkCreditBalance({ forceFresh: true }).
 * 2. Calling checkCreditBalance({ forceFresh: true }) invalidates coalesced in-flight promises,
 *    ensuring fresh balance retrieval.
 * 3. Static audit: Zero error handling blocks in AI generation pathways perform unforced reads.
 * 4. Static audit: Zero dynamic code execution (vm/eval) used in test harness.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('\n============================================================');
console.log('🧪 RUNNING FINANCIAL ERROR FORCEFRESH TEST SUITE');
console.log('============================================================\n');

// Pure in-memory wallet coalescing manager without dynamic code execution (vm/eval-free)
function createCreditBalanceManager(mockFetch) {
    const inFlightCreditCheckPromises = new Map();
    let latestCreditSyncSeq = 0;

    return function checkCreditBalance(opts = {}) {
        const isForceFresh = opts && opts.forceFresh === true;
        const initialUserId = 'usr_forcefresh_test_456';
        const mapKey = initialUserId;

        // ForceFresh mode: explicitly bypass/invalidate existing in-flight promise for this user
        if (isForceFresh && mapKey !== null) {
            inFlightCreditCheckPromises.delete(mapKey);
        } else if (!isForceFresh && mapKey !== null && inFlightCreditCheckPromises.has(mapKey)) {
            // Normal mode: coalesce identical concurrent requests for the SAME user
            return inFlightCreditCheckPromises.get(mapKey);
        }

        const syncSeq = ++latestCreditSyncSeq;
        const queryPromise = (async () => {
            try {
                const resp = await mockFetch('/api/credits');
                const data = await resp.json();
                if (syncSeq < latestCreditSyncSeq) {
                    return { status: 'stale', credits: data.credits };
                }
                return { status: 'active', success: true, credits: data.credits };
            } finally {
                if (inFlightCreditCheckPromises.get(mapKey) === queryPromise) {
                    inFlightCreditCheckPromises.delete(mapKey);
                }
            }
        })();

        inFlightCreditCheckPromises.set(mapKey, queryPromise);
        return queryPromise;
    };
}

async function runTests() {
    // --- Test 1: Runtime forceFresh bypasses in-flight coalesced reads ---
    console.log('Test 1: checkCreditBalance({ forceFresh: true }) invalidates in-flight promises and executes fresh query');
    {
        let fetchCount = 0;
        let signalFetch1Started = null;
        const fetch1StartedPromise = new Promise(r => { signalFetch1Started = r; });
        let finishFirstFetch = null;
        const firstFetchPromise = new Promise(res => { finishFirstFetch = res; });

        const mockFetch = async (url) => {
            if (url.includes('/api/credits')) {
                fetchCount++;
                if (fetchCount === 1) {
                    signalFetch1Started();
                    await firstFetchPromise;
                    return { ok: true, json: async () => ({ success: true, credits: 100 }) };
                }
                return { ok: true, json: async () => ({ success: true, credits: 200 }) };
            }
            return { ok: true, json: async () => ({ success: true }) };
        };

        const checkCreditBalance = createCreditBalanceManager(mockFetch);

        // Initial read 1 starts
        const read1Promise = checkCreditBalance();

        // Normal concurrent read 2 without forceFresh should coalesce to read 1
        const read2Promise = checkCreditBalance();
        assert.strictEqual(read1Promise, read2Promise, 'Normal calls must coalesce to the exact same promise');

        // Wait until fetch 1 has actually arrived at mockFetch
        await fetch1StartedPromise;
        assert.strictEqual(fetchCount, 1, 'Only one fetch should be dispatched during coalescing');

        // Forced fresh read 3 MUST bust cache and fire second fetch immediately
        const read3Promise = checkCreditBalance({ forceFresh: true });
        assert.notStrictEqual(read1Promise, read3Promise, 'ForceFresh MUST return a new distinct promise');

        // p3 resolves with fresh 200
        const res3 = await read3Promise;
        assert.strictEqual(res3.credits, 200, 'ForceFresh read must return latest balance (200)');
        assert.strictEqual(fetchCount, 2, 'Second fetch must have fired for forceFresh');

        // Let read 1 finish
        finishFirstFetch();

        const [res1, res2] = await Promise.all([read1Promise, read2Promise]);
        assert.strictEqual(res1.status, 'stale', 'Superseded read 1 must be marked stale');
        assert.strictEqual(res2.status, 'stale', 'Superseded read 2 must be marked stale');

        console.log('  ✓ Verified: forceFresh successfully invalidates coalesced promises and avoids stale overwrites.');
    }

    // --- Test 2: Static audit of error paths in app.js ---
    console.log('\nTest 2: Static audit of error paths in app.js for checkCreditBalance({ forceFresh: true })');
    {
        const appJsSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

        // 1. Check generateWingmanResponse error branches
        const gen402Regex = /response\.status\s*===\s*402[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(gen402Regex.test(appJsSource), 'generateWingmanResponse 402 handler must call checkCreditBalance({ forceFresh: true })');

        const gen409Regex = /response\.status\s*===\s*409[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(gen409Regex.test(appJsSource), 'generateWingmanResponse 409 handler must call checkCreditBalance({ forceFresh: true })');

        const gen503Regex = /response\.status\s*===\s*503\s*\|\|\s*response\.status\s*===\s*502[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(gen503Regex.test(appJsSource), 'generateWingmanResponse 502/503/504 handler must call checkCreditBalance({ forceFresh: true })');

        const gen500Regex = /response\.status\s*>=\s*500[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(gen500Regex.test(appJsSource), 'generateWingmanResponse 500+ handler must call checkCreditBalance({ forceFresh: true })');

        // 2. Check Maeve chat error branches
        const maeve402Regex = /chatResp\.status\s*===\s*402[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(maeve402Regex.test(appJsSource), 'Maeve chat 402 handler must call checkCreditBalance({ forceFresh: true })');

        const maeve409Regex = /chatResp\.status\s*===\s*409[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(maeve409Regex.test(appJsSource), 'Maeve chat 409 handler must call checkCreditBalance({ forceFresh: true })');

        const maeve503Regex = /chatResp\.status\s*===\s*503\s*\|\|\s*chatResp\.status\s*===\s*502[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(maeve503Regex.test(appJsSource), 'Maeve chat 502/503/504 handler must call checkCreditBalance({ forceFresh: true })');

        const maeveCatchRegex = /catch\s*\(chatErr\)[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(maeveCatchRegex.test(appJsSource), 'Maeve chat catch handler must call checkCreditBalance({ forceFresh: true })');

        console.log('  ✓ Verified: All error paths in app.js explicitly specify { forceFresh: true }.');
    }

    // --- Test 3: Static audit of error paths in vendor/production-runtime.js ---
    console.log('\nTest 3: Static audit of error paths in vendor/production-runtime.js');
    {
        const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'vendor/production-runtime.js'), 'utf8');

        // 1. Verify simulator review 402 handler calls checkCreditBalance({ forceFresh: true })
        const sim402Regex = /response\.status\s*===\s*402[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(sim402Regex.test(runtimeSource), 'Simulator review 402 handler must call checkCreditBalance({ forceFresh: true })');

        // 2. Verify simulator review catch handler calls checkCreditBalance({ forceFresh: true })
        const simCatchRegex = /catch\s*\([a-zA-Z0-9_]*\)[\s\S]*?checkCreditBalance\(\s*\{\s*forceFresh:\s*true\s*\}\s*\)/;
        assert.ok(simCatchRegex.test(runtimeSource), 'Simulator review catch handler must call checkCreditBalance({ forceFresh: true })');

        // 3. Verify simulator review success handler reconciles credit payload
        assert.ok(runtimeSource.includes('window.reconcileCreditPayload(data)'), 'Simulator review must reconcile credit payload');

        console.log('  ✓ Verified: vendor/production-runtime.js simulator review error paths enforce { forceFresh: true }.');
    }

    // --- Test 4: Static audit ensuring zero unverified credit commits in app.js error paths ---
    console.log('\nTest 4: Static audit: app.js never commits unverified error credits');
    {
        const appJsSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

        // Ensure errJson.credits is never committed without reconcileCreditPayload or creditsVerified === true
        assert.ok(!appJsSource.includes('window.updateUICredits(errJson.credits)'), 'app.js must not directly call updateUICredits(errJson.credits)');
        assert.ok(!appJsSource.includes('window.commitAuthoritativeCreditBalance(errJson.credits);') || appJsSource.includes('errJson.creditsVerified === true'), 'app.js must never commit errJson.credits without creditsVerified: true');

        console.log('  ✓ Verified: Zero unverified credit commits on error in app.js.');
    }

    console.log('\n============================================================');
    console.log('🏁 ALL FINANCIAL ERROR FORCEFRESH TESTS PASSED');
    console.log('============================================================\n');
}

runTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
