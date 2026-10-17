-- Migration 018: Grant 50 welcome credits only to accounts created after the cutover.
--
-- Accounts created before the cutover retain the 20-credit signup promise, including
-- email signups that verify after this migration is applied. Existing profiles are
-- never updated or backfilled. OAuth accounts remain eligible when Auth creates them
-- already confirmed, and email accounts remain gated on the first confirmation event.

BEGIN;

-- Prevent a concurrent Auth insert/confirmation from invoking the old 20-credit
-- trigger after the cutover timestamp is recorded but before this transaction commits.
LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;

-- Private-by-permission policy metadata records the precise rollout boundary. The
-- table stays in public for compatibility with the project's existing schema layout,
-- but has RLS enabled and no API-role privileges. The trigger owner can still read it.
CREATE TABLE IF NOT EXISTS public.signup_credit_policy (
    id pg_catalog.bool PRIMARY KEY DEFAULT true CHECK (id),
    cutover_at pg_catalog.timestamptz NOT NULL,
    legacy_credits pg_catalog.int4 NOT NULL DEFAULT 20 CHECK (legacy_credits = 20),
    welcome_credits pg_catalog.int4 NOT NULL DEFAULT 50 CHECK (welcome_credits = 50)
);

ALTER TABLE public.signup_credit_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.signup_credit_policy FROM PUBLIC, anon, authenticated, service_role;

-- New profiles default to the new grant. The trigger below supplies 20 explicitly for
-- pre-cutover identities, so pending legacy signups keep their previously promised grant.
ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 50;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cutover_at pg_catalog.timestamptz;
    v_legacy_credits pg_catalog.int4;
    v_welcome_credits pg_catalog.int4;
    v_initial_credits pg_catalog.int4;
BEGIN
    IF NEW.email_confirmed_at IS NOT NULL THEN
        SELECT cutover_at, legacy_credits, welcome_credits
        INTO v_cutover_at, v_legacy_credits, v_welcome_credits
        FROM public.signup_credit_policy
        WHERE id = true;

        IF NOT FOUND OR v_cutover_at IS NULL THEN
            RAISE EXCEPTION 'Signup credit policy is unavailable';
        END IF;

        IF NEW.created_at >= v_cutover_at THEN
            v_initial_credits := v_welcome_credits;
        ELSE
            v_initial_credits := v_legacy_credits;
        END IF;

        INSERT INTO public.profiles (id, credits, created_at, updated_at, has_paid_credits)
        VALUES (NEW.id, v_initial_credits, pg_catalog.now(), pg_catalog.now(), false)
        ON CONFLICT (id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

-- Set the boundary immediately before commit. Accounts created before this point,
-- including pending email registrations, retain the old 20-credit policy.
INSERT INTO public.signup_credit_policy (id, cutover_at, legacy_credits, welcome_credits)
VALUES (true, pg_catalog.clock_timestamp(), 20, 50)
ON CONFLICT (id) DO NOTHING;

COMMIT;
