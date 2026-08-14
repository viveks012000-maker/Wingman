-- =========================================================================
-- MIGRATION 002: ATOMIC CREDITS, IDEMPOTENCY LEDGER & RLS PRIVILEGE LOCKDOWN
-- Authoritative Schema Migration for Supabase Postgres
-- =========================================================================

BEGIN;

-- 1. Safely add missing columns to public.credit_transactions
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS feature TEXT;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';

-- 2. Enforce request_id validation check constraint (Bounded length and non-empty for non-nulls)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_credit_transactions_request_id_not_empty'
    ) THEN
        ALTER TABLE public.credit_transactions 
        ADD CONSTRAINT chk_credit_transactions_request_id_not_empty 
        CHECK (request_id IS NULL OR (pg_catalog.length(pg_catalog.trim(request_id)) > 0 AND pg_catalog.length(request_id) <= 128));
    END IF;
END $$;

-- 3. Real Database Idempotency Guarantee: UNIQUE constraint and index on (user_id, request_id)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_credit_transactions_user_request_id'
    ) THEN
        ALTER TABLE public.credit_transactions
        ADD CONSTRAINT uq_credit_transactions_user_request_id UNIQUE (user_id, request_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_req 
ON public.credit_transactions (user_id, request_id);

-- 4. Profiles Credits: Default 50 for new rows, NOT NULL, Non-negative constraint (Preserves existing balances)
ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 50;
UPDATE public.profiles SET credits = 50 WHERE credits IS NULL;
ALTER TABLE public.profiles ALTER COLUMN credits SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'credits_non_negative'
    ) THEN
        ALTER TABLE public.profiles ADD CONSTRAINT credits_non_negative CHECK (credits >= 0);
    END IF;
END $$;

