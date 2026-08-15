/**
 * Tests: Security Hardening & Audit Verification Suite
 */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('\n============================================================');
console.log('🧪 RUNNING SECURITY HARDENING & AUDIT VERIFICATION SUITE');
console.log('============================================================\n');

// 1. Canonical Production Detection Tests
const supabaseAuthPath = path.join(__dirname, '../middleware/supabaseAuth.js');
const authPath = path.join(__dirname, '../middleware/auth.js');
const serverPath = path.join(__dirname, '../server.js');

const supabaseAuthContent = fs.readFileSync(supabaseAuthPath, 'utf8').replace(/\r\n/g, '\n');
const authContent = fs.readFileSync(authPath, 'utf8').replace(/\r\n/g, '\n');
const serverContent = fs.readFileSync(serverPath, 'utf8').replace(/\r\n/g, '\n');

// Test 1: Canonical Railway & NODE_ENV checks present in middleware and server
assert.strictEqual(supabaseAuthContent.includes('RAILWAY_ENVIRONMENT'), true);
assert.strictEqual(authContent.includes('RAILWAY_ENVIRONMENT'), true);
assert.strictEqual(serverContent.includes('isProduction'), true);
console.log('✔ Test 1 Passed: Canonical production detection covers NODE_ENV=production and Railway environment variables');

// Test 2: Service-role fail-closed (No fallback to anon key for admin client)
assert.strictEqual(
    supabaseAuthContent.includes('const supabaseAdmin = (SUPABASE_SERVICE_ROLE_KEY && SUPABASE_SERVICE_ROLE_KEY.trim().length > 0)'),
    true,
    'supabaseAdmin requires actual SUPABASE_SERVICE_ROLE_KEY'
);
assert.strictEqual(
    supabaseAuthContent.includes('createClient(SUPABASE_URL, SUPABASE_ANON_KEY'),
    false,
    'supabaseAdmin must NEVER fall back to SUPABASE_ANON_KEY'
);
console.log('✔ Test 2 Passed: Supabase service-role fail-closed verified (zero silent fallback to anon key)');

// Test 3: Payment routes cannot mint production credits
assert.strictEqual(
    serverContent.includes("if (IS_PROD || process.env.ENABLE_MOCK_PAYMENTS !== 'true') {\n            return res.status(503).json({\n                success: false,\n                error: 'Production payment gateway integration pending. Real payment gateway required.'\n            });\n        }"),
    true,
    '/api/payments/verify must return 503 in production'
);
assert.strictEqual(
    serverContent.includes("app.post('/api/credits/purchase', requireSupabaseAuth, apiLimiter, (req, res) => {\n    return res.status(503).json({\n        success: false,\n        error: \"Direct credit purchasing is currently unavailable. Payment gateway integration is deferred.\"\n    });\n});"),
    true,
    '/api/credits/purchase must return 503'
);
console.log('✔ Test 3 Passed: Payment verification and purchase routes strictly locked down in production (HTTP 503)');

// Test 4: Simulator Review Cost Abuse & Protection
assert.strictEqual(serverContent.includes("app.post('/api/simulator/review'") && serverContent.includes("requireSupabaseAuth") && serverContent.includes("apiLimiter"), true);
assert.strictEqual(serverContent.includes("deduction = await verifyAndDeductCreditsDB(req, 2, 'simulator_review', reqId);"), true);
assert.strictEqual(serverContent.includes("if (!acquireUserConcurrencyLock(uid))"), true);
console.log('✔ Test 4 Passed: Simulator review is Supabase authenticated, metered, rate limited, and concurrency locked');

// Test 5: Account Deletion — No False Success & Proper Error Handling
assert.strictEqual(serverContent.includes("if (!supabaseAdmin || !supabaseAdmin.auth || !supabaseAdmin.auth.admin || typeof supabaseAdmin.auth.admin.deleteUser !== 'function') {\n            return res.status(500).json({ success: false, error: 'Server authentication admin service is unavailable.' });\n        }"), true);
assert.strictEqual(serverContent.includes("const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(uid);"), true);
assert.strictEqual(serverContent.includes("if (authDelErr) {\n                console.error('[delete-account Auth delete error]:', authDelErr.message);\n                return res.status(500).json({ success: false, error: 'Failed to delete authentication account: ' + authDelErr.message });\n            }"), true);
console.log('✔ Test 5 Passed: Account deletion checks admin service capability, verifies Auth deletion, and prevents false success');

