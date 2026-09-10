-- Provision MyWingman profile/free credits only after email ownership is verified.
--
-- Supabase Auth intentionally creates an unconfirmed auth.users row when Confirm Email is
-- enabled. A pending auth identity is not yet a MyWingman account with spendable credits.
-- Google/OAuth users are already confirmed at auth.users INSERT and are provisioned there.
-- Email/password users are provisioned exactly once when email_confirmed_at transitions
-- from NULL to a timestamp.

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.email_confirmed_at IS NOT NULL THEN
        INSERT INTO public.profiles (id, credits, created_at, updated_at, has_paid_credits)
        VALUES (NEW.id, 20, pg_catalog.now(), pg_catalog.now(), false)
        ON CONFLICT (id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
EXECUTE FUNCTION public.handle_new_user();

-- Remove only profiles that were prematurely provisioned under the old INSERT trigger.
-- Any paid flag, non-default balance, or transaction history makes the row ineligible.
DELETE FROM public.profiles p
USING auth.users u
WHERE p.id = u.id
  AND u.email_confirmed_at IS NULL
  AND p.credits = 20
  AND p.has_paid_credits = false
  AND NOT EXISTS (
      SELECT 1
      FROM public.credit_transactions t
      WHERE t.user_id = p.id
  );

-- Repair safely-recoverable historical confirmed identities that have no profile at all.
-- A user with any credit ledger history is intentionally excluded because a fresh 20-credit
-- balance could be wrong for that user and requires a separate ledger-aware audit.
INSERT INTO public.profiles (id, credits, created_at, updated_at, has_paid_credits)
SELECT u.id, 20, pg_catalog.now(), pg_catalog.now(), false
FROM auth.users u
WHERE u.email_confirmed_at IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = u.id
  )
  AND NOT EXISTS (
      SELECT 1
      FROM public.credit_transactions t
      WHERE t.user_id = u.id
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;
