'use strict';

// Disposable launch/recovery proof. This test never reads or writes the linked Supabase
// project; it creates a throwaway Postgres container and applies the repository history in the
// exact filename order, including the forward-only legacy-shape repairs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const migrationDir = path.join(root, 'migrations');
const migrations = fs.readdirSync(migrationDir)
    .filter(name => name.endsWith('.sql'))
    .sort();
assert.deepEqual(migrations.map(name => name.slice(0, 3)), [
    '001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '010', '011', '012', '013', '014', '015', '016', '017', '018', '019'
], 'tracked migration order must remain explicit and stable');

const container = `wingman-migration-replay-${process.pid}`;
const bootstrap = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  email_confirmed_at timestamptz
);
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
`;

function docker(args, input) {
    return execFileSync('docker', args, {
        cwd: root,
        input,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
    });
}

function psql(sql) {
    return docker([
        'exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1',
        '-U', 'postgres', '-d', 'wingman_replay'
    ], sql);
}

function scalar(sql) {
    return docker([
        'exec', '-i', container, 'psql', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
        '-U', 'postgres', '-d', 'wingman_replay'
    ], sql).trim();
}

try {
    try {
        docker(['--version']);
    } catch (checkErr) {
        if (checkErr && (checkErr.code === 'ENOENT' || checkErr.syscall === 'spawnSync' || (checkErr.message && checkErr.message.includes('ENOENT')))) {
            console.log('ℹ Docker is not available in local environment; skipping disposable container migration replay.');
            process.exit(0);
        }
        throw checkErr;
    }

    docker(['run', '--rm', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=wingman_replay', 'postgres:17.6-alpine']);
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt += 1) {
        try {
            docker(['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'wingman_replay']);
            // pg_isready can report the server as accepting connections while the
            // POSTGRES_DB init step is still creating the named database. Prove the
            // actual target database is queryable before applying any SQL.
            psql('SELECT 1;');
            ready = true;
            break;
        } catch (_) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
        }
    }
    assert.equal(ready, true, 'disposable Postgres did not become ready');
    psql(bootstrap);

    for (const name of migrations) {
        if (name.startsWith('014')) {
            // Before applying 014, create historical test fixtures in the disposable container:
            // 1. Untouched 50-credit legacy signup account (0 transactions)
            // 2. 50-credit account with purchase transaction history
            // 3. 98-credit legitimate balance account
            // 4. 50-credit paid account (has_paid_credits = true)
            // These rows are marked confirmed so migration 015 must not classify them as
            // pending-signup profiles later in the replay.
            psql(`
                INSERT INTO auth.users(id, email_confirmed_at) VALUES 
                    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pg_catalog.now()),
                    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pg_catalog.now()),
                    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', pg_catalog.now()),
                    ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', pg_catalog.now());
                UPDATE public.profiles SET credits = 50, has_paid_credits = false WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
                UPDATE public.profiles SET credits = 50, has_paid_credits = false WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
                INSERT INTO public.credit_transactions(user_id, amount, type, feature, request_id, status)
                VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 50, 'purchase', 'starter', 'tx_test_b', 'completed');
                UPDATE public.profiles SET credits = 98, has_paid_credits = false WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
                UPDATE public.profiles SET credits = 50, has_paid_credits = true WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
            `);
        }
        if (name.startsWith('015')) {
            // Reproduce the exact legacy defects immediately before the repair:
            // - the old auth.users INSERT trigger creates profiles before email verification;
            // - one safely recoverable confirmed identity can exist without a profile.
            psql(`
                INSERT INTO auth.users(id, email_confirmed_at) VALUES
                    ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', NULL),
                    ('ffffffff-ffff-4fff-8fff-ffffffffffff', NULL),
                    ('99999999-9999-4999-8999-999999999999', NULL),
                    ('77777777-7777-4777-8777-777777777777', pg_catalog.now());
                INSERT INTO public.credit_transactions(user_id, amount, type, feature, request_id, status)
                VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff', 1, 'purchase', 'fixture', 'tx_pending_history', 'completed');
                UPDATE public.profiles
                SET has_paid_credits = true
                WHERE id = '99999999-9999-4999-8999-999999999999';
                DELETE FROM public.profiles
                WHERE id = '77777777-7777-4777-8777-777777777777';
            `);
        }
        if (name.startsWith('018')) {
            // Keep these email signups pending across the cutover. A profile with an
            // existing balance must survive confirmation unchanged.
            psql(`
                INSERT INTO auth.users(id, created_at, email_confirmed_at) VALUES
                    ('81818181-8181-4818-8818-818181818181', '2026-10-15T00:00:00Z', NULL),
                    ('82828282-8282-4828-8828-828282828282', '2026-10-15T00:00:00Z', NULL),
                    ('83838383-8383-4838-8838-838383838383', '2026-10-15T00:00:00Z', NULL);
                INSERT INTO public.profiles(id, credits, has_paid_credits) VALUES
                    ('82828282-8282-4828-8828-828282828282', 73, true),
                    ('83838383-8383-4838-8838-838383838383', 0, true);
            `);
        }
        if (name.startsWith('019')) {
            // Migration 016 logged provider IDs before payload hashes existed.
            psql("INSERT INTO public.razorpay_events(event_id,payment_id,event_type) VALUES ('evt_legacy','pay_refund','payment.captured');");
        }
        psql(fs.readFileSync(path.join(migrationDir, name), 'utf8'));
    }

    // The new payment migration must also be safely replayable after its append-only
    // event trigger and constraints have been installed.
    psql(fs.readFileSync(path.join(migrationDir, '019_razorpay_live_modes_and_reconciliation.sql'), 'utf8'));

    // Verify Migration 014 historical reconciliation results.
    assert.equal(scalar("SELECT credits FROM public.profiles WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';"), '20',
        'Untouched 50-credit historical account must be reconciled to 20 by migration 014');
    assert.equal(scalar("SELECT credits FROM public.profiles WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';"), '50',
        '50-credit account with purchase transaction must remain untouched');
    assert.equal(scalar("SELECT credits FROM public.profiles WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';"), '98',
        'Account with legitimate 98-credit balance must remain untouched');
    assert.equal(scalar("SELECT credits FROM public.profiles WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';"), '50',
        'Paid account must remain untouched');

    // Verify Migration 015 cleanup is narrow: only untouched unconfirmed free-signup
    // profiles are removed. Transactional and paid rows must survive.
    assert.equal(scalar("SELECT COUNT(*) FROM public.profiles WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';"), '0',
        'Untouched unconfirmed free-signup profile must be removed by migration 015');
    assert.equal(scalar("SELECT COUNT(*) FROM public.profiles WHERE id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';"), '1',
        'Unconfirmed profile with transaction history must be preserved');
    assert.equal(scalar("SELECT COUNT(*) FROM public.profiles WHERE id = '99999999-9999-4999-8999-999999999999';"), '1',
        'Unconfirmed paid profile must be preserved');
    assert.equal(scalar("SELECT credits FROM public.profiles WHERE id = '77777777-7777-4777-8777-777777777777';"), '20',
        'Confirmed identity missing a profile and with no credit history must be safely backfilled to 20');

    // Migration 018 keeps pending pre-cutover registrations at 20 and preserves all
    // pre-existing balances/paid markers; new post-cutover verification earns 50.
    psql(`
        UPDATE auth.users SET email_confirmed_at = pg_catalog.now()
        WHERE id = '81818181-8181-4818-8818-818181818181';
        UPDATE auth.users SET email_confirmed_at = pg_catalog.now()
        WHERE id IN ('82828282-8282-4828-8828-828282828282', '83838383-8383-4838-8838-838383838383');
        INSERT INTO auth.users(id, email_confirmed_at)
        VALUES ('84848484-8484-4848-8848-848484848484', NULL);
        UPDATE auth.users SET email_confirmed_at = pg_catalog.now()
        WHERE id = '84848484-8484-4848-8848-848484848484';
        INSERT INTO auth.users(id, email_confirmed_at)
        VALUES ('85858585-8585-4858-8858-858585858585', pg_catalog.now());
        DO $$ BEGIN
          IF (SELECT credits FROM public.profiles WHERE id='81818181-8181-4818-8818-818181818181') <> 20 THEN RAISE EXCEPTION 'pre-cutover pending signup must retain 20 credits'; END IF;
          IF (SELECT credits FROM public.profiles WHERE id='82828282-8282-4828-8828-828282828282') <> 73 OR (SELECT has_paid_credits FROM public.profiles WHERE id='82828282-8282-4828-8828-828282828282') <> true THEN RAISE EXCEPTION 'existing pending-profile balance was overwritten'; END IF;
          IF (SELECT credits FROM public.profiles WHERE id='83838383-8383-4838-8838-838383838383') <> 0 OR (SELECT has_paid_credits FROM public.profiles WHERE id='83838383-8383-4838-8838-838383838383') <> true THEN RAISE EXCEPTION 'existing zero paid balance was overwritten'; END IF;
          IF (SELECT credits FROM public.profiles WHERE id='84848484-8484-4848-8848-848484848484') <> 50 THEN RAISE EXCEPTION 'new verified signup must receive exactly 50'; END IF;
          IF (SELECT credits FROM public.profiles WHERE id='85858585-8585-4858-8858-858585858585') <> 50 THEN RAISE EXCEPTION 'confirmed OAuth signup must receive exactly 50'; END IF;
          IF has_table_privilege('anon','public.signup_credit_policy','SELECT') OR has_table_privilege('authenticated','public.signup_credit_policy','INSERT') THEN RAISE EXCEPTION 'browser role can access signup policy'; END IF;
        END $$;
        UPDATE auth.users SET email_confirmed_at = email_confirmed_at WHERE id='84848484-8484-4848-8848-848484848484';
        DO $$ BEGIN
          IF (SELECT credits FROM public.profiles WHERE id='84848484-8484-4848-8848-848484848484') <> 50 THEN RAISE EXCEPTION 'repeated confirmation must not regrant'; END IF;
        END $$;
    `);

    const userId = '11111111-1111-4111-8111-111111111111';
    const otherId = '22222222-2222-4222-8222-222222222222';
    const smoke = `
