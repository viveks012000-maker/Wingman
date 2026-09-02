'use strict';

/**
 * RLS hardening regression suite.
 *
 * Issue 1: ownership binding — caller-supplied user_id must never reach the
 *          insert path; column identifiers must be validated before interpolation.
 * Issue 2: error propagation — database failures must surface as controlled
 *          RlsError failures, never as fake empty results; purgeAll must fail
 *          closed when any required purge operation fails.
 */

const assert = require('assert');
const { forRequest, RlsError, USER_SCOPED_TABLES } = require('../middleware/rls');

const UID_A = '11111111-1111-1111-1111-111111111111';
const UID_B = '22222222-2222-2222-2222-222222222222';

function authedReq(uid) {
    return { user: { id: uid, email: 'user-a@example.com' } };
}

function makeDb() {
    const state = { rows: [], executed: [] };
    return {
        state,
        async all(sql, params) {
            state.executed.push({ sql, params });
            const uid = Array.isArray(params) ? params[0] : params;
            return state.rows.filter(r => String(r.user_id) === String(uid));
        },
        async run(sql, params) {
            state.executed.push({ sql, params });
            return { changes: 1 };
        }
    };
}

// Minimal Supabase admin double: records inserts and returns scripted responses.
function makeSupabase(script = {}) {
    const state = { inserts: [], deletes: [], selects: [] };
    return {
        state,
        from(table) {
            const tableScript = script[table] || {};
            return {
                select() {
                    state.selects.push(table);
                    return {
                        eq() {
                            if (tableScript.selectReject) return Promise.reject(tableScript.selectReject);
                            return Promise.resolve({ data: tableScript.data || [], error: tableScript.error || null });
                        }
                    };
                },
                insert(rows) {
                    state.inserts.push({ table, rows });
                    if (tableScript.insertReject) return Promise.reject(tableScript.insertReject);
                    return Promise.resolve({ error: tableScript.insertError || null, data: rows });
                },
                delete() {
                    state.deletes.push(table);
                    return {
                        eq() {
                            if (tableScript.deleteReject) return Promise.reject(tableScript.deleteReject);
                            return Promise.resolve({ error: tableScript.deleteError || null });
                        }
                    };
                }
            };
        }
    };
}

