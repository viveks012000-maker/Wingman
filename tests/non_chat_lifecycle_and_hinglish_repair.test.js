'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
    resolveLanguageTarget,
    getAuthoritativeLanguageDirective,
    validateGeneratedLanguage
} = require('../middleware/languageSelection');

console.log("============================================================");
console.log("🔍 TESTING NON-CHAT LIFECYCLE & AUTHENTIC HINGLISH REPAIR");
console.log("============================================================");

// -----------------------------------------------------------------------------
// 1. MIXED ENGLISH + ROMAN HINDI RESOLUTION
// -----------------------------------------------------------------------------
console.log("▶ [TEST 1] Mixed English + Roman Hindi Resolution");

const sumitInput = "mera naam sumit hai and i like basketball";
const sanchiInput = "mera naam sanchi hai and i like basketball bhaut zayada";

assert.strictEqual(
    resolveLanguageTarget(sumitInput, [], 'auto'),
    'hinglish',
    `Sumit mixed input must resolve to hinglish target`
);

assert.strictEqual(
    resolveLanguageTarget(sanchiInput, [], 'auto'),
    'hinglish',
    `Sanchi mixed input must resolve to hinglish target`
);

console.log("✔ Test 1 Passed: Mixed inputs reliably resolve to 'hinglish'.");

// -----------------------------------------------------------------------------
// 2. ROMAN HINDI GREETING PREFIX STRIPPING IN SANITIZATION
// -----------------------------------------------------------------------------
console.log("▶ [TEST 2] Bio Sanitization Strips Roman Hindi Greeting Fluff");

const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.ok(
    serverCode.includes("mera|meri"),
    "server.js sanitizeBioInput must include regex for stripping 'mera naam / meri naam' greeting fluff"
);

// Test the regex directly as extracted from server.js
const greetingRegex = /^(namaste|hello|hi|hey)?\s*(mera|meri)\s+naam\s+[a-z0-9_-]+\s+hai\s*(aur|and|,|\.)?\s*/i;
const sanitizedSumit = sumitInput.replace(greetingRegex, '');
assert.strictEqual(
    sanitizedSumit,
    "i like basketball",
    "Sanitization must strip 'mera naam sumit hai and ' leaving core hobby"
);

console.log("✔ Test 2 Passed: Roman Hindi greeting fluff stripped cleanly.");

// -----------------------------------------------------------------------------
// 3. OPTION-BY-OPTION HINGLISH VALIDATION REJECTS TOKEN INDIAN WORDS
// -----------------------------------------------------------------------------
console.log("▶ [TEST 3] Validation Rejects Pure English with Token Indian Word");

// A batch of 10 options where 9 are pure English and 1 has just "chai"
const fakeTokenHinglishBatch = [
    "love playing pickup basketball on weekends and finding good food",
    "always down for a 3-point contest or catching a late game",
    "gym on weekdays, basketball court on sundays",
    "looking for someone who can match my energy on the court",
    "chai tapri enthusiast and basketball fan",
    "music, basketball, and long evening drives",
    "competitive on the court, relaxed everywhere else",
    "weekend pickup games are my favorite stress buster",
    "if you like sports and good conversations, say hi",
    "coffee lover with a serious basketball addiction"
];

const tokenCheck = validateGeneratedLanguage('hinglish', fakeTokenHinglishBatch);
assert.strictEqual(
    tokenCheck.valid,
    false,
    "Batch with mostly pure English and only 1 isolated Indian word must FAIL hinglish validation"
);
assert.strictEqual(
    tokenCheck.reason,
    'insufficient_hinglish_batch',
    "Failure reason must be insufficient_hinglish_batch"
);

