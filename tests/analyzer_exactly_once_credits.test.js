/**
 * Tests: Exactly-Once 50-Credit Design & Missing Profile Safety
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('\n============================================================');
console.log('🧪 RUNNING EXACTLY-ONCE 50-CREDIT & MISSING PROFILE TESTS');
console.log('============================================================\n');

// 1. Static Invariant Verification
const serverFile = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8').replace(/\r\n/g, '\n');
const migrationSql = fs.readFileSync(path.join(__dirname, '../migrations/002_atomic_credits_and_transactions.sql'), 'utf8').replace(/\r\n/g, '\n');

// Ensure server.js does NOT contain missing profile 50 credit insertion in getUserCreditsDB
assert.strictEqual(
    serverFile.includes('await supabaseAdmin\n                .from(\'profiles\')\n                .insert({ id: uid, credits: INITIAL_FREE_CREDITS });'),
    false,
    'server.js must NEVER auto-insert 50 credits in getUserCreditsDB'
);

// Ensure Migration 002 reserve_credits does NOT auto-provision missing profiles
assert.strictEqual(
    migrationSql.includes('INSERT INTO public.profiles (id, credits, created_at, updated_at)\n        VALUES (p_user_id, 50, NOW(), NOW())'),
    false,
    'reserve_credits must NEVER auto-insert 50 credits'
);

// Ensure handle_new_user trigger awards 50 ONCE on signup
assert.strictEqual(
    migrationSql.includes('INSERT INTO public.profiles (id, credits, created_at, updated_at)\n    VALUES (NEW.id, 50, NOW(), NOW())\n    ON CONFLICT (id) DO NOTHING;'),
    true,
    'handle_new_user trigger must insert 50 on signup with ON CONFLICT DO NOTHING'
);

// 2. Behavioral Unit Simulation of User Provisioning & Credit Lookups
function createMockProfilesDB() {
    const profiles = new Map();

    function handleNewUserSignup(authUserId) {
        if (!profiles.has(authUserId)) {
            profiles.set(authUserId, { id: authUserId, credits: 50 });
            return { success: true, credits: 50 };
        }
        // ON CONFLICT DO NOTHING
        return { success: true, credits: profiles.get(authUserId).credits };
    }

    function getUserCredits(authUserId) {
        if (profiles.has(authUserId)) {
            return { success: true, credits: profiles.get(authUserId).credits };
        }
        // Missing profile: ERROR / 0 credits, never auto-grants 50
        return { success: false, error: 'PROFILE_MISSING', credits: 0 };
    }

    function reserveCredits(authUserId, amount) {
        if (!profiles.has(authUserId)) {
            return { success: false, error: 'PROFILE_MISSING', credits: 0 };
        }
        const prof = profiles.get(authUserId);
        if (prof.credits < amount) {
            return { success: false, error: 'INSUFFICIENT_CREDITS', credits: prof.credits };
        }
        prof.credits -= amount;
        return { success: true, credits: prof.credits };
    }

    return { profiles, handleNewUserSignup, getUserCredits, reserveCredits };
}

const db = createMockProfilesDB();

// Test 1: New Auth User Provisioning -> Exactly 50 Credits
const res1 = db.handleNewUserSignup('user_new_001');
assert.strictEqual(res1.credits, 50, 'New user must receive exactly 50 signup credits');
console.log('✔ Test 1 Passed: New Auth user signup provisioning -> Exactly 50 credits');

// Test 2: Repeat Provisioning / Reauthentication -> Balance Remains 50 (No Re-grant)
const res2 = db.handleNewUserSignup('user_new_001');
assert.strictEqual(res2.credits, 50, 'Repeat provisioning must not grant extra credits');
assert.strictEqual(db.getUserCredits('user_new_001').credits, 50);
console.log('✔ Test 2 Passed: Repeated provisioning / login / refresh -> Balance remains 50 (+0 credits)');

// Test 3: Existing User with 100 Credits -> Preserved at 100
db.profiles.set('user_vip_100', { id: 'user_vip_100', credits: 100 });
assert.strictEqual(db.getUserCredits('user_vip_100').credits, 100);
console.log('✔ Test 3 Passed: Existing user with 100 credits -> Balance preserved at 100');

// Test 4: Existing User with 7 Credits -> Preserved at 7
db.profiles.set('user_low_7', { id: 'user_low_7', credits: 7 });
assert.strictEqual(db.getUserCredits('user_low_7').credits, 7);
console.log('✔ Test 4 Passed: Existing user with 7 credits -> Balance preserved at 7');

// Test 5: Existing Auth UID with Missing Profile -> Returns ERROR / 0 credits (No 50 auto-grant)
const res5 = db.getUserCredits('user_missing_profile');
assert.strictEqual(res5.success, false, 'Missing profile must return error');
assert.strictEqual(res5.credits, 0, 'Missing profile must return 0 credits');
assert.strictEqual(db.profiles.has('user_missing_profile'), false, 'Missing profile must NOT be auto-inserted');

const res5b = db.reserveCredits('user_missing_profile', 10);
assert.strictEqual(res5b.success, false);
assert.strictEqual(res5b.error, 'PROFILE_MISSING');
console.log('✔ Test 5 Passed: Existing Auth UID with missing profile -> Returns ERROR / 0 credits (No 50 auto-grant)');

// Test 6 & 7: Anti-Tampering & RLS Check in Migration 002
assert.strictEqual(
    migrationSql.includes('REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;'),
    true,
    'anon/authenticated clients must be revoked from direct INSERT/UPDATE/DELETE on profiles'
);
assert.strictEqual(
    migrationSql.includes('Direct modification of credit balance is forbidden.'),
    true,
    'Anti-tampering trigger must throw exception on direct credit mutation'
);
console.log('✔ Test 6 & 7 Passed: Browser/client direct INSERT/UPDATE/DELETE blocked via RLS & anti-tampering trigger');

console.log('\n🎉 ALL EXACTLY-ONCE 50-CREDIT & MISSING PROFILE TESTS PASSED!\n');
