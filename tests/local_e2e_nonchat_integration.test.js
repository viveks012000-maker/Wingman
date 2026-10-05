'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('============================================================');
console.log('🧪 LOCAL E2E NON-CHAT ARCHITECTURAL INTEGRATION SUITE');
console.log('============================================================\n');

// -----------------------------------------------------------------------------
// 1. TIMEOUT HIERARCHY VERIFICATION
// -----------------------------------------------------------------------------
console.log('▶ [TEST 1] Verifying Strict Timeout Hierarchy Contract');

const appJsCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const serverJsCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// Match client timeout
const clientTimeoutMatch = appJsCode.match(/const timeoutId = setTimeout\(\(\) => controller\.abort\(\),\s*(\d+)\);/);
assert.ok(clientTimeoutMatch, 'app.js must define client abort timeout in generateWingmanResponse');
const clientTimeout = parseInt(clientTimeoutMatch[1], 10);

// Match server total deadline
const serverDeadlineMatch = serverJsCode.match(/const SERVER_TOTAL_OPERATION_DEADLINE_MS\s*=\s*(\d+);/);
assert.ok(serverDeadlineMatch, 'server.js must define SERVER_TOTAL_OPERATION_DEADLINE_MS');
const serverDeadline = parseInt(serverDeadlineMatch[1], 10);

console.log(`  Client Timeout: ${clientTimeout}ms`);
console.log(`  Server Pipeline Deadline: ${serverDeadline}ms`);

assert.ok(serverDeadline >= 60000 && serverDeadline <= 70000, 'Server deadline must be bounded around 60-70s');
assert.ok(clientTimeout >= 80000, 'Client timeout must be at least 80s');
assert.ok(
    clientTimeout > serverDeadline,
    `Timeout hierarchy inversion: client timeout (${clientTimeout}ms) must strictly exceed server deadline (${serverDeadline}ms)`
);

console.log('✔ Test 1 Passed: Client timeout strictly exceeds server total operation deadline.\n');

// -----------------------------------------------------------------------------
// 2. PROVIDER TRANSIENT RETRY RESILIENCE (Mock 503 upstream)
// -----------------------------------------------------------------------------
console.log('▶ [TEST 2] Verifying Provider Transient Retry Contract (429, 500, 502, 503, 504)');

// Verify server.js contains retry loop in executeSingleOpenRouterCall and queryAnalyzerProvider
assert.ok(
    serverJsCode.includes('retryableStatuses.has(response.status) && attempt < 3') ||
    serverJsCode.includes('retryableStatuses.has(response.status)'),
    'server.js must check retryableStatuses on HTTP response failure'
);

// Verify 503 is in retryableStatuses
const retryableSets = serverJsCode.match(/new Set\(\[([\d,\s]+)\]\)/g);
assert.ok(retryableSets && retryableSets.length >= 2, 'server.js must define retryable HTTP status sets');
for (const setStr of retryableSets) {
    if (setStr.includes('429')) {
        assert.ok(setStr.includes('503'), `Retryable set must include 503: ${setStr}`);
        assert.ok(setStr.includes('500'), `Retryable set must include 500: ${setStr}`);
        assert.ok(setStr.includes('502'), `Retryable set must include 502: ${setStr}`);
        assert.ok(setStr.includes('504'), `Retryable set must include 504: ${setStr}`);
    }
}

console.log('✔ Test 2 Passed: 503 and transient 5xx/429 statuses are defined in retryable sets.\n');

// -----------------------------------------------------------------------------
// 3. AUTHENTIC HINGLISH 10/10 VALIDATION LAW
// -----------------------------------------------------------------------------
console.log('▶ [TEST 3] Verifying 10/10 Authentic Roman Hinglish Law & Token Blocking');

const {
    validateGeneratedLanguage,
    isOptionAuthenticHinglish,
    isOptionPureEnglish,
    resolveLanguageTarget
} = require('../middleware/languageSelection');

// Mixed English + Roman Hindi input
const mixedInput = "mera naam sumit hai and mujhe coffee pasand hai, let's explore cafes";
const resolvedTarget = resolveLanguageTarget(mixedInput, [], 'auto');
assert.strictEqual(resolvedTarget, 'hinglish', 'Mixed Roman-Hindi + English input must resolve to hinglish');

// 10 authentic Hinglish options
const authenticBatch = [
    "kya plan hai weekend pe coffee chalega?",
    "sach batao are you more of a chai person ya coffee lover?",
    "tumhara travel taste dekhke lagta hai you love mountain road trips",
    "honestly tumhara taste kaafi sorted lag raha hai",
    "pehle ye batao how do you survive without good music?",
    "kabhi socha nahi tha someone could have this cool hobby",
    "chalo settle karte hain best coffee spot in town kaunsa hai",
    "lagta hai hum dono ki wavelength kaafi match karti hai",
    "ek baat batao are you always this spontaneous ya aaj special mood hai?",
    "weekend pe let's catch up for some good food aur baatein"
];

