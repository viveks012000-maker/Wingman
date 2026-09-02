const { execSync } = require('child_process');
const path = require('path');

const TEST_TIMEOUT_MS = 60_000;

const testSuites = [
    { name: '0. Focused Release Repair Regression Guard', file: 'focused_release_repair.test.js' },
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
    { name: '16a. Disposable Migration Replay & Recovery Smoke', file: 'migration_replay.test.js', timeoutMs: 180_000 },
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
    { name: '30. Privileged Add-Credits Missing-Profile Guard', file: 'add_credits_profile_missing.test.js' },
    { name: '31. Production Legal & Privacy Accuracy Guard', file: 'legal_production_accuracy.test.js' },
    { name: '32. Public Health Endpoint Minimal-Disclosure Guard', file: 'health_endpoint_minimal.test.js' },
    { name: '33. Netlify Release Manifest Source-Commit Truth Guard', file: 'release_manifest_source.test.js' },
    { name: '33a. Checked-In Build Script Dependency Guard', file: 'build_script_dependencies.test.js' },
    { name: '33b. Process Resolution & Deterministic Text Artifact Guard', file: 'process_tools.test.js' },
    { name: '33c. Locked Text Artifact Byte Guard', file: 'locked_text_artifacts.test.js' },
    { name: '34. Maeve Provider Runtime & Retry Guard', file: 'maeve_runtime_repair.test.js' },
    { name: '35. Feature Access Preflight UX Guard', file: 'feature_access_preflight.test.js' },
    { name: '36. Duplicate Request Concurrency Lock Race Guard', file: 'duplicate_request_lock_race.test.js' },
    { name: '37. Analyzer Provider Diagnostic Boundary Guard', file: 'analyzer_provider_diagnostics.test.js' },
    { name: '38. Closed Dialog Inert Accessibility Guard', file: 'modal_inert_accessibility.test.js' },
    { name: '39. Buy Credits Nested-Interactive Accessibility Guard', file: 'buy_credits_nested_interactive.test.js' },
    { name: '40. Mobile Empty-State WCAG Contrast Guard', file: 'empty_state_mobile_contrast.test.js' },
    { name: '41. Cloudflare Pages Routing, 404 & CORS Cutover Guard', file: 'cloudflare_pages_cutover.test.js' },
    { name: '42. Cloudflare Final Accessibility Guard', file: 'cloudflare_final_accessibility.test.js' },
    { name: '43. Malformed JWT Fast-Reject & Remote Auth Guard', file: 'malformed_jwt_fast_reject.test.js' },
    { name: '44. Consent Table Least-Privilege Guard', file: 'user_consents_least_privilege.test.js' },
    { name: '45. Railway Request Admission & Client-IP Guard', file: 'railway_request_admission.test.js' },
    { name: '46. Full Production CI Coverage Guard', file: 'ci_full_gate_coverage.test.js' },
    { name: '47. Consent Browser Zero-Access Guard', file: 'user_consents_browser_zero_access.test.js' },
    { name: '48. Optimized Responsive Logo Delivery Guard', file: 'logo_delivery_optimization.test.js' },
    { name: '49. Inlined Critical Custom Stylesheet Guard', file: 'inline_critical_css.test.js' },
    { name: '50. Exact Self-Hosted Main Font Delivery Guard', file: 'self_host_main_fonts.test.js' },
    { name: '51. Inlined Cropper CSS Delivery Guard', file: 'inline_cropper_css.test.js' },
    { name: '52. Exact Self-Hosted Material Symbols Delivery Guard', file: 'self_host_material_symbols.test.js' },
    { name: '53. Landing Explicit Favicon Delivery Guard', file: 'landing_favicon_delivery.test.js' },
    { name: '54. Password Recovery Completion & Strengthened-Password Guard', file: 'password_recovery_compat.test.js' },
    { name: '55. Persisted Paid Plan State & O(1) Lookup Guard', file: 'paid_plan_state.test.js' },
    { name: '56. SEO Indexing, Canonical Metadata & 404 Hardening', file: 'seo_indexing_metadata.test.js' },
    { name: '57. Misdirected Custom-Domain CORS Revocation Guard', file: 'misdirected_domain_cors.test.js' },
    { name: '58. Production CSS Compatibility Artifact Lock', file: 'production_css_compat_lock.test.js' },
    { name: '59. Browser Vendor Provenance & Dependency Monitoring', file: 'browser_vendor_provenance.test.js' },
    { name: '60. All Dialog Accessibility Coverage', file: 'all_dialog_accessibility.test.js' },
    { name: '61. Chat Routing, Idempotency & Stale Response Contract', file: 'chat_contract.test.js' },
    { name: '62. Mobile Presentation Layer Browser QA', file: 'mobile_presentation_qa.test.js', timeoutMs: 90_000 },
    { name: '63. Client Image Pipeline Guard', file: 'client_image_pipeline.test.js' },
    { name: '64. Client Privacy Boundary Guard', file: 'client_privacy_boundary.test.js' },
    { name: '65. Mobile Viewport Behavior Guard', file: 'mobile_viewport_behavior.test.js' },
    { name: '66. Mobile Touch Scroll Regression', file: 'mobile_touch_scroll_regression.test.js', timeoutMs: 30_000 },
    { name: '67. Security Boundary & Log Integrity Guard', file: 'security_boundaries.test.js' },
    { name: '68. Launch Delivery & /app Verifier Contract', file: 'launch_hardening_contract.test.js' },
    { name: '69. Live Asset Integrity & Cloudflare Transformation Guard', file: 'live_asset_integrity.test.js' },
    { name: '70. Mobile Touch Interaction & Modal Reachability Repro', file: 'mobile_touch_interaction_repro.test.js', timeoutMs: 240_000 },
    { name: '71. RLS Ownership Binding & Error Propagation Hardening', file: 'rls_hardening.test.js' },
    { name: '72. Credit Release Transport Resilience', file: 'credit_release_resilience.test.js' },
    { name: '73. Prompt-Injection Boundary Resilience', file: 'prompt_injection_resilience.test.js' }
];

console.log('========================================================================');
console.log('🚀 RUNNING ALL MYWINGMAN COMPREHENSIVE HARDENING & AUDIT TEST SUITES');
console.log('========================================================================\n');

let totalPassed = 0;
let totalFailed = 0;

for (const suite of testSuites) {
    const filePath = path.join(__dirname, suite.file);
    const timeoutMs = suite.timeoutMs || TEST_TIMEOUT_MS;
    console.log(`\n▶ [SUITE] ${suite.name} (${suite.file})`);
    try {
        const output = execSync(`node "${filePath}"`, {
            stdio: 'pipe',
            encoding: 'utf8',
            timeout: timeoutMs,
            killSignal: 'SIGTERM'
        });
        console.log(output.trim());
        totalPassed++;
    } catch (err) {
        console.error(`❌ FAILED: ${suite.name}`);
        if (err.killed || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
            console.error(`Test suite exceeded ${timeoutMs / 1000} seconds and was terminated to prevent CI from hanging.`);
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
