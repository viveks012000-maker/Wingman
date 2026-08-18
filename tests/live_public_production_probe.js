'use strict';

const assert = require('assert');

const EXPECTED_SHA = '6fc1ebade8f619cbb94907f0e91048bcb9d21617';
const FRONTEND = 'https://mywingman.pages.dev';
const RAILWAY = 'https://wingman-production-c6ce.up.railway.app';
const CLOUDFLARE_ORIGIN = 'https://mywingman.pages.dev';
const RETIRED_NETLIFY_ORIGIN = 'https://soft-sawine-30785c.netlify.app';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(url, options = {}, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function waitForProductionSha() {
    let last = null;
    for (let attempt = 1; attempt <= 18; attempt++) {
        try {
            const response = await request(`${FRONTEND}/release.json`, { cache: 'no-store' });
            if (response.ok) {
                const body = await response.json();
                last = body && body.sourceCommit;
                if (last === EXPECTED_SHA) return body;
            } else {
                last = `HTTP ${response.status}`;
            }
        } catch (error) {
            last = error && error.message ? error.message : String(error);
        }
        if (attempt < 18) await sleep(10000);
    }
    throw new Error(`Cloudflare production did not expose expected release SHA ${EXPECTED_SHA}; last=${last}`);
}

function assertSecurityHeaders(response, label) {
    const hsts = response.headers.get('strict-transport-security') || '';
    assert.match(hsts, /max-age=31536000/i, `${label}: HSTS missing or weak`);
    assert.strictEqual((response.headers.get('x-content-type-options') || '').toLowerCase(), 'nosniff', `${label}: nosniff missing`);
    assert.strictEqual((response.headers.get('x-frame-options') || '').toUpperCase(), 'DENY', `${label}: frame denial missing`);
    assert.ok(response.headers.get('referrer-policy'), `${label}: Referrer-Policy missing`);
    assert.ok(response.headers.get('permissions-policy'), `${label}: Permissions-Policy missing`);
}

async function probeCloudflare() {
    const release = await waitForProductionSha();
    assert.strictEqual(release.sourceCommit, EXPECTED_SHA);

    const root = await request(`${FRONTEND}/`, { redirect: 'manual', cache: 'no-store' });
    assert.strictEqual(root.status, 200, 'Cloudflare / must return 200');
    assertSecurityHeaders(root, 'Cloudflare /');
    const rootCsp = root.headers.get('content-security-policy') || '';
    assert.ok(rootCsp, 'Cloudflare / CSP missing');
    assert.ok(!rootCsp.includes('netlify.app'), 'Cloudflare / CSP must not contain Netlify');
    assert.ok(!rootCsp.includes("'unsafe-eval'"), 'Landing page CSP must remain eval-free');
    const rootHtml = await root.text();
    assert.ok(
        /<img\s+loading="lazy"\s+decoding="async"\s+fetchpriority="low"\s+src="maeve\.jpg"/.test(rootHtml),
        'landing Maeve image must be deferred in production'
    );

    const app = await request(`${FRONTEND}/app`, { redirect: 'manual', cache: 'no-store' });
    assert.strictEqual(app.status, 200, 'Cloudflare /app must return 200');
    assertSecurityHeaders(app, 'Cloudflare /app');
    const appCsp = app.headers.get('content-security-policy') || '';
    assert.ok(appCsp.includes("'unsafe-eval'"), '/app CSP must retain HEIC runtime compatibility');
    assert.ok(!appCsp.includes('netlify.app'), '/app CSP must not contain Netlify');
    const appHtml = await app.text();
    assert.ok(appHtml.includes('./vendor/heic2any-loader.js'), 'production /app must load the lazy HEIC shim');
    assert.ok(!appHtml.includes('<script src="./vendor/heic2any.min.js"></script>'), 'production /app must not eagerly load the heavy HEIC runtime');
    assert.ok(!appHtml.includes('soft-sawine-30785c'), 'production /app must not contain retired Netlify domain');
    assert.ok(
        /<img\s+loading="lazy"\s+decoding="async"\s+fetchpriority="low"\s+src="maeve\.jpg"/.test(appHtml),
        'dashboard Maeve image must be deferred in production'
    );

    const appHtmlRoute = await request(`${FRONTEND}/app.html`, { redirect: 'manual', cache: 'no-store' });
    assert.ok([301, 302, 307, 308].includes(appHtmlRoute.status), `/app.html must canonicalize to /app, got ${appHtmlRoute.status}`);
    const location = appHtmlRoute.headers.get('location') || '';
    assert.ok(/\/app(?:$|[?#])/.test(location), `/app.html canonical target must be /app, got ${location}`);

    const missing = await request(`${FRONTEND}/__wingman_missing_${Date.now()}`, { redirect: 'manual', cache: 'no-store' });
    assert.strictEqual(missing.status, 404, 'nonexistent Cloudflare routes must return a real 404');

    const realHeic = await request(`${FRONTEND}/vendor/heic2any.min.js`, { redirect: 'manual' });
    assert.strictEqual(realHeic.status, 200, 'on-demand HEIC runtime must remain available');
    const canonicalCropper = await request(`${FRONTEND}/vendor/cropperjs/cropper.min.js`, { redirect: 'manual' });
    assert.strictEqual(canonicalCropper.status, 200, 'canonical Cropper runtime must remain available');
    for (const deadDuplicate of ['/vendor/cropper.min.js', '/vendor/cropper.min.css']) {
        const response = await request(`${FRONTEND}${deadDuplicate}`, { redirect: 'manual' });
        assert.strictEqual(response.status, 404, `non-allowlisted vendor asset must not ship: ${deadDuplicate}`);
    }

    const releaseVendorKeys = Object.keys(release.files || {}).filter(key => key.startsWith('vendor/')).sort();
    const expectedVendorKeys = [
        'vendor/cropperjs/cropper.min.css',
        'vendor/cropperjs/cropper.min.js',
        'vendor/heic2any-loader.js',
        'vendor/heic2any.min.js',
        'vendor/production-runtime.js',
        'vendor/supabase.min.js'
    ].sort();
    assert.deepStrictEqual(releaseVendorKeys, expectedVendorKeys, 'production release manifest vendor set must match exact allowlist');

    return { release: release.sourceCommit, appHtmlCanonicalStatus: appHtmlRoute.status, vendorFiles: releaseVendorKeys.length };
}

async function probeRailway() {
    const root = await request(`${RAILWAY}/`, { redirect: 'manual' });
    assert.strictEqual(root.status, 200, 'Railway root service probe must return 200');
    assertSecurityHeaders(root, 'Railway /');
    const rootBody = await root.json();
    assert.strictEqual(rootBody.service, 'mywingman-api');

    const health = await request(`${RAILWAY}/api/health`, { redirect: 'manual' });
    assert.strictEqual(health.status, 200, 'Railway /api/health must return 200');
    assertSecurityHeaders(health, 'Railway /api/health');
    const healthBody = await health.json();
    assert.strictEqual(healthBody.status, 'ok');
    assert.strictEqual(healthBody.database, 'supabase_active');

    for (const path of [
        '/package.json',
        '/package-lock.json',
        '/server.js',
        '/app.js',
        '/tests/security_node.test.js',
        '/migrations/008_idempotent_credit_settlement.sql',
        '/scripts/build-netlify-dist.js',
        '/middleware/supabaseAuth.js'
    ]) {
        const response = await request(`${RAILWAY}${path}`, { redirect: 'manual' });
        assert.strictEqual(response.status, 404, `Railway must not expose repository/static path ${path}`);
    }

    const allowedPreflight = await request(`${RAILWAY}/api/config`, {
        method: 'OPTIONS',
        headers: { Origin: CLOUDFLARE_ORIGIN, 'Access-Control-Request-Method': 'GET' },
        redirect: 'manual'
    });
    assert.ok([200, 204].includes(allowedPreflight.status), `Cloudflare preflight must succeed, got ${allowedPreflight.status}`);
    assert.strictEqual(allowedPreflight.headers.get('access-control-allow-origin'), CLOUDFLARE_ORIGIN);
    assert.strictEqual((allowedPreflight.headers.get('access-control-allow-credentials') || '').toLowerCase(), 'true');

    const allowedGet = await request(`${RAILWAY}/api/config`, { headers: { Origin: CLOUDFLARE_ORIGIN }, redirect: 'manual' });
    assert.strictEqual(allowedGet.status, 200, 'Cloudflare-origin API config request must succeed');
    assert.strictEqual(allowedGet.headers.get('access-control-allow-origin'), CLOUDFLARE_ORIGIN);
    const configBody = await allowedGet.json();
    assert.ok(configBody.supabaseUrl && configBody.supabaseAnonKey, 'public auth config must remain available');
    assert.ok(!JSON.stringify(configBody).toLowerCase().includes('service_role'), 'public config must not expose service-role material');

    for (const hostileOrigin of [RETIRED_NETLIFY_ORIGIN, 'https://evil.example']) {
        const preflight = await request(`${RAILWAY}/api/config`, {
            method: 'OPTIONS',
            headers: { Origin: hostileOrigin, 'Access-Control-Request-Method': 'GET' },
            redirect: 'manual'
        });
        assert.strictEqual(preflight.headers.get('access-control-allow-origin'), null, `unauthorized origin must not receive ACAO: ${hostileOrigin}`);
        assert.strictEqual(preflight.headers.get('access-control-allow-credentials'), null, `unauthorized origin must not receive credential permission: ${hostileOrigin}`);
        const get = await request(`${RAILWAY}/api/config`, { headers: { Origin: hostileOrigin }, redirect: 'manual' });
        assert.strictEqual(get.headers.get('access-control-allow-origin'), null, `unauthorized GET must not receive ACAO: ${hostileOrigin}`);
    }

    const malformedJwt = await request(`${RAILWAY}/api/credits`, {
        headers: { Origin: CLOUDFLARE_ORIGIN, Authorization: 'Bearer not-a-jwt' },
        redirect: 'manual'
    });
    assert.strictEqual(malformedJwt.status, 401, 'malformed bearer token must fail closed with 401');

    return { health: healthBody.database, malformedJwtStatus: malformedJwt.status };
}

async function observeCustomDomain() {
    try {
        const response = await request('https://mywingman.com/', { redirect: 'manual' }, 12000);
        return { reachable: true, status: response.status, location: response.headers.get('location') || null };
    } catch (error) {
        return { reachable: false, error: error && error.message ? error.message : String(error) };
    }
}

(async () => {
    const cloudflare = await probeCloudflare();
    const railway = await probeRailway();
    const customDomain = await observeCustomDomain();
    console.log('✅ LIVE_PUBLIC_PRODUCTION_PROBE_PASS');
    console.log(JSON.stringify({ expectedSha: EXPECTED_SHA, cloudflare, railway, customDomain }, null, 2));
})().catch(error => {
    console.error('❌ LIVE_PUBLIC_PRODUCTION_PROBE_FAIL');
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
