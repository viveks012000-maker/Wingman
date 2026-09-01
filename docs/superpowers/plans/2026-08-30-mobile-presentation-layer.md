# MyWingman Mobile Presentation Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MyWingman landing page, dashboard, chat workflow, dialogs, authentication UI, and legal pages reliable and usable across supported mobile and desktop viewports without changing the existing product/security behavior.

**Architecture:** Use `style.css` as the shared responsive source of truth for mobile primitives and page-specific mobile classes. Remove runtime geometry mutation from `config.js`; retain only the VisualViewport publisher in `app.js` and let CSS consume the published value. Add browser-level geometry and interaction assertions that test the usable viewport, fixed navigation clearance, dialog scrolling, chat composer visibility, and reload behavior.

**Tech Stack:** Static HTML, Tailwind-generated `output.css`, shared CSS, vanilla JavaScript, Node.js assertions, Playwright Chromium.

**Spec:** User-approved targeted mobile presentation layer requirements in the active conversation.

## Global Constraints

- Preserve existing Supabase authentication, credit accounting, privacy boundaries, CSP, APIs, and Antigravity integration.
- Do not add or configure a payment provider; purchase UI remains explicitly unavailable.
- Preserve the established visual identity and desktop behavior at `768px+` unless a reproducible desktop defect is found.
- Support `320x568`, `360x800`, `375x667`, `390x700`, `390x844`, `393x852`, `412x915`, `430x932`, `768x1024`, `1366x768`, and `1920x1080`, plus breakpoint-adjacent widths.
- Use `100dvh`/VisualViewport and safe-area insets for viewport-sensitive behavior.
- Important interactive mobile targets must be at least approximately `44x44` CSS pixels.
- Every production behavior change must have a failing regression check before implementation.

---

### Task 1: Add Failing Mobile Browser Contracts

**Files:**
- Create: `tests/mobile_presentation_qa.test.js`
- Modify: `tests/run_all_tests.js`

**Interfaces:**
- Consumes: local static pages and existing Playwright dependency.
- Produces: executable responsive QA for all public pages and the dashboard.

- [ ] **Step 1: Write failing browser checks**

  Add a local static server and Playwright checks for every required viewport. Assert that meaningful content, excluding intentionally clipped decorative layers, stays within the viewport; fixed bottom navigation does not intersect active app controls; the chat composer, credit notice, and review action remain reachable; dialogs fit or expose an internal scroll region; mobile text inputs compute to at least `16px`; and page reload preserves the selected app tab without leaving stale scroll offsets.

- [ ] **Step 2: Run the new suite and verify expected failures**

  Run `node tests/mobile_presentation_qa.test.js`.

  Expected: failures identify the current chat/bottom-nav overlap, fixed-height inconsistencies, dialog sizing/scrolling gaps, landing density problems, and any breakpoint-specific overflow or clipping.

- [ ] **Step 3: Register the suite**

  Add the test to `tests/run_all_tests.js` after the existing browser viewport suite.

- [ ] **Step 4: Re-run the focused suite**

  Run `node tests/mobile_presentation_qa.test.js` and keep the failure output as the implementation contract.

### Task 2: Consolidate Responsive Viewport and Navigation Geometry

**Files:**
- Modify: `style.css`
- Modify: `config.js`
- Modify: `app.js`
- Modify: `app.html`
- Test: `tests/mobile_presentation_qa.test.js`

**Interfaces:**
- Consumes: `--wingman-visual-height`, `#mobileNavBar`, `#mainContentCanvas`, `#chatboxSection`.
- Produces: one CSS-controlled mobile viewport contract with fixed-header and fixed-bottom-nav clearance.

- [ ] **Step 1: Write the failing geometry assertions**

  Assert that mobile app layout uses shared custom properties for header height, bottom-nav height, and safe-area clearance; that `config.js` does not write chat height/min-height inline; and that the active chat card/footer ends above the bottom navigation at every supported mobile viewport.

- [ ] **Step 2: Run focused geometry tests**

  Run `node tests/mobile_presentation_qa.test.js` and confirm the existing inline/runtime rules fail the contract.

- [ ] **Step 3: Implement the shared geometry contract**

  Publish VisualViewport height from `app.js`, define shared variables in `style.css`, remove the chat geometry mutation from `config.js`, add a semantic mobile app shell class, and use CSS grid/flex rows so the chat message region scrolls while the footer remains visible. Reserve bottom safe-area space in the main canvas instead of relying on arbitrary `112px` padding.

- [ ] **Step 4: Normalize mobile navigation and active panels**

  Give the header and bottom nav stable measured heights, keep all mobile nav buttons at least `44px` high, reset the active panel scroll position without forcing body scroll bugs, and ensure hidden panels cannot contribute layout height.

- [ ] **Step 5: Run focused tests**

  Run `node tests/mobile_presentation_qa.test.js` and the existing `node tests/browser_viewport_live_qa.js`.

