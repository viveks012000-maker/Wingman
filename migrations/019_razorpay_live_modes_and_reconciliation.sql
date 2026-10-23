-- Forward-only payment lifecycle, environment separation, and refund/dispute audit.
-- This migration adds no provider credentials and never changes customer balances.
BEGIN;

-- Replace the original test-only currency/mode checks without rewriting migration 016.
DO $$
DECLARE
    v_constraint record;
    v_definition text;
BEGIN
    FOR v_constraint IN
        SELECT conname, pg_catalog.pg_get_constraintdef(oid) AS definition
        FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.razorpay_orders'::pg_catalog.regclass
          AND contype = 'c'
          AND conname NOT IN (
              'razorpay_orders_mode_currency_check',
              'razorpay_orders_lifecycle_state_check',
              'razorpay_orders_refund_status_check',
              'razorpay_orders_dispute_status_check',
              'razorpay_orders_refunded_amount_check',
              'razorpay_orders_fulfilled_payment_check',
              'razorpay_orders_catalog_integrity_check'
          )
    LOOP
        v_definition := v_constraint.definition;
        IF v_definition LIKE '%currency = ''INR''%' OR v_definition LIKE '%mode = ''test''%' OR
           (v_definition LIKE '%payment_id IS NULL%' AND v_definition LIKE '%fulfilled_at IS NULL%') OR
           (v_definition LIKE '%plan_id%' AND v_definition LIKE '%credits%' AND v_definition LIKE '%amount_minor%') THEN
            EXECUTE pg_catalog.format('ALTER TABLE public.razorpay_orders DROP CONSTRAINT %I', v_constraint.conname);
        END IF;
    END LOOP;
END;
$$;

ALTER TABLE public.razorpay_orders
    ADD COLUMN IF NOT EXISTS receipt pg_catalog.text,
    ADD COLUMN IF NOT EXISTS lifecycle_state pg_catalog.text,
    ADD COLUMN IF NOT EXISTS captured_at pg_catalog.timestamptz,
    ADD COLUMN IF NOT EXISTS refunded_amount_minor pg_catalog.int4 NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS refund_status pg_catalog.text NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS dispute_status pg_catalog.text NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS review_required pg_catalog.bool NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS review_reason pg_catalog.text,
    ADD COLUMN IF NOT EXISTS provider_updated_at pg_catalog.timestamptz,
    ADD COLUMN IF NOT EXISTS updated_at pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now();

UPDATE public.razorpay_orders
SET lifecycle_state = CASE WHEN payment_id IS NOT NULL THEN 'fulfilled' ELSE 'pending' END,
    captured_at = CASE WHEN payment_id IS NOT NULL THEN fulfilled_at ELSE NULL END
WHERE lifecycle_state IS NULL;