-- 5. New User Trigger: Awards exactly 50 credits ONCE upon Auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, credits, created_at, updated_at)
    VALUES (NEW.id, 50, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- Rebind trigger to auth.users if auth schema is available
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
        DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
        CREATE TRIGGER on_auth_user_created
            AFTER INSERT ON auth.users
            FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
    END IF;
END $$;

-- 6. Anti-Tampering Trigger: Block direct browser modification of credits column
CREATE OR REPLACE FUNCTION public.prevent_direct_credit_mutation()
RETURNS trigger 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF (CURRENT_USER IN ('anon', 'authenticated') OR pg_catalog.current_setting('request.jwt.claim.role', true) IN ('anon', 'authenticated')) THEN
        IF (NEW.credits IS DISTINCT FROM OLD.credits) THEN
            RAISE EXCEPTION 'Direct modification of credit balance is forbidden.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_direct_credit_mutation ON public.profiles;
CREATE TRIGGER trg_prevent_direct_credit_mutation
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.prevent_direct_credit_mutation();

-- 7. Atomic Reservation RPC: reserve_credits (Internal backend usage before calling AI)
CREATE OR REPLACE FUNCTION public.reserve_credits(
    p_user_id pg_catalog.uuid,
    p_amount pg_catalog.int4,
    p_feature pg_catalog.text,
    p_request_id pg_catalog.text
)
RETURNS pg_catalog.json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_current_credits pg_catalog.int4;
    v_new_credits pg_catalog.int4;
    v_clean_req_id pg_catalog.text;
    v_clean_feature pg_catalog.text;
    v_existing_tx RECORD;
BEGIN
    -- 1. Validate User ID
    IF p_user_id IS NULL THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid user ID.');
    END IF;

    -- 2. Validate Amount (Must be positive integer, max 100,000)
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000 THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid credit deduction amount.');
    END IF;

    -- 3. Validate and sanitize Feature string
    v_clean_feature := pg_catalog.trim(pg_catalog.coalesce(p_feature, ''));
    IF v_clean_feature = '' OR pg_catalog.length(v_clean_feature) > 64 THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid feature identifier.');
    END IF;

    -- 4. Validate and sanitize Request ID (Must not be null, whitespace, or exceeding 128 chars)
    v_clean_req_id := pg_catalog.trim(pg_catalog.coalesce(p_request_id, ''));
    IF v_clean_req_id = '' OR pg_catalog.length(v_clean_req_id) > 128 THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid or missing idempotency request ID.');
    END IF;

    -- 5. Lock profile row FOR UPDATE first to guarantee serialized per-user execution
    SELECT credits INTO v_current_credits 
    FROM public.profiles 
    WHERE id = p_user_id 
    FOR UPDATE;

    -- 6. Check if profile exists (NO auto-granting 50 credits to missing profiles)
    IF v_current_credits IS NULL THEN
        RETURN pg_catalog.json_build_object(
            'success', false,
            'error_message', 'PROFILE_MISSING',
            'error', 'PROFILE_MISSING',
            'currentCredits', 0,
            'new_balance', 0
        );
    END IF;

    -- 7. Atomic Idempotency Check while holding profile lock
    SELECT id, status, amount INTO v_existing_tx
    FROM public.credit_transactions
    WHERE user_id = p_user_id AND request_id = v_clean_req_id
    LIMIT 1;

    IF v_existing_tx.id IS NOT NULL THEN
        -- Request ID already exists: Return current balance as duplicate without double deduction
        RETURN pg_catalog.json_build_object(
            'success', true,
            'remainingCredits', v_current_credits,
            'new_balance', v_current_credits,
            'duplicate', true,
            'status', v_existing_tx.status
        );
    END IF;

    -- 8. Validate balance sufficiency
    IF v_current_credits < p_amount THEN
        RETURN pg_catalog.json_build_object(
            'success', false,
            'error_message', 'Insufficient credit balance.',
            'error', 'INSUFFICIENT_CREDITS',
            'currentCredits', v_current_credits,
            'new_balance', v_current_credits
        );
    END IF;

    -- 9. Deduct from profile
    v_new_credits := v_current_credits - p_amount;
    UPDATE public.profiles
    SET credits = v_new_credits, updated_at = pg_catalog.now()
    WHERE id = p_user_id;

    -- 10. Insert transaction record in 'pending' status
    INSERT INTO public.credit_transactions (id, user_id, amount, type, feature, request_id, status, created_at)
    VALUES (pg_catalog.gen_random_uuid(), p_user_id, -p_amount, 'feature_usage', v_clean_feature, v_clean_req_id, 'pending', pg_catalog.now());

    RETURN pg_catalog.json_build_object(
        'success', true,
        'remainingCredits', v_new_credits,
        'new_balance', v_new_credits,
        'duplicate', false
    );
END;
$$;

-- 8. Atomic Settlement RPC: settle_credits (Internal backend usage after successful AI generation)
CREATE OR REPLACE FUNCTION public.settle_credits(
    p_user_id pg_catalog.uuid,
    p_request_id pg_catalog.text
)
RETURNS pg_catalog.json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_clean_req_id pg_catalog.text;
    v_updated_rows pg_catalog.int4;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid user ID.');
    END IF;

    v_clean_req_id := pg_catalog.trim(pg_catalog.coalesce(p_request_id, ''));
    IF v_clean_req_id = '' OR pg_catalog.length(v_clean_req_id) > 128 THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid request ID.');
    END IF;

    UPDATE public.credit_transactions
    SET status = 'completed'
    WHERE user_id = p_user_id AND request_id = v_clean_req_id AND status = 'pending';

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

    RETURN pg_catalog.json_build_object('success', true, 'settled', v_updated_rows > 0);
END;
$$;

-- 9. Atomic Release RPC: release_credits (Internal backend usage on AI failure - Zero charge)
CREATE OR REPLACE FUNCTION public.release_credits(
    p_user_id pg_catalog.uuid,
    p_request_id pg_catalog.text,
    p_reason pg_catalog.text DEFAULT 'ai_failure'
)
RETURNS pg_catalog.json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pending_amount pg_catalog.int4;
    v_current_credits pg_catalog.int4;
    v_new_credits pg_catalog.int4;
    v_clean_req_id pg_catalog.text;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid user ID.');
    END IF;

    v_clean_req_id := pg_catalog.trim(pg_catalog.coalesce(p_request_id, ''));
    IF v_clean_req_id = '' OR pg_catalog.length(v_clean_req_id) > 128 THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid request ID.');
    END IF;

    -- Lock profile row FOR UPDATE
    SELECT credits INTO v_current_credits 
    FROM public.profiles 
    WHERE id = p_user_id 
    FOR UPDATE;

    -- Find pending transaction FOR UPDATE
    SELECT amount INTO v_pending_amount
    FROM public.credit_transactions
    WHERE user_id = p_user_id AND request_id = v_clean_req_id AND status = 'pending'
    FOR UPDATE;

    -- If no pending transaction found (already settled or already released), do not restore credits
    IF v_pending_amount IS NULL THEN
        RETURN pg_catalog.json_build_object(
            'success', true, 
            'remainingCredits', pg_catalog.coalesce(v_current_credits, 0), 
            'new_balance', pg_catalog.coalesce(v_current_credits, 0),
            'already_settled_or_released', true
        );
    END IF;

    -- Restore reserved credits exactly once
    v_new_credits := pg_catalog.coalesce(v_current_credits, 0) + pg_catalog.abs(v_pending_amount);

    UPDATE public.profiles
    SET credits = v_new_credits, updated_at = pg_catalog.now()
    WHERE id = p_user_id;

    UPDATE public.credit_transactions
    SET status = 'cancelled', type = 'cancelled_usage'
    WHERE user_id = p_user_id AND request_id = v_clean_req_id AND status = 'pending';

    RETURN pg_catalog.json_build_object(
        'success', true,
        'remainingCredits', v_new_credits,
        'new_balance', v_new_credits,
        'released', true
    );
END;
$$;

-- 10. Atomic Add Credits RPC: add_credits (Internal backend usage for purchase top-ups)
CREATE OR REPLACE FUNCTION public.add_credits(
    p_user_id pg_catalog.uuid,
    p_amount pg_catalog.int4,
    p_tier pg_catalog.text DEFAULT 'starter',
    p_payment_id pg_catalog.text DEFAULT NULL,
    p_order_id pg_catalog.text DEFAULT NULL,
    p_amount_inr pg_catalog.numeric DEFAULT 0,
    p_signature pg_catalog.text DEFAULT NULL
)
RETURNS pg_catalog.json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_current_credits pg_catalog.int4;
    v_new_credits pg_catalog.int4;
    v_tx_req_id pg_catalog.text;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid user ID.');
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Credit amount must be greater than zero.');
    END IF;

    v_tx_req_id := pg_catalog.coalesce(p_payment_id, p_order_id, 'purchase_' || pg_catalog.gen_random_uuid()::pg_catalog.text);

    SELECT credits INTO v_current_credits FROM public.profiles WHERE id = p_user_id FOR UPDATE;

    IF v_current_credits IS NULL THEN
        INSERT INTO public.profiles (id, credits, created_at, updated_at)
        VALUES (p_user_id, p_amount, pg_catalog.now(), pg_catalog.now())
        ON CONFLICT (id) DO UPDATE SET credits = public.profiles.credits + p_amount, updated_at = pg_catalog.now();
        
        SELECT credits INTO v_new_credits FROM public.profiles WHERE id = p_user_id;
    ELSE
        v_new_credits := v_current_credits + p_amount;
        UPDATE public.profiles
        SET credits = v_new_credits, updated_at = pg_catalog.now()
        WHERE id = p_user_id;
    END IF;

    INSERT INTO public.credit_transactions (id, user_id, amount, type, feature, request_id, status, created_at)
    VALUES (
        pg_catalog.gen_random_uuid(), 
        p_user_id, 
        p_amount, 
        'purchase', 
        pg_catalog.coalesce(p_tier, 'starter'), 
        v_tx_req_id, 
        'completed', 
        pg_catalog.now()
    );

    RETURN pg_catalog.json_build_object(
        'success', true,
        'remainingCredits', v_new_credits,
        'new_balance', v_new_credits
    );
END;
$$;

-- 11. Row Level Security Policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can view own profile') THEN
        CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'credit_transactions' AND policyname = 'Users can view own transactions') THEN
        CREATE POLICY "Users can view own transactions" ON public.credit_transactions FOR SELECT USING (auth.uid() = user_id);
    END IF;
