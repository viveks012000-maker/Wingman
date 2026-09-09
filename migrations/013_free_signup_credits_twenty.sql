-- Migration 013: Set first-time signup free credits to 20
-- Every user who signs in / signs up for the first time receives exactly 20 credits (one-time).
-- The account is initialized on 'Free Plan' (has_paid_credits = false).
-- When a user purchases a plan, add_credits updates has_paid_credits = true ('Paid Plan').

BEGIN;

-- 1. Update default column value for newly created profile rows
ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 20;

-- 2. Update new user trigger to grant 20 credits once on Auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, credits, created_at, updated_at, has_paid_credits)
    VALUES (NEW.id, 20, pg_catalog.now(), pg_catalog.now(), false)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

COMMIT;
