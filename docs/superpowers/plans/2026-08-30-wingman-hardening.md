# MyWingman Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove confirmed privacy, payload, mobile, accessibility, and chat consistency defects without changing the Antigravity integration or paid-feature contracts.

**Architecture:** Keep the current single-page client and Express API, but make boundaries explicit. User-entered text and conversations remain memory-only; image processing produces one bounded JPEG representation; mobile layout uses one visual-viewport contract; all dialogs use the existing accessibility manager; chat uses one validated request shape and stable idempotency key.

**Tech Stack:** Vanilla JavaScript, HTML/CSS, Express, Supabase, Node test scripts, Playwright.

**Spec:** `PROJECT_MASTER_SPECIFICATION.md`

## Global Constraints

- Preserve Antigravity CLI version `1.1.22` and its existing bridge.
- Do not add payment providers or fake checkout behavior.
- Do not persist screenshots, raw text, transcripts, generated outputs, or access tokens in browser storage.
- Do not add `unsafe-eval` when the CSP-safe HEIC runtime is used.
- Keep the existing API credit reservation and idempotency contracts.
- Use ASCII for new source text unless existing user-facing copy requires otherwise.

---

### Task 1: Client Privacy Boundary

**Files:**
- Modify: `app.js:7-39,2698-2810,1483-1490,2045-2047`
- Modify: `supabaseClient.js:795-816`
- Modify: `privacy.html:56-59`
- Test: `tests/client_privacy_boundary.test.js`

**Interfaces:**
- `safeStorage` retains only settings and non-sensitive UI preferences.
- `saveSessionState()` no longer writes conversation, text, image, or generated-result payloads.
- Authentication UI derives from the Supabase session rather than persisted boolean flags.

- [ ] **Step 1: Write the failing test**

Assert that `safeStorage.set()` does not write to `sessionStorage` for sensitive session payloads, that `saveSessionState()` has no raw text or simulator-thread persistence, and that logout removes only owned keys.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/client_privacy_boundary.test.js`

Expected: FAIL on raw session payload persistence and duplicated storage writes.

- [ ] **Step 3: Write the minimal implementation**

Keep settings in `localStorage`, keep sensitive runtime state in memory, remove persisted auth checks from UI branches, and replace origin-wide `clear()` calls with removal of the app-owned key list.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/client_privacy_boundary.test.js`

Expected: PASS with no private text, transcript, screenshot, or token persistence.

- [ ] **Step 5: Update the disclosure and run related regression tests**

Run: `node tests/security_hardening_audit.test.js` and `node tests/legal_production_accuracy.test.js`

Expected: PASS with privacy copy describing memory-only conversational processing accurately.

---

### Task 2: Bounded Image Pipeline

**Files:**
- Modify: `app.js:686-728,749-760,1256-1273`
- Modify: `middleware/imageValidator.js:36-95`
- Test: `tests/client_image_pipeline.test.js`

**Interfaces:**
- `processImageToJpegDataUrl(file)` returns a JPEG data URL whose decoded canvas dimensions are bounded by the shared maximum edge and pixel budget.
- All upload, HEIC conversion, rotation, and crop fallback paths use that bounded representation.

- [ ] **Step 1: Write the failing test**

Exercise the browser canvas harness with a 10,000 by 8,000 image and assert the output canvas is bounded; assert the client does not apply the text word limiter to image data URLs.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/client_image_pipeline.test.js`

Expected: FAIL because the current canvas uses the natural image dimensions and the image path shares text truncation logic.

- [ ] **Step 3: Write the minimal implementation**

Compute a scale from max edge and max pixels, draw into the bounded canvas, and route every processed image through the helper. Keep server byte/type/count validation and add decoded-dimension rejection only where metadata can be safely obtained without trusting remote URLs.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/client_image_pipeline.test.js` and `node tests/analyzer_image_validation.test.js`

Expected: PASS with bounded output and unchanged server validation behavior.

---

### Task 3: Mobile Viewport and Plexus Truthfulness

**Files:**
- Modify: `app.js:2279-2303,3639-3646,3774-3810`
- Modify: `app.html:554-559,659-674,1858-1867`
- Modify: `style.css:52-59,79-84,123-127,201-204`
- Test: `tests/mobile_viewport_behavior.test.js`

**Interfaces:**
- `window.visualViewport` updates `--wingman-visual-height` and keeps the composer/footer visible above the keyboard.
- Mobile Plexus controls are disabled and visibly marked unavailable when the canvas is intentionally not rendered.
- Bottom content reserves the fixed navigation height plus `env(safe-area-inset-bottom)`.