### Task 3: Rework Mobile Landing and Legal Layouts

**Files:**
- Modify: `index.html`
- Modify: `terms.html`
- Modify: `privacy.html`
- Modify: `refund.html`
- Modify: `style.css`
- Test: `tests/mobile_presentation_qa.test.js`

**Interfaces:**
- Consumes: existing landing sections, public legal document structure, shared visual tokens.
- Produces: narrow-screen-specific typography, rhythm, CTA, card, footer, marquee, and legal document behavior without changing desktop classes.

- [ ] **Step 1: Write failing landing/legal assertions**

  Assert mobile hero bounds and section spacing are below the current excessive values, footer branding is not oversized, footer links wrap instead of overflowing, long headings wrap safely, and marquee/decorative overflow cannot create document-width overflow.

- [ ] **Step 2: Verify failures**

  Run `node tests/mobile_presentation_qa.test.js` and record the current landing/footer/legal measurements.

- [ ] **Step 3: Implement mobile landing presentation**

  Add a landing page hook and responsive rules that compact hero padding, use fluid headline sizing, make CTA/proof elements readable, reduce repeated section gaps and card padding, contain marquee tracks, preserve touch-friendly links, and scale the footer logo/copy/link row for narrow widths.

- [ ] **Step 4: Implement mobile legal presentation**

  Add shared legal page hooks/rules for safe gutters, fluid headings, readable article spacing, wrapping long words/URLs, and wrapped footer links while leaving legal content unchanged.

- [ ] **Step 5: Run focused browser checks**

  Run `node tests/mobile_presentation_qa.test.js` and `node tests/browser_viewport_live_qa.js`.

### Task 4: Normalize App Panels, Workflow Controls, and Dialogs

**Files:**
- Modify: `app.html`
- Modify: `style.css`
- Modify: `accessibility.js`
- Test: `tests/mobile_presentation_qa.test.js`
- Test: `tests/all_dialog_accessibility.test.js`

**Interfaces:**
- Consumes: all four app panels, shared modal registration/focus logic, existing payment-disabled state.
- Produces: consistent mobile panel spacing, touch targets, dialog max-height/scroll behavior, and keyboard-safe forms.

- [ ] **Step 1: Add failing workflow/dialog checks**

  Exercise Analyze, Icebreaker, Bio Optimizer, Practice, Coach Hotline, settings, auth, consent, purchase-disabled, crop, unreadable-image, activation, and account-deletion dialogs. Assert each active control is reachable, required copy is visible, dialogs have internal scrolling when taller than the visual viewport, close controls are keyboard/finger accessible, and background content is inert while open.

- [ ] **Step 2: Verify expected failures**

  Run `node tests/mobile_presentation_qa.test.js` and `node tests/all_dialog_accessibility.test.js`.

- [ ] **Step 3: Implement shared app/control rules**

  Normalize mobile panel gutters, text wrapping, chips, upload/dropzone sizing, result cards, textarea/input sizes, action buttons, and credit notices. Use one modal shell rule for dynamic viewport height, safe-area padding, internal scrolling, and `44px` controls. Keep payment-disabled copy honest and prevent unavailable purchase actions from looking active.

- [ ] **Step 4: Verify focused workflow/dialog behavior**

  Run the focused browser suite, modal accessibility suite, chat contract suite, and mobile viewport behavior suite.

### Task 5: Full Audit, Build, and Second Regression Pass

**Files:**
- Modify: `tests/mobile_presentation_qa.test.js` if fresh audit reveals uncovered reproducible defects.
- Modify: affected production files only when a fresh audit reproduces a defect.

**Interfaces:**
- Consumes: all previous responsive contracts and production build scripts.
- Produces: verified responsive behavior and a documented list of any unverified external items.

- [ ] **Step 1: Run fresh second browser audit**

  Test all required viewports and breakpoint-adjacent widths with console/page-error capture, failed-request capture, bounding-box overlap checks, focus checks, keyboard visual-viewport resizing, long-chat scrolling, dialog scrolling, and reload behavior.

- [ ] **Step 2: Fix every newly reproducible issue**

  Add a regression assertion first, verify it fails, implement the correction, and rerun the affected suite.

- [ ] **Step 3: Run production verification**

  Run `npm test`, `npm run build:css`, and `npm run build:netlify`.

- [ ] **Step 4: Re-run browser QA against source and generated output**

  Run `node tests/browser_viewport_live_qa.js` and `node tests/mobile_presentation_qa.test.js` after the build completes. Check desktop at `768`, `1366`, and `1920` widths for regression.

- [ ] **Step 5: Report evidence accurately**

  Separate fixed defects, newly discovered/fixed defects, mobile results, desktop results, accessibility results, build/test results, remaining unverified items, and remaining known bugs. Do not mark unavailable live deployment or git-dependent checks as passed.
