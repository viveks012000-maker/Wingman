-- =========================================================================
-- MIGRATION 002: ATOMIC CREDITS, IDEMPOTENCY LEDGER & RLS PRIVILEGE LOCKDOWN
-- Authoritative Schema Migration for Supabase Postgres
-- =========================================================================

-- 1. Safely add missing columns and constraints to public.credit_transactions
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS feature TEXT;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';

-- Enforce request_id not empty check constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_credit_transactions_request_id_not_empty'
    ) THEN
        ALTER TABLE public.credit_transactions 
        ADD CONSTRAINT chk_credit_transactions_request_id_not_empty 
        CHECK (request_id IS NULL OR length(trim(request_id)) > 0);
    END IF;
END $$;

-- 2. Real Database Idempotency Guarantee: UNIQUE constraint and index on (user_id, request_id)
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

-- 3. Profiles Credits: Default 50 for new rows, NOT NULL, Non-negative constraint (Preserves existing balances)
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

-- 4. New User Trigger: Awards exactly 50 credits ONCE upon Auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- 5. Anti-Tampering Trigger: Block direct browser modification of credits column
CREATE OR REPLACE FUNCTION public.prevent_direct_credit_mutation()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF (current_user IN ('anon', 'authenticated') OR current_setting('request.jwt.claim.role', true) IN ('anon', 'authenticated')) THEN
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

-- 6. Atomic Reservation RPC: reserve_credits (Internal backend usage before calling AI)
CREATE OR REPLACE FUNCTION public.reserve_credits(
    p_user_id UUID,
    p_amount INTEGER,
    p_feature TEXT,
    p_request_id TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_credits INTEGER;
    v_new_credits INTEGER;
    v_clean_req_id TEXT;
    v_existing_tx RECORD;
BEGIN
    -- 1. Validate amount
    IF p_amount <= 0 THEN
        RETURN json_build_object('success', false, 'error_message', 'Invalid credit deduction amount.');
    END IF;

    -- 2. Validate and sanitize request ID (Must not be null or whitespace)
    v_clean_req_id := TRIM(COALESCE(p_request_id, ''));
    IF v_clean_req_id = '' THEN
        RETURN json_build_object('success', false, 'error_message', 'Invalid or missing idempotency request ID.');
    END IF;

    -- 3. Lock profile row FOR UPDATE first to guarantee serialized per-user execution
    SELECT credits INTO v_current_credits 
    FROM public.profiles 
    WHERE id = p_user_id 
    FOR UPDATE;

    -- 4. Check if profile exists (NO auto-granting 50 credits to missing profiles)
    IF v_current_credits IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error_message', 'User profile does not exist. Please authenticate or contact support.',
            'currentCredits', 0,
            'new_balance', 0
        );
    END IF;

    -- 5. Atomic Idempotency Check while holding profile lock
    SELECT id, status, amount INTO v_existing_tx
    FROM public.credit_transactions
    WHERE user_id = p_user_id AND request_id = v_clean_req_id
    LIMIT 1;

    IF v_existing_tx.id IS NOT NULL THEN
        -- Request ID already exists: Return current balance as duplicate without double deduction
        RETURN json_build_object(
            'success', true,
            'remainingCredits', v_current_credits,
            'new_balance', v_current_credits,
            'duplicate', true,
            'status', v_existing_tx.status
        );
    END IF;

    -- 6. Validate balance sufficiency
    IF v_current_credits < p_amount THEN
        RETURN json_build_object(
            'success', false,
            'error_message', 'Insufficient credit balance.',
            'currentCredits', v_current_credits,
            'new_balance', v_current_credits
        );
    END IF;

    -- 7. Deduct from profile
    v_new_credits := v_current_credits - p_amount;
    UPDATE public.profiles
    SET credits = v_new_credits, updated_at = NOW()
    WHERE id = p_user_id;

    -- 8. Insert transaction record in 'pending' status
    INSERT INTO public.credit_transactions (id, user_id, amount, type, feature, request_id, status, created_at)
    VALUES (gen_random_uuid(), p_user_id, -p_amount, 'feature_usage', p_feature, v_clean_req_id, 'pending', NOW());

    RETURN json_build_object(
        'success', true,
        'remainingCredits', v_new_credits,
        'new_balance', v_new_credits,
        'duplicate', false
    );
END;
$$;