END $$;

-- 12. Privilege Lockdown (Revoke from client roles, grant only to backend service_role)
REVOKE ALL ON FUNCTION public.reserve_credits(pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_credits(pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.text) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.settle_credits(pg_catalog.uuid, pg_catalog.text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_credits(pg_catalog.uuid, pg_catalog.text) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.release_credits(pg_catalog.uuid, pg_catalog.text, pg_catalog.text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_credits(pg_catalog.uuid, pg_catalog.text, pg_catalog.text) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.add_credits(pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.numeric, pg_catalog.text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_credits(pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.numeric, pg_catalog.text) TO service_role, postgres;

-- If legacy deduct_credits function exists in live DB, revoke client execution without replacing its return type
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p 
        JOIN pg_namespace n ON p.pronamespace = n.oid 
        WHERE n.nspname = 'public' AND p.proname = 'deduct_credits'
    ) THEN
        REVOKE ALL ON FUNCTION public.deduct_credits(pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.text) FROM PUBLIC, anon, authenticated;
    END IF;
END $$;

-- Revoke all mutation and TRUNCATE privileges from client roles
REVOKE ALL, TRUNCATE ON public.credit_transactions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.credit_transactions FROM anon, authenticated;
GRANT SELECT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role, postgres;

REVOKE ALL, TRUNCATE ON public.profiles FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role, postgres;

COMMIT;
