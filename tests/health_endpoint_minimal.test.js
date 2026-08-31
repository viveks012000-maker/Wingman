const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = server.indexOf("app.get('/api/health'");
const end = server.indexOf("// Payment verification endpoint", start);
assert.ok(start >= 0 && end > start, 'health endpoint must exist');
const health = server.slice(start, end);

assert.ok(!health.includes('userCount'), 'public health response must not disclose user/profile counts');
assert.ok(!health.includes("SELECT COUNT(*)"), 'health probe must not count production users');
assert.ok(!health.includes('error: err.message'), 'health response must not return raw internal exception messages');
assert.ok(health.includes("select('id')"), 'Supabase health must perform a lightweight database probe');
assert.ok(health.includes(".limit(1)"), 'Supabase health probe must be bounded');
assert.ok(health.includes("res.status(503).json({ status: 'degraded'"), 'database failures must produce a degraded 503 response');
assert.ok(health.includes("database: 'supabase_active'"), 'healthy Supabase response must remain explicit');

console.log('✔ Public health endpoint disclosure and availability guard passed.');
