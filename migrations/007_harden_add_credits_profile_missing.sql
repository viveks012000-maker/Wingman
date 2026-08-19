-- ============================================================================
-- MIGRATION 007: HARDEN PRIVILEGED CREDIT TOP-UP AGAINST MISSING PROFILES
-- Missing profiles remain explicit. This RPC never provisions or repairs user profiles.
-- ============================================================================
BEGIN;

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

    -- Lock existing profile. Missing profile is an explicit invariant violation: do not create it.
    SELECT credits INTO v_current_credits
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.json_build_object(
            'success', false,
            'error', 'PROFILE_MISSING',
            'error_message', 'PROFILE_MISSING',
            'currentCredits', 0,
            'new_balance', 0
        );
    END IF;

    -- Idempotent payment/request replay: do not mint twice for an existing request ID.
    IF EXISTS (
        SELECT 1 FROM public.credit_transactions
        WHERE user_id = p_user_id AND request_id = v_tx_req_id
    ) THEN
        RETURN pg_catalog.json_build_object(
            'success', true,
            'remainingCredits', v_current_credits,
            'new_balance', v_current_credits,
            'duplicate', true
        );
    END IF;

    v_new_credits := v_current_credits + p_amount;
    UPDATE public.profiles
    SET credits = v_new_credits, updated_at = pg_catalog.now()
    WHERE id = p_user_id;

    INSERT INTO public.credit_transactions (id, user_id, amount, type, feature, request_id, status, created_at)
    VALUES (
        pg_catalog.gen_random_uuid(),
        p_user_id,
        p_amount,
        'purchase',
        v_clean_tier,
        v_tx_req_id,
        'completed',
        pg_catalog.now()
    );

    RETURN pg_catalog.json_build_object(
        'success', true,
        'remainingCredits', v_new_credits,
        'new_balance', v_new_credits,
        'duplicate', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.add_credits(pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.numeric, pg_catalog.text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_credits(pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.numeric, pg_catalog.text) TO service_role, postgres;

COMMIT;
