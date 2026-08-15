const fs = require('fs');

const serverPath = 'server.js';
let server = fs.readFileSync(serverPath, 'utf8');
const routeStart = server.indexOf("app.post('/api/user/delete-account'");
const routeEnd = server.indexOf('// PUBLIC ENDPOINT FOR SUPABASE AUTHENTICATION CONFIGURATION', routeStart);
if (routeStart < 0 || routeEnd < 0) throw new Error('delete-account route not found');

const replacement = `app.post('/api/user/delete-account', requireSupabaseAuth, apiLimiter, async (req, res) => {
    try {
        const uid = getUserIdFromReq(req);
        if (!uid || uid === 'guest_user') {
            return res.status(401).json({ success: false, error: 'Unauthorized: valid authentication token required.' });
        }

        if (!supabaseAdmin || !supabaseAdmin.auth || !supabaseAdmin.auth.admin || typeof supabaseAdmin.auth.admin.deleteUser !== 'function') {
            return res.status(500).json({ success: false, error: 'Server authentication admin service is unavailable.' });
        }

        const isMissingOptionalTableError = (err) => {
            const code = err && err.code ? String(err.code) : '';
            return code === '42P01' || code === 'PGRST116' || code === 'PGRST205';
        };

        // 1. Purge optional user-created content before deleting the Auth identity. These tables
        // are not part of the core FK cascade and may not exist in every deployment.
        for (const table of ['saved_bios', 'saved_chat_analyses', 'saved_chat_histories']) {
            try {
                const { error: tblErr } = await supabaseAdmin.from(table).delete().eq('user_id', uid);
                if (tblErr && !isMissingOptionalTableError(tblErr)) {
                    console.error(\`[delete-account \${table} error]:\`, tblErr.message);
                    return res.status(500).json({ success: false, error: 'Failed to purge saved account content.' });
                }
            } catch (e) {
                return res.status(500).json({ success: false, error: 'Failed to purge saved account content.' });
            }
        }

        // 2. In local development, purge auxiliary SQLite state before the irreversible Auth
        // deletion. A local cleanup failure must not leave an already-deleted Auth identity.
        if (db) {
            try {
                const rls = forRequest(req, db);
                await rls.purgeAll();
                await db.run('DELETE FROM users_auth WHERE id = ?', uid);
            } catch (localErr) {
                console.error('[delete-account local database error]:', localErr.message);
                return res.status(500).json({ success: false, error: 'Failed to purge local account data.' });
            }
        }

        // 3. Delete the Supabase Auth identity as the authoritative commit point. Core Postgres
        // data is protected by ON DELETE CASCADE foreign keys:
        // auth.users -> profiles -> credit_transactions, and auth.users -> user_consents.
        // We deliberately do NOT pre-delete profiles or the credit ledger. If Auth deletion fails,
        // the user's core account state therefore remains intact instead of becoming corrupted.
        const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(uid);
        if (authDelErr) {
            console.error('[delete-account Auth delete error]:', authDelErr.message);
            return res.status(500).json({ success: false, error: 'Failed to delete authentication account: ' + authDelErr.message });
        }

        res.json({ success: true, message: "Account data and authentication profile permanently purged." });
    } catch (err) {
        console.error("Delete Account Error:", err);
        res.status(500).json({ success: false, error: "Internal server error during account deletion." });
    }
});

`;
server = server.slice(0, routeStart) + replacement + server.slice(routeEnd);
fs.writeFileSync(serverPath, server);

// Update the legacy second-pass assertion so it verifies cascade-based deletion instead of
// requiring the now-dangerous pre-delete of profiles.
const secondPath = 'tests/second_pass_verification.test.js';
let second = fs.readFileSync(secondPath, 'utf8');
second = second.replace(
  `assert.strictEqual(serverFile.includes("await supabaseAdmin.from('profiles').delete().eq('id', uid);"), true, 'delete-account must purge profiles');\nassert.strictEqual(serverFile.includes("await supabaseAdmin.auth.admin.deleteUser(uid);"), true, 'delete-account must purge Supabase Auth user identity');`,
  `assert.strictEqual(serverFile.includes("await supabaseAdmin.from('profiles').delete().eq('id', uid);"), false, 'delete-account must not pre-delete profiles before Auth deletion');\nassert.strictEqual(serverFile.includes("await supabaseAdmin.auth.admin.deleteUser(uid);"), true, 'delete-account must purge Supabase Auth user identity');`
);
fs.writeFileSync(secondPath, second);

const testPath = 'tests/account_deletion_atomicity.test.js';
fs.writeFileSync(testPath, `const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const migration001 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_initial_schema_and_rpc.sql'), 'utf8');
const migration005 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '005_user_consent_and_age_verification.sql'), 'utf8');
const start = server.indexOf("app.post('/api/user/delete-account'");
const end = server.indexOf('// PUBLIC ENDPOINT FOR SUPABASE AUTHENTICATION CONFIGURATION', start);
assert.ok(start >= 0 && end > start, 'delete-account route must exist');
const route = server.slice(start, end);

const authDelete = "supabaseAdmin.auth.admin.deleteUser(uid)";
assert.ok(route.includes(authDelete), 'Auth identity deletion must remain the authoritative deletion operation');
assert.ok(!route.includes("from('credit_transactions').delete()"), 'Credit ledger must not be pre-deleted before Auth deletion');
assert.ok(!route.includes("from('profiles').delete()"), 'Profile must not be pre-deleted before Auth deletion');
assert.ok(route.includes("code === 'PGRST205'"), 'Missing optional PostgREST tables must be treated as absent, not fatal');
assert.ok(route.includes("Failed to purge saved account content."), 'Actual optional-content deletion errors must fail closed before Auth deletion');
assert.ok(route.includes("Failed to purge local account data."), 'Local auxiliary cleanup must fail closed before Auth deletion');
assert.ok(route.indexOf('rls.purgeAll()') < route.indexOf(authDelete), 'Local cleanup must occur before irreversible Auth deletion');
assert.ok(route.indexOf("saved_bios") < route.indexOf(authDelete), 'Optional saved-content cleanup must occur before Auth deletion');
assert.ok(route.includes("if (authDelErr)"), 'Auth deletion failure must be checked');

assert.ok(migration001.includes('id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE'), 'profiles must cascade from auth.users');
assert.ok(migration001.includes('REFERENCES public.profiles(id) ON DELETE CASCADE'), 'credit transactions must cascade from profiles');
assert.ok(migration005.includes('user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE'), 'consent rows must cascade from auth.users');

console.log('✔ Account deletion atomicity and FK-cascade regression guard passed.');
`);

const runnerPath = 'tests/run_all_tests.js';
let runner = fs.readFileSync(runnerPath, 'utf8');
if (!runner.includes('account_deletion_atomicity.test.js')) {
  const anchor = "    { name: '27. Production CORS Least-Privilege Guard', file: 'cors_production_policy.test.js' }\n";
  if (!runner.includes(anchor)) throw new Error('Test runner anchor missing');
  runner = runner.replace(anchor,
    "    { name: '27. Production CORS Least-Privilege Guard', file: 'cors_production_policy.test.js' },\n" +
    "    { name: '28. Account Deletion Atomicity & Cascade Guard', file: 'account_deletion_atomicity.test.js' }\n");
}
fs.writeFileSync(runnerPath, runner);

console.log('Account deletion route and regression tests patched.');
