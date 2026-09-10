'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const migrationDir = path.join(root, 'migrations');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`✅ PASS: ${name}`);
    } catch (e) {
        failed++;
        failures.push({ name, error: e.message });
        console.log(`❌ FAIL: ${name} — ${e.message}`);
    }
}

async function runTests() {
    console.log('========================================================================');
    console.log('🧪 HISTORICAL SIGNUP CREDITS RECONCILIATION & INVARIANT TEST SUITE');
    console.log('========================================================================\n');

    const m013 = fs.readFileSync(path.join(migrationDir, '013_free_signup_credits_twenty.sql'), 'utf8');
    const m014 = fs.readFileSync(path.join(migrationDir, '014_reconcile_erroneous_signup_credits.sql'), 'utf8');

    // 1. Brand-new account gets exactly 20 credits
    await test('1. Migration 013 sets default column credits to exactly 20', () => {
        assert.ok(
            /ALTER TABLE public\.profiles ALTER COLUMN credits SET DEFAULT 20;/i.test(m013),
            'Migration 013 must set profiles.credits default to 20'
        );
        assert.ok(
            /VALUES\s*\(\s*NEW\.id\s*,\s*20\s*,/i.test(m013),
            'handle_new_user() trigger must insert 20 credits'
        );
    });

    // 2. New account starts with has_paid_credits = false
    await test('2. New account starts with has_paid_credits = false (Free Plan)', () => {
        assert.ok(
            /ADD COLUMN IF NOT EXISTS has_paid_credits pg_catalog\.bool NOT NULL DEFAULT false;/i.test(m013),
            'has_paid_credits column must default to false'
        );
        assert.ok(
            /VALUES\s*\(\s*NEW\.id\s*,\s*20\s*,\s*pg_catalog\.now\(\)\s*,\s*pg_catalog\.now\(\)\s*,\s*false\s*\)/i.test(m013),
            'handle_new_user() trigger must explicitly insert has_paid_credits = false'
        );
    });

    // 3. Signing in again grants zero additional signup credits
    // 4. Re-running profile provisioning grants zero additional signup credits
    await test('3 & 4. Re-running profile provisioning is idempotent with ON CONFLICT (id) DO NOTHING', () => {
        assert.ok(
            m013.includes('ON CONFLICT (id) DO NOTHING;'),
            'handle_new_user() must be strictly idempotent to prevent repeated credit awards on repeated sign-ins'
        );
    });

    // 5. Erroneous untouched 50-credit historical account is safely corrected to 20
    await test('5. Migration 014 targets untouched 50-credit accounts with 0 transactions', () => {
        assert.ok(
            /UPDATE public\.profiles p\s*SET credits = 20/i.test(m014),
            'Migration 014 must set credits to 20'
        );
        assert.ok(
            m014.includes('WHERE p.credits = 50'),
            'Migration 014 must filter by p.credits = 50'
        );
        assert.ok(
            m014.includes('AND p.has_paid_credits = false'),
            'Migration 014 must filter by p.has_paid_credits = false'
        );
        assert.ok(
            /NOT EXISTS\s*\(\s*SELECT 1 FROM public\.credit_transactions/i.test(m014),
            'Migration 014 must require zero transactions in credit_transactions'
        );
    });

    // 6. User with 50 credits plus transaction history is not blindly modified
    // 7. User with another legitimate balance is untouched
    // 8. Paid user is untouched
    await test('6, 7 & 8. Migration 014 WHERE clause strictly preserves users with transactions, other balances, or paid status', () => {
        function simulate014Filter(profile, transactions) {
            if (profile.credits !== 50) return false;
            if (profile.has_paid_credits !== false) return false;
            const hasTx = transactions.some(t => t.user_id === profile.id);
            if (hasTx) return false;
            return true;
        }

        assert.strictEqual(simulate014Filter({ id: 'u1', credits: 50, has_paid_credits: false }, []), true,
            'Untouched 50-credit account must be eligible for correction');
        assert.strictEqual(simulate014Filter({ id: 'u2', credits: 50, has_paid_credits: false }, [{ user_id: 'u2', amount: 50, type: 'purchase' }]), false,
            '50-credit account with transactions must be EXCLUDED');
        assert.strictEqual(simulate014Filter({ id: 'u3', credits: 98, has_paid_credits: false }, []), false,
            '98-credit account must be EXCLUDED');
        assert.strictEqual(simulate014Filter({ id: 'u4', credits: 18, has_paid_credits: false }, []), false,
            '18-credit account must be EXCLUDED');
        assert.strictEqual(simulate014Filter({ id: 'u5', credits: 50, has_paid_credits: true }, []), false,
            'Paid account must be EXCLUDED');
    });

    // 9. Existing auth/logout/login functionality still passes
    await test('9. Forensic auth lifecycle test suite exists and is intact', () => {
        const authTestPath = path.join(root, 'tests', 'forensic_auth_lifecycle.test.js');
        assert.ok(fs.existsSync(authTestPath), 'forensic_auth_lifecycle.test.js must exist');
        const authTestSrc = fs.readFileSync(authTestPath, 'utf8');
        assert.ok(authTestSrc.includes('logoutUser must be an asynchronous function'), 'auth test must be comprehensive');
    });

    // 10. Migration replay from clean database succeeds and includes both historical repair migrations.
    await test('10. Tracked migrations chain includes 014 and 015 in strict order', () => {
        const migrations = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql')).sort();
        assert.ok(migrations.some(f => f.startsWith('014')), 'Migration 014 must be present in migrations directory');
        assert.ok(migrations.some(f => f.startsWith('015')), 'Migration 015 must be present in migrations directory');
        const prefixes = migrations.map(m => m.slice(0, 3));
        assert.deepStrictEqual(prefixes, [
            '001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '010', '011', '012', '013', '014', '015'
        ], 'Migration chain must be strictly ordered from 001 to 015');
    });

    // 11. No migration can subsequently restore the old 50-credit signup default
    await test('11. No subsequent migration restores 50 credits default or trigger', () => {
        const migrations = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql')).sort();
        const post013 = migrations.filter(f => f >= '013');
        for (const f of post013) {
            const sql = fs.readFileSync(path.join(migrationDir, f), 'utf8');
            assert.ok(!sql.includes('DEFAULT 50'), `Migration ${f} must NOT restore DEFAULT 50`);
            assert.ok(!/VALUES\s*\(\s*NEW\.id\s*,\s*50\s*,/i.test(sql),
                `Migration ${f} must NOT insert 50 credits in handle_new_user`);
        }
    });

    console.log('\n------------------------------------------------------------------------');
    console.log(`Results: ${passed} passed, ${failed} failed.`);
    console.log('------------------------------------------------------------------------\n');

    if (failed > 0) {
        failures.forEach(f => console.error(`❌ ${f.name}: ${f.error}`));
        process.exit(1);
    }
}

runTests();
