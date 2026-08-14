/**
 * Tests: Screenshot Analyzer Credit Reservation & Zero-Charge Failure Recovery
 */
const assert = require('assert');

console.log('\n============================================================');
console.log('🧪 RUNNING SCREENSHOT ANALYZER ZERO-CHARGE FAILURE RECOVERY TESTS');
console.log('============================================================\n');

// In-Memory Simulated Ledger to test exact state transitions (reserve -> release -> settle)
function createSimulatedCreditLedger(initialCredits = 50) {
    let balance = initialCredits;
    const transactions = [];

    function reserveCredits(userId, amount, feature, requestId) {
        if (!requestId || !requestId.trim()) {
            return { success: false, error_message: 'Invalid request ID' };
        }
        // Idempotency check
        const existing = transactions.find(t => t.userId === userId && t.requestId === requestId);
        if (existing) {
            if (existing.status === 'completed' || existing.status === 'pending') {
                return { success: true, remainingCredits: balance, duplicate: true };
            }
        }
        if (balance < amount) {
            return { success: false, error_message: 'Insufficient credits', currentCredits: balance };
        }
        balance -= amount;
        transactions.push({
            id: 'tx_' + Math.random().toString(36).substr(2, 6),
            userId,
            amount: -amount,
            feature,
            requestId,
            status: 'pending'
        });
        return { success: true, remainingCredits: balance, duplicate: false };
    }

    function settleCredits(userId, requestId) {
        const tx = transactions.find(t => t.userId === userId && t.requestId === requestId && t.status === 'pending');
        if (tx) {
            tx.status = 'completed';
        }
        return { success: true };
    }

    function releaseCredits(userId, requestId, reason = 'ai_failure') {
        const tx = transactions.find(t => t.userId === userId && t.requestId === requestId && t.status === 'pending');
        if (!tx) {
            return { success: true, remainingCredits: balance, alreadyReleased: true };
        }
        balance += Math.abs(tx.amount);
        tx.status = 'cancelled';
        tx.reason = reason;
        return { success: true, remainingCredits: balance, released: true };
    }

    return {
        getBalance: () => balance,
        getTransactions: () => transactions,
        reserveCredits,
        settleCredits,
        releaseCredits
    };
}

// Test 1: Successful Flow (Reserve 10 -> Settle -> Final Cost = 10)
const ledger1 = createSimulatedCreditLedger(50);
const reqId1 = 'req_success_001';
const res1 = ledger1.reserveCredits('user_123', 10, 'analyze', reqId1);
assert.strictEqual(res1.success, true);
assert.strictEqual(res1.remainingCredits, 40);
assert.strictEqual(ledger1.getBalance(), 40);

ledger1.settleCredits('user_123', reqId1);
assert.strictEqual(ledger1.getBalance(), 40);
const tx1 = ledger1.getTransactions().find(t => t.requestId === reqId1);
assert.strictEqual(tx1.status, 'completed');
console.log('✔ Test 1 Passed: Successful analysis charges exactly 10 credits (50 -> 40, status = completed)');

// Test 2: AI Failure Recovery (Reserve 10 -> AI Fails -> Release -> Final Cost = 0)
const ledger2 = createSimulatedCreditLedger(50);
const reqId2 = 'req_fail_002';
const res2 = ledger2.reserveCredits('user_123', 10, 'analyze', reqId2);
assert.strictEqual(res2.success, true);
assert.strictEqual(res2.remainingCredits, 40);

// Simulate AI pipeline failure / timeout
const relRes = ledger2.releaseCredits('user_123', reqId2, 'AICREDITS timeout 504');
assert.strictEqual(relRes.success, true);
assert.strictEqual(relRes.remainingCredits, 50);
assert.strictEqual(ledger2.getBalance(), 50, 'Final user balance must be restored to 50');

const tx2 = ledger2.getTransactions().find(t => t.requestId === reqId2);
assert.strictEqual(tx2.status, 'cancelled');
console.log('✔ Test 2 Passed: AI failure restores reservation completely (Final Cost = 0 credits, balance = 50)');

// Test 3: Duplicate Request / Idempotency
const dupRes = ledger1.reserveCredits('user_123', 10, 'analyze', reqId1);
assert.strictEqual(dupRes.duplicate, true, 'Duplicate completed request must not charge again');
console.log('✔ Test 3 Passed: Idempotent repeat request recognized without duplicate deduction');

// Test 4: Insufficient Balance Check
const ledger4 = createSimulatedCreditLedger(5); // Only 5 credits
const res4 = ledger4.reserveCredits('user_123', 10, 'analyze', 'req_low_004');
assert.strictEqual(res4.success, false);
assert.strictEqual(res4.currentCredits, 5);
assert.strictEqual(ledger4.getBalance(), 5, 'Balance remains untouched when insufficient');
console.log('✔ Test 4 Passed: Insufficient balance rejected before AI pipeline with 0 deduction');

console.log('\n🎉 ALL ZERO-CHARGE FAILURE RECOVERY & LEDGER TESTS PASSED!\n');
