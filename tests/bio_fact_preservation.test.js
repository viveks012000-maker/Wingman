/**
 * tests/bio_fact_preservation.test.js
 * 
 * Verifies:
 * 1. sanitizeBioInput strictly preserves real user facts, institutions, and cultural terminology
 *    (e.g., IIT Roorkee, dhaba, pani puri, chai tapri, auto, monsoon).
 * 2. Empty or whitespace-only bio input returns "" and NEVER hallucinates default or synthetic text.
 * 3. Greeting and intro fluff are stripped while preserving the core biographical facts.
 * 4. Static audit: server.js contains zero Westernizing or fact-altering string replacement rules.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('\n============================================================');
console.log('🧪 RUNNING BIO FACT PRESERVATION TEST SUITE');
console.log('============================================================\n');

const server = require('../server.js');
const { sanitizeBioInput } = server;

// --- Test 1: sanitizeBioInput empty and whitespace handling ---
console.log('Test 1: sanitizeBioInput returns empty string for empty or whitespace-only input');
{
    assert.strictEqual(sanitizeBioInput(''), '', 'Empty string must return empty string');
    assert.strictEqual(sanitizeBioInput('   '), '', 'Whitespace spaces must return empty string');
    assert.strictEqual(sanitizeBioInput('\n\t  \r\n'), '', 'Whitespace tabs and newlines must return empty string');
    assert.strictEqual(sanitizeBioInput(null), '', 'Null input must return empty string');
    assert.strictEqual(sanitizeBioInput(undefined), '', 'Undefined input must return empty string');
    assert.strictEqual(sanitizeBioInput('a'), '', 'Single character input must return empty string');

    console.log('  ✓ Verified: Zero default or hallucinated text injected for empty bio inputs.');
}

// --- Test 2: Cultural terminology and specific biographical facts preserved ---
console.log('\nTest 2: Specific biographical facts and cultural terms are strictly preserved');
{
    const testCases = [
        {
            input: 'Graduated from IIT Roorkee with a degree in civil engineering.',
            expectedSnippet: 'IIT Roorkee'
        },
        {
            input: 'Spending Friday nights at the local dhaba with friends.',
            expectedSnippet: 'dhaba'
        },
        {
            input: 'Always down for roadside pani puri and sweet lassi.',
            expectedSnippet: 'pani puri'
        },
        {
            input: 'Philosophical conversations at the chai tapri.',
            expectedSnippet: 'chai tapri'
        },
        {
            input: 'Navigating Bangalore traffic in an auto while listening to podcasts.',
            expectedSnippet: 'auto'
        },
        {
            input: 'Walking in the Mumbai monsoon with cutting chai.',
            expectedSnippet: 'monsoon'
        }
    ];

    for (const { input, expectedSnippet } of testCases) {
        const sanitized = sanitizeBioInput(input);
        assert.ok(sanitized.includes(expectedSnippet), `Expected sanitized bio to preserve "${expectedSnippet}". Result: "${sanitized}"`);
        // Verify no replacement was made to Western equivalents
        assert.ok(!sanitized.includes('24-hour diner'), 'Must NOT replace dhaba with 24-hour diner');
        assert.ok(!sanitized.includes('street tacos'), 'Must NOT replace pani puri with street tacos');
        assert.ok(!sanitized.includes('coffee shop'), 'Must NOT replace chai tapri with coffee shop');
        assert.ok(!sanitized.includes('college town'), 'Must NOT replace Roorkee with college town');
        assert.ok(!sanitized.includes('rainy days'), 'Must NOT replace monsoon with rainy days');
    }

    console.log('  ✓ Verified: All cultural facts, locations, and idioms preserved without alteration.');
}

// --- Test 3: Intro fluff stripping preserves fact body ---
console.log('\nTest 3: Greeting and intro fluff stripping preserves factual body');
{
    const introFactInputs = [
        {
            input: 'Hey my name is Rahul, graduated from IIT Roorkee and love street food.',
            expectedFact: 'IIT Roorkee'
        },
        {
            input: 'Namaste mera naam Amit hai aur spending evenings at local dhaba.',
            expectedFact: 'local dhaba'
        },
        {
            input: 'Just downloaded Bumble and looking for someone to try pani puri with.',
            expectedFact: 'pani puri'
        }
    ];

    for (const { input, expectedFact } of introFactInputs) {
        const sanitized = sanitizeBioInput(input);
        assert.ok(sanitized.includes(expectedFact), `Must retain fact "${expectedFact}" after intro strip. Got: "${sanitized}"`);
        assert.ok(!sanitized.toLowerCase().includes('mera naam'), 'Must strip intro fluff');
    }

    console.log('  ✓ Verified: Intro fluff stripped while factual content is preserved.');
}

// --- Test 4: Static audit of server.js for forbidden replacement rules ---
console.log('\nTest 4: Static audit of server.js for forbidden fact-altering replacements');
{
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

    // Forbidden regex replacements that previously altered user facts
    const forbiddenPatterns = [
        /replace\([^)]*dhaba[^)]*24-hour diner/i,
        /replace\([^)]*pani puri[^)]*street tacos/i,
        /replace\([^)]*chai tapri[^)]*coffee shop/i,
        /replace\([^)]*Roorkee[^)]*college town/i,
        /replace\([^)]*monsoon[^)]*rainy days/i
    ];

    for (const pattern of forbiddenPatterns) {
        assert.ok(!pattern.test(serverSource), `server.js contains forbidden fact-altering replacement: ${pattern}`);
    }

    // Verify sanitizeBioInput does not have a default fallback bio string
    const sanitizeBioMatch = serverSource.match(/function sanitizeBioInput\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(sanitizeBioMatch, 'server.js must define function sanitizeBioInput');
    const sanitizeBioBody = sanitizeBioMatch[1];

    assert.ok(
        !sanitizeBioBody.includes('Software engineer') && !sanitizeBioBody.includes('love coffee'),
        'sanitizeBioInput must not include hallucinated default bio'
    );

    console.log('  ✓ Verified: server.js contains zero fact-altering or Westernizing substitutions.');
}

console.log('\n============================================================');
console.log('🏁 ALL BIO FACT PRESERVATION TESTS PASSED');
console.log('============================================================\n');