BEGIN;

-- Email/password signup starts unconfirmed: no profile and no free credits yet.
INSERT INTO auth.users(id, email_confirmed_at) VALUES ('${userId}', NULL);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = '${userId}') THEN
    RAISE EXCEPTION 'unconfirmed signup must not receive a profile or credits';
  END IF;
END $$;

-- The first NULL -> non-NULL email confirmation transition provisions exactly once.
UPDATE auth.users SET email_confirmed_at = pg_catalog.now() WHERE id = '${userId}';
DO $$ BEGIN
  IF (SELECT credits FROM public.profiles WHERE id = '${userId}') <> 50 THEN RAISE EXCEPTION 'post-cutover verified signup must grant exactly 50 credits'; END IF;
  IF (SELECT has_paid_credits FROM public.profiles WHERE id = '${userId}') <> false THEN RAISE EXCEPTION 'verified signup must be on Free Plan'; END IF;
END $$;

-- Subsequent updates cannot re-award signup credits.
UPDATE auth.users SET email_confirmed_at = email_confirmed_at WHERE id = '${userId}';
DO $$ BEGIN
  IF (SELECT credits FROM public.profiles WHERE id = '${userId}') <> 50 THEN RAISE EXCEPTION 'confirmation replay changed signup credits'; END IF;
