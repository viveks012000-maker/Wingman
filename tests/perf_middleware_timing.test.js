const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

process.env.NODE_ENV = 'test';
const { withPerfMiddleware } = require('../server');

(async () => {
    const originalLog = console.log;
    const capturedLogs = [];
    console.log = (...args) => capturedLogs.push(args.join(' '));

    try {
        const req = {
            originalUrl: '/api/chat',
            body: { message: 'synthetic content must never be logged' },
            user: { id: 'synthetic-user-id', email: 'private@example.test' },
            headers: { authorization: 'Bearer synthetic-token' }
        };
        const res = new EventEmitter();
        const middleware = withPerfMiddleware('auth_context', async (_req, _res, next) => {
            await new Promise(resolve => setTimeout(resolve, 8));
            next();
        });

        await new Promise((resolve, reject) => {
            middleware(req, res, error => error ? reject(error) : resolve());
        });

        const telemetryLine = capturedLogs.find(line => line.startsWith('[PERF_TELEMETRY]'));
        assert.ok(telemetryLine, 'AI middleware must emit a privacy-safe timing record');
        const payload = JSON.parse(telemetryLine.slice('[PERF_TELEMETRY] '.length));
        assert.equal(payload.feature, 'chat');
        assert.equal(payload.stage, 'auth_context');
        assert.ok(payload.durationMs >= 1, 'middleware time must be measured with a positive elapsed duration');
        assert.equal(telemetryLine.includes('synthetic content'), false, 'telemetry must not include request text');
        assert.equal(telemetryLine.includes('private@example.test'), false, 'telemetry must not include user identity');
        assert.equal(telemetryLine.includes('synthetic-token'), false, 'telemetry must not include credentials');
    } finally {
        console.log = originalLog;
    }

    console.log('Privacy-safe middleware timing guard passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
