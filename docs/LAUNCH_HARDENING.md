# Wingman launch hardening contract

## Authoritative delivery path

- Canonical public URL: `https://mywingman.pages.dev/`.
- Protected source branch: `main`.
- Cloudflare Pages production branch: `main`.
- Pages build command: `npm run build:production`.
- Pages publish directory: `netlify-dist`.
- The `build:production` name is authoritative; it intentionally invokes the existing
  reviewed frontend-only pipeline. Historical `build:netlify` references are not a second
  deployment path.
- Every artifact contains `release.json.sourceCommit`. The production gate requires that value
  to equal the commit being built, and the post-deploy verifier requires the live value to equal
  the protected-main commit that triggered the deployment.

The immutable preview hostname is not a release target. Users should use the canonical
production URL; no source change is made to chase an immutable preview deployment.

## Scope boundaries

This hardening keeps the feature routes, prompts, provider models, credit costs, idempotency,
retry behavior, consent requirements, and AI provider behavior unchanged. No real AI provider
canary, payment transaction, production database reset, custom-domain DNS change, or secret is
part of the release process.

## Required gates

The production gate runs the complete regression suite, the disposable migration replay, the
locked CSS check, the production build, high-severity dependency audit, and public-artifact
denylist checks. The live verifier checks release identity, route status, real Chromium CDP touch
movement on `/`, `/app`, and the `/app.html` canonical alias at all four required mobile sizes,
modal lock cleanup, and desktop wheel movement.

The live verifier intentionally checks `document.scrollingElement.scrollTop` and `window.scrollY`
after an `Input.dispatchTouchEvent` gesture. HTTP 200 alone is never treated as scroll proof.
