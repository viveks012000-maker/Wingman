'use strict';
const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const express = require('express');
const request = require('supertest');
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.RAILWAY_ENVIRONMENT;
delete process.env.ENABLE_MOCK_AUTH;
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
after(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
});
const { app } = require('../railway-server');
const { globalLimiter } = require('../middleware/security');

test('every path matched by an Analyzer parser authenticates before malformed JSON is parsed', async () => {
    for (const path of ['/api/ANALYZE', '/api/Analyze/', '/api/analyze/extra', '/api/analyze//extra', '/api/ANALYZE-CHAT-SCREENSHOT', '/api/analyze-chat-screenshot/extra']) {
        const response = await request(app).post(path)
            .set('Origin', 'https://mywingmanapp.com')
            .set('Content-Type', 'application/json').send('{"broken":');
        assert.equal(response.status, 401, path + ' must reject before parsing');
        assert.equal(response.headers['access-control-allow-origin'], 'https://mywingmanapp.com');
    }
    const unrelated = await request(app).post('/api/analyzer').set('Content-Type', 'application/json').send('{"broken":');
    assert.equal(unrelated.status, 400, 'a similarly named path does not use the Analyzer admission chain');
});

test('the global limiter applies after Express removes its /api mount prefix', async (t) => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    t.after(() => { process.env.NODE_ENV = previousNodeEnv; });
    const fixture = express();
    fixture.use('/api/', globalLimiter);
    let work = 0;
    fixture.get('/api/probe', (req, res) => { work++; res.json({ ok: true }); });
    // req.ip here is loopback, but production must never use the development exemption.
    for (let count = 0; count < 1000; count++) {
        assert.equal((await request(fixture).get('/api/probe')).status, 200);
    }
    assert.equal((await request(fixture).get('/api/probe')).status, 429);
    assert.equal(work, 1000, 'rejected requests must not reach expensive downstream work');
});