END $$;

-- OAuth-like users that are already confirmed at INSERT still provision immediately.
INSERT INTO auth.users(id, email_confirmed_at) VALUES ('${otherId}', pg_catalog.now());
DO $$ BEGIN
  IF (SELECT credits FROM public.profiles WHERE id = '${otherId}') <> 50 THEN RAISE EXCEPTION 'confirmed-at-insert user must receive exactly 50 credits'; END IF;
  IF (SELECT has_paid_credits FROM public.profiles WHERE id = '${otherId}') <> false THEN RAISE EXCEPTION 'confirmed-at-insert user must be on Free Plan'; END IF;
END $$;

SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$ DECLARE result json; BEGIN
  result := public.reserve_credits('${userId}', 10, 'analyzer', 'replay-1');
  IF result->>'success' <> 'true' OR (result->>'remainingCredits')::int <> 40 THEN RAISE EXCEPTION 'reservation failed: %', result; END IF;
  result := public.reserve_credits('${userId}', 10, 'analyzer', 'replay-1');
  IF result->>'duplicate' <> 'true' OR (result->>'remainingCredits')::int <> 40 THEN RAISE EXCEPTION 'reservation was not idempotent: %', result; END IF;
  result := public.settle_credits('${userId}', 'replay-1');
  IF result->>'success' <> 'true' THEN RAISE EXCEPTION 'settlement failed: %', result; END IF;
  result := public.settle_credits('${userId}', 'replay-1');
  IF result->>'success' <> 'true' THEN RAISE EXCEPTION 'settlement replay failed: %', result; END IF;
  result := public.reserve_credits('${userId}', 10, 'analyzer', 'replay-2');
  IF result->>'success' <> 'true' OR (result->>'remainingCredits')::int <> 30 THEN RAISE EXCEPTION 'second reservation failed: %', result; END IF;
  result := public.release_credits('${userId}', 'replay-2', 'test');
  IF result->>'released' <> 'true' OR (result->>'remainingCredits')::int <> 40 THEN RAISE EXCEPTION 'release failed: %', result; END IF;
  result := public.release_credits('${userId}', 'replay-2', 'test');
  IF result->>'already_released' <> 'true' OR (result->>'remainingCredits')::int <> 40 THEN RAISE EXCEPTION 'release replay was not idempotent: %', result; END IF;
  INSERT INTO public.credit_transactions(user_id, amount, type, feature, request_id, status)
  VALUES ('${userId}', -7, 'purchase', 'fixture', 'release-wrong-type', 'pending');
  result := public.release_credits('${userId}', 'release-wrong-type', 'test');
  IF result->>'success' <> 'false' OR (SELECT credits FROM public.profiles WHERE id='${userId}') <> 40 OR (SELECT status FROM public.credit_transactions WHERE user_id='${userId}' AND request_id='release-wrong-type') <> 'pending' THEN RAISE EXCEPTION 'pending non-usage row was restored or changed: %', result; END IF;
  INSERT INTO public.credit_transactions(user_id, amount, type, feature, request_id, status)
  VALUES ('${userId}', 5, 'feature_usage', 'fixture', 'release-positive-amount', 'pending'),
         ('${userId}', 0, 'feature_usage', 'fixture', 'release-zero-amount', 'pending');
  result := public.release_credits('${userId}', 'release-positive-amount', 'test');
  IF result->>'success' <> 'false' OR (SELECT credits FROM public.profiles WHERE id='${userId}') <> 40 OR (SELECT status FROM public.credit_transactions WHERE user_id='${userId}' AND request_id='release-positive-amount') <> 'pending' THEN RAISE EXCEPTION 'positive reservation amount was restored or changed: %', result; END IF;
  result := public.release_credits('${userId}', 'release-zero-amount', 'test');
  IF result->>'success' <> 'false' OR (SELECT credits FROM public.profiles WHERE id='${userId}') <> 40 OR (SELECT status FROM public.credit_transactions WHERE user_id='${userId}' AND request_id='release-zero-amount') <> 'pending' THEN RAISE EXCEPTION 'zero reservation amount was restored or changed: %', result; END IF;
  INSERT INTO public.credit_transactions(user_id, amount, type, feature, request_id, status)
  VALUES ('${userId}', -2147483648, 'feature_usage', 'fixture', 'release-overflow', 'pending');
  result := public.release_credits('${userId}', 'release-overflow', 'test');
  IF result->>'success' <> 'false' OR (SELECT credits FROM public.profiles WHERE id='${userId}') <> 40 OR (SELECT status FROM public.credit_transactions WHERE user_id='${userId}' AND request_id='release-overflow') <> 'pending' THEN RAISE EXCEPTION 'out-of-range reservation was restored or changed: %', result; END IF;
  INSERT INTO public.credit_transactions(user_id, amount, type, feature, request_id, status)
  VALUES ('${userId}', -5, 'cancelled_purchase', 'fixture', 'release-cancelled-wrong-type', 'cancelled');
  result := public.release_credits('${userId}', 'release-cancelled-wrong-type', 'test');
  IF result->>'success' <> 'false' OR (SELECT credits FROM public.profiles WHERE id='${userId}') <> 40 THEN RAISE EXCEPTION 'unrelated cancelled row was reported as released: %', result; END IF;
  result := public.reserve_credits('${userId}', 1000, 'analyzer', 'replay-insufficient');
  IF result->>'error' <> 'INSUFFICIENT_CREDITS' THEN RAISE EXCEPTION 'insufficient balance was not rejected: %', result; END IF;
  result := public.record_user_consent('terms-v1', 'privacy-v1', true, true, NULL, NULL, '${userId}');
  IF result->>'success' <> 'true' OR result->>'user_id' <> '${userId}' THEN RAISE EXCEPTION 'consent flow failed: %', result; END IF;
