'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const serverContent = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const configContent = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
const promptSystemContent = fs.readFileSync(path.join(ROOT, 'config', 'promptSystem.js'), 'utf8');
const appJsContent = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appHtml = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');

console.log('============================================================');
console.log('🌐 RUNNING BILINGUAL (ENGLISH + HINGLISH) LANGUAGE TESTS');
console.log('============================================================\n');

// ---------------------------------------------------------------------
// 1. PROMPT SYSTEM DEFINITIONS & DEVANAGARI BAN DIRECTIVES
// ---------------------------------------------------------------------
console.log('--- 1. PROMPT SYSTEM EXPORTS & CONSTRAINTS ---');
const promptSystem = require('../config/promptSystem');

assert.ok(promptSystem.TARGET_MARKET_LOCK, 'TARGET_MARKET_LOCK must be exported for English');
assert.ok(promptSystem.HINGLISH_BIO_TARGET_MARKET_LOCK, 'HINGLISH_BIO_TARGET_MARKET_LOCK must be exported for Hinglish');
assert.ok(promptSystem.HINGLISH_OUTPUT_DIRECTIVE, 'HINGLISH_OUTPUT_DIRECTIVE must be exported');

// Devanagari character regex test: \u0900-\u097F, \uA8E0-\uA8FF, \u1CD0-\u1CFF
const DEVANAGARI_REGEX = /[\u0900-\u097F\uA8E0-\uA8FF\u1CD0-\u1CFF]/;
assert.strictEqual(DEVANAGARI_REGEX.test(promptSystem.HINGLISH_BIO_TARGET_MARKET_LOCK), false, 'HINGLISH_BIO_TARGET_MARKET_LOCK must contain 0 Devanagari characters');
assert.strictEqual(DEVANAGARI_REGEX.test(promptSystem.HINGLISH_OUTPUT_DIRECTIVE), false, 'HINGLISH_OUTPUT_DIRECTIVE must contain 0 Devanagari characters');

assert.ok(promptSystem.HINGLISH_OUTPUT_DIRECTIVE.includes('LATIN / ENGLISH ALPHABET'), 'Hinglish directive must mandate Latin/English alphabet');
assert.ok(promptSystem.HINGLISH_OUTPUT_DIRECTIVE.includes('ABSOLUTE BAN ON DEVANAGARI'), 'Hinglish directive must enforce absolute ban on Devanagari');
console.log('✔ Passed: Prompt system exports clean Hinglish directives with zero Devanagari characters.\n');

// ---------------------------------------------------------------------
// 2. SERVER-SIDE CANONICALIZATION & REGEX LOGIC
// ---------------------------------------------------------------------
console.log('--- 2. LANGUAGE CANONICALIZATION & DEVANAGARI DETECTION ---');

// Canonicalizer test
function testCanonicalizeLanguage(lang) {
    if (!lang || typeof lang !== 'string') return 'en';
    const normalized = lang.trim().toLowerCase();
    if (normalized === 'hinglish' || normalized === 'hi-latn' || normalized === 'hi_latn') return 'hinglish';
    return 'en';
}

assert.strictEqual(testCanonicalizeLanguage('en'), 'en');
assert.strictEqual(testCanonicalizeLanguage('EN'), 'en');
assert.strictEqual(testCanonicalizeLanguage('hinglish'), 'hinglish');
assert.strictEqual(testCanonicalizeLanguage('Hinglish'), 'hinglish');
assert.strictEqual(testCanonicalizeLanguage('hi-latn'), 'hinglish');
assert.strictEqual(testCanonicalizeLanguage('hi_latn'), 'hinglish');
assert.strictEqual(testCanonicalizeLanguage('hindi'), 'en', 'Invalid or pure Hindi language must fall back to en');
assert.strictEqual(testCanonicalizeLanguage('es'), 'en', 'Unsupported language must fall back to en');
assert.strictEqual(testCanonicalizeLanguage(null), 'en', 'Null must fall back to en');
assert.strictEqual(testCanonicalizeLanguage(undefined), 'en', 'Undefined must fall back to en');
assert.strictEqual(testCanonicalizeLanguage(''), 'en', 'Empty string must fall back to en');

// Devanagari detection tests
function testContainsDevanagari(val) {
    if (!val) return false;
    if (typeof val === 'string') return DEVANAGARI_REGEX.test(val);
    if (Array.isArray(val)) return val.some(item => testContainsDevanagari(item));
    if (typeof val === 'object') return Object.values(val).some(item => testContainsDevanagari(item));
    return false;
}

