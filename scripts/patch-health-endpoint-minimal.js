const fs = require('fs');

let server = fs.readFileSync('server.js', 'utf8');
const oldBlock = `// System Health Check Endpoint
app.get('/api/health', async (req, res) => {
    try {
        let userCount = 0;
        let dbStatus = 'disconnected';
        if (db) {
            dbStatus = 'sqlite_active';
            const countRow = await db.get('SELECT COUNT(*) as count FROM user_profiles');
            userCount = countRow ? countRow.count : 0;
        } else if (supabaseAdmin) {
            dbStatus = 'supabase_active';
            try {
                const { count } = await supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true });
                userCount = count || 0;
            } catch (sErr) {}
        }
        res.json({
            status: 'ok',
            database: dbStatus,
            userCount: userCount,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ status: 'error', database: 'error', error: err.message });
    }
});`;

const newBlock = `// System Health Check Endpoint — availability only; never expose user/business-volume data.
app.get('/api/health', async (req, res) => {
    const timestamp = new Date().toISOString();
    try {
        if (db) {
            await db.get('SELECT 1 AS ok');
            return res.json({ status: 'ok', database: 'sqlite_active', timestamp });
        }

        if (supabaseAdmin) {
            const { error } = await supabaseAdmin
                .from('profiles')
                .select('id')
                .limit(1);
            if (error) {
                console.error('[Health Check] Supabase probe failed:', error.message);
                return res.status(503).json({ status: 'degraded', database: 'supabase_unavailable', timestamp });
            }
            return res.json({ status: 'ok', database: 'supabase_active', timestamp });
        }

        return res.status(503).json({ status: 'degraded', database: 'unavailable', timestamp });
    } catch (err) {
        console.error('[Health Check] Database probe failed:', err && err.message ? err.message : err);
        return res.status(503).json({ status: 'degraded', database: 'unavailable', timestamp });
    }
});`;

if (!server.includes(oldBlock)) throw new Error('Expected old health endpoint block not found');
server = server.replace(oldBlock, newBlock);
fs.writeFileSync('server.js', server);

const test = `const assert = require('assert');\nconst fs = require('fs');\nconst path = require('path');\n\nconst server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');\nconst start = server.indexOf("app.get('/api/health'");\nconst end = server.indexOf("// Payment verification endpoint", start);\nassert.ok(start >= 0 && end > start, 'health endpoint must exist');\nconst health = server.slice(start, end);\n\nassert.ok(!health.includes('userCount'), 'public health response must not disclose user/profile counts');\nassert.ok(!health.includes("SELECT COUNT(*)"), 'health probe must not count production users');\nassert.ok(!health.includes('error: err.message'), 'health response must not return raw internal exception messages');\nassert.ok(health.includes("select('id')"), 'Supabase health must perform a lightweight database probe');\nassert.ok(health.includes(".limit(1)"), 'Supabase health probe must be bounded');\nassert.ok(health.includes("res.status(503).json({ status: 'degraded'"), 'database failures must produce a degraded 503 response');\nassert.ok(health.includes("database: 'supabase_active'"), 'healthy Supabase response must remain explicit');\n\nconsole.log('✔ Public health endpoint disclosure and availability guard passed.');\n`;
fs.writeFileSync('tests/health_endpoint_minimal.test.js', test);

let runner = fs.readFileSync('tests/run_all_tests.js', 'utf8');
const anchor = `    { name: '31. Production Legal & Privacy Accuracy Guard', file: 'legal_production_accuracy.test.js' }\n`;
if (!runner.includes(anchor)) throw new Error('Suite 31 anchor not found');
runner = runner.replace(anchor, `    { name: '31. Production Legal & Privacy Accuracy Guard', file: 'legal_production_accuracy.test.js' },\n    { name: '32. Public Health Endpoint Minimal-Disclosure Guard', file: 'health_endpoint_minimal.test.js' }\n`);
fs.writeFileSync('tests/run_all_tests.js', runner);

console.log('Health endpoint minimal-disclosure patch applied.');
