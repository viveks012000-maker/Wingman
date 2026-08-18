'use strict';

require('dotenv').config();

const express = require('express');
const { verifySupabaseToken, requireSupabaseAuth } = require('./middleware/supabaseAuth');
const { analyzerAdmissionLimiter } = require('./middleware/security');
const { app: wingmanApi } = require('./server');

const app = express();
const PORT = process.env.PORT || 3000;
const LARGE_BODY_ANALYZER_PATHS = new Set([
    '/api/analyze',
    '/api/analyze/',
    '/api/analyze-chat-screenshot',
    '/api/analyze-chat-screenshot/'
]);

// Railway is the backend only. Cloudflare Pages is the sole frontend origin.
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

module.exports = { app, startRailwayServer, LARGE_BODY_ANALYZER_PATHS };

if (require.main === module) {
    startRailwayServer().catch((error) => {
        console.error('Fatal Railway gateway startup error:', error);
        process.exit(1);
    });
}