END $$;
INSERT INTO auth.users(id, email_confirmed_at) VALUES ('33333333-3333-4333-8333-333333333333', pg_catalog.now());
INSERT INTO public.credit_transactions(user_id, amount, type, feature, request_id, status)
VALUES ('33333333-3333-4333-8333-333333333333', -3, 'feature_usage', 'fixture', 'release-missing-profile', 'pending');
-- Model a legacy orphan in this disposable database only. Production's ON DELETE
-- CASCADE normally prevents this state; suppressing FK triggers here lets the
-- regression prove release_credits fails closed if historical corruption exists.
SET session_replication_role = replica;
DELETE FROM public.profiles WHERE id='33333333-3333-4333-8333-333333333333';
SET session_replication_role = origin;
DO $$ DECLARE result json; BEGIN
  result := public.release_credits('33333333-3333-4333-8333-333333333333', 'release-missing-profile', 'test');
  IF result->>'success' <> 'false' OR EXISTS (SELECT 1 FROM public.profiles WHERE id='33333333-3333-4333-8333-333333333333') OR (SELECT status FROM public.credit_transactions WHERE user_id='33333333-3333-4333-8333-333333333333' AND request_id='release-missing-profile') <> 'pending' THEN RAISE EXCEPTION 'missing profile release must fail without changing ledger: %', result; END IF;
