const fs = require('fs');

// server.js: remove unsafe-eval and make imports side-effect free.
let server = fs.readFileSync('server.js', 'utf8');
const oldEval = `scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://*.supabase.co"],`;
const newEval = `scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://*.supabase.co"],`;
if (!server.includes(oldEval)) throw new Error('Expected Helmet unsafe-eval directive not found');
server = server.replace(oldEval, newEval);

const oldStart = `        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(\`🚀 Secure Wingman 3-Tier Backend Online on port \${PORT} (Supabase Postgres Active)\`);
        });
        server.keepAliveTimeout = 120000;
        server.headersTimeout = 125000;
        module.exports = { app, server, db, supabaseAdmin };
    } catch (err) {
        console.error("Fatal Server Startup Error:", err);
        process.exit(1);
    }
}

startWingmanServer();`;

const newStart = `        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(\`🚀 Secure Wingman 3-Tier Backend Online on port \${PORT} (Supabase Postgres Active)\`);
        });
        server.keepAliveTimeout = 120000;
        server.headersTimeout = 125000;
        return server;
    } catch (err) {
        console.error("Fatal Server Startup Error:", err);
        throw err;
    }
}

// Importing the application must not open a network listener. Runtime entry points call
// startWingmanServer explicitly; tests and tooling can safely import the Express app.
module.exports = { app, startWingmanServer, supabaseAdmin };

if (require.main === module) {
    startWingmanServer().catch(() => process.exit(1));
}`;
if (!server.includes(oldStart)) throw new Error('Expected server startup/export block not found');
server = server.replace(oldStart, newStart);
fs.writeFileSync('server.js', server);

// Netlify CSP: public runtime has no eval/new Function usage, so unsafe-eval is unnecessary.
let build = fs.readFileSync('scripts/build-netlify-dist.js', 'utf8');
const oldCsp = `"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.supabase.co",`;
const newCsp = `"script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.supabase.co",`;
if (!build.includes(oldCsp)) throw new Error('Expected Netlify unsafe-eval directive not found');
build = build.replace(oldCsp, newCsp);
fs.writeFileSync('scripts/build-netlify-dist.js', build);

const test = `const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const buildSource = fs.readFileSync(path.join(root, 'scripts', 'build-netlify-dist.js'), 'utf8');

assert.ok(serverSource.includes('if (require.main === module) {'), 'server must only bind when executed as entry point');
assert.ok(!serverSource.includes('\\nstartWingmanServer();'), 'server import must not unconditionally start a listener');
assert.ok(serverSource.includes('module.exports = { app, startWingmanServer, supabaseAdmin };'), 'server must export app and explicit starter');
assert.ok(!serverSource.includes("'unsafe-eval'"), 'Helmet CSP must not allow unsafe-eval');
assert.ok(!buildSource.includes("'unsafe-eval'"), 'Netlify CSP must not allow unsafe-eval');

const output = execFileSync(process.execPath, ['-e', "require('./server'); process.stdout.write('IMPORT_OK')"], {
  cwd: root,
  encoding: 'utf8',
  timeout: 2500,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    AICREDITS_API_KEY: 'test_key',
    AICREDITS_API_KEY_VISION: 'test_vision_key',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'test_anon',
    SUPABASE_SERVICE_ROLE_KEY: 'test_service_role'
  }
});
assert.ok(output.endsWith('IMPORT_OK'), 'requiring server.js must return promptly after import');
assert.ok(!output.includes('Secure Wingman 3-Tier Backend Online'), 'requiring server.js must not open a listener');
console.log('✔ Runtime startup side-effect and CSP unsafe-eval hardening passed.');
`;
fs.writeFileSync('tests/runtime_startup_csp_hardening.test.js', test);

let runner = fs.readFileSync('tests/run_all_tests.js', 'utf8');
const anchor = `    { name: '27. Production CORS Least-Privilege Guard', file: 'cors_production_policy.test.js' }\n`;
if (!runner.includes(anchor)) throw new Error('Suite 27 runner anchor not found');
runner = runner.replace(anchor, `    { name: '27. Production CORS Least-Privilege Guard', file: 'cors_production_policy.test.js' },\n    { name: '28. Runtime Startup & CSP Unsafe-Eval Guard', file: 'runtime_startup_csp_hardening.test.js' }\n`);
fs.writeFileSync('tests/run_all_tests.js', runner);
console.log('Final runtime/CSP patch applied.');
