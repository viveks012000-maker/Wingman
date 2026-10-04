-- Prepare for Test Mode only. Apply in a staging database and verify before enabling.
BEGIN;
CREATE TABLE public.razorpay_orders (
    order_id text PRIMARY KEY CHECK (order_id ~ '^order_[A-Za-z0-9]{1,64}$'),
    user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    plan_id text NOT NULL CHECK (plan_id IN ('starter','pro','elite','limited')),
    credits integer NOT NULL CHECK (credits > 0),
    amount_minor integer NOT NULL CHECK (amount_minor > 0),
    currency text NOT NULL CHECK (currency = 'INR'),
    mode text NOT NULL CHECK (mode = 'test'),
    payment_id text UNIQUE,
    fulfilled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((payment_id IS NULL) = (fulfilled_at IS NULL)),
    CHECK ((plan_id='starter' AND credits=250 AND amount_minor=44900) OR
           (plan_id='pro' AND credits=600 AND amount_minor=89900) OR
           (plan_id='elite' AND credits=3000 AND amount_minor=179900) OR
           (plan_id='limited' AND credits=100000 AND amount_minor=449900))
);
-- Preserve financial records when a profile is deleted; detached orders cannot be credited.
CREATE INDEX razorpay_orders_user_idx ON public.razorpay_orders(user_id);
CREATE TABLE public.razorpay_events (
    event_id text PRIMARY KEY,
    payment_id text NOT NULL,
    event_type text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.razorpay_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.razorpay_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.razorpay_orders, public.razorpay_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.razorpay_orders TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.razorpay_events TO service_role;

CREATE FUNCTION public.fulfill_razorpay_order(p_order_id text, p_payment_id text, p_amount_minor integer, p_currency text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_order public.razorpay_orders%ROWTYPE;
    v_result json;
    v_balance integer;
BEGIN
    IF p_payment_id IS NULL OR p_payment_id !~ '^pay_[A-Za-z0-9]{1,64}$' THEN
        RAISE EXCEPTION 'Invalid payment reference';
    END IF;
    SELECT * INTO v_order FROM public.razorpay_orders WHERE order_id=p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order.user_id IS NULL OR v_order.amount_minor IS DISTINCT FROM p_amount_minor OR
        v_order.currency IS DISTINCT FROM p_currency OR v_order.mode <> 'test' THEN
        RAISE EXCEPTION 'Invalid order';
    END IF;
    IF v_order.fulfilled_at IS NOT NULL THEN
        IF v_order.payment_id <> p_payment_id THEN RAISE EXCEPTION 'Order already paid'; END IF;
        SELECT credits INTO v_balance FROM public.profiles WHERE id=v_order.user_id;
        RETURN pg_catalog.json_build_object('success',true,'duplicate',true,'credits',v_balance);
    END IF;
    -- Global payment_id uniqueness prevents reuse across accounts, beyond add_credits' per-user guard.
    UPDATE public.razorpay_orders SET payment_id=p_payment_id, fulfilled_at=pg_catalog.now() WHERE order_id=p_order_id;
    SELECT public.add_credits(v_order.user_id, v_order.credits, v_order.plan_id, p_payment_id, p_order_id, v_order.amount_minor::numeric / 100, NULL) INTO v_result;
    IF COALESCE((v_result->>'success')::boolean,false) IS NOT TRUE OR
        COALESCE((v_result->>'duplicate')::boolean,false) IS TRUE THEN
        RAISE EXCEPTION 'Credit grant failed';
    END IF;
    RETURN pg_catalog.json_build_object('success',true,'duplicate',false,'credits',(v_result->>'new_balance')::integer,'creditsAdded',v_order.credits);
END;
$$;
REVOKE ALL ON FUNCTION public.fulfill_razorpay_order(text,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_razorpay_order(text,text,integer,text) TO service_role;
COMMIT;