END $$;
DO $$ BEGIN
  IF (SELECT credits FROM public.profiles WHERE id = '${userId}') <> 40 THEN RAISE EXCEPTION 'balance invariant failed'; END IF;
END $$;
DELETE FROM auth.users WHERE id = '${userId}';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = '${userId}') THEN RAISE EXCEPTION 'auth cascade did not remove profile'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '${otherId}') THEN RAISE EXCEPTION 'cascade removed unrelated account'; END IF;
END $$;
ROLLBACK;
`;
    psql(smoke);
    psql(`
BEGIN;
INSERT INTO auth.users(id,email_confirmed_at) VALUES ('${userId}',pg_catalog.now()), ('${otherId}',pg_catalog.now());
INSERT INTO public.razorpay_orders(order_id,user_id,plan_id,credits,amount_minor,currency,mode)
VALUES ('order_replay','${userId}','starter',250,44900,'INR','test'),
       ('order_other','${otherId}','starter',250,44900,'INR','test');
DO $$ DECLARE result json; BEGIN
 result := public.fulfill_razorpay_order('order_replay','pay_replay',44900,'INR');
 IF result->>'success' <> 'true' OR (result->>'credits')::int <> 300 THEN RAISE EXCEPTION 'payment fulfillment failed: %',result; END IF;
 result := public.fulfill_razorpay_order('order_replay','pay_replay',44900,'INR');
 IF result->>'duplicate' <> 'true' OR (result->>'credits')::int <> 300 THEN RAISE EXCEPTION 'duplicate payment grant: %',result; END IF;
 BEGIN
   PERFORM public.fulfill_razorpay_order('order_other','pay_replay',44900,'INR');
   RAISE EXCEPTION 'payment reuse unexpectedly succeeded';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 IF (SELECT credits FROM public.profiles WHERE id='${otherId}') <> 50 THEN RAISE EXCEPTION 'other wallet changed'; END IF;
 IF (SELECT count(*) FROM public.credit_transactions WHERE user_id='${userId}' AND request_id='pay_replay') <> 1 THEN RAISE EXCEPTION 'purchase ledger is not exactly once'; END IF;
 IF pg_catalog.has_function_privilege('authenticated','public.fulfill_razorpay_order(text,text,integer,text)','EXECUTE') THEN RAISE EXCEPTION 'browser can grant credits'; END IF;
 IF pg_catalog.has_table_privilege('anon','public.razorpay_orders','SELECT') THEN RAISE EXCEPTION 'anonymous payment record access'; END IF;
END $$;
DELETE FROM auth.users WHERE id='${userId}';
DO $$ BEGIN
 IF (SELECT user_id FROM public.razorpay_orders WHERE order_id='order_replay') IS NOT NULL THEN RAISE EXCEPTION 'financial record did not detach'; END IF;
END $$;
ROLLBACK;
`);
    psql(`
