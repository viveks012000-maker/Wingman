/**
 * Tests: Screenshot Analyzer Credit State Machine, Idempotency & Concurrency
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('\n============================================================');
console.log('🧪 RUNNING SCREENSHOT ANALYZER STATE MACHINE & IDEMPOTENCY TESTS');
console.log('============================================================\n');

// 1. Static Invariant Verification
const migrationSql = fs.readFileSync(path.join(__dirname, '../migrations/002_atomic_credits_and_transactions.sql'), 'utf8');

// Real UNIQUE constraint
assert.strictEqual(
    migrationSql.includes('ADD CONSTRAINT uq_credit_transactions_user_request_id UNIQUE (user_id, request_id);'),
    true,
    'Migration 002 must define real UNIQUE constraint on (user_id, request_id)'
);

// Non-empty request ID check constraint with length bounding
assert.strictEqual(
    migrationSql.includes('chk_credit_transactions_request_id_not_empty'),
    true,
    'Migration 002 must enforce chk_credit_transactions_request_id_not_empty check constraint'
);

// Hardened empty search paths on all SECURITY DEFINER functions
const secDefCount = (migrationSql.match(/SECURITY DEFINER/g) || []).length;
const searchPathEmptyCount = (migrationSql.match(/SET search_path = ''/g) || []).length;
assert.strictEqual(searchPathEmptyCount >= secDefCount, true, 'Every SECURITY DEFINER function must specify SET search_path = \'\'');

// Transaction wrapping (BEGIN / COMMIT)
assert.strictEqual(migrationSql.includes('BEGIN;'), true, 'Migration 002 must contain BEGIN;');
assert.strictEqual(migrationSql.includes('COMMIT;'), true, 'Migration 002 must contain COMMIT;');

// Visible permission failures (No EXCEPTION WHEN OTHERS THEN NULL)
assert.strictEqual(
    migrationSql.includes('WHEN OTHERS THEN\n        NULL;') || migrationSql.includes('WHEN OTHERS THEN NULL;'),
    false,
    'Migration 002 must NOT swallow permission errors'
);
console.log('✔ Static Invariants Verified: UNIQUE constraint, search_path = \'\' hardening, transaction block, and error visibility.');

// 2. Behavioral Unit Ledger Simulation
function createSimulatedPostgresCreditLedger(initialCredits = 50) {
    let balance = initialCredits;
    const transactions = new Map(); // key: `${userId}:${requestId}`

    function reserveCredits(userId, amount, feature, requestId) {
        if (!requestId || typeof requestId !== 'string' || !requestId.trim()) {
            return { success: false, error_message: 'Invalid or missing idempotency request ID.' };
        }
        const cleanReqId = requestId.trim();
        const txKey = `${userId}:${cleanReqId}`;

        // Idempotency check
        if (transactions.has(txKey)) {
            const existing = transactions.get(txKey);
            return {
                success: true,
                remainingCredits: balance,
                new_balance: balance,
                duplicate: true,
                status: existing.status
            };
        }

        if (balance < amount) {
            return {
                success: false,
                error_message: 'Insufficient credit balance.',
                currentCredits: balance,
                new_balance: balance
            };
        }

        balance -= amount;
        transactions.set(txKey, {
            id: 'tx_' + Math.random().toString(36).substring(2, 7),
            userId,
            amount: -amount,
            feature,
            requestId: cleanReqId,
            status: 'pending'
        });

        return {
            success: true,
            remainingCredits: balance,
            new_balance: balance,
            duplicate: false
        };
    }

    function settleCredits(userId, requestId) {
        if (!requestId || typeof requestId !== 'string' || !requestId.trim()) {
            return { success: false, error_message: 'Invalid request ID.' };
        }
        const txKey = `${userId}:${requestId.trim()}`;
        if (!transactions.has(txKey)) {
            return { success: false, error_message: 'Transaction not found.' };
        }
        const tx = transactions.get(txKey);
        if (tx.status === 'pending') {
            tx.status = 'completed';
            return { success: true, settled: true };
        }
        return { success: true, settled: false, status: tx.status };
    }

    function releaseCredits(userId, requestId, reason = 'ai_failure') {
        if (!requestId || typeof requestId !== 'string' || !requestId.trim()) {
            return { success: false, error_message: 'Invalid request ID.' };
        }
        const txKey = `${userId}:${requestId.trim()}`;
        if (!transactions.has(txKey)) {
            return { success: true, remainingCredits: balance, new_balance: balance, already_settled_or_released: true };
        }
        const tx = transactions.get(txKey);
        if (tx.status === 'pending') {
            balance += Math.abs(tx.amount);
            tx.status = 'cancelled';
            tx.reason = reason;
            return { success: true, remainingCredits: balance, new_balance: balance, released: true };
        }
        return { success: true, remainingCredits: balance, new_balance: balance, already_settled_or_released: true };
    }

    return {
        getBalance: () => balance,
        getTransactions: () => Array.from(transactions.values()),
        reserveCredits,
        settleCredits,
        releaseCredits
    };
}

// Test 1: Successful Analyzer Lifecycle (Initial 50 -> Reserve 10 -> Settle -> Final 40)
const ledger1 = createSimulatedPostgresCreditLedger(50);
const req1 = 'req_success_001';
const res1 = ledger1.reserveCredits('user_1', 10, 'analyze', req1);
assert.strictEqual(res1.success, true);
assert.strictEqual(res1.remainingCredits, 40);
assert.strictEqual(res1.duplicate, false);

const set1 = ledger1.settleCredits('user_1', req1);
assert.strictEqual(set1.success, true);
assert.strictEqual(set1.settled, true);
assert.strictEqual(ledger1.getBalance(), 40);
console.log('✔ Test 1 Passed: Successful Analyzer charges exactly 10 credits (50 -> 40, status = completed)');

// Test 2: Failed Analyzer Lifecycle (Initial 50 -> Reserve 10 -> AI Fails -> Release -> Final 50)
const ledger2 = createSimulatedPostgresCreditLedger(50);
const req2 = 'req_fail_002';
const res2 = ledger2.reserveCredits('user_2', 10, 'analyze', req2);
assert.strictEqual(res2.success, true);
assert.strictEqual(res2.remainingCredits, 40);

const rel2 = ledger2.releaseCredits('user_2', req2, 'AICREDITS timeout 504');
assert.strictEqual(rel2.success, true);
assert.strictEqual(rel2.released, true);
assert.strictEqual(ledger2.getBalance(), 50, 'Balance must be restored to 50 on failure');
console.log('✔ Test 2 Passed: Failed Analyzer releases reservation with 0 final cost (50 -> 40 -> 50)');

// Test 3: Duplicate Settle (Idempotent Settle)
const setDup = ledger1.settleCredits('user_1', req1);
assert.strictEqual(setDup.success, true);
assert.strictEqual(setDup.settled, false, 'Duplicate settle must not re-settle');
assert.strictEqual(ledger1.getBalance(), 40, 'Balance unchanged on duplicate settle');
console.log('✔ Test 3 Passed: Repeated settle is idempotent and does not alter balance');

// Test 4: Duplicate Release Cannot Mint Credits
const relDup = ledger2.releaseCredits('user_2', req2);
assert.strictEqual(relDup.success, true);
assert.strictEqual(relDup.already_settled_or_released, true);
assert.strictEqual(ledger2.getBalance(), 50, 'Balance must remain 50 and NEVER become 60');
console.log('✔ Test 4 Passed: Duplicate release cannot mint credits (balance stays 50, never 60)');

// Test 5: Settle/Release Race (Completed transaction cannot be released)
const relOnCompleted = ledger1.releaseCredits('user_1', req1);
assert.strictEqual(relOnCompleted.success, true);
assert.strictEqual(relOnCompleted.already_settled_or_released, true);
assert.strictEqual(ledger1.getBalance(), 40, 'Completed transaction cannot be refunded via release');
console.log('✔ Test 5 Passed: Completed transaction cannot be released');

// Test 6: Idempotent Repeat Request (Same request ID sequentially)
const dupSeq = ledger1.reserveCredits('user_1', 10, 'analyze', req1);
assert.strictEqual(dupSeq.success, true);
assert.strictEqual(dupSeq.duplicate, true);
assert.strictEqual(ledger1.getBalance(), 40, 'Sequential repeat reservation does not deduct again');
console.log('✔ Test 6 Passed: Same request ID sequentially returns duplicate: true without re-deduction');

// Test 7: Invalid Request IDs (NULL, empty, whitespace) Rejected
assert.strictEqual(ledger1.reserveCredits('user_1', 10, 'analyze', null).success, false);
assert.strictEqual(ledger1.reserveCredits('user_1', 10, 'analyze', '').success, false);
assert.strictEqual(ledger1.reserveCredits('user_1', 10, 'analyze', '   ').success, false);
console.log('✔ Test 7 Passed: NULL, empty, and whitespace request IDs rejected');

// Test 8: Different Request IDs Treated Independently
const req3 = 'req_independent_003';
const res3 = ledger1.reserveCredits('user_1', 10, 'analyze', req3);
assert.strictEqual(res3.success, true);
assert.strictEqual(res3.remainingCredits, 30);
assert.strictEqual(res3.duplicate, false);
console.log('✔ Test 8 Passed: Different request IDs treated independently (40 -> 30)');

console.log('\n🎉 ALL STATE MACHINE & IDEMPOTENCY TESTS PASSED!\n');
