'use strict';

require('dotenv').config();

const express = require('express');
const { verifySupabaseToken, requireSupabaseAuth } = require('./middleware/supabaseAuth');
const { analyzerAdmissionLimiter } = require('./middleware/security');
const { isPrivateDevelopmentOrigin } = require('./middleware/developmentOrigin');
const { app: wingmanApi } = require('./server');

const app = express();
const PORT = process.env.PORT || 3000;
const LARGE_BODY_ANALYZER_PATHS = new Set([
    '/api/analyze',
    '/api/analyze/',
    '/api/analyze-chat-screenshot',
    '/api/analyze-chat-screenshot/'
]);

const GATEWAY_PRODUCTION_ALLOWED_ORIGINS = [
    'https://mywingmanapp.com'
];
const GATEWAY_DEVELOPMENT_ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'http://localhost:10000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:10000'
];

function getGatewayAllowedOrigins() {
    const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);
    const defaults = isProduction
        ? GATEWAY_PRODUCTION_ALLOWED_ORIGINS
        : [...GATEWAY_PRODUCTION_ALLOWED_ORIGINS, ...GATEWAY_DEVELOPMENT_ALLOWED_ORIGINS];
    const configured = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean)
        : [];

    const safeConfigured = isProduction ? [] : configured;

    return new Set([...defaults, ...safeConfigured]);
}

function applyAnalyzerAdmissionCors(req, res) {
    const origin = req && req.headers ? req.headers.origin : null;
    const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);
    if (origin === 'https://mywingman.com') return false;
    const isAllowedOrigin = origin && (getGatewayAllowedOrigins().has(origin) ||
        (!isProduction && isPrivateDevelopmentOrigin(origin)));
    if (!isAllowedOrigin) return false;

    // Early admission responses must never reflect a request-controlled Origin. The mounted
    // inner app handles normal development responses; this gateway path emits CORS only for the
    // fixed production frontend origin from the explicit allowlist.
    const approvedOrigin = GATEWAY_PRODUCTION_ALLOWED_ORIGINS.find(value => value === origin);
    if (!approvedOrigin) return false;
    res.setHeader('Access-Control-Allow-Origin', approvedOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (typeof res.vary === 'function') res.vary('Origin');
    else res.setHeader('Vary', 'Origin');
    return true;
}

// Railway is the backend only. The canonical custom domain is the sole frontend origin.
// Keep a tiny root probe for platform/load-balancer diagnostics, but never expose
// repository files, frontend assets, tests, migrations or build internals from Railway.
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});

app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'mywingman-api' });
});

app.use((req, res, next) => {
    const pathname = typeof req.path === 'string' ? req.path : '';
    if (pathname === '/api' || pathname.startsWith('/api/')) {
        return next();
    }
    return res.status(404).json({ success: false, error: 'Not found.' });
});

// The inner Wingman app intentionally allows up to 38 MB JSON bodies on Screenshot Analyzer
// routes. Authenticate those requests here, before any body parser sees attacker-controlled
// bytes. OPTIONS bypasses admission auth so the inner CORS middleware can answer preflight.
// A dedicated IP limiter runs before auth so valid-looking junk JWTs cannot turn this gateway
// into an unbounded Supabase token-verification amplifier.
app.use((req, res, next) => {
    const pathname = typeof req.path === 'string' ? req.path : '';
    if (req.method === 'OPTIONS' || !LARGE_BODY_ANALYZER_PATHS.has(pathname)) {
        return next();
    }

    // Admission can terminate with 401/429 before the mounted application's CORS middleware.
    // Mirror the same production allowlist here so the canonical browser origin can read
    // those errors, while stale/retired origins still receive no CORS grant.
    applyAnalyzerAdmissionCors(req, res);

    return analyzerAdmissionLimiter(req, res, () => {
        return verifySupabaseToken(req, res, () => requireSupabaseAuth(req, res, next));
    });
});

app.use(wingmanApi);

async function startRailwayServer() {
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 MyWingman API-only Railway gateway online on port ${PORT}`);
    });
    server.keepAliveTimeout = 120000;
    server.headersTimeout = 125000;
    return server;
}

module.exports = {
    app,
    startRailwayServer,
    LARGE_BODY_ANALYZER_PATHS,
    GATEWAY_PRODUCTION_ALLOWED_ORIGINS,
    getGatewayAllowedOrigins,
    applyAnalyzerAdmissionCors
};

if (require.main === module) {
    startRailwayServer().catch((error) => {
        console.error('Fatal Railway gateway startup error:', error);
        process.exit(1);
    });
}
