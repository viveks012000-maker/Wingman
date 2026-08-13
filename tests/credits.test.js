/**
 * =========================================================================================
 * MYWINGMAN USER PROVISIONING & CREDIT SYSTEM INTEGRATION TESTS
 * =========================================================================================
 */

const { initializeDatabase } = require('../database');
const { createUserProvisioningMiddleware } = require('../middleware/userProvisioning');

async function runTests() {
    console.log("🧪 Running MyWingman User Provisioning & Credit System Integration Tests...\n");
    let passed = 0;
    let failed = 0;

    const db = await initializeDatabase();

    // Test 1: User Auto-Provisioning Middleware
    try {
        const autoProvisionUser = createUserProvisioningMiddleware(db);
        const mockReq = { user: { id: 'test_uuid_12345', email: 'testuser@example.com' } };
        const mockRes = {};
        let nextCalled = false;

        await autoProvisionUser(mockReq, mockRes, () => { nextCalled = true; });

        if (!nextCalled) throw new Error("autoProvisionUser middleware did not invoke next()");

        const profile = await db.get('SELECT * FROM user_profiles WHERE user_id = ?', ['test_uuid_12345']);
        if (!profile || profile.user_id !== 'test_uuid_12345') {
            throw new Error("User profile was not created in user_profiles table");
        }
        if (profile.credits_balance !== 0) {
            throw new Error(`Expected initial balance 0, got ${profile.credits_balance}`);
        }

        console.log("✅ TEST 1 PASSED: User Auto-Provisioning Middleware creates profile row with 0 initial credits.");
        passed++;
    } catch (err) {
        console.error("❌ TEST 1 FAILED:", err.message);
        failed++;
    }

    // Test 2: Idempotent User Auto-Provisioning (No Duplicate Creation Error)
    try {
        const autoProvisionUser = createUserProvisioningMiddleware(db);
        const mockReq = { user: { id: 'test_uuid_12345', email: 'testuser@example.com' } };
        await autoProvisionUser(mockReq, {}, () => {});

        const profiles = await db.all('SELECT * FROM user_profiles WHERE user_id = ?', ['test_uuid_12345']);
        if (profiles.length !== 1) {
            throw new Error(`Expected 1 profile row, found ${profiles.length}`);
        }

        console.log("✅ TEST 2 PASSED: User Auto-Provisioning is idempotent and handles existing profiles safely.");
        passed++;
    } catch (err) {
        console.error("❌ TEST 2 FAILED:", err.message);
        failed++;
    }

    // Cleanup test data
    try {
        await db.run('DELETE FROM user_profiles WHERE user_id = ?', ['test_uuid_12345']);
        await db.run('DELETE FROM users_auth WHERE id = ?', ['test_uuid_12345']);
    } catch (e) {}

    console.log(`\n📊 TEST RESULTS: ${passed} Passed, ${failed} Failed.`);
    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    console.error("Fatal test runner error:", err);
    process.exit(1);
});
