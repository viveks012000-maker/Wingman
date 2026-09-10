-- Migration 014: Reconcile historical untouched 50-credit signup accounts to 20 credits
-- Authoritative Rule: Every new user receives exactly 20 free credits once in their lifetime.
-- This migration safely corrects existing accounts that were granted 50 free credits
-- under legacy provisioning and have zero transaction history (untouched free signup grant).
-- All accounts with transaction history (purchases, spend, refunds, adjustments) and all
-- accounts with other legitimate balances are strictly preserved.

BEGIN;

UPDATE public.profiles p
SET credits = 20,
    updated_at = pg_catalog.now()
WHERE p.credits = 50
  AND p.has_paid_credits = false
  AND NOT EXISTS (
      SELECT 1 FROM public.credit_transactions t
      WHERE t.user_id = p.id
  );

COMMIT;
