BEGIN;

-- Browser clients never mutate consent rows directly. Consent writes/withdrawals are handled
-- by the authenticated Railway backend through the service-role client. Keep only the one
-- browser permission that can be useful for authenticated self-service reads; RLS still
-- restricts that SELECT to auth.uid() = user_id.
REVOKE ALL PRIVILEGES ON TABLE public.user_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_consents TO authenticated;

COMMIT;
