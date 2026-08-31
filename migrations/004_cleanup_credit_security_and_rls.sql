-- Migration 004: clean up credit security function exposure and stale/duplicate RLS policies.
-- This migration MUST NOT mutate user rows, balances, auth identities, or transaction data.

BEGIN;

-- Trigger helper is internal-only. Browser roles must never invoke it as an RPC.
REVOKE EXECUTE ON FUNCTION public.prevent_direct_credit_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_direct_credit_mutation() FROM anon;
REVOKE EXECUTE ON FUNCTION public.prevent_direct_credit_mutation() FROM authenticated;

-- Remove stale browser mutation policies. PostgreSQL table privileges already block these writes;
-- removing the policies keeps RLS aligned with the intended server-authoritative architecture.
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Remove duplicate/legacy read policies and recreate one canonical policy per table.
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can read own profile"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can read own transactions" ON public.credit_transactions;
DROP POLICY IF EXISTS "Users can view own transactions" ON public.credit_transactions;
CREATE POLICY "Users can read own transactions"
    ON public.credit_transactions
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

-- Defense-in-depth: preserve browser read access but explicitly keep direct writes unavailable.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.profiles FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.credit_transactions FROM anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.credit_transactions TO authenticated;

COMMIT;
