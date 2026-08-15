const fs = require('fs');

// 1) Remove unnecessary unsafe-eval from Railway Helmet CSP and make importing server.js side-effect free.
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

// 2) Netlify browser CSP does not need unsafe-eval either.
let build = fs.readFileSync('scripts/build-netlify-dist.js', 'utf8');
const oldCsp = `"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.supabase.co",`;
const newCsp = `"script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.supabase.co",`;
if (!build.includes(oldCsp)) throw new Error('Expected Netlify unsafe-eval directive not found');
build = build.replace(oldCsp, newCsp);
fs.writeFileSync('scripts/build-netlify-dist.js', build);

// 3) Make .env.example match the production CORS policy. Development localhost is already
// allowed by code in non-production and must not be copied into production ALLOWED_ORIGINS.
let envExample = fs.readFileSync('.env.example', 'utf8');
const oldOrigins = `ALLOWED_ORIGINS="https://mywingman.com,https://*.pages.dev,http://localhost:3000,http://127.0.0.1:3000"`;
const newOrigins = `# Production: explicit HTTPS origins only. Localhost is automatically allowed in non-production.\nALLOWED_ORIGINS="https://mywingman.com,https://chimerical-granita-c68c5a.netlify.app"`;
if (!envExample.includes(oldOrigins)) throw new Error('Expected stale ALLOWED_ORIGINS example not found');
envExample = envExample.replace(oldOrigins, newOrigins);
fs.writeFileSync('.env.example', envExample);

// 4) Add regression coverage on top of the account-deletion suite now in current main.
const test = `const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const buildSource = fs.readFileSync(path.join(root, 'scripts', 'build-netlify-dist.js'), 'utf8');
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

assert.ok(serverSource.includes('if (require.main === module) {'), 'server must bind only as process entry point');
assert.ok(!serverSource.includes('\\nstartWingmanServer();'), 'importing server.js must not unconditionally start a listener');
assert.ok(serverSource.includes('module.exports = { app, startWingmanServer, supabaseAdmin };'), 'server must export app and explicit starter');
assert.ok(!serverSource.includes("'unsafe-eval'"), 'Railway Helmet CSP must not allow unsafe-eval');
assert.ok(!buildSource.includes("'unsafe-eval'"), 'Netlify generated CSP must not allow unsafe-eval');
assert.ok(envExample.includes('ALLOWED_ORIGINS="https://mywingman.com,https://chimerical-granita-c68c5a.netlify.app"'), 'production origin example must use exact trusted origins');
assert.ok(!envExample.includes('https://*.pages.dev'), 'production origin example must not advertise wildcard preview origins');

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
assert.ok(output.endsWith('IMPORT_OK'), 'requiring server.js must return promptly');
assert.ok(!output.includes('Secure Wingman 3-Tier Backend Online'), 'requiring server.js must not open a listener');
console.log('✔ Runtime startup, CSP unsafe-eval, and production CORS example hardening passed.');
`;
fs.writeFileSync('tests/runtime_startup_csp_hardening.test.js', test);

let runner = fs.readFileSync('tests/run_all_tests.js', 'utf8');
const anchor = `    { name: '28. Account Deletion Atomicity & Cascade Guard', file: 'account_deletion_atomicity.test.js' }\n`;
if (!runner.includes(anchor)) throw new Error('Suite 28 account-deletion anchor not found');
runner = runner.replace(anchor, `    { name: '28. Account Deletion Atomicity & Cascade Guard', file: 'account_deletion_atomicity.test.js' },\n    { name: '29. Runtime Startup, CSP & Production-Origin Example Guard', file: 'runtime_startup_csp_hardening.test.js' }\n`);
fs.writeFileSync('tests/run_all_tests.js', runner);

console.log('Final current-main runtime/CSP hardening patch applied.');
