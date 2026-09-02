'use strict';

const assert = require('assert');
const request = require('supertest');

// Keep production secrets out of this suite. Mock auth is requested per request only.
delete process.env.RAILWAY_ENVIRONMENT;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.ENABLE_MOCK_AUTH;
delete process.env.ALLOWED_ORIGINS;
process.env.NODE_ENV = 'test';

const {
  getRateLimitClientIp,
  getRateLimitIpKey,
  getApiRateLimitKey
} = require('../middleware/security');
const { verifySupabaseToken } = require('../middleware/supabaseAuth');
const {
  app,
  LARGE_BODY_ANALYZER_PATHS,
  GATEWAY_PRODUCTION_ALLOWED_ORIGINS,
  getGatewayAllowedOrigins
} = require('../railway-server');

function mockReq({ ip = '198.51.100.9', realIp, remoteAddress = '10.0.0.7', user } = {}) {
  const headers = {};
  if (realIp !== undefined) headers['x-real-ip'] = realIp;
  return { ip, headers, socket: { remoteAddress }, user };
}

async function runVerify(req) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('verifySupabaseToken did not call next()')), 1000);
    Promise.resolve(verifySupabaseToken(req, {}, () => {
      clearTimeout(timer);
      resolve(req);
    })).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

(async () => {
  // Railway's documented X-Real-IP is trusted only inside Railway and only as a literal IP.
  process.env.RAILWAY_ENVIRONMENT = 'production';
  assert.strictEqual(
    getRateLimitClientIp(mockReq({ realIp: '203.0.113.41' })),
    '203.0.113.41',
    'Railway must rate-limit by the validated X-Real-IP client address'
  );
  assert.strictEqual(
    getRateLimitClientIp(mockReq({ realIp: '203.0.113.41, 10.0.0.1' })),
    '198.51.100.9',
    'non-literal/spoof-like X-Real-IP values must fall back to Express identity'
  );
  assert.strictEqual(
    getRateLimitClientIp(mockReq({ realIp: 'not-an-ip' })),
    '198.51.100.9',
    'invalid X-Real-IP must fall back to Express identity'
  );

  const ipv6A = getRateLimitIpKey(mockReq({ realIp: '2001:db8:abcd:1200::1' }));
  const ipv6B = getRateLimitIpKey(mockReq({ realIp: '2001:db8:abcd:12ff::2' }));
  assert.strictEqual(ipv6A, ipv6B, 'IPv6 addresses in the same /56 must share a normalized limiter key');
  assert.notStrictEqual(ipv6A, '2001:db8:abcd:1200::1', 'IPv6 limiter key must not use the raw rotating address');

  // Production CORS is limited to the canonical custom origin. Stale deployment
  // configuration must not widen credentialed browser access to arbitrary HTTPS origins.
  process.env.ALLOWED_ORIGINS = [
    'https://preview.example.com',
    'https://soft-sawine-30785c.netlify.app',
    'http://localhost:9999',
    '*'
  ].join(',');
  let allowed = getGatewayAllowedOrigins();
  assert.deepStrictEqual(GATEWAY_PRODUCTION_ALLOWED_ORIGINS, ['https://mywingmanapp.com'], 'only the canonical production origin must remain allowed');
  assert(allowed.has('https://mywingmanapp.com'), 'canonical production origin must remain allowed');
  assert(!allowed.has('https://mywingman.pages.dev'), 'legacy Cloudflare Pages origin must be revoked after cutover');
  assert(!allowed.has('https://preview.example.com'), 'configured preview origins must not widen production CORS');
  assert(!allowed.has('https://soft-sawine-30785c.netlify.app'), 'retired Netlify origins must remain rejected');
  assert(!allowed.has('http://localhost:9999'), 'localhost configured origin must be rejected in production');
  assert(!allowed.has('*'), 'wildcard configured origin must be rejected in production');

  process.env.ALLOWED_ORIGINS = 'https://mywingman.com,https://preview.mywingman.com';
  allowed = getGatewayAllowedOrigins();
  assert(!allowed.has('https://mywingman.com'), 'stale mywingman.com must remain denied even when configured');
  assert(!allowed.has('https://preview.mywingman.com'), 'configured custom domains must not widen production CORS');

  delete process.env.RAILWAY_ENVIRONMENT;
  delete process.env.ALLOWED_ORIGINS;
  assert.strictEqual(
    getRateLimitClientIp(mockReq({ realIp: '203.0.113.41' })),
    '198.51.100.9',
    'X-Real-IP must be ignored outside Railway'
  );
  assert.strictEqual(
    getApiRateLimitKey(mockReq({ realIp: '203.0.113.41', user: { id: 'user-123' } })),
    'user-123',
    'authenticated AI rate limiting must remain user-ID based'
  );

  assert(LARGE_BODY_ANALYZER_PATHS.has('/api/analyze'));
  assert(LARGE_BODY_ANALYZER_PATHS.has('/api/analyze/'));
  assert(LARGE_BODY_ANALYZER_PATHS.has('/api/analyze-chat-screenshot'));
  assert(LARGE_BODY_ANALYZER_PATHS.has('/api/analyze-chat-screenshot/'));

  // A server-preverified identity must be reused by the inner app without a second remote call.
  let remoteFetchCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    remoteFetchCalls += 1;
    return { ok: false, status: 401, json: async () => ({}) };
  };
  const preverified = {
    user: { id: '00000000-0000-0000-0000-000000000123', email: 'verified@example.com' },
    headers: { authorization: 'Bearer header.payload.signature' }
  };
  await runVerify(preverified);
  assert.strictEqual(remoteFetchCalls, 0, 'preverified gateway identity must not be remotely verified twice');
  assert.strictEqual(preverified.user.id, '00000000-0000-0000-0000-000000000123');

  // Missing/malformed auth must be rejected BEFORE the 38 MB Analyzer JSON parser. Invalid
  // JSON would be a 400 parser error if parsing happened first; the correct gateway result is 401.
  // Because this response terminates before the inner CORS middleware, the gateway itself must
  // grant the canonical production origin permission to read the 401.
  let response = await request(app)
    .post('/api/analyze')
    .set('Origin', 'https://mywingman.pages.dev')
    .set('Content-Type', 'application/json')
    .send('{"broken":');
  assert.strictEqual(response.status, 401, 'unauthenticated Analyzer malformed JSON must be rejected before parsing');
  assert.strictEqual(response.headers['access-control-allow-origin'], undefined, 'legacy Pages origin must receive no early CORS permission');
  assert.strictEqual(response.headers['access-control-allow-credentials'], undefined, 'legacy Pages origin must receive no credentialed CORS permission');

  response = await request(app)
    .post('/api/analyze')
    .set('Origin', 'https://mywingmanapp.com')
    .set('Content-Type', 'application/json')
    .send('{"broken":');
  assert.strictEqual(response.status, 401, 'custom-domain unauthenticated Analyzer request must be rejected before parsing');
  assert.strictEqual(response.headers['access-control-allow-origin'], 'https://mywingmanapp.com', 'early 401 must remain readable by the custom production domain');
  assert.strictEqual(response.headers['access-control-allow-credentials'], 'true', 'custom-domain early 401 must preserve credentialed CORS semantics');

  const beforeMalformedJwt = remoteFetchCalls;
  response = await request(app)
    .post('/api/analyze-chat-screenshot/')
    .set('Origin', 'https://soft-sawine-30785c.netlify.app')
    .set('Authorization', 'Bearer not-a-jwt')
    .set('Content-Type', 'application/json')
    .send('{"broken":');
  assert.strictEqual(response.status, 401, 'malformed JWT must be rejected before the large parser');
  assert.strictEqual(remoteFetchCalls, beforeMalformedJwt, 'malformed JWT must not trigger remote Supabase verification');
  assert.strictEqual(response.headers['access-control-allow-origin'], undefined, 'retired Netlify origin must receive no early CORS permission');

  response = await request(app)
    .post('/api/analyze')
    .set('Origin', 'https://attacker.example')
    .set('Content-Type', 'application/json')
    .send('{"broken":');
  assert.strictEqual(response.status, 401, 'hostile-origin unauthenticated Analyzer request must still fail auth');
  assert.strictEqual(response.headers['access-control-allow-origin'], undefined, 'hostile origin must receive no early CORS permission');

  // Once outer auth succeeds, parsing proceeds normally. This proves the gate protects only
  // admission and does not bypass the existing body validator/parser for authenticated users.
  response = await request(app)
    .post('/api/analyze')
    .set('Origin', 'https://mywingman.pages.dev')
    .set('x-mock-auth', 'true')
    .set('Content-Type', 'application/json')
    .send('{"broken":');
  assert.strictEqual(response.status, 400, 'authenticated malformed JSON must reach the normal parser and fail as bad JSON');
  assert.strictEqual(response.headers['access-control-allow-origin'], undefined, 'legacy Pages origin must receive no parser-error CORS permission');

  // A revoked origin must not receive the unauthenticated preflight shortcut or any CORS grant.
  response = await request(app)
    .options('/api/analyze')
    .set('Origin', 'https://mywingman.pages.dev')
    .set('Access-Control-Request-Method', 'POST');
  assert.strictEqual(response.status, 401, 'revoked-origin Analyzer preflight must not bypass admission auth');
  assert.strictEqual(response.headers['access-control-allow-origin'], undefined, 'revoked-origin preflight must receive no CORS permission');

  // The canonical origin still receives the existing unauthenticated preflight response.
  response = await request(app)
    .options('/api/analyze')
    .set('Origin', 'https://mywingmanapp.com')
    .set('Access-Control-Request-Method', 'POST');
  assert.strictEqual(response.status, 204, 'canonical Analyzer CORS preflight must remain unauthenticated');
  assert.strictEqual(response.headers['access-control-allow-origin'], 'https://mywingmanapp.com');

  // Unrelated small-body APIs keep their prior middleware order/behavior; the outer gateway is
  // intentionally scoped only to the two 38 MB Analyzer routes.
  response = await request(app)
    .post('/api/icebreaker')
    .set('Content-Type', 'application/json')
    .send('{"broken":');
  assert.strictEqual(response.status, 400, 'unrelated API route behavior must remain unchanged');

  global.fetch = originalFetch;
  console.log('✅ Railway request admission, early-error CORS, pre-body auth, and real-client IP limiter guard passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