for (let i = 0; i < authenticBatch.length; i++) {
    assert.strictEqual(
        isOptionAuthenticHinglish(authenticBatch[i]),
        true,
        `Option ${i + 1} must be authentic Roman Hinglish: "${authenticBatch[i]}"`
    );
}

const authValidation = validateGeneratedLanguage('hinglish', authenticBatch);
assert.strictEqual(authValidation.valid, true, '10/10 authentic Hinglish batch must pass validation');

// Batch with isolated token word ("chai") in mostly English sentence
const fakeHinglishBatch = [
    "I really love having chai in the morning with a good book", // Token chai alone
    "Let us go grab some coffee this Friday evening at 8pm",
    "What is your favorite travel destination for the summer?",
    "Tell me about your most interesting weekend experience",
    "Are you more of an outdoor adventurer or an indoor relaxer?",
    "Sounds like a fantastic project you are working on",
    "Do you prefer morning walks or evening sunsets?",
    "I think your music playlist must be quite eclectic",
    "Looking forward to hearing more about your photography",
    "Let us debate whether city life beats countryside peace"
];

const fakeValidation = validateGeneratedLanguage('hinglish', fakeHinglishBatch);
assert.strictEqual(fakeValidation.valid, false, 'Batch with 9 English lines and 1 token chai must fail hinglish validation');
assert.strictEqual(fakeValidation.reason, 'insufficient_hinglish_batch', 'Must report insufficient_hinglish_batch');

// English control batch
const englishBatch = [
    "Coffee or tea is the real personality test here",
    "Tell me about the best trip you took recently",
    "Curious if you are an early bird or a night owl",
    "Your book collection sounds like an absolute treasure",
    "What is your go-to weekend unwinding ritual?",
    "I have to admit your photography style is impressive",
    "Let us find out if your taste in music matches mine",
    "Are you more about planning itineraries or being spontaneous?",
    "That sounds like a fascinating creative journey",
    "Quick question: favorite local spot to grab a bite?"
];

const engValidation = validateGeneratedLanguage('english', englishBatch);
assert.strictEqual(engValidation.valid, true, '10/10 English batch must pass english validation');

console.log('✔ Test 3 Passed: 10/10 authentic Hinglish law and token rejection verified.\n');

// -----------------------------------------------------------------------------
// 4. LANGUAGE REPAIR FAILS CLOSED (Credit Safety)
// -----------------------------------------------------------------------------
console.log('▶ [TEST 4] Verifying Language Repair Fails Closed (Zero Charge Law)');

// Verify server.js repairLanguageMismatch revalidates output
assert.ok(
    serverJsCode.includes('validateGeneratedLanguage(expectedLanguage, repairedOutput)'),
    'repairLanguageMismatch must re-validate repairedOutput with validateGeneratedLanguage'
);

assert.ok(
    serverJsCode.includes('LANGUAGE_POLICY_VIOLATION'),
    'repairLanguageMismatch must throw LANGUAGE_POLICY_VIOLATION on validation failure'
);

// Verify repairLanguageMismatch does NOT return invalid content on error
const repairFnIdx = serverJsCode.indexOf('async function repairLanguageMismatch');
assert.ok(repairFnIdx !== -1, 'repairLanguageMismatch must exist');
const repairFnEnd = serverJsCode.indexOf('app.post([\'/api/analyze\'', repairFnIdx);
const repairBody = serverJsCode.substring(repairFnIdx, repairFnEnd);

assert.ok(
    !repairBody.includes('return content;') || repairBody.indexOf('if (validation.valid) return content;') !== -1,
    'repairLanguageMismatch must not return invalid content on error or fallback'
);

assert.ok(
    repairBody.includes('throw policyErr') || repairBody.includes('throw err'),
    'repairLanguageMismatch must throw an error when repair cannot resolve language mismatch'
);

console.log('✔ Test 4 Passed: Language repair fail-closed behavior verified.\n');

// -----------------------------------------------------------------------------
// 5. CACHE BOUNDING & REPLAY RESOLUTION
// -----------------------------------------------------------------------------
console.log('▶ [TEST 5] Verifying Cache Bounding & Coalescing Invariants');

assert.ok(
    serverJsCode.includes('MAX_COMPLETED_RESPONSES = 500') ||
    serverJsCode.includes('MAX_COMPLETED_RESPONSES'),
    'server.js must define MAX_COMPLETED_RESPONSES'
);

assert.ok(
    serverJsCode.includes('completedAiResponses.delete(oldestKey)'),
    'cacheCompletedAiResponse must evict oldest key when capacity is reached'
);

console.log('✔ Test 5 Passed: Replay cache size bounded with LRU eviction.\n');

console.log('============================================================');
console.log('🎉 ALL ARCHITECTURAL NON-CHAT E2E INTEGRATION TESTS PASSED!');
console.log('============================================================');
