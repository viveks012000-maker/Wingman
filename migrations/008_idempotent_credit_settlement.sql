-- Make final credit settlement safe to retry after an ambiguous network/provider response.
-- This is backward compatible with existing callers: a genuinely pending reservation still
-- becomes completed, while replaying the same settlement after it already completed returns
-- success=true, settled=true instead of a false-negative failure.

CREATE OR REPLACE FUNCTION public.settle_credits(p_user_id uuid, p_request_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_clean_req_id pg_catalog.text;
    v_status pg_catalog.text;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN pg_catalog.json_build_object(
            'success', false,
            'settled', false,
            'error_message', 'Invalid user ID.'
        );
    END IF;

    v_clean_req_id := pg_catalog.btrim(COALESCE(p_request_id, ''));
    IF v_clean_req_id = '' OR pg_catalog.length(v_clean_req_id) > 128 THEN
        RETURN pg_catalog.json_build_object(
            'success', false,
            'settled', false,
            'error_message', 'Invalid request ID.'
        );
    END IF;

    UPDATE public.credit_transactions
    SET status = 'completed'
    WHERE user_id = p_user_id
      AND request_id = v_clean_req_id
      AND status = 'pending'
    RETURNING status INTO v_status;

    IF FOUND THEN
        RETURN pg_catalog.json_build_object(
            'success', true,
            'settled', true,
            'already_settled', false
        );
    END IF;

    -- (user_id, request_id) is protected by a unique index, so this lookup is unambiguous.
    SELECT status
    INTO v_status
    FROM public.credit_transactions
    WHERE user_id = p_user_id
      AND request_id = v_clean_req_id;

    IF NOT FOUND THEN
        RETURN pg_catalog.json_build_object(
            'success', false,
            'settled', false,
            'error_message', 'Credit reservation not found.'
        );
    END IF;

    IF v_status = 'completed' THEN
        RETURN pg_catalog.json_build_object(
            'success', true,
            'settled', true,
            'already_settled', true
        );
    END IF;

    IF v_status = 'cancelled' THEN
        RETURN pg_catalog.json_build_object(
            'success', false,
            'settled', false,
            'error_message', 'Credit reservation was already released.'
        );
    END IF;

    RETURN pg_catalog.json_build_object(
        'success', false,
        'settled', false,
        'error_message', 'Credit reservation is not pending.'
    );
END;
$function$;

-- Credit mutation RPCs remain server-only. Never expose settlement to browser roles.
REVOKE ALL ON FUNCTION public.settle_credits(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_credits(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.settle_credits(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.settle_credits(uuid, text) TO service_role;