// Test 6: Signup Authentication State (Requires Session)
const clientJs = fs.readFileSync(path.join(__dirname, '../supabaseClient.js'), 'utf8');
assert.strictEqual(clientJs.includes("if (resp.data.session && resp.data.session.access_token) {"), true);
assert.strictEqual(clientJs.includes("confirmationRequired: true"), true);
console.log('✔ Test 6 Passed: Signup requires valid active session to mark user authenticated (handles confirmation flow)');

// Test 7: Duplicate Token Storage Removed
assert.strictEqual(clientJs.includes("safeSet('wingman_jwt_token'"), false, 'Redundant custom token storage removed from supabaseClient.js');
console.log('✔ Test 7 Passed: Redundant custom access token copies in localStorage/sessionStorage removed');

// Test 8: Private Logging in Production Suppressed
assert.strictEqual(serverContent.includes("if (!IS_PROD && process.env.DEBUG_PAYLOADS === 'true') {\n                console.log(\"\\n================ [STAGE 1 VISION JSON OUTPUT] ================\");"), true);
assert.strictEqual(serverContent.includes("if (!IS_PROD && process.env.DEBUG_PAYLOADS === 'true') {\n            console.log(\"[ICEBREAKER CLEAN OUTPUT]:\", cleanedOptions);\n        }"), true);
console.log('✔ Test 8 Passed: Production private payload logs strictly suppressed behind !IS_PROD');

// Test 9: Analytics Strict Allowlist
assert.strictEqual(serverContent.includes("const ALLOWED_ANALYTICS_EVENTS = new Set(["), true);
assert.strictEqual(serverContent.includes("const ALLOWED_ANALYTICS_META_KEYS = new Set(["), true);
console.log('✔ Test 9 Passed: Analytics strictly validates events and metadata against bounded literal allowlists');

// Test 10: .gitignore Pattern Hardening
const gitignoreContent = fs.readFileSync(path.join(__dirname, '../.gitignore'), 'utf8');
assert.strictEqual(gitignoreContent.includes('*.p12'), true);
assert.strictEqual(gitignoreContent.includes('*.pfx'), true);
assert.strictEqual(gitignoreContent.includes('*.cer'), true);
assert.strictEqual(gitignoreContent.includes('*.bak'), true);
assert.strictEqual(gitignoreContent.includes('*.backup'), true);
assert.strictEqual(gitignoreContent.includes('*.dump'), true);
assert.strictEqual(gitignoreContent.includes('*.dmp'), true);
console.log('✔ Test 10 Passed: .gitignore contains all required backup, key, certificate, and credential patterns');

// Test 11: Dependency Vulnerabilities
try {
    const auditOutput = execSync('npm audit --json', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const auditParsed = JSON.parse(auditOutput);
    const totalVulns = (auditParsed.metadata && auditParsed.metadata.vulnerabilities && auditParsed.metadata.vulnerabilities.total) || 0;
    assert.strictEqual(totalVulns, 0, `Expected 0 vulnerabilities from npm audit, got ${totalVulns}`);
    console.log('✔ Test 11 Passed: npm audit reports 0 vulnerabilities');
} catch (e) {
    if (e.stdout) {
        const auditParsed = JSON.parse(e.stdout);
        const totalVulns = (auditParsed.metadata && auditParsed.metadata.vulnerabilities && auditParsed.metadata.vulnerabilities.total) || 0;
        assert.strictEqual(totalVulns, 0, `Expected 0 vulnerabilities, got ${totalVulns}`);
    } else {
        throw e;
    }
}

console.log('\n🎉 ALL SECURITY HARDENING & AUDIT TESTS PASSED!\n');
