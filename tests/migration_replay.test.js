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
    '001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '010', '011', '012'
], 'tracked migration order must remain explicit and stable');

const container = `wingman-migration-replay-${process.pid}`;
const bootstrap = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
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
            ready = true;
            break;
        } catch (_) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
        }
    }
    assert.equal(ready, true, 'disposable Postgres did not become ready');
    psql(bootstrap);

    for (const name of migrations) {
        psql(fs.readFileSync(path.join(migrationDir, name), 'utf8'));
    }

    const userId = '11111111-1111-4111-8111-111111111111';
    const otherId = '22222222-2222-4222-8222-222222222222';
    const smoke = `
BEGIN;
INSERT INTO auth.users(id) VALUES ('${userId}'), ('${otherId}');
DO $$ BEGIN
  IF (SELECT credits FROM public.profiles WHERE id = '${userId}') <> 50 THEN RAISE EXCEPTION 'signup must grant exactly 50 credits'; END IF;
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
  IF result->>'already_settled_or_released' <> 'true' OR (result->>'remainingCredits')::int <> 40 THEN RAISE EXCEPTION 'release replay was not idempotent: %', result; END IF;
  result := public.reserve_credits('${userId}', 1000, 'analyzer', 'replay-insufficient');
  IF result->>'error' <> 'INSUFFICIENT_CREDITS' THEN RAISE EXCEPTION 'insufficient balance was not rejected: %', result; END IF;
  result := public.record_user_consent('terms-v1', 'privacy-v1', true, true, NULL, NULL, '${userId}');
  IF result->>'success' <> 'true' OR result->>'user_id' <> '${userId}' THEN RAISE EXCEPTION 'consent flow failed: %', result; END IF;
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
    assert.equal(scalar("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='updated_at';"), '1');
    assert.equal(scalar("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='type';"), '1');
    console.log(`✔ Migration replay and recovery smoke passed (${migrations.length} tracked migrations, disposable Postgres only).`);
} finally {
    try { docker(['rm', '-f', container]); } catch (_) {}
}
