# MyWingman Razorpay Activation Resume Checkpoint

**Saved:** 2026-10-23 (Asia/Kolkata)

**State:** Paused at the user's request. Resume only when the user sends `resume`.
**Repository:** `viveks012000-maker/Wingman`

## Git checkpoint

- Last known deployed production baseline: `611b374252b4f9c4011961db19d53582d799a39b` (PR #179 merge). This matches the local `origin/main` tracking ref and the previously inspected live release manifest. Recheck the remote and live deployments on resume; the Railway connector was not available for a fresh check during this checkpoint.
- Local working branch: `codex/railway-environment-name-razorpay-activation`.
- Local code checkpoint commit: `2c2824f44d1153b1c21eb8f896f31b73eb76600e` (`checkpoint: correct Railway environment identity gates`). It is local only: not pushed, merged, or deployed.
- The checkpoint document is saved in a subsequent local commit on the same branch. Inspect `git log --oneline -- docs/RAZORPAY_ACTIVATION_RESUME.md` to find that documentation commit.
- Do not stage or remove the pre-existing untracked images under `work/performance-optimization/screenshots/` (10 files). They are unrelated workspace data and were preserved untouched.

## What was completed locally

The Railway environment identity correction now uses Railway's documented `RAILWAY_ENVIRONMENT_NAME` and `RAILWAY_ENVIRONMENT_ID`. A valid environment ID and name are required to identify a Railway runtime. The production payment gate requires the exact production environment ID `30e98667-a8a1-415d-8cf1-55e670f45bd0` together with the name `production`; the obsolete `RAILWAY_ENVIRONMENT` variable alone cannot authorize live payments. Production-safe authentication behavior remains in place for Railway deployments. `X-Real-IP` is trusted only in a recognized Railway runtime and only after literal IP validation.

The code checkpoint contains these 27 files:

- `middleware/auth.js`
- `middleware/railwayEnvironment.js`
- `middleware/razorpayPayments.js`
- `middleware/security.js`
- `middleware/securityBoundaries.js`
- `middleware/supabaseAuth.js`
- `railway-server.js`
- `server.js`
- `tests/auto_language_runtime.test.js`
- `tests/codex_audit_verification.test.js`
- `tests/cors_production_policy.test.js`
- `tests/error_disclosure.test.js`
- `tests/final_hardening_pass.test.js`
- `tests/internal_prompt_tag_leak_regression.test.js`
- `tests/maeve_modes_matrix.test.js`
- `tests/malformed_jwt_fast_reject.test.js`
- `tests/railway_environment_identity.test.js`
- `tests/railway_request_admission.test.js`
- `tests/razorpay_modes_reconciliation.test.js`
- `tests/razorpay_payments.test.js`
- `tests/request_lifecycle_and_idempotency_replay.test.js`
- `tests/roleplay_provider_path.test.js`
- `tests/run_all_tests.js`
- `tests/second_pass_verification.test.js`
- `tests/security_hardening_audit.test.js`
- `tests/ui_api_contract.test.js`
- `tests/universal_auto_language.test.js`

## Verification already completed

- Full `npm test`: exit 0; 128 passed, 0 failed.
- Additional focused Railway identity, Razorpay mode/reconciliation, payment mock/security, request admission, CORS and hardening checks passed.
- Disposable migration replay was skipped because Docker was unavailable. Migration 019 was already applied; do not rerun it against production.
- `git -c core.whitespace=cr-at-eol diff --cached --check` passed before the code checkpoint commit.
- A scan of the code changes found no credential-like token, private-key block, or credential-bearing URL. Secret values were not added to files or logs.

## Production and payment state last observed

- The API health endpoint returned `status: ok` with Supabase active. `/app` loaded. No authenticated AI/credit workflow was invoked during the payment work.
- `/api/payments/config` returned `enabled: false`, `mode: disabled`, `currency: INR`, `keyId: null`, and no available plan IDs. Real INR collection is not operational. No payment activation, production variable change, payment, or deployment was performed for this local fix.
- The frontend release manifest reported source commit `611b374252b4f9c4011961db19d53582d799a39b` at the time previously checked. Treat this as the last known observation and recheck on resume.
- Supabase project was previously confirmed active. Migration `019_razorpay_live_modes_and_reconciliation` was applied at `20261023161423`; reconciliation functions were present and executable only by `service_role`. No production database write was made.
- USD collection remains disabled. The Razorpay account's international-card screen reported that this business type is unsupported. Keep the USD pricing display intact.

## Railway connection and identifiers

These IDs were previously observed through the existing Railway project/configuration; reconfirm them with the authenticated Railway connector before using them:

- Project `Wingman`: `dda20725-30ef-4770-ab4e-d24a5c5cb5a3`
- Service `Wingman`: `ce064d3b-9dcc-43d4-9a37-b99878fa18b1`
- Production environment: `30e98667-a8a1-415d-8cf1-55e670f45bd0`
- Staging environment: `438d986c-d799-42a0-9149-ef0eef809486`

The last Railway connector call returned `UNAUTHORIZED` and requested app reauthentication. A Railway website login does not restore the Codex connection. The user must reconnect Railway under Codex **Settings → Apps & Connections → Railway** and complete authorization personally. Do not retry login repeatedly or request credentials in chat.

## Razorpay status and blockers

Previously inspected Razorpay dashboard state:

- Existing MyWingman merchant account: account access complete; website `https://mywingmanapp.com/` approved.
- Domestic cards, UPI, and displayed netbanking methods: activated in the dashboard.
- The inspected API keys page showed no existing key entry and offered `Generate Key`. Do not generate or replace keys until Railway access is restored, existing Railway variable presence is safely checked, and the live activation gates are satisfied.
- The inspected webhook page had no configured endpoint. Check again before creating exactly one endpoint; avoid duplicate webhook registrations.
- Automatic capture was shown as enabled (within 12 minutes); refunds used the normal 5–7 day schedule.
- The international-payment screen rejected international cards for this business type. Do not enable USD collection or add another provider.
- GST addition was reported unsupported for this business type. This does not establish tax exemption. A qualified owner/accountant determination remains required before setting `RAZORPAY_LIVE_TAX_APPROVED=true`.
- The merchant dashboard state does not prove a completed live transaction or that the production API currently has valid live keys. The Railway environment variables have not been safely inspected because the connector is unauthorized.

The live config endpoint was disabled, but current Railway flags, secret presence, key validity, webhook signature secret, and any incident-related rotation status remain unverified. Do not deploy the environment correction until a safe variable-name/presence audit proves it cannot unexpectedly enable live checkout. Never print or copy secret values into chat, logs, commits, or this document.

## Exact resume plan

When the user sends `resume`, continue this existing task in order; do not restart its implementation:

1. Read this checkpoint. Confirm the current branch, code commit, documentation commit, preserved `work/` images, current remote `main`, latest production SHA, Railway connector status, and production health.
2. Check current official Railway incident guidance and whether this workspace received an affected-account notice. The user's prior prompt identified a possible October 20–22, 2026 incident; that notice and any account exposure have not been verified here. If access is available, inspect unusual account/provider usage. If credible compromise evidence appears, alert the user and prioritize containment. Do not rotate shared credentials blindly; map every consumer and coordinate authorized rotation safely.
3. If Railway is still unauthorized, request the one exact action: reconnect the Railway app in Codex Settings → Apps & Connections. Continue independent local work, but do not claim production variables or deployment state are verified.
4. With Railway access, inspect production variable **names and presence only** plus safe format/enablement booleans, without displaying values. Verify current Railway identity, deployment SHA, payment configuration, and whether deploying this fix could activate collection. Preserve existing secrets, data, credits, payment settings, and rollback.
5. Recheck Railway's documented environment identity and the X-Real-IP trust boundary. Maintain a separate disabled-by-default payment activation gate. Do not deploy if the fix could turn on live collection unexpectedly.
6. Run the relevant tests, compare against the latest `main`, create a PR on the existing repository branch workflow, satisfy required checks, and deploy only through the existing Railway pipeline after the safety property is proven. Do not deploy Cloudflare for this backend-only change or trigger a deployment hook.
7. Reinspect the existing Razorpay merchant account. Confirm domestic INR eligibility, key/webhook state, capture, account mapping, signature verification, order amount/currency, fulfillment, idempotency, refund/dispute reconciliation, authenticated checkout, and browser-close recovery. Configure secrets only in Railway after provider approval and authorization; configure one correct webhook if needed.
8. Resolve tax treatment with a verified owner/accountant decision. Do not invent a tax rate or exemption, change approved package prices, or set the tax approval flag without that determination.
9. Keep USD collection disabled while preserving the USD display selector. Use isolated, non-billable/provider-test checks; do not perform an unapproved real-money transaction.
10. Before real INR collection, verify every provider, security, tax, deployment, rollback, and reconciliation gate and obtain the user's explicit authorization to activate real-money collection. Then verify the live release and checkout configuration. Never claim payments are operational without actual evidence.

## Fresh-session recovery

Open this repository directory:

`C:\Users\sumit\Documents\Codex\2026-10-19\files-pasted-by-the-user-mywingman\wingman-ai-failure-investigation`

Read this document first. Check `git status --short --branch` and `git log --oneline -5`. Continue from `codex/railway-environment-name-razorpay-activation` and code checkpoint `2c2824f44d1153b1c21eb8f896f31b73eb76600e`. Do not run `git clean`, reset, or overwrite local work. Preserve the untracked `work/performance-optimization/screenshots/` files. Compare the branch to the current remote `main` and resolve intervening changes safely before opening or merging a PR.
