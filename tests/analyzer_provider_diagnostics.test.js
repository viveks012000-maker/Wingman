const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('server.js', 'utf8');

// Protected Analyzer provider contract must remain exact.
assert(source.includes("const apiKey = isVisionStage ? process.env.AICREDITS_API_KEY_VISION : process.env.AICREDITS_API_KEY;"));
assert(source.includes("const model = isVisionStage ? 'qwen/qwen3.5-flash-02-23' : 'qwen/qwen3-235b-a22b-2507';"));
assert(source.includes("const baseUrl = 'https://api.aicredits.in/v1';"));
const providerStart = source.indexOf('async function queryAnalyzerProvider');
const providerEnd = source.indexOf('// Strict Maeve provider path', providerStart);
assert(providerStart >= 0 && providerEnd > providerStart);
const providerBlock = source.slice(providerStart, providerEnd);
assert(!providerBlock.includes('AICREDITS_API_KEY_GENERAL'), 'Analyzer must not fall back to the general key');
assert(!providerBlock.includes('OPENROUTER_API_KEY'), 'Analyzer must not fall back to OpenRouter');
assert(!providerBlock.includes('FALLBACK_MODELS'), 'Analyzer must not use model fallback');

// Executable coarse error classifier.
const helperStart = source.indexOf('function getAnalyzerProviderFailureCode');
assert(helperStart >= 0);
const helperEnd = source.indexOf('// Strict Screenshot Analyzer provider call', helperStart);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(source.slice(helperStart, helperEnd) + '\nthis.classify = getAnalyzerProviderFailureCode;', ctx);
assert.strictEqual(ctx.classify({ code: 'AI_PROVIDER_CONFIG' }), 'AI_PROVIDER_CONFIG');
assert.strictEqual(ctx.classify({ statusCode: 401 }), 'AI_PROVIDER_AUTH');
assert.strictEqual(ctx.classify({ statusCode: 403 }), 'AI_PROVIDER_AUTH');
assert.strictEqual(ctx.classify({ statusCode: 402 }), 'AI_PROVIDER_BUDGET');
assert.strictEqual(ctx.classify({ statusCode: 429 }), 'AI_PROVIDER_RATE_LIMIT');
assert.strictEqual(ctx.classify({ statusCode: 503 }), 'AI_PROVIDER_UPSTREAM');
assert.strictEqual(ctx.classify({ isTimeout: true }), 'AI_PROVIDER_TIMEOUT');
assert.strictEqual(ctx.classify({ code: 'AI_PROVIDER_EMPTY_RESPONSE' }), 'AI_PROVIDER_EMPTY_RESPONSE');

// Missing config and runtime errors must carry stage without exposing raw provider details to clients.
assert(providerBlock.includes("err.code = 'AI_PROVIDER_CONFIG';"));
assert(providerBlock.includes('err.analyzerStage = stage;'));
assert(providerBlock.includes('timeoutErr.analyzerStage = stage;'));
assert(providerBlock.includes('err.analyzerStage = err.analyzerStage || stage;'));

const analyzerRouteStart = source.indexOf("app.post(['/api/analyze', '/api/analyze-chat-screenshot']");
const analyzerRouteEnd = source.indexOf('// 2. ICEBREAKER GENERATOR', analyzerRouteStart);
const route = source.slice(analyzerRouteStart, analyzerRouteEnd);
assert(route.includes("const analyzerFailureStage = (error && error.analyzerStage) ? error.analyzerStage : 'pipeline';"));
assert(route.includes("? 'ANALYZER_PIPELINE_FAILURE'"));
assert(route.includes('code: analyzerFailureCode'));
assert(route.includes('stage: analyzerFailureStage'));
assert(route.includes('reqId: reqId'));
assert(route.includes('error: "AI analysis failed. Your credits were restored."'));
assert(route.includes('error: "Analysis timed out. Your credits were restored."'));
assert(!route.includes('error: error.message'), 'raw provider error must not be returned to Analyzer clients');
assert(!route.includes('error: errText'), 'raw provider response body must not be returned to Analyzer clients');

console.log('Analyzer provider diagnostic boundary guard passed.');
