const fs = require('fs');

// Harden server helper: semantic RPC failure must never be interpreted as successful minting.
const serverPath = 'server.js';
let server = fs.readFileSync(serverPath, 'utf8');
const oldServer = `        if (!rpcErr && rpcRes) {
            const row = Array.isArray(rpcRes) ? rpcRes[0] : rpcRes;
            if (row && typeof row === 'object') {
                const rem = typeof row.new_balance === 'number' ? row.new_balance : (typeof row.remainingCredits === 'number' ? row.remainingCredits : addCredits);
                return rem / CREDITS_PER_INR;
            }
        }
    } catch (rpcEx) {
        console.warn('[addUserCreditsDB RPC notice]:', rpcEx.message);
    }

    // Fail closed: privileged credit minting may only succeed through the add_credits RPC.
    const mintErr = new Error('Credit minting service unavailable. No credits were added.');
    mintErr.statusCode = 503;
    throw mintErr;`;
const newServer = `        if (!rpcErr && rpcRes) {
            const row = Array.isArray(rpcRes) ? rpcRes[0] : rpcRes;
            if (row && typeof row === 'object') {
                if (row.success !== true) {
                    const rowCode = typeof row.error === 'string' ? row.error.trim() : '';
                    const rowMessage = typeof row.error_message === 'string' ? row.error_message.trim() : '';
                    if (rowCode === 'PROFILE_MISSING' || rowMessage === 'PROFILE_MISSING') {
                        const profileErr = new Error('PROFILE_MISSING');
                        profileErr.code = 'PROFILE_MISSING';
                        profileErr.statusCode = 404;
                        throw profileErr;
                    }
                    const rejected = new Error(rowMessage || 'Credit minting request was rejected. No credits were added.');
                    rejected.statusCode = 503;
                    throw rejected;
                }
                const rem = typeof row.new_balance === 'number' ? row.new_balance : (typeof row.remainingCredits === 'number' ? row.remainingCredits : null);
                if (typeof rem !== 'number') {
                    const malformed = new Error('Credit minting service returned an invalid balance. No success was accepted.');
                    malformed.statusCode = 503;
                    throw malformed;
                }
                return rem / CREDITS_PER_INR;
            }
        }
    } catch (rpcEx) {
        if (rpcEx && (rpcEx.code === 'PROFILE_MISSING' || rpcEx.statusCode === 404)) throw rpcEx;
        console.warn('[addUserCreditsDB RPC notice]:', rpcEx.message);
    }

    // Fail closed: privileged credit minting may only succeed through a semantically successful add_credits RPC.
    const mintErr = new Error('Credit minting service unavailable. No credits were added.');
    mintErr.statusCode = 503;
    throw mintErr;`;
if (!server.includes(oldServer)) throw new Error('Expected addUserCreditsDB response block not found');
server = server.replace(oldServer, newServer);
fs.writeFileSync(serverPath, server);

