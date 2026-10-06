-- Migration 017: Durable release_credits RPC distinction
-- Distinguishes pending (released), cancelled (already released), completed (already settled), and not found.
-- Prevents financial ambiguity by ensuring COMPLETED transactions never report a success or refund state.

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
    v_tx_status pg_catalog.text;
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

    -- Lock profile row FOR UPDATE
    SELECT credits INTO v_current_credits
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    -- Lock transaction row FOR UPDATE
    SELECT amount, status INTO v_pending_amount, v_tx_status
    FROM public.credit_transactions
    WHERE user_id = p_user_id AND request_id = v_clean_req_id
    FOR UPDATE;

    -- 1. Transaction Not Found
    IF v_tx_status IS NULL THEN
        RETURN pg_catalog.json_build_object(
            'success', false,
            'released', false,
            'error_code', 'CREDIT_TRANSACTION_NOT_FOUND',
            'error_message', 'Credit transaction not found.',
            'remainingCredits', COALESCE(v_current_credits, 0),
            'new_balance', COALESCE(v_current_credits, 0)
        );
    END IF;

    -- 2. Transaction Already Completed (Settled) — CANNOT RELEASE!
    IF v_tx_status = 'completed' THEN
        RETURN pg_catalog.json_build_object(
            'success', false,
            'released', false,
            'already_settled', true,
            'error_code', 'ALREADY_SETTLED',
            'error_message', 'Cannot release settled transaction.',
            'remainingCredits', COALESCE(v_current_credits, 0),
            'new_balance', COALESCE(v_current_credits, 0)
        );
    END IF;

    -- 3. Transaction Already Cancelled (Already Released) — IDEMPOTENT NO-OP
    IF v_tx_status = 'cancelled' THEN
        RETURN pg_catalog.json_build_object(
            'success', true,
            'released', true,
            'already_released', true,
            'remainingCredits', COALESCE(v_current_credits, 0),
            'new_balance', COALESCE(v_current_credits, 0)
        );
    END IF;

    -- 4. Transaction Pending — Restore reserved credits exactly once
    IF v_tx_status = 'pending' THEN
        v_new_credits := COALESCE(v_current_credits, 0) + pg_catalog.abs(COALESCE(v_pending_amount, 0));

        UPDATE public.profiles
        SET credits = v_new_credits, updated_at = pg_catalog.now()
        WHERE id = p_user_id;

        UPDATE public.credit_transactions
        SET status = 'cancelled', type = 'cancelled_usage'
        WHERE user_id = p_user_id AND request_id = v_clean_req_id AND status = 'pending';

        RETURN pg_catalog.json_build_object(
            'success', true,
            'released', true,
            'already_released', false,
            'remainingCredits', v_new_credits,
            'new_balance', v_new_credits
        );
    END IF;

    -- Fallback for any other unexpected state
    RETURN pg_catalog.json_build_object(
        'success', false,
        'released', false,
        'error_message', 'Credit transaction is not pending.',
        'remainingCredits', COALESCE(v_current_credits, 0),
        'new_balance', COALESCE(v_current_credits, 0)
    );
END;
$$;

-- Credit mutation RPCs remain server-only. Never expose release to browser roles.
REVOKE ALL ON FUNCTION public.release_credits(pg_catalog.uuid, pg_catalog.text, pg_catalog.text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_credits(pg_catalog.uuid, pg_catalog.text, pg_catalog.text) TO service_role, postgres;
