-- Forward-only repair for databases where the historical 001-011 sequence was already
-- recorded before its legacy column assumptions were discovered. This does not reset data,
-- rewrite migration history, or change any public RPC signature.

BEGIN;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.credit_transactions
    ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'feature_usage';

-- 001 created credit_transactions.id as BIGSERIAL, while later function bodies supplied UUIDs.
-- Keep the existing BIGSERIAL primary key and let its existing default allocate IDs instead.
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
    IF p_user_id IS NULL THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid user ID.');
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000 THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid credit deduction amount.');
    END IF;
    v_clean_feature := pg_catalog.btrim(COALESCE(p_feature, ''));
    IF v_clean_feature = '' OR pg_catalog.length(v_clean_feature) > 64 THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid feature identifier.');
    END IF;
    v_clean_req_id := pg_catalog.btrim(COALESCE(p_request_id, ''));
    IF v_clean_req_id = '' OR pg_catalog.length(v_clean_req_id) > 128 THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid or missing idempotency request ID.');
    END IF;

    SELECT credits INTO v_current_credits FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF v_current_credits IS NULL THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'PROFILE_MISSING', 'error', 'PROFILE_MISSING', 'currentCredits', 0, 'new_balance', 0);
    END IF;

    SELECT id, status, amount INTO v_existing_tx
    FROM public.credit_transactions
    WHERE user_id = p_user_id AND request_id = v_clean_req_id
    LIMIT 1;
    IF v_existing_tx.id IS NOT NULL THEN
        RETURN pg_catalog.json_build_object('success', true, 'remainingCredits', v_current_credits, 'new_balance', v_current_credits, 'duplicate', true, 'status', v_existing_tx.status);
    END IF;
    IF v_current_credits < p_amount THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Insufficient credit balance.', 'error', 'INSUFFICIENT_CREDITS', 'currentCredits', v_current_credits, 'new_balance', v_current_credits);
    END IF;

    v_new_credits := v_current_credits - p_amount;
    UPDATE public.profiles SET credits = v_new_credits, updated_at = pg_catalog.now() WHERE id = p_user_id;
    INSERT INTO public.credit_transactions (user_id, amount, type, feature, request_id, status, created_at)
    VALUES (p_user_id, -p_amount, 'feature_usage', v_clean_feature, v_clean_req_id, 'pending', pg_catalog.now());

    RETURN pg_catalog.json_build_object('success', true, 'remainingCredits', v_new_credits, 'new_balance', v_new_credits, 'duplicate', false);
END;
$$;

-- Preserve migration 011's final paid-plan behavior while using the BIGSERIAL default.
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
    v_clean_tier pg_catalog.text;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid user ID.');
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000 THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid credit amount.');
    END IF;
    v_clean_tier := pg_catalog.btrim(COALESCE(p_tier, 'purchase'));
    IF v_clean_tier = '' OR pg_catalog.length(v_clean_tier) > 64 THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid credit tier.');
    END IF;
    v_tx_req_id := pg_catalog.btrim(COALESCE(p_payment_id, p_order_id, ''));
    IF v_tx_req_id = '' THEN
        v_tx_req_id := 'purchase_' || pg_catalog.gen_random_uuid()::pg_catalog.text;
    ELSIF pg_catalog.length(v_tx_req_id) > 128 THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid payment request ID.');
    END IF;

    SELECT credits INTO v_current_credits FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN pg_catalog.json_build_object('success', false, 'error', 'PROFILE_MISSING', 'error_message', 'PROFILE_MISSING', 'currentCredits', 0, 'new_balance', 0);
    END IF;
    IF EXISTS (SELECT 1 FROM public.credit_transactions WHERE user_id = p_user_id AND request_id = v_tx_req_id) THEN
        RETURN pg_catalog.json_build_object('success', true, 'remainingCredits', v_current_credits, 'new_balance', v_current_credits, 'duplicate', true);
    END IF;

    v_new_credits := v_current_credits + p_amount;
    UPDATE public.profiles SET credits = v_new_credits, has_paid_credits = true, updated_at = pg_catalog.now() WHERE id = p_user_id;
    INSERT INTO public.credit_transactions (user_id, amount, type, feature, request_id, status, created_at)
    VALUES (p_user_id, p_amount, 'purchase', v_clean_tier, v_tx_req_id, 'completed', pg_catalog.now());

    RETURN pg_catalog.json_build_object('success', true, 'remainingCredits', v_new_credits, 'new_balance', v_new_credits, 'duplicate', false);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_credits(pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_credits(pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.text) TO service_role, postgres;
REVOKE ALL ON FUNCTION public.add_credits(pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.numeric, pg_catalog.text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_credits(pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.numeric, pg_catalog.text) TO service_role, postgres;

COMMIT;
