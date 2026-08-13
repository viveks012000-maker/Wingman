-- ============================================================================
-- MY WINGMAN SUPABASE POSTGRES INITIAL SCHEMA & ATOMIC CREDIT DEDUCTION RPC
-- Migration: 001_initial_schema_and_rpc.sql
-- ============================================================================

-- 1. Profiles Table (Source of Truth for Users & Credit Balances)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    credits INTEGER DEFAULT 0 NOT NULL,
    tier TEXT DEFAULT 'free',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. Credit Transactions Audit Ledger
CREATE TABLE IF NOT EXISTS public.credit_transactions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    feature TEXT NOT NULL,
    request_id TEXT,
    payment_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. Row Level Security (RLS) Configuration
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own profile') THEN
        CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own transactions') THEN
        CREATE POLICY "Users can view own transactions" ON public.credit_transactions FOR SELECT USING (auth.uid() = user_id);
    END IF;
END $$;

-- 5. Atomic Credit Deduction Function (RPC)
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
BEGIN
    -- Lock profile row for update to prevent concurrent race conditions
    SELECT credits INTO v_current_credits FROM public.profiles WHERE id = p_user_id FOR UPDATE;

    IF v_current_credits IS NULL THEN
        -- Auto-provision profile if missing
        INSERT INTO public.profiles (id, credits, display_name)
        VALUES (p_user_id, 0, 'MyWingman User')
        ON CONFLICT (id) DO NOTHING;
        v_current_credits := 0;
    END IF;

    IF v_current_credits < p_amount THEN
        RETURN json_build_object('success', false, 'currentCredits', v_current_credits);
    END IF;

    v_remaining_credits := v_current_credits - p_amount;

    UPDATE public.profiles SET credits = v_remaining_credits WHERE id = p_user_id;

    INSERT INTO public.credit_transactions (user_id, amount, feature, request_id)
    VALUES (p_user_id, -p_amount, p_feature, p_request_id);

    RETURN json_build_object(
        'success', true,
        'remainingCredits', v_remaining_credits
    );
END;
$$;