BEGIN;
INSERT INTO auth.users(id,email_confirmed_at) VALUES ('${userId}',pg_catalog.now());
INSERT INTO public.razorpay_orders(order_id,user_id,plan_id,credits,amount_minor,currency,mode,receipt)
VALUES ('order_refund','${userId}','starter',250,44900,'INR','test','receipt_refund');
SELECT public.fulfill_razorpay_order('order_refund','pay_refund',44900,'INR');
UPDATE public.profiles SET credits=credits-20 WHERE id='${userId}';
INSERT INTO public.credit_transactions(user_id,amount,type,feature,request_id,status)
VALUES ('${userId}',-20,'feature_usage','analyze','spent-before-refund','completed');
DO $$ DECLARE result json; balance integer; BEGIN
 result := public.record_razorpay_event('evt_capture','pay_refund','payment.captured','test','order_refund',repeat('a',64),'captured',44900,'INR',pg_catalog.now());
 IF result->>'success' <> 'true' OR result->>'duplicate' <> 'false' THEN RAISE EXCEPTION 'capture event was not recorded: %',result; END IF;
 result := public.record_razorpay_event('evt_capture','pay_refund','payment.captured','test','order_refund',repeat('a',64),'captured',44900,'INR',pg_catalog.now());
 IF result->>'duplicate' <> 'true' THEN RAISE EXCEPTION 'capture event replay was not idempotent: %',result; END IF;
 result := public.record_razorpay_event('evt_legacy','pay_refund','payment.captured','test','order_refund',repeat('a',64),'captured',44900,'INR',pg_catalog.now());
 IF result->>'duplicate' <> 'true' OR result->>'legacy' <> 'true' THEN RAISE EXCEPTION 'legacy capture event replay was not safely recognized: %',result; END IF;
 result := public.record_razorpay_reconciliation('evt_refund_partial','refund.processed','test','order_refund','pay_refund','rfnd_partial',repeat('b',64),'processed',44900,10000,10000,'INR',pg_catalog.now(),NULL,false);
 IF result->>'success' <> 'true' OR result->>'reviewRequired' <> 'true' OR result->>'refundStatus' <> 'partial' THEN RAISE EXCEPTION 'partial refund did not queue manual review: %',result; END IF;
 result := public.record_razorpay_reconciliation('evt_refund_partial','refund.processed','test','order_refund','pay_refund','rfnd_partial',repeat('b',64),'processed',44900,10000,10000,'INR',pg_catalog.now(),NULL,false);
 IF result->>'duplicate' <> 'true' THEN RAISE EXCEPTION 'refund event replay was not idempotent: %',result; END IF;
 result := public.record_razorpay_reconciliation('evt_refund_pending','refund.created','test','order_refund','pay_refund','rfnd_pending',repeat('f',64),'created',44900,1000,10000,'INR',pg_catalog.now(),NULL,false);
 IF result->>'refundStatus' <> 'pending' OR result->>'reviewRequired' <> 'true' THEN RAISE EXCEPTION 'pending refund state was not durably queued: %',result; END IF;
 result := public.record_razorpay_reconciliation('evt_refund_failed','refund.failed','test','order_refund','pay_refund','rfnd_failed',repeat('1',64),'failed',44900,1000,10000,'INR',pg_catalog.now(),NULL,false);
 IF result->>'refundStatus' <> 'failed' OR result->>'reviewRequired' <> 'true' THEN RAISE EXCEPTION 'failed refund state was not durably queued: %',result; END IF;
 SELECT credits INTO balance FROM public.profiles WHERE id='${userId}';
 IF balance <> 280 THEN RAISE EXCEPTION 'partial refund changed spent/free wallet credits: %',balance; END IF;
 result := public.record_razorpay_reconciliation('evt_refund_full','refund.processed','test','order_refund','pay_refund','rfnd_final',repeat('c',64),'processed',44900,34900,44900,'INR',pg_catalog.now(),NULL,false);
 IF result->>'lifecycleState' <> 'refunded' OR result->>'refundStatus' <> 'full' THEN RAISE EXCEPTION 'full refund state was not recorded: %',result; END IF;
 result := public.record_razorpay_reconciliation('evt_dispute','payment.dispute.under_review','test','order_refund','pay_refund','disp_review',repeat('d',64),'under_review',44900,44900,44900,'INR',pg_catalog.now(),'under_review',true);
 IF result->>'disputeStatus' <> 'under_review' OR result->>'lifecycleState' <> 'refunded' THEN RAISE EXCEPTION 'dispute state was not reconciled safely: %',result; END IF;
 BEGIN
   UPDATE public.razorpay_events SET payload_sha256=repeat('e',64) WHERE event_id='evt_dispute';
   RAISE EXCEPTION 'payment event evidence was mutable';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM = 'payment event evidence was mutable' THEN RAISE; END IF;
 END;
 SELECT credits INTO balance FROM public.profiles WHERE id='${userId}';
 IF balance <> 280 THEN RAISE EXCEPTION 'refund/dispute reconciliation changed the aggregate wallet: %',balance; END IF;
 IF (SELECT count(*) FROM public.credit_transactions WHERE user_id='${userId}' AND request_id='pay_refund') <> 1 THEN RAISE EXCEPTION 'purchase credit provenance was lost'; END IF;
 IF pg_catalog.has_function_privilege('authenticated','public.record_razorpay_event(text,text,text,text,text,text,text,integer,text,timestamp with time zone)','EXECUTE') THEN RAISE EXCEPTION 'browser can record provider events'; END IF;
 IF pg_catalog.has_function_privilege('authenticated','public.record_razorpay_reconciliation(text,text,text,text,text,text,text,text,integer,integer,integer,text,timestamp with time zone,text,boolean)','EXECUTE') THEN RAISE EXCEPTION 'browser can reconcile payments'; END IF;
 IF pg_catalog.has_table_privilege('anon','public.razorpay_events','SELECT') THEN RAISE EXCEPTION 'anonymous event access'; END IF;
