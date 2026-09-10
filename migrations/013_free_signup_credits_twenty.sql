-- Migration 013: Set first-time signup free credits to 20
-- Every user who signs in / signs up for the first time receives exactly 20 credits (one-time).
-- The account is initialized on 'Free Plan' (has_paid_credits = false).
-- When a user purchases a plan, add_credits updates has_paid_credits = true ('Paid Plan').

BEGIN;

-- 1. Ensure has_paid_credits column exists with default false
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS has_paid_credits pg_catalog.bool NOT NULL DEFAULT false;

-- 2. Update default column value for newly created profile rows
ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 20;

-- 3. Update new user trigger to grant 20 credits once on Auth signup
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

-- 4. Rebind trigger on auth.users if auth schema is available
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
        DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
        CREATE TRIGGER on_auth_user_created
            AFTER INSERT ON auth.users
            FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
    END IF;
END $$;

-- 5. Fix plan state: any user with no purchase transactions must be has_paid_credits = false ('Free Plan')
UPDATE public.profiles p
SET has_paid_credits = false
WHERE NOT EXISTS (
    SELECT 1 FROM public.credit_transactions t
    WHERE t.user_id = p.id
      AND t.status = 'completed'
      AND t.type = 'purchase'
      AND t.amount > 0
);

-- 6. Ensure authenticated role can read own profile
GRANT SELECT ON public.profiles TO authenticated;

COMMIT;