// New forward-only migration: never rewrite historical migrations already applied in production.
const migration = `-- ============================================================================
-- MIGRATION 007: HARDEN PRIVILEGED CREDIT TOP-UP AGAINST MISSING PROFILES
-- Missing profiles remain explicit. This RPC never provisions or repairs user profiles.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.add_credits(
    p_user_id pg_catalog.uuid,
    p_amount pg_catalog.int4,
    p_tier pg_catalog.text DEFAULT 'starter',
    p_payment_id pg_catalog.text DEFAULT NULL,
    p_order_id pg_catalog.text DEFAULT NULL,
    p_amount_inr pg_catalog.numeric DEFAULT 0,
    p_signature pg_catalog.text DEFAULT NULL
)
RETURNS pg_catalog.json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_current_credits pg_catalog.int4;
    v_new_credits pg_catalog.int4;
    v_tx_req_id pg_catalog.text;
    v_clean_tier pg_catalog.text;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid user ID.');
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000 THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid credit amount.');
    END IF;

    v_clean_tier := pg_catalog.btrim(COALESCE(p_tier, 'purchase'));
    IF v_clean_tier = '' OR pg_catalog.length(v_clean_tier) > 64 THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid credit tier.');
    END IF;

    v_tx_req_id := pg_catalog.btrim(COALESCE(p_payment_id, p_order_id, ''));
    IF v_tx_req_id = '' THEN
        v_tx_req_id := 'purchase_' || pg_catalog.gen_random_uuid()::pg_catalog.text;
    ELSIF pg_catalog.length(v_tx_req_id) > 128 THEN
        RETURN pg_catalog.json_build_object('success', false, 'error_message', 'Invalid payment request ID.');
    END IF;

    -- Lock existing profile. Missing profile is an explicit invariant violation: do not create it.
    SELECT credits INTO v_current_credits
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.json_build_object(
            'success', false,
            'error', 'PROFILE_MISSING',
            'error_message', 'PROFILE_MISSING',
            'currentCredits', 0,
            'new_balance', 0
        );
    END IF;

    -- Idempotent payment/request replay: do not mint twice for an existing request ID.
    IF EXISTS (
        SELECT 1 FROM public.credit_transactions
        WHERE user_id = p_user_id AND request_id = v_tx_req_id
    ) THEN
        RETURN pg_catalog.json_build_object(
            'success', true,
            'remainingCredits', v_current_credits,
            'new_balance', v_current_credits,
            'duplicate', true
        );
    END IF;

    v_new_credits := v_current_credits + p_amount;
    UPDATE public.profiles
    SET credits = v_new_credits, updated_at = pg_catalog.now()
    WHERE id = p_user_id;

    INSERT INTO public.credit_transactions (id, user_id, amount, type, feature, request_id, status, created_at)
    VALUES (
        pg_catalog.gen_random_uuid(),
        p_user_id,
        p_amount,
        'purchase',
        v_clean_tier,
        v_tx_req_id,
        'completed',
        pg_catalog.now()
    );

    RETURN pg_catalog.json_build_object(
        'success', true,
        'remainingCredits', v_new_credits,
        'new_balance', v_new_credits,
        'duplicate', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.add_credits(pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.numeric, pg_catalog.text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_credits(pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.numeric, pg_catalog.text) TO service_role, postgres;

COMMIT;
`;
fs.writeFileSync('migrations/007_harden_add_credits_profile_missing.sql', migration);

const test = `const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '007_harden_add_credits_profile_missing.sql'), 'utf8');

const helperStart = server.indexOf('async function addUserCreditsDB');
const helperEnd = server.indexOf('function sanitizeResponseText', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'addUserCreditsDB helper must exist');
const helper = server.slice(helperStart, helperEnd);
assert.ok(helper.includes('if (row.success !== true)'), 'server must reject semantic add_credits failures');
assert.ok(helper.includes("rowCode === 'PROFILE_MISSING'"), 'server must preserve PROFILE_MISSING from top-up RPC');
assert.ok(helper.includes("typeof row.new_balance === 'number'"), 'server must require an authoritative numeric minted balance');
assert.ok(!helper.includes(': addCredits);'), 'server must not invent a successful balance when RPC omits one');

assert.ok(migration.includes('IF NOT FOUND THEN'), 'add_credits must fail when the profile row is missing');
assert.ok(migration.includes("'error', 'PROFILE_MISSING'"), 'migration must return explicit PROFILE_MISSING');
const missingBlockStart = migration.indexOf('IF NOT FOUND THEN');
const missingBlockEnd = migration.indexOf('END IF;', missingBlockStart);
const missingBlock = migration.slice(missingBlockStart, missingBlockEnd);
assert.ok(!missingBlock.includes('INSERT INTO public.profiles'), 'missing-profile branch must never auto-create a profile');
assert.ok(migration.includes("'duplicate', true"), 'payment request IDs must be idempotent');
assert.ok(migration.includes('FROM PUBLIC, anon, authenticated'), 'client roles must remain revoked from add_credits');
assert.ok(migration.includes('TO service_role, postgres'), 'add_credits must remain backend-only');

console.log('✔ Privileged add_credits missing-profile and semantic-success invariant passed.');
`;
fs.writeFileSync('tests/add_credits_profile_missing.test.js', test);

let runner = fs.readFileSync('tests/run_all_tests.js', 'utf8');
const anchor = `    { name: '29. Runtime Startup, CSP & Production-Origin Example Guard', file: 'runtime_startup_csp_hardening.test.js' }\n`;
if (!runner.includes(anchor)) throw new Error('Suite 29 anchor not found');
runner = runner.replace(anchor, `    { name: '29. Runtime Startup, CSP & Production-Origin Example Guard', file: 'runtime_startup_csp_hardening.test.js' },\n    { name: '30. Privileged Add-Credits Missing-Profile Guard', file: 'add_credits_profile_missing.test.js' }\n`);
fs.writeFileSync('tests/run_all_tests.js', runner);

console.log('add_credits missing-profile hardening patch applied.');
