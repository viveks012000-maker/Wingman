const { execSync } = require('child_process');
const path = require('path');

const TEST_TIMEOUT_MS = 60_000;

const testSuites = [
    { name: '1. Final Technical Hardening Pass Verification', file: 'final_hardening_pass.test.js' },
    { name: '2. Codex Comprehensive Audit Verification', file: 'codex_audit_verification.test.js' },
    { name: '3. Core Hardening Verification Suite', file: 'hardening_verification.test.js' },
    { name: '4. Second Pass Adversarial Verification', file: 'second_pass_verification.test.js' },
    { name: '5. Node Security & Route Bounds Tests', file: 'security_node.test.js' },
    { name: '6. Credit Auto-Provisioning Suite', file: 'credits.test.js' },
    { name: '7. Screenshot Analyzer Button State Machine', file: 'analyzer_button_state.test.js' },
    { name: '8. Screenshot Analyzer Image Validation & Bounds', file: 'analyzer_image_validation.test.js' },
    { name: '9. Screenshot Analyzer AI Pipeline & Model Lock', file: 'analyzer_ai_pipeline.test.js' },
    { name: '10. Screenshot Analyzer State Machine & Idempotency', file: 'analyzer_credit_failure_zero_charge.test.js' },
    { name: '11. Exactly-Once 50-Credit & Missing Profile Safety', file: 'analyzer_exactly_once_credits.test.js' },
    { name: '12. Screenshot Analyzer Full End-to-End Integration', file: 'analyzer_full_e2e_integration.test.js' },
    { name: '13. Public SEO Files (robots.txt & sitemap.xml)', file: 'seo_files.test.js' },
    { name: '14. Security Hardening & Audit Verification', file: 'security_hardening_audit.test.js' },
    { name: '15. Runtime Cross-Feature Isolation & Button State', file: 'runtime_cross_feature_isolation.test.js' },
    { name: '16. Credit Balance & Authoritative Auth Runtime', file: 'credit_balance_auth_runtime.test.js' },
    { name: '17. Migration 002 Safety & Security Audit', file: 'migration_002_safety_audit.test.js' },
    { name: '18. Migration 003 COALESCE Syntax Audit', file: 'migration_003_coalesce_audit.test.js' },
    { name: '19. System Settings & Formatting Verification', file: 'system_settings_formatting.test.js' },
    { name: '20. Production Readiness & QA Regression Suite', file: 'production_readiness_regression.test.js' },
    { name: '21. Credit/Purchase Modal Regression Guard', file: 'credit_purchase_modal_regression.test.js' },
    { name: '22. Netlify Frontend-Only Deploy Safety', file: 'netlify_deploy_safety.test.js' },
    { name: '23. Railway Static Internal-File Denylist', file: 'static_internal_exposure.test.js' },
    { name: '24. Mobile Responsiveness & Viewport Audit', file: 'viewport_overflow_qa.test.js' },
    { name: '25. Headless Browser Live Viewport Overflow QA', file: 'browser_viewport_live_qa.js' },
    { name: '26. Post-Audit Correctness & DOM Sink Guard', file: 'post_audit_correctness.test.js' },
    { name: '27. Production CORS Least-Privilege Guard', file: 'cors_production_policy.test.js' },
    { name: '28. Account Deletion Atomicity & Cascade Guard', file: 'account_deletion_atomicity.test.js' },
    { name: '29. Runtime Startup, CSP & Production-Origin Example Guard', file: 'runtime_startup_csp_hardening.test.js' },
    { name: '30. Privileged Add-Credits Missing-Profile Guard', file: 'add_credits_profile_missing.test.js' }
];

console.log('========================================================================');
console.log('🚀 RUNNING ALL MYWINGMAN COMPREHENSIVE HARDENING & AUDIT TEST SUITES');
console.log('========================================================================\n');

let totalPassed = 0;
let totalFailed = 0;

for (const suite of testSuites) {
    const filePath = path.join(__dirname, suite.file);
    console.log(`\n▶ [SUITE] ${suite.name} (${suite.file})`);
    try {
        const output = execSync(`node "${filePath}"`, {
            stdio: 'pipe',
            encoding: 'utf8',
            timeout: TEST_TIMEOUT_MS,
            killSignal: 'SIGTERM'
        });
        console.log(output.trim());
        totalPassed++;
    } catch (err) {
        console.error(`❌ FAILED: ${suite.name}`);
        if (err.killed || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
            console.error(`Test suite exceeded ${TEST_TIMEOUT_MS / 1000} seconds and was terminated to prevent CI from hanging.`);
        }
        if (err.stdout) console.log(err.stdout);
        if (err.stderr) console.error(err.stderr);
        totalFailed++;
    }
}

console.log('\n========================================================================');
console.log(`🏁 TEST SUITES COMPLETED: ${totalPassed} Passed, ${totalFailed} Failed`);
console.log('========================================================================\n');

process.exit(totalFailed > 0 ? 1 : 0);
