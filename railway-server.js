'use strict';

require('dotenv').config();

const express = require('express');
const { app: wingmanApi } = require('./server');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.use(wingmanApi);

async function startRailwayServer() {
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 MyWingman API-only Railway gateway online on port ${PORT}`);
    });
    server.keepAliveTimeout = 120000;
    server.headersTimeout = 125000;
    return server;
}

module.exports = { app, startRailwayServer };

if (require.main === module) {
    startRailwayServer().catch((error) => {
        console.error('Fatal Railway gateway startup error:', error);
        process.exit(1);
    });
}
