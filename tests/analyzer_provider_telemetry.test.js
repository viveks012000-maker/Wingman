const assert = require('node:assert/strict');

const originalApiKey = process.env.AICREDITS_API_KEY;
const originalVisionKey = process.env.AICREDITS_API_KEY_VISION;
process.env.NODE_ENV = 'test';
process.env.AICREDITS_API_KEY_VISION = 'vision-test-secret';
const { queryAnalyzerProvider } = require('../server');

(async () => {
    const originalFetch = global.fetch;
    const originalLog = console.log;
    const capturedLogs = [];
    console.log = (...args) => capturedLogs.push(args.join(' '));

    try {
        let calls = 0;
        global.fetch = async (url, options) => {
            calls += 1;
            assert.equal(url, 'https://api.aicredits.in/v1/chat/completions');
            assert.equal(options.headers.Authorization, 'Bearer vision-test-secret');
            return new Response(JSON.stringify({ choices: [{ message: { content: 'synthetic reply' } }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        };

        const result = await queryAnalyzerProvider('vision', [
            { role: 'user', content: 'synthetic private screenshot text' }
        ], 0.2, 10, 1000);

        assert.equal(result, 'synthetic reply');
        assert.equal(calls, 1);
        const telemetryLine = capturedLogs.find(line => line.startsWith('[PERF_TELEMETRY]'));
        assert.ok(telemetryLine, 'Analyzer provider calls must emit per-attempt timing');
        const payload = JSON.parse(telemetryLine.slice('[PERF_TELEMETRY] '.length));
        assert.equal(payload.feature, 'analyze');
        assert.equal(payload.stage, 'vision_provider_attempt');
        assert.equal(payload.attemptCount, 1);
        assert.ok(payload.durationMs >= 0);
        assert.equal(telemetryLine.includes('synthetic private screenshot text'), false);
        assert.equal(telemetryLine.includes('vision-test-secret'), false);
    } finally {
        global.fetch = originalFetch;
        console.log = originalLog;
        if (originalApiKey === undefined) delete process.env.AICREDITS_API_KEY;
        else process.env.AICREDITS_API_KEY = originalApiKey;
        if (originalVisionKey === undefined) delete process.env.AICREDITS_API_KEY_VISION;
        else process.env.AICREDITS_API_KEY_VISION = originalVisionKey;
    }
    console.log('Analyzer provider attempt telemetry guard passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
