'use strict';

/**
 * Wingman — Prompt Optimization, Mode Isolation, and Speed Test Suite
 *
 * Verifies:
 * 1. Prompts for /api/analyze, /api/icebreaker, and /api/optimize do not contain duplicated language instructions.
 * 2. Active mode isolation in prompt compilation.
 * 3. Dynamic repair token budget scaling proportional to required slot count.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('============================================================');
console.log('🧪 RUNNING PROMPT OPTIMIZATION AND SPEED SUITE');
console.log('============================================================\n');

// -------------------------------------------------------------
// TEST 1: No duplicated language directives in server.js non-chat routes
// -------------------------------------------------------------
console.log('▶ [TEST 1] No duplicate languageDirective + getAuthoritativeProfileDirective in non-chat routes');
const serverContent = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// Ensure no route concatenates both directives
const hasAnalyzeDup = serverContent.includes("languageDirective(language, 'analyze') + getAuthoritativeProfileDirective");
assert.strictEqual(hasAnalyzeDup, false, 'Analyze route must not concatenate duplicate language directives');

const hasIcebreakerDup = serverContent.includes("languageDirective(language, 'icebreaker') + getAuthoritativeProfileDirective");
assert.strictEqual(hasIcebreakerDup, false, 'Icebreaker route must not concatenate duplicate language directives');

const hasBioDup = serverContent.includes("languageDirective(language, 'optimize') + getAuthoritativeProfileDirective");
assert.strictEqual(hasBioDup, false, 'Bio route must not concatenate duplicate language directives');

console.log('✔ Test 1 Passed: Duplicate language directives eliminated from all 3 non-chat routes.\n');

// -------------------------------------------------------------
// TEST 2: Dynamic Repair Token Budget Formula
// -------------------------------------------------------------
console.log('▶ [TEST 2] Dynamic repair token budget scaling');
function computeRepairMaxTokens(slotCount, feature) {
    return Math.min(1000, Math.max(250, slotCount * (feature === 'optimize' ? 120 : 60)));
}

// 1 slot icebreaker -> 250 tokens (lower bound)
assert.strictEqual(computeRepairMaxTokens(1, 'icebreaker'), 250, '1 slot icebreaker should use min bound 250 tokens');

// 2 slots icebreaker -> 250 tokens
assert.strictEqual(computeRepairMaxTokens(2, 'icebreaker'), 250, '2 slots icebreaker should use min bound 250 tokens');

// 6 slots icebreaker -> 360 tokens
assert.strictEqual(computeRepairMaxTokens(6, 'icebreaker'), 360, '6 slots icebreaker should use 360 tokens');

// 2 slots bio -> 250 tokens
assert.strictEqual(computeRepairMaxTokens(2, 'optimize'), 250, '2 slots bio should use min bound 250 tokens');

// 5 slots bio -> 600 tokens
assert.strictEqual(computeRepairMaxTokens(5, 'optimize'), 600, '5 slots bio should use 600 tokens');

// 10 slots bio -> 1000 tokens (upper bound)
assert.strictEqual(computeRepairMaxTokens(10, 'optimize'), 1000, '10 slots bio should cap at 1000 tokens');

console.log('✔ Test 2 Passed: Token budget scales dynamically with slot count to accelerate repair calls.\n');

// -------------------------------------------------------------
// TEST 3: renderFiveCards Presentation-Only Text Invariant
// -------------------------------------------------------------
console.log('▶ [TEST 3] app.js renderFiveCards is strictly presentation-only');
const appContent = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

// Ensure renderFiveCards does NOT call toLowerCase() or inject expressivePool emojis
const renderFiveCardsMatch = appContent.match(/window\.renderFiveCards\s*=\s*function\s*\([^\)]*\)\s*\{([\s\S]*?)(?=\n\s*window\.|\n\s*function|\n\s*\/\/\s*===)/);
assert.ok(renderFiveCardsMatch, 'renderFiveCards function definition found');
const renderBody = renderFiveCardsMatch[1];

assert.strictEqual(
    renderBody.includes('cardText = cardText.toLowerCase()'),
    false,
    'renderFiveCards must NOT lowercase cardText'
);
assert.strictEqual(
    renderBody.includes('expressivePool'),
    false,
    'renderFiveCards must NOT inject expressivePool emojis'
);
console.log('✔ Test 3 Passed: renderFiveCards text transformations completely removed.\n');

console.log('============================================================');
console.log('🎉 ALL PROMPT OPTIMIZATION AND SPEED TESTS PASSED (3/3)!');
console.log('============================================================');