END $$;
ROLLBACK;
`);
    // Race two service-role fulfillment transactions against the same order. The
    // first holds the row lock while the second waits; after commit the second must
    // observe the fulfilled row and return duplicate=true without granting again.
    psql(`
INSERT INTO auth.users(id,email_confirmed_at) VALUES ('44444444-4444-4444-8444-444444444444',pg_catalog.now());
INSERT INTO public.razorpay_orders(order_id,user_id,plan_id,credits,amount_minor,currency,mode)
VALUES ('order_concurrent','44444444-4444-4444-8444-444444444444','starter',250,44900,'INR','test');
`);
    const concurrentSqlPath = `/tmp/wingman-concurrent-${process.pid}.sql`;
    const concurrentOutputPath = `/tmp/wingman-concurrent-${process.pid}.out`;
    docker(['exec', '-i', container, 'sh', '-c', `cat > ${concurrentSqlPath}`], `
SET ROLE service_role;
BEGIN;
SELECT public.fulfill_razorpay_order('order_concurrent','pay_concurrent',44900,'INR');
SELECT pg_catalog.pg_sleep(2);
COMMIT;
RESET ROLE;
`);
    docker(['exec', '-d', container, 'sh', '-c', `psql -t -A -v ON_ERROR_STOP=1 -U postgres -d wingman_replay < ${concurrentSqlPath} > ${concurrentOutputPath} 2>&1`]);
    let firstTransactionHoldingLock = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (scalar("SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname='wingman_replay' AND state='active' AND query LIKE 'SELECT pg_catalog.pg_sleep(2)%';") === '1') {
            firstTransactionHoldingLock = true;
            break;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    assert.equal(firstTransactionHoldingLock, true, 'first concurrent payment transaction did not acquire its lock');
    const secondTransaction = psql("SET ROLE service_role; SELECT public.fulfill_razorpay_order('order_concurrent','pay_concurrent',44900,'INR'); RESET ROLE;");
    assert.match(secondTransaction, /"duplicate"\s*:\s*true/, 'second fulfillment must return as an idempotent duplicate');
    const firstTransaction = docker(['exec', container, 'cat', concurrentOutputPath]);
    assert.match(firstTransaction, /"duplicate"\s*:\s*false/, 'first fulfillment must be the only credit grant');
    assert.equal(scalar("SELECT credits FROM public.profiles WHERE id='44444444-4444-4444-8444-444444444444';"), '300', 'concurrent callbacks must grant the package exactly once');
    assert.equal(scalar("SELECT count(*) FROM public.credit_transactions WHERE user_id='44444444-4444-4444-8444-444444444444' AND request_id='pay_concurrent';"), '1', 'concurrent callbacks must retain one purchase provenance row');

    assert.equal(scalar("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='updated_at';"), '1');
    assert.equal(scalar("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='type';"), '1');
    console.log(`✔ Migration replay and recovery smoke passed (${migrations.length} tracked migrations, disposable Postgres only).`);
} finally {
    try { docker(['rm', '-f', container]); } catch (_) {}
}
