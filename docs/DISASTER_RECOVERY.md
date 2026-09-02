# Wingman disaster recovery runbook

This runbook is deliberately non-destructive. Do not run `supabase db reset --linked` or any
production reset command.

## Release recovery

1. Confirm `main` is protected and identify the last known-good commit from GitHub history.
2. Revert or forward-fix through a reviewed pull request. Do not push directly to `main`.
3. Let the protected-main Pages integration deploy the resulting commit with
   `npm run build:production` to `netlify-dist`.
4. Wait for `release.json.sourceCommit` at `https://mywingmanapp.com/release.json` to match
   the protected-main commit. The live verifier must pass before recovery is declared complete.
5. If Pages is unavailable, preserve the last known-good artifact and use the provider rollback
   facility; do not upload backend files or secrets to the public artifact.

## Database recovery

Supabase is authoritative in production. Repository migrations are forward-only. New or
recovered databases apply every tracked migration in filename order; the disposable replay test
exercises that sequence and the credit/consent invariants. Existing databases use the
forward-only reconciliation migration; historical migration files are not rewritten.

Before a planned production migration, take a provider-managed backup and record its timestamp
and restore point in the incident log. Restore into a separately identified recovery target
first, replay the repository migrations there, run `npm run verify:migrations`, and compare the
credit ledger and profile invariants before any cutover. A production restore requires an
operator with Supabase project access; this repository contains no database credentials.

SQLite is an optional local-development fallback only when explicitly enabled outside production.
It is not a production data store and is not a substitute for Supabase backup or restore.

## Secret and infrastructure handling

Never print, commit, archive, or paste values of `SUPABASE_SERVICE_ROLE_KEY`, provider API keys,
Railway secrets, or Cloudflare credentials. Verify variable names and presence through the
provider UI/secret manager, not by exposing values. Keep Railway backend health and Cloudflare
Pages production verification separate from feature QA; do not spend credits or call real AI
providers as part of recovery.
