/**
 * =========================================================================================
 * MYWINGMAN PAYMENT VERIFICATION & CREDIT LEDGER INTEGRATION TESTS
 * =========================================================================================
 */

const { initializeDatabase } = require('../database');
const { createUserProvisioningMiddleware } = require('../middleware/userProvisioning');

async function runPaymentTests() {
    console.log("🧪 Running MyWingman Payment Ledger & State Sync Integration Tests...\n");
    let passed = 0;
    let failed = 0;

    const db = await initializeDatabase();
    if (!db) {
        console.log("ℹ️ SQLite driver not installed; skipping SQLite payment tests.");
        return;
    }
    const testUserId = 'test_pay_uuid_67890';
    const autoProvisionUser = createUserProvisioningMiddleware(db);

    // Test 1: Auto-Provision User for Payment
    try {
        const mockReq = { user: { id: testUserId, email: 'paytest@example.com' } };
        await autoProvisionUser(mockReq, {}, () => {});

        const profile = await db.get('SELECT * FROM user_profiles WHERE user_id = ?', [testUserId]);
        if (!profile || profile.credits_balance !== 5.00) {
            throw new Error(`Expected initial balance 5.00 (50 credits), got ${profile ? profile.credits_balance : 'null'}`);
        }
        console.log("✅ TEST 1 PASSED: Payment test user auto-provisioned with 50 initial credits (5.00 INR).");
        passed++;
    } catch (err) {
        console.error("❌ TEST 1 FAILED:", err.message);
        failed++;
    }

    // Test 2: Atomic Credit Addition (250 Credits = 25 INR)
    try {
        const addInr = 25; // 250 credits
        await db.exec('BEGIN IMMEDIATE');
        await db.run('UPDATE user_profiles SET credits_balance = ROUND(credits_balance + ?, 2) WHERE user_id = ?', [addInr, testUserId]);
        const purchaseId = 'pur_test_' + Date.now();
        await db.run('INSERT INTO credit_purchases (id, user_id, amount_inr, credits_added, tier_name, payment_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [purchaseId, testUserId, addInr, 250, 'starter', 'pay_test_123', new Date().toISOString()]);
        await db.exec('COMMIT');

        const updatedProfile = await db.get('SELECT * FROM user_profiles WHERE user_id = ?', [testUserId]);
        const credits = Math.round(updatedProfile.credits_balance * 10);
        if (credits !== 250) {
            throw new Error(`Expected 250 credits after top-up, got ${credits}`);
        }

        console.log("✅ TEST 2 PASSED: 250 credits top-up atomically updates SQLite balance to 25 INR (250 credits).");
        passed++;
    } catch (err) {
        try { await db.exec('ROLLBACK'); } catch (e) {}
        console.error("❌ TEST 2 FAILED:", err.message);
        failed++;
    }

    // Test 3: Audit Purchases Log Entry Created
    try {
        const purchases = await db.all('SELECT * FROM credit_purchases WHERE user_id = ?', [testUserId]);
        if (purchases.length !== 1) {
            throw new Error(`Expected 1 credit purchase record, found ${purchases.length}`);
        }
        console.log("✅ TEST 3 PASSED: Audit ledger entry recorded in credit_purchases table.");
        passed++;
    } catch (err) {
        console.error("❌ TEST 3 FAILED:", err.message);
        failed++;
    }

    // Cleanup
    try {
        await db.run('DELETE FROM credit_purchases WHERE user_id = ?', [testUserId]);
        await db.run('DELETE FROM user_profiles WHERE user_id = ?', [testUserId]);
        await db.run('DELETE FROM users_auth WHERE id = ?', [testUserId]);
    } catch (e) {}

    console.log(`\n📊 TEST RESULTS: ${passed} Passed, ${failed} Failed.`);
    if (failed > 0) process.exit(1);
}

runPaymentTests().catch(err => {
    console.error("Fatal test runner error:", err);
    process.exit(1);
});
