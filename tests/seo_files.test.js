/**
 * Tests: SEO Files Verification (robots.txt & sitemap.xml)
 */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('\n============================================================');
console.log('🧪 RUNNING SEO FILES (ROBOTS.TXT & SITEMAP.XML) TESTS');
console.log('============================================================\n');

// 1. Static File Verification
const robotsPath = path.join(__dirname, '../robots.txt');
const sitemapPath = path.join(__dirname, '../sitemap.xml');

assert.strictEqual(fs.existsSync(robotsPath), true, 'robots.txt must exist at project root');
assert.strictEqual(fs.existsSync(sitemapPath), true, 'sitemap.xml must exist at project root');

const robotsContent = fs.readFileSync(robotsPath, 'utf8');
const sitemapContent = fs.readFileSync(sitemapPath, 'utf8');

// Validate robots.txt content
assert.strictEqual(robotsContent.includes('User-agent: *'), true, 'robots.txt must declare User-agent: *');
assert.strictEqual(robotsContent.includes('Allow: /'), true, 'robots.txt must declare Allow: /');
assert.strictEqual(robotsContent.includes('Disallow: /api/'), true, 'robots.txt must disallow /api/');
assert.strictEqual(robotsContent.includes('Sitemap: https://mywingman.com/sitemap.xml'), true, 'robots.txt must reference canonical sitemap.xml');
console.log('✔ Test 1 Passed: robots.txt static content and directives validated');

// Validate sitemap.xml content
assert.strictEqual(sitemapContent.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), true, 'sitemap.xml must have XML declaration');
assert.strictEqual(sitemapContent.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'), true, 'sitemap.xml must declare sitemap 0.9 schema');
assert.strictEqual(sitemapContent.includes('<loc>https://mywingman.com/</loc>'), true, 'sitemap.xml must include homepage');
assert.strictEqual(sitemapContent.includes('<loc>https://mywingman.com/privacy.html</loc>'), true, 'sitemap.xml must include privacy policy');
assert.strictEqual(sitemapContent.includes('<loc>https://mywingman.com/terms.html</loc>'), true, 'sitemap.xml must include terms of service');
assert.strictEqual(sitemapContent.includes('<loc>https://mywingman.com/refund.html</loc>'), true, 'sitemap.xml must include refund policy');

// Ensure no private or API paths in sitemap
assert.strictEqual(sitemapContent.includes('/api/'), false, 'sitemap.xml must not include /api/ routes');
assert.strictEqual(sitemapContent.includes('/app.html'), false, 'sitemap.xml must not include private /app.html');
assert.strictEqual(sitemapContent.includes('localhost'), false, 'sitemap.xml must not include localhost');
console.log('✔ Test 2 Passed: sitemap.xml XML structure, canonical URLs, and private exclusions validated');

// 2. HTTP Server Reachability & Public Access
process.env.NODE_ENV = 'development';
process.env.ENABLE_MOCK_AUTH = 'true';
const { app, server: importedServer } = require('../server');

function getRequest(server, reqPath) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: server.address().port,
            path: reqPath,
            method: 'GET'
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });
        req.on('error', reject);
        req.end();
    });
}

async function closeServer(server) {
    if (!server || typeof server.close !== 'function' || !server.listening) return;
    await new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
    });
}

async function testHttpEndpoints() {
    const testServer = http.createServer(app);
    await new Promise(res => testServer.listen(0, '127.0.0.1', res));

    try {
        // Test /robots.txt
        const robotsRes = await getRequest(testServer, '/robots.txt');
        assert.strictEqual(robotsRes.status, 200, `Expected HTTP 200 for /robots.txt, got ${robotsRes.status}`);
        assert.strictEqual(robotsRes.body.includes('User-agent: *'), true, '/robots.txt response must match file contents');
        console.log('✔ Test 3 Passed: HTTP GET /robots.txt returns 200 OK without authentication');

        // Test /sitemap.xml
        const sitemapRes = await getRequest(testServer, '/sitemap.xml');
        assert.strictEqual(sitemapRes.status, 200, `Expected HTTP 200 for /sitemap.xml, got ${sitemapRes.status}`);
        assert.strictEqual(sitemapRes.body.includes('<urlset'), true, '/sitemap.xml response must contain valid urlset');
        console.log('✔ Test 4 Passed: HTTP GET /sitemap.xml returns 200 OK without authentication');
    } finally {
        await closeServer(testServer);
        await closeServer(importedServer);
    }

    console.log('\n🎉 ALL SEO FILES TESTS PASSED!\n');
}

testHttpEndpoints().catch(async err => {
    console.error('❌ SEO Files test failed:', err);
    try { await closeServer(importedServer); } catch (_) {}
    process.exit(1);
});