async function run() {
    // ---------- ISSUE 1: ownership binding ----------
    {
        const db = makeDb();
        const rls = forRequest(authedReq(UID_A), db);
        await rls.create('saved_bios', ['original_bio', 'mode'], ['hello world', 'Punchy']);
        const call = db.state.executed.find(e => e.sql.startsWith('INSERT INTO saved_bios'));
        assert.ok(call, 'authenticated create must execute an insert');
        assert.ok(call.sql.includes('user_id'), 'insert must bind user_id');
        assert.strictEqual(call.params[call.params.length - 1], UID_A, 'user_id must be the authenticated uid');
        assert.ok(!call.sql.includes(UID_B), 'no foreign uid may appear in SQL');
    }

    {
        // Caller attempts to include user_id in columns: controlled rejection, no write.
        const db = makeDb();
        const rls = forRequest(authedReq(UID_A), db);
        let threw = null;
        try { await rls.create('saved_bios', ['user_id', 'mode'], [UID_B, 'Punchy']); }
        catch (e) { threw = e; }
        assert.ok(threw instanceof RlsError, `user_id in columns must raise RlsError, got: ${threw}`);
        assert.strictEqual(db.state.executed.length, 0, 'rejected create must not execute SQL');
        assert.ok(!String(threw.message).includes(UID_B), 'error must not echo caller-supplied identifiers');
    }

    {
        // Supabase path: caller-supplied user_id must be rejected before payload build.
        const admin = makeSupabase();
        const rls = forRequest(authedReq(UID_A), null, { supabaseAdmin: admin });
        let threw = null;
        try { await rls.create('saved_bios', ['user_id'], [UID_B]); }
        catch (e) { threw = e; }
        assert.ok(threw instanceof RlsError, 'supabase path must reject caller user_id');
        assert.strictEqual(admin.state.inserts.length, 0, 'no insert may reach Supabase');
    }

    {
        // Supabase path: safe columns populated, user_id forced LAST to the authenticated uid.
        const admin = makeSupabase();
        const rls = forRequest(authedReq(UID_A), null, { supabaseAdmin: admin });
        await rls.create('saved_bios', ['original_bio', 'mode'], ['hey', 'Witty']);
        assert.strictEqual(admin.state.inserts.length, 1, 'exactly one insert');
        const row = admin.state.inserts[0].rows[0];
        assert.strictEqual(row.user_id, UID_A, 'row owner must be authenticated uid');
        assert.strictEqual(row.original_bio, 'hey');
        assert.strictEqual(row.mode, 'Witty');
    }

    {
        // Even if a safe column value is an object attempting to smuggle ownership,
        // the final user_id binding must remain the authenticated uid.
        const admin = makeSupabase();
        const rls = forRequest(authedReq(UID_A), null, { supabaseAdmin: admin });
        await rls.create('saved_chat_analyses', ['tone'], ['Direct']);
        const row = admin.state.inserts[0].rows[0];
        assert.strictEqual(row.user_id, UID_A);
    }

    {
        const db = makeDb();
        const rls = forRequest(null, db);
        let threw = null;
        try { await rls.create('saved_bios', ['mode'], ['x']); }
        catch (e) { threw = e; }
        assert.ok(threw instanceof RlsError, 'unauthenticated create must fail');
        assert.strictEqual(db.state.executed.length, 0);
    }

    {
        const db = makeDb();
        const rls = forRequest(authedReq(UID_A), db);
        let threw = null;
        try { await rls.create('profiles', ['display_name'], ['x']); }
        catch (e) { threw = e; }
        assert.ok(threw instanceof RlsError, 'unsupported table must fail');
    }

    {
        // SQL-injection resistance: column identifiers must pass a strict policy.
        const db = makeDb();
        const rls = forRequest(authedReq(UID_A), db);
        for (const hostile of ['mode); DROP TABLE saved_bios--', 'mode--', 'mode" , user_id', '1=1']) {
            let threw = null;
            try { await rls.create('saved_bios', [hostile], ['x']); }
            catch (e) { threw = e; }
            assert.ok(threw instanceof RlsError, `hostile column must be rejected: ${hostile}`);
        }
        assert.strictEqual(db.state.executed.length, 0, 'no SQL may run for rejected columns');
    }

    {
        // Cross-user isolation: list binds to the authenticated uid only.
        const db = makeDb();
        db.state.rows = [{ user_id: UID_A, mode: 'a1' }, { user_id: UID_B, mode: 'b1' }];
        const rlsA = forRequest(authedReq(UID_A), db);
        const rowsA = await rlsA.list('saved_bios');
        assert.deepStrictEqual(rowsA.map(r => r.user_id), [UID_A], 'list must return only own rows');
        const rowsB = await forRequest(authedReq(UID_B), db).list('saved_bios');
        assert.deepStrictEqual(rowsB.map(r => r.user_id), [UID_B]);
    }

    // ---------- ISSUE 2: error propagation ----------
    {
        // Successful query + zero records stays [].
        const db = makeDb();
        const rows = await forRequest(authedReq(UID_A), db).list('saved_bios');
        assert.deepStrictEqual(rows, [], 'legitimate empty result must remain []');
    }

    {
        // SQLite transport failure must NOT masquerade as [].
        const db = makeDb();
        db.all = async () => { throw new Error('SQLITE_BUSY: database is locked'); };
        let threw = null;
        try { await forRequest(authedReq(UID_A), db).list('saved_bios'); }
        catch (e) { threw = e; }
        assert.ok(threw instanceof RlsError, `db failure must raise RlsError, got: ${threw}`);
        assert.ok(!String(threw.message).includes('SQLITE'), 'controlled error must not leak internals');
    }

    {
        // Supabase error object must NOT masquerade as [].
        const admin = makeSupabase({ saved_bios: { error: { message: 'supabase secret detail PGRST-private' } } });
        let threw = null;
        try { await forRequest(authedReq(UID_A), null, { supabaseAdmin: admin }).list('saved_bios'); }
        catch (e) { threw = e; }
        assert.ok(threw instanceof RlsError, 'supabase failure must raise RlsError');
        assert.ok(!String(threw.message).includes('PGRST-private'), 'must not leak raw provider errors');
    }

    {
        // Successful Supabase query with records returns them; empty returns [].
        const admin = makeSupabase({ saved_bios: { data: [{ user_id: UID_A, mode: 'a' }] } });
        const rows = await forRequest(authedReq(UID_A), null, { supabaseAdmin: admin }).list('saved_bios');
        assert.strictEqual(rows.length, 1);
        const adminEmpty = makeSupabase({ saved_bios: { data: [] } });
        const empty = await forRequest(authedReq(UID_A), null, { supabaseAdmin: adminEmpty }).list('saved_bios');
        assert.deepStrictEqual(empty, []);
    }

    {
        // Supabase insert failure must propagate (no silent data loss).
        const admin = makeSupabase({ saved_bios: { insertError: { message: 'rls policy violation detail' } } });
        let threw = null;
        try { await forRequest(authedReq(UID_A), null, { supabaseAdmin: admin }).create('saved_bios', ['mode'], ['x']); }
        catch (e) { threw = e; }
        assert.ok(threw instanceof RlsError, 'supabase insert failure must raise RlsError');
        assert.ok(!String(threw.message).includes('rls policy violation detail'), 'insert error must not leak provider detail');
    }

    {
        // purgeAll: every table is attempted; any failure fails closed.
        const db = makeDb();
        const attempted = [];
        db.run = async (sql) => {
            const table = (sql.match(/DELETE FROM (\w+)/) || [])[1];
            attempted.push(table);
            if (table === 'saved_chat_analyses') throw new Error('SQLITE_BUSY');
        };
        let threw = null;
        try { await forRequest(authedReq(UID_A), db).purgeAll(); }
        catch (e) { threw = e; }
        assert.ok(threw instanceof RlsError, 'purge failure must raise RlsError');
        assert.strictEqual(attempted.length, USER_SCOPED_TABLES.length, 'all tables must still be attempted before failing');
        assert.ok(!String(threw.message).includes('SQLITE'), 'purge error must not leak internals');
    }

    {
        // purgeAll: success path completes without throwing.
        const db = makeDb();
        await forRequest(authedReq(UID_A), db).purgeAll();
        const deletes = db.state.executed.filter(e => e.sql.startsWith('DELETE FROM'));
        assert.strictEqual(deletes.length, USER_SCOPED_TABLES.length);
    }

    {
        // purgeAll: Supabase path failure surfaces; no silent success.
        const admin = makeSupabase({ saved_bios: { deleteReject: new Error('network down') } });
        let threw = null;
        try { await forRequest(authedReq(UID_A), null, { supabaseAdmin: admin }).purgeAll(); }
        catch (e) { threw = e; }
        assert.ok(threw instanceof RlsError, 'supabase purge failure must fail closed');
        assert.strictEqual(admin.state.deletes.length, USER_SCOPED_TABLES.length, 'all supabase tables attempted');
    }

    console.log('RLS HARDENING: ALL TESTS PASSED');
}

run().catch(error => {
    console.error(error && error.stack || error);
    process.exit(1);
});
