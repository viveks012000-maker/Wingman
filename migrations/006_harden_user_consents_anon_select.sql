-- Migration 006: Harden consent-table read privileges
-- Mirrors the verified production hardening applied after migration 005.
-- Authenticated users may read only their own consent rows through RLS.
-- Anonymous/public roles receive no direct table access.

BEGIN;

REVOKE SELECT ON TABLE public.user_consents FROM anon;
REVOKE ALL ON TABLE public.user_consents FROM PUBLIC;
GRANT SELECT ON TABLE public.user_consents TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.user_consents TO service_role;

COMMIT;