ALTER TABLE public.razorpay_orders
    ALTER COLUMN lifecycle_state SET DEFAULT 'pending',
    ALTER COLUMN lifecycle_state SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.razorpay_orders'::pg_catalog.regclass AND conname = 'razorpay_orders_mode_currency_check') THEN
        ALTER TABLE public.razorpay_orders ADD CONSTRAINT razorpay_orders_mode_currency_check
            CHECK ((mode = 'test' AND currency = 'INR') OR
                   (mode = 'live_inr' AND currency = 'INR') OR
                   (mode = 'live_usd' AND currency = 'USD'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.razorpay_orders'::pg_catalog.regclass AND conname = 'razorpay_orders_lifecycle_state_check') THEN
        ALTER TABLE public.razorpay_orders ADD CONSTRAINT razorpay_orders_lifecycle_state_check
            CHECK (lifecycle_state IN ('pending','captured','fulfilled','refunded','disputed'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.razorpay_orders'::pg_catalog.regclass AND conname = 'razorpay_orders_refund_status_check') THEN
        ALTER TABLE public.razorpay_orders ADD CONSTRAINT razorpay_orders_refund_status_check
            CHECK (refund_status IN ('none','pending','partial','full','failed'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.razorpay_orders'::pg_catalog.regclass AND conname = 'razorpay_orders_dispute_status_check') THEN
        ALTER TABLE public.razorpay_orders ADD CONSTRAINT razorpay_orders_dispute_status_check
            CHECK (dispute_status IN ('none','created','under_review','action_required','won','lost','closed'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.razorpay_orders'::pg_catalog.regclass AND conname = 'razorpay_orders_refunded_amount_check') THEN
        ALTER TABLE public.razorpay_orders ADD CONSTRAINT razorpay_orders_refunded_amount_check
            CHECK (refunded_amount_minor >= 0 AND refunded_amount_minor <= amount_minor);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.razorpay_orders'::pg_catalog.regclass AND conname = 'razorpay_orders_fulfilled_payment_check') THEN
        ALTER TABLE public.razorpay_orders ADD CONSTRAINT razorpay_orders_fulfilled_payment_check
            CHECK (fulfilled_at IS NULL OR payment_id IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.razorpay_orders'::pg_catalog.regclass AND conname = 'razorpay_orders_catalog_integrity_check') THEN
        ALTER TABLE public.razorpay_orders ADD CONSTRAINT razorpay_orders_catalog_integrity_check
            CHECK (
                (plan_id = 'starter' AND credits = 250 AND
                    ((mode IN ('test','live_inr') AND amount_minor = 44900) OR mode = 'live_usd')) OR
                (plan_id = 'pro' AND credits = 600 AND
                    ((mode IN ('test','live_inr') AND amount_minor = 89900) OR mode = 'live_usd')) OR
                (plan_id = 'elite' AND credits = 3000 AND
                    ((mode IN ('test','live_inr') AND amount_minor = 179900) OR mode = 'live_usd')) OR
                (plan_id = 'limited' AND credits = 100000 AND
                    ((mode IN ('test','live_inr') AND amount_minor = 449900) OR mode = 'live_usd'))
            );
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS razorpay_orders_receipt_uidx
    ON public.razorpay_orders(receipt) WHERE receipt IS NOT NULL;
CREATE INDEX IF NOT EXISTS razorpay_orders_review_queue_idx
    ON public.razorpay_orders(updated_at) WHERE review_required = true;

ALTER TABLE public.razorpay_events
    ALTER COLUMN payment_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS mode pg_catalog.text,
    ADD COLUMN IF NOT EXISTS order_id pg_catalog.text,
    ADD COLUMN IF NOT EXISTS resource_id pg_catalog.text,
    ADD COLUMN IF NOT EXISTS payload_sha256 pg_catalog.text,
    ADD COLUMN IF NOT EXISTS provider_status pg_catalog.text,
    ADD COLUMN IF NOT EXISTS amount_minor pg_catalog.int4,
    ADD COLUMN IF NOT EXISTS currency pg_catalog.text,
    ADD COLUMN IF NOT EXISTS event_created_at pg_catalog.timestamptz,
    ADD COLUMN IF NOT EXISTS processing_status pg_catalog.text;

UPDATE public.razorpay_events
SET mode = COALESCE(mode, 'test'),
    currency = COALESCE(currency, 'INR'),
    processing_status = COALESCE(processing_status, 'processed')
WHERE mode IS NULL OR currency IS NULL OR processing_status IS NULL;

ALTER TABLE public.razorpay_events
    ALTER COLUMN mode SET DEFAULT 'test',
    ALTER COLUMN mode SET NOT NULL,
    ALTER COLUMN currency SET DEFAULT 'INR',
    ALTER COLUMN currency SET NOT NULL,
    ALTER COLUMN processing_status SET DEFAULT 'processed',
    ALTER COLUMN processing_status SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.razorpay_events'::pg_catalog.regclass AND conname = 'razorpay_events_mode_currency_check') THEN
        ALTER TABLE public.razorpay_events ADD CONSTRAINT razorpay_events_mode_currency_check
            CHECK ((mode = 'test' AND currency = 'INR') OR
                   (mode = 'live_inr' AND currency = 'INR') OR
                   (mode = 'live_usd' AND currency = 'USD'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.razorpay_events'::pg_catalog.regclass AND conname = 'razorpay_events_processing_status_check') THEN
        ALTER TABLE public.razorpay_events ADD CONSTRAINT razorpay_events_processing_status_check
            CHECK (processing_status IN ('received','processed','ignored','review_required'));
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS razorpay_events_order_idx ON public.razorpay_events(order_id);

ALTER TABLE public.razorpay_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.razorpay_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.razorpay_orders, public.razorpay_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.razorpay_orders TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.razorpay_events TO service_role;

CREATE OR REPLACE FUNCTION public.guard_razorpay_event_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Payment events are append-only';
    END IF;
    IF ROW(OLD.event_id, OLD.payment_id, OLD.event_type, OLD.mode, OLD.order_id,
           OLD.resource_id, OLD.payload_sha256, OLD.provider_status, OLD.amount_minor,
           OLD.currency, OLD.event_created_at, OLD.received_at)
       IS DISTINCT FROM
       ROW(NEW.event_id, NEW.payment_id, NEW.event_type, NEW.mode, NEW.order_id,
           NEW.resource_id, NEW.payload_sha256, NEW.provider_status, NEW.amount_minor,
           NEW.currency, NEW.event_created_at, NEW.received_at) THEN
        RAISE EXCEPTION 'Payment event evidence is immutable';
    END IF;
    IF OLD.processing_status <> 'received' OR
       NEW.processing_status NOT IN ('processed','ignored','review_required') THEN
        RAISE EXCEPTION 'Invalid payment event outcome transition';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS razorpay_events_append_only ON public.razorpay_events;
CREATE TRIGGER razorpay_events_append_only
    BEFORE UPDATE OR DELETE ON public.razorpay_events
    FOR EACH ROW EXECUTE FUNCTION public.guard_razorpay_event_immutability();

-- A capture can only be fulfilled by the privileged API after it has fetched the
-- payment from Razorpay and checked the exact order, amount, currency, and status.
CREATE OR REPLACE FUNCTION public.fulfill_razorpay_order(
    p_order_id pg_catalog.text,
    p_payment_id pg_catalog.text,
    p_amount_minor pg_catalog.int4,
    p_currency pg_catalog.text
)
RETURNS pg_catalog.json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_order public.razorpay_orders%ROWTYPE;
    v_result pg_catalog.json;
    v_balance pg_catalog.int4;
BEGIN
    IF p_order_id IS NULL OR p_order_id !~ '^order_[A-Za-z0-9]{1,64}$' OR
       p_payment_id IS NULL OR p_payment_id !~ '^pay_[A-Za-z0-9]{1,64}$' THEN
        RAISE EXCEPTION 'Invalid payment reference';
    END IF;

    SELECT * INTO v_order
    FROM public.razorpay_orders
    WHERE order_id = p_order_id
    FOR UPDATE;

    IF NOT FOUND OR v_order.user_id IS NULL OR
       v_order.amount_minor IS DISTINCT FROM p_amount_minor OR
       v_order.currency IS DISTINCT FROM p_currency OR
       NOT ((v_order.mode = 'test' AND v_order.currency = 'INR') OR
            (v_order.mode = 'live_inr' AND v_order.currency = 'INR') OR
            (v_order.mode = 'live_usd' AND v_order.currency = 'USD')) THEN
        RAISE EXCEPTION 'Invalid order';
    END IF;

    IF v_order.review_required OR v_order.lifecycle_state IN ('refunded','disputed') OR
       v_order.refunded_amount_minor > 0 OR v_order.dispute_status <> 'none' THEN
        RAISE EXCEPTION 'Purchase requires manual review';
    END IF;

    IF v_order.fulfilled_at IS NOT NULL THEN
        IF v_order.payment_id <> p_payment_id THEN RAISE EXCEPTION 'Order already paid'; END IF;
        SELECT credits INTO v_balance FROM public.profiles WHERE id = v_order.user_id;
        RETURN pg_catalog.json_build_object('success', true, 'duplicate', true, 'credits', v_balance);
    END IF;

    -- The unique payment_id constraint prevents provider payment reuse across orders.
    UPDATE public.razorpay_orders
    SET payment_id = p_payment_id,
        fulfilled_at = pg_catalog.now(),
        captured_at = COALESCE(captured_at, pg_catalog.now()),
        lifecycle_state = 'fulfilled',
        updated_at = pg_catalog.now(),
        provider_updated_at = pg_catalog.now()
    WHERE order_id = p_order_id;

    SELECT public.add_credits(
        v_order.user_id, v_order.credits, v_order.plan_id, p_payment_id, p_order_id,
        CASE WHEN p_currency = 'INR' THEN p_amount_minor::pg_catalog.numeric / 100 ELSE NULL END,
        NULL
    ) INTO v_result;

    IF COALESCE((v_result->>'success')::pg_catalog.bool, false) IS NOT TRUE OR
       COALESCE((v_result->>'duplicate')::pg_catalog.bool, false) IS TRUE THEN
        RAISE EXCEPTION 'Credit grant failed';
    END IF;

    RETURN pg_catalog.json_build_object(
        'success', true, 'duplicate', false,
        'credits', (v_result->>'new_balance')::pg_catalog.int4,
        'creditsAdded', v_order.credits
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_razorpay_event(
    p_event_id pg_catalog.text,
    p_payment_id pg_catalog.text,
    p_event_type pg_catalog.text,
    p_mode pg_catalog.text,
    p_order_id pg_catalog.text,
    p_payload_sha256 pg_catalog.text,
    p_provider_status pg_catalog.text,
    p_amount_minor pg_catalog.int4,
    p_currency pg_catalog.text,
    p_event_created_at pg_catalog.timestamptz
)
RETURNS pg_catalog.json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_order public.razorpay_orders%ROWTYPE;
    v_existing_hash pg_catalog.text;
    v_existing_payment_id pg_catalog.text;
    v_existing_event_type pg_catalog.text;
    v_rows pg_catalog.int4;
BEGIN
    IF p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9_-]{1,128}$' OR
       p_payment_id IS NULL OR p_payment_id !~ '^pay_[A-Za-z0-9]{1,64}$' OR
       p_order_id IS NULL OR p_order_id !~ '^order_[A-Za-z0-9]{1,64}$' OR
       p_event_type NOT IN ('payment.captured','order.paid') OR
       p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[a-f0-9]{64}$' OR
       NOT ((p_mode = 'test' AND p_currency = 'INR') OR
            (p_mode = 'live_inr' AND p_currency = 'INR') OR
            (p_mode = 'live_usd' AND p_currency = 'USD')) THEN
        RAISE EXCEPTION 'Invalid provider event';
    END IF;

    SELECT * INTO v_order FROM public.razorpay_orders WHERE order_id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order.mode <> p_mode OR v_order.currency <> p_currency OR
       v_order.payment_id IS DISTINCT FROM p_payment_id OR v_order.amount_minor IS DISTINCT FROM p_amount_minor THEN
        RAISE EXCEPTION 'Provider event does not match a fulfilled purchase';
    END IF;

    INSERT INTO public.razorpay_events(
        event_id, payment_id, event_type, mode, order_id, resource_id, payload_sha256,
        provider_status, amount_minor, currency, event_created_at, processing_status
    ) VALUES (
        p_event_id, p_payment_id, p_event_type, p_mode, p_order_id, p_payment_id, p_payload_sha256,
        p_provider_status, p_amount_minor, p_currency, p_event_created_at, 'processed'
    ) ON CONFLICT (event_id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        SELECT payload_sha256, payment_id, event_type
        INTO v_existing_hash, v_existing_payment_id, v_existing_event_type
        FROM public.razorpay_events WHERE event_id = p_event_id;
        -- Migration 016 stored only the event id, payment id, and event type.
        -- Accept an exact legacy replay without pretending its old payload hash exists.
        IF v_existing_hash IS NULL AND v_existing_payment_id = p_payment_id AND v_existing_event_type = p_event_type THEN
            RETURN pg_catalog.json_build_object('success', true, 'duplicate', true, 'legacy', true);
        END IF;
        IF v_existing_hash IS DISTINCT FROM p_payload_sha256 THEN RAISE EXCEPTION 'Provider event ID payload conflict'; END IF;
        RETURN pg_catalog.json_build_object('success', true, 'duplicate', true);
    END IF;
    RETURN pg_catalog.json_build_object('success', true, 'duplicate', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_razorpay_reconciliation(
    p_event_id pg_catalog.text,
    p_event_type pg_catalog.text,
    p_mode pg_catalog.text,
    p_order_id pg_catalog.text,
    p_payment_id pg_catalog.text,
    p_resource_id pg_catalog.text,
    p_payload_sha256 pg_catalog.text,
    p_provider_status pg_catalog.text,
    p_payment_amount_minor pg_catalog.int4,
    p_resource_amount_minor pg_catalog.int4,
    p_refunded_total_minor pg_catalog.int4,
    p_currency pg_catalog.text,
    p_event_created_at pg_catalog.timestamptz,
    p_dispute_state pg_catalog.text,
    p_force_review pg_catalog.bool
)
RETURNS pg_catalog.json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_order public.razorpay_orders%ROWTYPE;
    v_existing_hash pg_catalog.text;
    v_rows pg_catalog.int4;
    v_needs_review pg_catalog.bool := COALESCE(p_force_review, false);
    v_refunded pg_catalog.int4;
    v_refund_status pg_catalog.text;
    v_dispute_status pg_catalog.text;
    v_next_state pg_catalog.text;
    v_reason pg_catalog.text;
BEGIN
    IF p_event_id IS NULL OR p_event_id !~ '^[A-Za-z0-9_-]{1,128}$' OR
       p_event_type NOT IN (
           'payment.captured','order.paid',
           'refund.created','refund.processed','refund.failed',
           'payment.dispute.created','payment.dispute.under_review','payment.dispute.action_required',
           'payment.dispute.won','payment.dispute.lost','payment.dispute.closed','reconciliation.snapshot'
       ) OR p_mode NOT IN ('test','live_inr','live_usd') OR
       p_order_id IS NULL OR p_order_id !~ '^order_[A-Za-z0-9]{1,64}$' OR
       (p_payment_id IS NOT NULL AND p_payment_id !~ '^pay_[A-Za-z0-9]{1,64}$') OR
       p_resource_id IS NULL OR p_resource_id !~ '^[A-Za-z0-9_-]{1,128}$' OR
       p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[a-f0-9]{64}$' OR
       p_provider_status IS NULL OR length(p_provider_status) > 64 OR
       p_payment_amount_minor IS NULL OR p_payment_amount_minor <= 0 OR
       p_refunded_total_minor IS NULL OR p_refunded_total_minor < 0 OR
       p_resource_amount_minor IS NOT NULL AND p_resource_amount_minor < 0 OR
       NOT ((p_mode = 'test' AND p_currency = 'INR') OR
            (p_mode = 'live_inr' AND p_currency = 'INR') OR
            (p_mode = 'live_usd' AND p_currency = 'USD')) THEN
        RAISE EXCEPTION 'Invalid reconciliation event';
    END IF;
    IF p_event_type LIKE 'payment.dispute.%' AND
       (p_dispute_state IS NULL OR p_dispute_state NOT IN ('created','under_review','action_required','won','lost','closed')) THEN
        RAISE EXCEPTION 'Invalid dispute state';
    END IF;

    SELECT * INTO v_order FROM public.razorpay_orders WHERE order_id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Purchase not found'; END IF;

    INSERT INTO public.razorpay_events(
        event_id, payment_id, event_type, mode, order_id, resource_id, payload_sha256,
        provider_status, amount_minor, currency, event_created_at, processing_status
    ) VALUES (
        p_event_id, p_payment_id, p_event_type, p_mode, p_order_id, p_resource_id, p_payload_sha256,
        p_provider_status, p_resource_amount_minor, p_currency, p_event_created_at, 'received'
    ) ON CONFLICT (event_id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        SELECT payload_sha256 INTO v_existing_hash FROM public.razorpay_events WHERE event_id = p_event_id;
        IF v_existing_hash IS DISTINCT FROM p_payload_sha256 THEN RAISE EXCEPTION 'Provider event ID payload conflict'; END IF;
        RETURN pg_catalog.json_build_object('success', true, 'duplicate', true, 'reviewRequired', v_order.review_required);
    END IF;

    v_refunded := GREATEST(v_order.refunded_amount_minor, p_refunded_total_minor);
    v_next_state := v_order.lifecycle_state;
    v_refund_status := v_order.refund_status;
    v_dispute_status := v_order.dispute_status;
    v_reason := 'provider_reconciliation';

    IF v_order.mode <> p_mode OR v_order.currency <> p_currency OR v_order.amount_minor <> p_payment_amount_minor OR
       (v_order.payment_id IS NOT NULL AND p_payment_id IS NOT NULL AND v_order.payment_id <> p_payment_id) OR
       v_refunded > v_order.amount_minor OR
       (p_resource_amount_minor IS NOT NULL AND p_resource_amount_minor > v_order.amount_minor) THEN
        v_needs_review := true;
        v_reason := 'provider_reference_or_amount_mismatch';
    END IF;

    IF p_event_type LIKE 'refund.%' THEN
        v_needs_review := true;
        v_reason := 'refund_requires_operator_review';
        IF p_provider_status NOT IN ('created','pending','processed','failed') THEN
            v_needs_review := true;
            v_reason := 'unknown_refund_status';
        END IF;
        IF v_refunded = v_order.amount_minor THEN
            v_refund_status := 'full';
            v_next_state := 'refunded';
        ELSIF p_provider_status IN ('created','pending') THEN
            v_refund_status := 'pending';
            IF v_order.dispute_status IN ('created','under_review','action_required') THEN v_next_state := 'disputed';
            ELSIF v_order.lifecycle_state = 'pending' THEN v_next_state := 'captured'; END IF;
        ELSIF p_provider_status = 'failed' THEN
            v_refund_status := 'failed';
            IF v_order.dispute_status IN ('created','under_review','action_required') THEN v_next_state := 'disputed';
            ELSIF v_order.lifecycle_state = 'pending' THEN v_next_state := 'captured'; END IF;
        ELSIF v_refunded > 0 THEN
            v_refund_status := 'partial';
            IF v_order.dispute_status IN ('created','under_review','action_required') THEN v_next_state := 'disputed';
            ELSIF v_order.lifecycle_state = 'pending' THEN v_next_state := 'captured'; END IF;
        END IF;
    ELSIF p_event_type LIKE 'payment.dispute.%' THEN
        v_needs_review := true;
        v_reason := 'dispute_requires_operator_review';
        IF p_dispute_state NOT IN ('created','under_review','action_required','won','lost','closed') THEN
            v_needs_review := true;
            v_reason := 'unknown_dispute_status';
        ELSE
            v_dispute_status := p_dispute_state;
        END IF;
        IF v_refunded = v_order.amount_minor THEN v_next_state := 'refunded';
        ELSE v_next_state := 'disputed'; END IF;
    ELSE
        v_needs_review := true;
        v_reason := 'ambiguous_payment_reconciliation';
        IF v_refunded = v_order.amount_minor THEN
            v_refund_status := 'full';
            v_next_state := 'refunded';
        ELSE
            IF p_provider_status = 'refund_pending' THEN v_refund_status := 'pending';
            ELSIF p_provider_status = 'refund_failed' THEN v_refund_status := 'failed';
            ELSIF v_refunded > 0 THEN v_refund_status := 'partial'; END IF;
            IF v_order.dispute_status IN ('created','under_review','action_required') THEN v_next_state := 'disputed';
            ELSIF v_order.lifecycle_state = 'pending' THEN v_next_state := 'captured'; END IF;
        END IF;
    END IF;

    UPDATE public.razorpay_orders
    SET payment_id = CASE WHEN v_needs_review AND v_reason = 'provider_reference_or_amount_mismatch' THEN payment_id ELSE COALESCE(payment_id, p_payment_id) END,
        lifecycle_state = v_next_state,
        captured_at = COALESCE(captured_at, pg_catalog.now()),
        refunded_amount_minor = LEAST(v_order.amount_minor, v_refunded),
        refund_status = v_refund_status,
        dispute_status = v_dispute_status,
        review_required = review_required OR v_needs_review,
        review_reason = CASE WHEN v_needs_review THEN v_reason ELSE review_reason END,
        provider_updated_at = GREATEST(COALESCE(provider_updated_at, '-infinity'::pg_catalog.timestamptz), COALESCE(p_event_created_at, pg_catalog.now())),
        updated_at = pg_catalog.now()
    WHERE order_id = p_order_id;

    UPDATE public.razorpay_events
    SET processing_status = CASE WHEN v_needs_review THEN 'review_required' ELSE 'processed' END
    WHERE event_id = p_event_id;

    RETURN pg_catalog.json_build_object(
        'success', true, 'duplicate', false, 'reviewRequired', v_needs_review,
        'lifecycleState', v_next_state, 'refundStatus', v_refund_status, 'disputeStatus', v_dispute_status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_razorpay_order(pg_catalog.text,pg_catalog.text,pg_catalog.int4,pg_catalog.text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_razorpay_order(pg_catalog.text,pg_catalog.text,pg_catalog.int4,pg_catalog.text) TO service_role;
REVOKE ALL ON FUNCTION public.record_razorpay_event(pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.int4,pg_catalog.text,pg_catalog.timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_razorpay_event(pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.int4,pg_catalog.text,pg_catalog.timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.record_razorpay_reconciliation(pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.int4,pg_catalog.int4,pg_catalog.int4,pg_catalog.text,pg_catalog.timestamptz,pg_catalog.text,pg_catalog.bool) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_razorpay_reconciliation(pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.int4,pg_catalog.int4,pg_catalog.int4,pg_catalog.text,pg_catalog.timestamptz,pg_catalog.text,pg_catalog.bool) TO service_role;

COMMIT;
