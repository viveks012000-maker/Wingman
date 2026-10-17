-- Migration 017: Durable release_credits RPC distinction.
-- Restore only a valid pending feature-usage reservation, exactly once.

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
    v_new_credits pg_catalog.int8;
    v_clean_req_id pg_catalog.text;
    v_tx_status pg_catalog.text;
    v_tx_type pg_catalog.text;
    v_profile_found pg_catalog.bool;
    v_tx_found pg_catalog.bool;
    v_rows pg_catalog.int8;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN pg_catalog.json_build_object(
            'success', false,
            'released', false,
            'error_message', 'Invalid user ID.'
        );
    END IF;

    v_clean_req_id := pg_catalog.btrim(COALESCE(p_request_id, ''));
    IF v_clean_req_id = '' OR pg_catalog.length(v_clean_req_id) > 128 THEN
        RETURN pg_catalog.json_build_object(
            'success', false,
            'released', false,
            'error_message', 'Invalid request ID.'
        );
    END IF;

    -- A profile is required for every successful result, including a replay.
    SELECT credits INTO v_current_credits
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;
    v_profile_found := FOUND;

    IF NOT v_profile_found THEN
        RETURN pg_catalog.json_build_object(
            'success', false,
            'released', false,
            'error_code', 'CREDIT_PROFILE_NOT_FOUND',
            'error_message', 'Credit profile not found.'
        );
    END IF;

    IF v_current_credits IS NULL THEN
        RETURN pg_catalog.json_build_object(
            'success', false,
            'released', false,
            'error_code', 'CREDIT_BALANCE_INVALID',
            'error_message', 'Credit balance is invalid.'
        );
    END IF;

    SELECT amount, status, type INTO v_pending_amount, v_tx_status, v_tx_type
    FROM public.credit_transactions
    WHERE user_id = p_user_id AND request_id = v_clean_req_id
    FOR UPDATE;
    v_tx_found := FOUND;

    IF NOT v_tx_found THEN
        RETURN pg_catalog.json_build_object(
            'success', false,
            'released', false,
            'error_code', 'CREDIT_TRANSACTION_NOT_FOUND',
            'error_message', 'Credit transaction not found.',
            'remainingCredits', v_current_credits,
            'new_balance', v_current_credits
        );
    END IF;

    IF v_tx_status = 'completed' THEN
        RETURN pg_catalog.json_build_object(
            'success', false,
            'released', false,
            'already_settled', true,
            'error_code', 'ALREADY_SETTLED',
            'error_message', 'Cannot release settled transaction.',
            'remainingCredits', v_current_credits,
            'new_balance', v_current_credits
        );
    END IF;

    -- Only a row produced by this function's successful release is an idempotent replay.
    IF v_tx_status = 'cancelled' THEN
        IF v_tx_type IS DISTINCT FROM 'cancelled_usage' OR v_pending_amount IS NULL OR v_pending_amount >= 0 THEN
            RETURN pg_catalog.json_build_object(
                'success', false,
                'released', false,
                'error_code', 'INVALID_RELEASE_TRANSACTION',
                'error_message', 'Cancelled transaction is not a valid released usage reservation.',
                'remainingCredits', v_current_credits,
                'new_balance', v_current_credits
            );
        END IF;

        RETURN pg_catalog.json_build_object(
            'success', true,
            'released', true,
            'already_released', true,
            'remainingCredits', v_current_credits,
            'new_balance', v_current_credits
        );
    END IF;

    IF v_tx_status = 'pending' THEN
        IF v_tx_type IS DISTINCT FROM 'feature_usage' OR v_pending_amount IS NULL OR v_pending_amount >= 0 THEN
            RETURN pg_catalog.json_build_object(
                'success', false,
                'released', false,
                'error_code', 'INVALID_RELEASE_TRANSACTION',
                'error_message', 'Only a negative pending feature-usage reservation can be released.',
                'remainingCredits', v_current_credits,
                'new_balance', v_current_credits
            );
        END IF;

        -- Widen before negation so the int4 minimum cannot overflow. Reject any balance
        -- that cannot be stored in the existing int4 profile column.
        v_new_credits := v_current_credits::pg_catalog.int8 - v_pending_amount::pg_catalog.int8;
        IF v_new_credits < -2147483648 OR v_new_credits > 2147483647 THEN
            RETURN pg_catalog.json_build_object(
                'success', false,
                'released', false,
                'error_code', 'CREDIT_BALANCE_OVERFLOW',
                'error_message', 'Released balance is outside the supported range.',
                'remainingCredits', v_current_credits,
                'new_balance', v_current_credits
            );
        END IF;

        UPDATE public.profiles
        SET credits = v_new_credits::pg_catalog.int4, updated_at = pg_catalog.now()
        WHERE id = p_user_id;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows <> 1 THEN
            RAISE EXCEPTION 'Credit profile disappeared during locked release';
        END IF;

        UPDATE public.credit_transactions
        SET status = 'cancelled', type = 'cancelled_usage'
        WHERE user_id = p_user_id
          AND request_id = v_clean_req_id
          AND status = 'pending'
          AND type = 'feature_usage'
          AND amount = v_pending_amount;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows <> 1 THEN
            RAISE EXCEPTION 'Reservation changed during locked release';
        END IF;

        RETURN pg_catalog.json_build_object(
            'success', true,
            'released', true,
            'already_released', false,
            'remainingCredits', v_new_credits,
            'new_balance', v_new_credits
        );
    END IF;

    RETURN pg_catalog.json_build_object(
        'success', false,
        'released', false,
        'error_message', 'Credit transaction is not pending.',
        'remainingCredits', v_current_credits,
        'new_balance', v_current_credits
    );
END;
$$;

-- Credit mutation RPCs remain server-only. Never expose release to browser roles.
REVOKE ALL ON FUNCTION public.release_credits(pg_catalog.uuid, pg_catalog.text, pg_catalog.text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_credits(pg_catalog.uuid, pg_catalog.text, pg_catalog.text) TO service_role, postgres;