-- 7. Atomic Settlement RPC: settle_credits (Internal backend usage after successful AI generation)
CREATE OR REPLACE FUNCTION public.settle_credits(
    p_user_id UUID,
    p_request_id TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_clean_req_id TEXT;
    v_updated_rows INTEGER;
BEGIN
    v_clean_req_id := TRIM(COALESCE(p_request_id, ''));
    IF v_clean_req_id = '' THEN
        RETURN json_build_object('success', false, 'error_message', 'Invalid request ID.');
    END IF;

    UPDATE public.credit_transactions
    SET status = 'completed'
    WHERE user_id = p_user_id AND request_id = v_clean_req_id AND status = 'pending';

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

    RETURN json_build_object('success', true, 'settled', v_updated_rows > 0);
END;
$$;

-- 8. Atomic Release RPC: release_credits (Internal backend usage on AI failure - Zero charge)
CREATE OR REPLACE FUNCTION public.release_credits(
    p_user_id UUID,
    p_request_id TEXT,
    p_reason TEXT DEFAULT 'ai_failure'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pending_amount INTEGER;
    v_current_credits INTEGER;
    v_new_credits INTEGER;
    v_clean_req_id TEXT;
BEGIN
    v_clean_req_id := TRIM(COALESCE(p_request_id, ''));
    IF v_clean_req_id = '' THEN
        RETURN json_build_object('success', false, 'error_message', 'Invalid request ID.');
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
        RETURN json_build_object(
            'success', true, 
            'remainingCredits', COALESCE(v_current_credits, 0), 
            'new_balance', COALESCE(v_current_credits, 0),
            'already_settled_or_released', true
        );
    END IF;

    -- Restore reserved credits exactly once
    v_new_credits := COALESCE(v_current_credits, 0) + ABS(v_pending_amount);

    UPDATE public.profiles
    SET credits = v_new_credits, updated_at = NOW()
    WHERE id = p_user_id;

    UPDATE public.credit_transactions
    SET status = 'cancelled', type = 'cancelled_usage'
    WHERE user_id = p_user_id AND request_id = v_clean_req_id AND status = 'pending';

    RETURN json_build_object(
        'success', true,
        'remainingCredits', v_new_credits,
        'new_balance', v_new_credits,
        'released', true
    );
END;
$$;

-- 9. Atomic Add Credits RPC: add_credits (Internal backend usage for purchase top-ups)
CREATE OR REPLACE FUNCTION public.add_credits(
    p_user_id UUID,
    p_amount INTEGER,
    p_tier TEXT DEFAULT 'starter',
    p_payment_id TEXT DEFAULT NULL,
    p_order_id TEXT DEFAULT NULL,
    p_amount_inr NUMERIC DEFAULT 0,
    p_signature TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_credits INTEGER;
    v_new_credits INTEGER;
    v_tx_req_id TEXT;
BEGIN
    IF p_amount <= 0 THEN
        RETURN json_build_object('success', false, 'error_message', 'Credit amount must be greater than zero.');
    END IF;

    v_tx_req_id := COALESCE(p_payment_id, p_order_id, 'purchase_' || gen_random_uuid()::TEXT);

    SELECT credits INTO v_current_credits FROM public.profiles WHERE id = p_user_id FOR UPDATE;

    IF v_current_credits IS NULL THEN
        INSERT INTO public.profiles (id, credits, created_at, updated_at)
        VALUES (p_user_id, p_amount, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET credits = public.profiles.credits + p_amount, updated_at = NOW();
        
        SELECT credits INTO v_new_credits FROM public.profiles WHERE id = p_user_id;
    ELSE
        v_new_credits := v_current_credits + p_amount;
        UPDATE public.profiles
        SET credits = v_new_credits, updated_at = NOW()
        WHERE id = p_user_id;
    END IF;

    INSERT INTO public.credit_transactions (id, user_id, amount, type, feature, request_id, status, created_at)
    VALUES (
        gen_random_uuid(), 
        p_user_id, 
        p_amount, 
        'purchase', 
        COALESCE(p_tier, 'starter'), 
        v_tx_req_id, 
        'completed', 
        NOW()
    );

    RETURN json_build_object(
        'success', true,
        'remainingCredits', v_new_credits,
        'new_balance', v_new_credits
    );
END;
$$;

-- 10. Deduct credits wrapper calling reserve_credits for compatibility
CREATE OR REPLACE FUNCTION public.deduct_credits(
    p_user_id UUID,
    p_amount INTEGER,
    p_feature TEXT,
    p_request_id TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public.reserve_credits(
        p_user_id, 
        p_amount, 
        p_feature, 
        COALESCE(p_request_id, 'ded_' || gen_random_uuid()::TEXT)
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
REVOKE ALL ON FUNCTION public.reserve_credits(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_credits(UUID, INTEGER, TEXT, TEXT) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.settle_credits(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_credits(UUID, TEXT) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.release_credits(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_credits(UUID, TEXT, TEXT) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.add_credits(UUID, INTEGER, TEXT, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_credits(UUID, INTEGER, TEXT, TEXT, TEXT, NUMERIC, TEXT) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.deduct_credits(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_credits(UUID, INTEGER, TEXT, TEXT) TO service_role, postgres;

REVOKE INSERT, UPDATE, DELETE ON public.credit_transactions FROM anon, authenticated;
GRANT SELECT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role, postgres;

REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role, postgres;
