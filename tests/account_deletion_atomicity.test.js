const assert = require('assert');
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