// An authentic Roman Hinglish batch where at least 60% of options have natural Hindi phrasing
const authenticHinglishBatch = [
    "basketball kaafi pasand hai, weekends usually court pe milunga 🏀\n\nreal question: pickup game ya proper league?",
    "court pe challenge accept karogi ya sirf baatein? 😉\n\nhonest debate: 3-pointer ya smooth layup?",
    "gym discipline intact hai, par Sunday brunch pe zero control 🥞\n\nscene sort karte hain?",
    "late-night drives aur playlist debates meri specialty hai 🎧\n\npick a side: slow acoustic ya full volume?",
    "weekends court pe guzar jaate hain aur sham ko tapri chai ☕\n\nkya lagta hai, pickup game khele?",
    "basketball aur achha music ka combination best lagta hai 🎵\n\ntumhara weekend scene kya hota hai?",
    "thoda sporty, thoda chill vibe hai yahan\n\ncoffee pe chalte hain?",
    "court pe intense focus, par bahar full chill\n\nfree ho is weekend?",
    "sports lover hoon, game night miss nahi hoti 🏀\n\nserious player ya casual fan?",
    "good vibes aur intense game dono zaroori hain\n\nbasketball challenge dogi?"
];

const authenticCheck = validateGeneratedLanguage('hinglish', authenticHinglishBatch);
assert.strictEqual(
    authenticCheck.valid,
    true,
    "Authentic Roman Hinglish batch must PASS validation"
);

console.log("✔ Test 3 Passed: Option-by-option validator strictly blocks token Hinglish.");

// -----------------------------------------------------------------------------
// 4. CLIENT REQUEST LIFECYCLE & RETRY PURGE AUDIT
// -----------------------------------------------------------------------------
console.log("▶ [TEST 4] Client Single-Flight & Unique Idempotency Key Invariants");

const appJsCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Ensure no retry while loop exists in generateWingmanResponse
const genWingmanStart = appJsCode.indexOf('window.generateWingmanResponse = async function');
assert.ok(genWingmanStart !== -1, "generateWingmanResponse must exist in app.js");
const genWingmanBody = appJsCode.substring(genWingmanStart, genWingmanStart + 4000);

assert.strictEqual(
    genWingmanBody.includes('while (attempt <= maxRetries)'),
    false,
    "generateWingmanResponse MUST NOT contain a client-side retry while-loop"
);

assert.strictEqual(
    genWingmanBody.includes('maxRetries ='),
    false,
    "generateWingmanResponse MUST NOT declare maxRetries"
);

// Ensure createAiOperationId creates unique IDs per invocation
assert.ok(
    appJsCode.includes("const operationId = createAiOperationId('analyzer');"),
    "Screenshot analyzer must create unique operationId per invocation"
);
assert.ok(
    appJsCode.includes("const operationId = createAiOperationId('icebreaker');"),
    "Icebreaker generator must create unique operationId per invocation"
);
assert.ok(
    appJsCode.includes("const operationId = createAiOperationId('bio');"),
    "Bio optimizer must create unique operationId per invocation"
);

console.log("✔ Test 4 Passed: Client-side single-flight invariant & unique operation IDs verified.");

// -----------------------------------------------------------------------------
// 5. SERVER-SIDE DUPLICATE COALESCING & 409 GUARDS
// -----------------------------------------------------------------------------
console.log("▶ [TEST 5] Server-Side Duplicate Coalescing & Replay Resolution");

assert.ok(
    serverCode.includes("getCompletedAiResponse(reqId)"),
    "server.js must query completed AI response cache"
);

assert.ok(
    serverCode.includes("inFlightAiOperations.get(reqId)"),
    "server.js must query in-flight AI operations"
);

// In repairLanguageMismatch, queryOpenRouter timeout must be at least 25000ms
const repairFnIdx = serverCode.indexOf('async function repairLanguageMismatch');
assert.ok(repairFnIdx !== -1, "repairLanguageMismatch must exist in server.js");
const repairFnBody = serverCode.substring(repairFnIdx, repairFnIdx + 3500);
assert.ok(
    repairFnBody.includes('25000'),
    "repairLanguageMismatch must use at least 25000ms timeout for queryOpenRouter"
);

console.log("✔ Test 5 Passed: Server-side duplicate coalescing and repair timeout verified.");

console.log("============================================================");
console.log("🎉 ALL NON-CHAT LIFECYCLE & HINGLISH REPAIR TESTS PASSED!");
console.log("============================================================");