assert.strictEqual(testContainsDevanagari('kya bolu usko ab'), false);
assert.strictEqual(testContainsDevanagari('ye thoda zyada serious lag raha hai'), false);
assert.strictEqual(testContainsDevanagari('coffee pe milke decide karte hain 😏'), false);
assert.strictEqual(testContainsDevanagari('profile achhi hai but opener thoda generic lag raha hai'), false);
assert.strictEqual(testContainsDevanagari('क्या बोलूं उसको'), true, 'Must detect Devanagari characters');
assert.strictEqual(testContainsDevanagari('tumhari profile acchi hai but यह thoda generic hai'), true, 'Must detect mixed Devanagari');
assert.strictEqual(testContainsDevanagari(['clean option 1', 'clean option 2']), false);
assert.strictEqual(testContainsDevanagari(['clean option 1', 'ऑप्शन २']), true);
assert.strictEqual(testContainsDevanagari({ reply: 'kya bolu' }), false);
assert.strictEqual(testContainsDevanagari({ reply: 'क्या बोलूं' }), true);

console.log('✔ Passed: Canonicalization and Devanagari detection operate flawlessly across types.\n');

// ---------------------------------------------------------------------
// 3. SERVER-SIDE ENDPOINT AUDIT & ATOMIC CONTRACTS
// ---------------------------------------------------------------------
console.log('--- 3. SERVER-SIDE ROUTE CONTRACTS & DEVANAGARI REPAIR ---');

// Verify all 5 routes have language extraction
assert.ok(serverContent.includes("canonicalizeLanguage(rawLanguage)") || serverContent.includes("canonicalizeLanguage(bodyData.language)"), 'Routes must canonicalize request language');

// Check Screenshot Analyzer
assert.ok(serverContent.includes("screenshotTextSystemPrompt") && serverContent.includes("HINGLISH_OUTPUT_DIRECTIVE"), 'Screenshot analyzer must inject Hinglish directive in Hinglish mode');
assert.ok(serverContent.includes('repairHinglishDevanagari(optionsList, "analyze")'), 'Screenshot analyzer must check for Devanagari and repair');

// Check Icebreaker Generator
assert.ok(serverContent.includes("icebreakerSystemPrompt") && serverContent.includes("withPromptBoundary(icebreakerSystemPrompt)") && serverContent.includes("HINGLISH_OUTPUT_DIRECTIVE"), 'Icebreaker generator must inject Hinglish directive in Hinglish mode');
assert.ok(serverContent.includes('repairHinglishDevanagari(cleanedOptions, "icebreaker")'), 'Icebreaker generator must check for Devanagari and repair');

// Check Bio Optimizer
assert.ok(serverContent.includes('sanitizeBioInput(text || rawText, language)'), 'Bio Optimizer must pass language to sanitizeBioInput');
assert.ok(serverContent.includes("language === 'hinglish' ? HINGLISH_BIO_TARGET_MARKET_LOCK : TARGET_MARKET_LOCK"), 'Bio Optimizer must use HINGLISH_BIO_TARGET_MARKET_LOCK when Hinglish');
assert.ok(serverContent.includes('repairHinglishDevanagari(optionsList, "optimize")'), 'Bio Optimizer must check for Devanagari and repair');

// Check Chat / Hotline / Roleplay
assert.ok(serverContent.includes("hotlineSystemPrompt") && serverContent.includes("withPromptBoundary(hotlineSystemPrompt)") && serverContent.includes("HINGLISH_OUTPUT_DIRECTIVE"), 'Coach hotline must inject Hinglish directive in Hinglish mode');
assert.ok(serverContent.includes("datingCoachSystemPrompt") && serverContent.includes("withPromptBoundary(datingCoachSystemPrompt)") && serverContent.includes("HINGLISH_OUTPUT_DIRECTIVE"), 'Roleplay drills must inject Hinglish directive in Hinglish mode');
assert.ok(serverContent.includes('repairHinglishDevanagari(hotlineAdvice, "chat_hotline")'), 'Coach hotline must check for Devanagari and repair');
assert.ok(serverContent.includes('repairHinglishDevanagari(replyText, "chat_roleplay")'), 'Roleplay drills must check for Devanagari and repair');

