-- ============================================================================
-- MY WINGMAN SUPABASE POSTGRES PRODUCTION HARDENING MIGRATION
-- Migration: 002_atomic_credits_and_transactions.sql
-- ============================================================================

-- 1. Ensure Profile Schema Integrity, Non-Negative Constraint & 50-Credit Default
DO $$
BEGIN
    -- Handle any accidental negative balances before applying constraint
    UPDATE public.profiles SET credits = 0 WHERE credits < 0;

    -- Set default initial credits to 50 for all newly created profiles
    ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 50;

    -- Ensure NOT NULL constraint on credits
    ALTER TABLE public.profiles ALTER COLUMN credits SET NOT NULL;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'credits_non_negative'
    ) THEN
        ALTER TABLE public.profiles
        ADD CONSTRAINT credits_non_negative CHECK (credits >= 0);
    END IF;
END $$;

-- 2. Auth Trigger Function: Ensure Exactly 50 Initial Credits on Signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, credits, tier, created_at, updated_at)
    VALUES (NEW.id, 50, 'free', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- Ensure trigger is bound to auth.users if trigger exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users') THEN
        DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
        CREATE TRIGGER on_auth_user_created
            AFTER INSERT ON auth.users
            FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        NULL; -- Ignore if auth schema permissions are managed by Supabase dashboard
END $$;

-- 3. Performance Index for Idempotency Checks on credit_transactions
CREATE INDEX IF NOT EXISTS idx_credit_transactions_req_user ON public.credit_transactions(user_id, request_id);

-- 4. User-Scoped Tables & Row Level Security (RLS) Configuration
CREATE TABLE IF NOT EXISTS public.saved_bios (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    original_bio TEXT,
    mode TEXT,
    generated_options JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.saved_chat_analyses (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    image_url TEXT,
    tone TEXT,
    generated_options JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.saved_chat_histories (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    scenario TEXT,
    messages JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_bios_user ON public.saved_bios(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_chat_analyses_user ON public.saved_chat_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_chat_histories_user ON public.saved_chat_histories(user_id);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_bios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_chat_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_chat_histories ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies (Users can only access their own data; NO direct client write on credits)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can view own profile') THEN
        CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'credit_transactions' AND policyname = 'Users can view own transactions') THEN
        CREATE POLICY "Users can view own transactions" ON public.credit_transactions FOR SELECT USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'saved_bios' AND policyname = 'Users can view own bios') THEN
        CREATE POLICY "Users can view own bios" ON public.saved_bios FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'saved_chat_analyses' AND policyname = 'Users can view own analyses') THEN
        CREATE POLICY "Users can view own analyses" ON public.saved_chat_analyses FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'saved_chat_histories' AND policyname = 'Users can view own chat histories') THEN
        CREATE POLICY "Users can view own chat histories" ON public.saved_chat_histories FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

-- 6. ATOMIC & IDEMPOTENT CREDIT DEDUCTION FUNCTION (RPC)
CREATE OR REPLACE FUNCTION deduct_credits(
    p_user_id UUID,
    p_amount INTEGER,
    p_feature TEXT,
    p_request_id TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_credits INTEGER;
    v_remaining_credits INTEGER;
    v_existing_tx BIGINT;
BEGIN
    IF p_amount <= 0 THEN
        RETURN json_build_object('success', false, 'error_message', 'Invalid deduction amount.');
    END IF;

    -- Lock profile row for update to prevent race conditions
    SELECT credits INTO v_current_credits FROM public.profiles WHERE id = p_user_id FOR UPDATE;

    IF v_current_credits IS NULL THEN
        -- Auto-provision profile with 50 initial signup credits if missing
        INSERT INTO public.profiles (id, credits)
        VALUES (p_user_id, 50)
        ON CONFLICT (id) DO NOTHING;
        
        -- Re-lock and fetch authoritative balance
        SELECT credits INTO v_current_credits FROM public.profiles WHERE id = p_user_id FOR UPDATE;
        IF v_current_credits IS NULL THEN
            v_current_credits := 50;
        END IF;
    END IF;

    -- Server-side Idempotency Check: if request_id already deducted for this user, return current balance
    IF p_request_id IS NOT NULL AND p_request_id <> '' THEN
        SELECT id INTO v_existing_tx
        FROM public.credit_transactions
        WHERE user_id = p_user_id AND request_id = p_request_id AND amount < 0
        LIMIT 1;

        IF v_existing_tx IS NOT NULL THEN
            RETURN json_build_object(
                'success', true,
                'remainingCredits', v_current_credits,
                'new_balance', v_current_credits,
                'duplicate', true
            );
        END IF;
    END IF;

    IF v_current_credits < p_amount THEN
        RETURN json_build_object(
            'success', false,
            'currentCredits', v_current_credits,
            'error_message', 'Insufficient credit balance.'
        );
    END IF;

    v_remaining_credits := v_current_credits - p_amount;

    UPDATE public.profiles SET credits = v_remaining_credits WHERE id = p_user_id;

    INSERT INTO public.credit_transactions (user_id, amount, feature, request_id, created_at)
    VALUES (p_user_id, -p_amount, p_feature, p_request_id, NOW());

    RETURN json_build_object(
        'success', true,
        'remainingCredits', v_remaining_credits,
        'new_balance', v_remaining_credits,
        'duplicate', false
    );
END;
$$;

-- 7. ATOMIC & IDEMPOTENT CREDIT REFUND / ROLLBACK FUNCTION (RPC)
CREATE OR REPLACE FUNCTION refund_credits(
    p_user_id UUID,
    p_amount INTEGER,
    p_feature TEXT,
    p_request_id TEXT,
    p_reason TEXT DEFAULT 'ai_failure'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_credits INTEGER;
    v_new_credits INTEGER;
    v_deducted_amount INTEGER;
    v_already_refunded BIGINT;
BEGIN
    IF p_amount <= 0 OR p_request_id IS NULL OR p_request_id = '' THEN
        RETURN json_build_object('success', false, 'error_message', 'Invalid refund parameters.');
    END IF;

    -- Verify that a deduction actually occurred for this request_id
    SELECT ABS(amount) INTO v_deducted_amount
    FROM public.credit_transactions
    WHERE user_id = p_user_id AND request_id = p_request_id AND amount < 0
    LIMIT 1;

    IF v_deducted_amount IS NULL THEN
        RETURN json_build_object('success', false, 'error_message', 'No matching deduction found to refund.');
    END IF;

    -- Prevent refunding more than the original deduction amount
    IF p_amount > v_deducted_amount THEN
        RETURN json_build_object('success', false, 'error_message', 'Refund amount exceeds original deduction.');
    END IF;

    -- Idempotency Check: Prevent duplicate refunds for the same request_id
    SELECT id INTO v_already_refunded
    FROM public.credit_transactions
    WHERE user_id = p_user_id AND request_id = p_request_id AND amount > 0
    LIMIT 1;

    -- Lock profile row for update
    SELECT credits INTO v_current_credits FROM public.profiles WHERE id = p_user_id FOR UPDATE;

    IF v_current_credits IS NULL THEN
        v_current_credits := 0;
    END IF;

    IF v_already_refunded IS NOT NULL THEN
        RETURN json_build_object(
            'success', true,
            'remainingCredits', v_current_credits,
            'new_balance', v_current_credits,
            'already_refunded', true
        );
    END IF;

    v_new_credits := v_current_credits + p_amount;

    UPDATE public.profiles SET credits = v_new_credits WHERE id = p_user_id;

    INSERT INTO public.credit_transactions (user_id, amount, feature, request_id, created_at)
    VALUES (p_user_id, p_amount, 'refund:' || p_feature, p_request_id, NOW());

    RETURN json_build_object(
        'success', true,
        'remainingCredits', v_new_credits,
        'new_balance', v_new_credits,
        'refunded', true
    );
END;
$$;

-- 8. Explicit Privilege Lockdown (Prevent browser clients from calling credit RPCs or modifying credits directly)
DO $$
BEGIN
    -- Revoke direct execution of credit mutation RPCs from public and browser roles
    REVOKE ALL ON FUNCTION public.deduct_credits(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.deduct_credits(UUID, INTEGER, TEXT, TEXT) TO service_role, postgres;

    REVOKE ALL ON FUNCTION public.refund_credits(UUID, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.refund_credits(UUID, INTEGER, TEXT, TEXT, TEXT) TO service_role, postgres;

    -- Revoke direct table mutation privileges on credit ledger from browser roles
    REVOKE INSERT, UPDATE, DELETE ON public.credit_transactions FROM anon, authenticated;
    GRANT SELECT ON public.credit_transactions TO authenticated;
    GRANT ALL ON public.credit_transactions TO service_role, postgres;

    -- Revoke direct credit column modification from browser roles
    REVOKE UPDATE (credits) ON public.profiles FROM anon, authenticated;
    GRANT SELECT ON public.profiles TO authenticated;
    GRANT ALL ON public.profiles TO service_role, postgres;
EXCEPTION
    WHEN OTHERS THEN
        NULL; -- Safe fallback if roles differ across self-hosted vs cloud Supabase
END $$;
