const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { readVerifiedCreditState, releaseCreditsDB } = require('../server');

async function runTests() {
    console.log('--- 1. readVerifiedCreditState Unit Tests ---');
    {
        // 1.1 Unauthenticated or guest user returns credits: null, creditsVerified: false
        const guestRes = await readVerifiedCreditState(null);
        assert.deepStrictEqual(guestRes, { credits: null, creditsVerified: false });

        const guestStrRes = await readVerifiedCreditState('guest_user');
        assert.deepStrictEqual(guestStrRes, { credits: null, creditsVerified: false });
        console.log('✔ Passed: Unauthenticated / guest calls return { credits: null, creditsVerified: false }');

        // 1.2 Express request without authenticated user
        const reqMock = { headers: {}, body: {} };
        const reqRes = await readVerifiedCreditState(reqMock);
        assert.deepStrictEqual(reqRes, { credits: null, creditsVerified: false });
        console.log('✔ Passed: Request without user returns { credits: null, creditsVerified: false }');
    }

    console.log('--- 2. releaseCreditsDB Never Invents 0 ---');
    {
        // 2.1 Missing user or reqId returns remainingCredits: null, balanceVerified: false (never 0)
        const rel1 = await releaseCreditsDB(null, 'test_req_123');
        assert.strictEqual(rel1.remainingCredits, null, 'Unauthenticated release must return null remainingCredits');
        assert.strictEqual(rel1.balanceVerified, false, 'Unauthenticated release must mark balanceVerified false');

        const rel2 = await releaseCreditsDB('user_123', null);
        assert.strictEqual(rel2.remainingCredits, null, 'Missing reqId must return null remainingCredits');
        assert.strictEqual(rel2.balanceVerified, false, 'Missing reqId must mark balanceVerified false');
        console.log('✔ Passed: releaseCreditsDB never invents 0 on missing user or reqId');
    }

    console.log('--- 3. Static Audit: Zero Successful Payloads Publish deduction.remainingCredits ---');
    {
        const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

        // Check each paid AI route in server.js
        const paidEndpoints = [
            "'/api/analyze'",
            "'/api/icebreaker'",
            "'/api/optimize'",
            "'/api/chat'",
            "'/api/simulator/review'"
        ];

        for (const ep of paidEndpoints) {
            const idx = serverSource.indexOf(`app.post(${ep}`);
            const altIdx = idx >= 0 ? idx : serverSource.indexOf(`app.post([${ep}`);
            assert.ok(altIdx >= 0, `Route ${ep} must exist in server.js`);
        }

        // Verify that deduction.remainingCredits is NEVER returned in successPayload
        const successPayloadMatches = serverSource.match(/successPayload\s*=\s*\{[\s\S]*?\};/g) || [];
        for (const sp of successPayloadMatches) {
            assert.ok(
                !sp.includes('deduction.remainingCredits'),
                `successPayload must NEVER include deduction.remainingCredits: ${sp}`
            );
            assert.ok(
                !sp.includes('deduction.currentCredits'),
                `successPayload must NEVER include deduction.currentCredits: ${sp}`
            );
            assert.ok(
                sp.includes('creditsVerified'),
                `successPayload must always include creditsVerified: ${sp}`
            );
        }
        console.log('✔ Passed: All success payloads enforce verified credit contract without snapshot fallbacks');
    }

    console.log('All credit verified response contract tests passed!');
}

runTests().catch(err => {
    console.error('Test failure:', err);
    process.exit(1);
});