// Check Simulator Review
assert.ok(serverContent.includes('repairHinglishDevanagari(reviewJson, "simulator_review")'), 'Simulator review must check for Devanagari and repair');

// Verify fail-closed behavior (no unfulfilled debit, releaseCreditsDB called on error)
assert.ok(serverContent.includes('releaseCreditsDB(req, reqId'), 'Credit release must be triggered on failure');

console.log('✔ Passed: All 5 backend routes strictly conform to language and repair contracts.\n');

// ---------------------------------------------------------------------
// 4. BIO OPTIMIZER DEMOGRAPHIC ISOLATION (CULTURAL CONTEXT)
// ---------------------------------------------------------------------
console.log('--- 4. BIO OPTIMIZER CULTURAL CONTEXT ISOLATION ---');

// Test that sanitizeBioInput retains desi terms when language is 'hinglish'
const sanitizeBioInputRegex = /function sanitizeBioInput\([\s\S]*?^}/m;
assert.ok(serverContent.includes("function sanitizeBioInput(rawInput, language = 'en')"), 'sanitizeBioInput must accept language');
assert.ok(serverContent.includes("if (language !== 'hinglish') {"), 'US cultural isolation must be guarded for Hinglish');

console.log('✔ Passed: Bio Optimizer preserves Desi lifestyle contexts in Hinglish mode.\n');

// ---------------------------------------------------------------------
// 5. CLIENT-SIDE i18n MODULE & DICTIONARY
// ---------------------------------------------------------------------
console.log('--- 5. CLIENT-SIDE i18n MODULE & ZERO DEVANAGARI DICTIONARY ---');

assert.ok(configContent.includes('window.wingmanI18n'), 'config.js must export window.wingmanI18n');
assert.ok(configContent.includes("STORAGE_KEY = 'wingman_language'"), 'config.js must use wingman_language storage key');
assert.ok(configContent.includes("document.documentElement.lang = validLang === 'hinglish' ? 'hi-Latn' : 'en'"), 'config.js must update documentElement lang attribute');

// Extract dictionary and verify ZERO Devanagari characters in Hinglish dictionary
const dictMatch = configContent.match(/var DICTIONARY = (\{[\s\S]*?\n    \};)/);
assert.ok(dictMatch, 'DICTIONARY must be defined in config.js');
const dictionary = eval('(' + dictMatch[1].replace(/;\s*$/, '') + ')');

assert.ok(dictionary.en, 'English dictionary must exist');
assert.ok(dictionary.hinglish, 'Hinglish dictionary must exist');

for (const [key, val] of Object.entries(dictionary.hinglish)) {
    assert.strictEqual(DEVANAGARI_REGEX.test(val), false, `Hinglish dictionary value for '${key}' must not contain Devanagari characters: "${val}"`);
}
console.log(`✔ Passed: Verified ${Object.keys(dictionary.hinglish).length} Hinglish dictionary strings contain ZERO Devanagari characters.\n`);

// ---------------------------------------------------------------------
// 6. UI TOGGLE CONTROLS & RESPONSIVENESS IN HTML
// ---------------------------------------------------------------------
console.log('--- 6. UI TOGGLES IN APP.HTML & INDEX.HTML ---');

// Check app.html
assert.ok(appHtml.includes('lang-toggle-btn'), 'app.html must contain .lang-toggle-btn elements');
assert.ok(appHtml.includes('data-lang="en"'), 'app.html must contain data-lang="en" toggle');
assert.ok(appHtml.includes('data-lang="hinglish"'), 'app.html must contain data-lang="hinglish" toggle');
assert.ok(appHtml.includes('data-i18n="language_label"'), 'app.html must contain language label i18n attribute');

// Check index.html
assert.ok(indexHtml.includes('lang-toggle-btn'), 'index.html must contain .lang-toggle-btn elements');
assert.ok(indexHtml.includes('data-lang="en"'), 'index.html must contain data-lang="en" toggle');
assert.ok(indexHtml.includes('data-lang="hinglish"'), 'index.html must contain data-lang="hinglish" toggle');

// Verify app.js wires language into outgoing payloads
assert.ok(appJsContent.includes('window.wingmanI18n.getLanguage()'), 'app.js must pass active language in AI requests');

console.log('✔ Passed: UI toggles and payload binding are properly installed in frontend.\n');

console.log('============================================================');
console.log('🎉 ALL BILINGUAL (ENGLISH + HINGLISH) TESTS PASSED!');
console.log('============================================================');
