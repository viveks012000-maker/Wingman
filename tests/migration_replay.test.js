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
    '001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '010', '011', '012', '013', '014', '015'
], 'tracked migration order must remain explicit and stable');

const container = `wingman-migration-replay-${process.pid}`;
const bootstrap = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
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
    docker(['run', '--rm', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=wingman_replay', 'postgres:16-alpine']);
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
            // Reproduce the exact legacy defect immediately before the repair:
            // the old auth.users INSERT trigger creates profiles before email verification.
            psql(`
                INSERT INTO auth.users(id, email_confirmed_at) VALUES
                    ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', NULL),
                    ('ffffffff-ffff-4fff-8fff-ffffffffffff', NULL),
                    ('99999999-9999-4999-8999-999999999999', NULL);
                INSERT INTO public.credit_transactions(user_id, amount, type, feature, request_id, status)
                VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff', 1, 'purchase', 'fixture', 'tx_pending_history', 'completed');
                UPDATE public.profiles
                SET has_paid_credits = true
                WHERE id = '99999999-9999-4999-8999-999999999999';
            `);
        }
        psql(fs.readFileSync(path.join(migrationDir, name), 'utf8'));
    }

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
  IF (SELECT credits FROM public.profiles WHERE id = '${userId}') <> 20 THEN RAISE EXCEPTION 'verified signup must grant exactly 20 credits'; END IF;
  IF (SELECT has_paid_credits FROM public.profiles WHERE id = '${userId}') <> false THEN RAISE EXCEPTION 'verified signup must be on Free Plan'; END IF;
END $$;

-- Subsequent updates cannot re-award signup credits.
UPDATE auth.users SET email_confirmed_at = email_confirmed_at WHERE id = '${userId}';
DO $$ BEGIN
  IF (SELECT credits FROM public.profiles WHERE id = '${userId}') <> 20 THEN RAISE EXCEPTION 'confirmation replay changed signup credits'; END IF;
END $$;

-- OAuth-like users that are already confirmed at INSERT still provision immediately.
INSERT INTO auth.users(id, email_confirmed_at) VALUES ('${otherId}', pg_catalog.now());
DO $$ BEGIN
  IF (SELECT credits FROM public.profiles WHERE id = '${otherId}') <> 20 THEN RAISE EXCEPTION 'confirmed-at-insert user must receive exactly 20 credits'; END IF;
  IF (SELECT has_paid_credits FROM public.profiles WHERE id = '${otherId}') <> false THEN RAISE EXCEPTION 'confirmed-at-insert user must be on Free Plan'; END IF;
END $$;

SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$ DECLARE result json; BEGIN
  result := public.reserve_credits('${userId}', 10, 'analyzer', 'replay-1');
  IF result->>'success' <> 'true' OR (result->>'remainingCredits')::int <> 10 THEN RAISE EXCEPTION 'reservation failed: %', result; END IF;
  result := public.reserve_credits('${userId}', 10, 'analyzer', 'replay-1');
  IF result->>'duplicate' <> 'true' OR (result->>'remainingCredits')::int <> 10 THEN RAISE EXCEPTION 'reservation was not idempotent: %', result; END IF;
  result := public.settle_credits('${userId}', 'replay-1');
  IF result->>'success' <> 'true' THEN RAISE EXCEPTION 'settlement failed: %', result; END IF;
  result := public.settle_credits('${userId}', 'replay-1');
  IF result->>'success' <> 'true' THEN RAISE EXCEPTION 'settlement replay failed: %', result; END IF;
  result := public.reserve_credits('${userId}', 10, 'analyzer', 'replay-2');
  IF result->>'success' <> 'true' OR (result->>'remainingCredits')::int <> 0 THEN RAISE EXCEPTION 'second reservation failed: %', result; END IF;
  result := public.release_credits('${userId}', 'replay-2', 'test');
  IF result->>'released' <> 'true' OR (result->>'remainingCredits')::int <> 10 THEN RAISE EXCEPTION 'release failed: %', result; END IF;
  result := public.release_credits('${userId}', 'replay-2', 'test');
  IF result->>'already_settled_or_released' <> 'true' OR (result->>'remainingCredits')::int <> 10 THEN RAISE EXCEPTION 'release replay was not idempotent: %', result; END IF;
  result := public.reserve_credits('${userId}', 1000, 'analyzer', 'replay-insufficient');
  IF result->>'error' <> 'INSUFFICIENT_CREDITS' THEN RAISE EXCEPTION 'insufficient balance was not rejected: %', result; END IF;
  result := public.record_user_consent('terms-v1', 'privacy-v1', true, true, NULL, NULL, '${userId}');
  IF result->>'success' <> 'true' OR result->>'user_id' <> '${userId}' THEN RAISE EXCEPTION 'consent flow failed: %', result; END IF;
END $$;
DO $$ BEGIN
  IF (SELECT credits FROM public.profiles WHERE id = '${userId}') <> 10 THEN RAISE EXCEPTION 'balance invariant failed'; END IF;
END $$;
DELETE FROM auth.users WHERE id = '${userId}';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = '${userId}') THEN RAISE EXCEPTION 'auth cascade did not remove profile'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '${otherId}') THEN RAISE EXCEPTION 'cascade removed unrelated account'; END IF;
END $$;
ROLLBACK;
`;
    psql(smoke);
    assert.equal(scalar("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='updated_at';"), '1');
    assert.equal(scalar("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='type';"), '1');
    console.log(`✔ Migration replay and recovery smoke passed (${migrations.length} tracked migrations, disposable Postgres only).`);
} finally {
    try { docker(['rm', '-f', container]); } catch (_) {}
}
