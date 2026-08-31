BEGIN;

-- Consent state is server-authoritative. Production browser code reads and mutates consent
-- only through authenticated Railway API endpoints; it does not query public.user_consents
-- directly. Remove all browser-role table privileges so consent rows are reachable only
-- through trusted server/service-role paths.
REVOKE ALL PRIVILEGES ON TABLE public.user_consents FROM PUBLIC, anon, authenticated;

COMMIT;
