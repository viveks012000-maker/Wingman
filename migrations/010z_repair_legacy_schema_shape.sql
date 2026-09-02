-- Forward-only compatibility repair for the original numeric migration history.
--
-- The first migration created a BIGSERIAL ledger id and omitted two columns that later
-- migrations already referenced. Do not edit or rename 001-011: those files are historical
-- records. This repair is intentionally idempotent and must run after 010 and before 011 on a
-- new/recovery database. Existing databases that already recorded 011 receive the same repair
-- in 012_reconcile_legacy_schema_shape.sql.

BEGIN;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.credit_transactions
    ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'feature_usage';

COMMIT;