- [ ] **Step 1: Write the failing test**

Assert that the source registers a visual-viewport update path, does not use a conflicting mobile `100vh` override, and exposes a truthful disabled Plexus control on mobile.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/mobile_viewport_behavior.test.js`

Expected: FAIL because no visual-viewport listener exists and the mobile toggle remains enabled.

- [ ] **Step 3: Write the minimal implementation**

Use `100dvh` plus a `visualViewport.height` CSS variable, update on resize/scroll, remove conflicting inline mobile rules, and make the mobile Plexus setting disabled with explanatory accessible text.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/mobile_viewport_behavior.test.js` and `node tests/browser_viewport_live_qa.js`

Expected: PASS across the existing viewport matrix.

---

### Task 4: Unified Dialog Accessibility

**Files:**
- Modify: `accessibility.js:4-10`
- Modify: `app.js:4133-4141`
- Modify: `app.html:2033-2081`
- Modify: `vendor/production-runtime.js:52-123,373-462`
- Test: `tests/all_dialog_accessibility.test.js`

**Interfaces:**
- Every static dialog is registered in the shared modal configuration.
- Dynamically-created dialogs use the same role, inert, focus-trap, Escape, and return-focus behavior.
- `showUnreadableErrorModal()` produces a visible, focusable dialog instead of only removing `hidden`.

- [ ] **Step 1: Write the failing test**

Enumerate static dialog IDs, assert each is registered and initially inert/hidden, and exercise the unreadable dialog open path.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/all_dialog_accessibility.test.js`

Expected: FAIL for unregistered dialogs and the unreadable modal's retained opacity/pointer-events classes.

- [ ] **Step 3: Write the minimal implementation**

Add missing dialog registrations, remove all closed-state classes when opening the unreadable dialog, and expose one registration function for dynamic runtime dialogs.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/all_dialog_accessibility.test.js`, `node tests/modal_inert_accessibility.test.js`, and `node tests/buy_credits_nested_interactive.test.js`

Expected: PASS with focus and inertness preserved.

---

### Task 5: Chat Request Contract

**Files:**
- Modify: `app.js:3531-3543,3761-3851`
- Modify: `server.js:2568-2741`
- Test: `tests/chat_request_contract.test.js`

**Interfaces:**
- `submitChatboxMessage()` creates one request ID before its first await, sends it in both the body and `X-Idempotency-Key`, and ignores stale responses after a mode switch.
- The server normalizes `isHotline`, `mode`, and scenario before reservation, validates one canonical history array, and rejects conflicting/invalid values with HTTP 400.
- Hotline and roleplay keep their separate provider budgets and prompts.

- [ ] **Step 1: Write the failing test**

Assert stable request-key creation, stale-generation response rejection, `isHotline` routing, invalid scenario rejection before reservation, and canonical history usage.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/chat_request_contract.test.js`

Expected: FAIL because direct chat fetch has no idempotency key and the server ignores `isHotline`.

- [ ] **Step 3: Write the minimal implementation**

Add the synchronous request key and generation token in the client; add a pre-reservation normalization/validation block in the server; use the validated history in both provider branches.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/chat_request_contract.test.js`, `node tests/security_node.test.js`, and `node tests/maeve_runtime_repair.test.js`

Expected: PASS while retaining Hotline/roleplay separation.

---

### Task 6: Full Verification

**Files:**
- Test: existing `tests/` suites and `package.json` scripts

- [ ] **Step 1: Run focused application tests serially**

Run: `node tests/client_privacy_boundary.test.js`, `node tests/client_image_pipeline.test.js`, `node tests/mobile_viewport_behavior.test.js`, `node tests/all_dialog_accessibility.test.js`, and `node tests/chat_request_contract.test.js`

- [ ] **Step 2: Run the full regression suite**

Run: `npm test`

Expected: all suites pass; live-provider suites may remain explicitly skipped unless their documented environment flags are set.

- [ ] **Step 3: Run the production build and inspect artifacts**

Run: `npm run build:netlify`

Expected: CSS lock, CSP, HEIC provenance, public allowlist, manifest, and local asset checks pass.

- [ ] **Step 4: Review the final source changes**

Run: `git diff --stat` and `git diff --check`

Expected: only intended source, test, documentation, and approved generated artifact changes remain.
