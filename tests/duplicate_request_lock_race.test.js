const assert=require('assert'); const fs=require('fs'); const vm=require('vm');
const source=fs.readFileSync('server.js','utf8').replace(/\r\n/g,'\n');
assert(source.includes('const activeUserAiRequests = new Map();'));
assert(source.includes('function acquireUserConcurrencyLock(userId, requestId)'));
assert(source.includes('function releaseUserConcurrencyLock(userId, requestId)'));
assert(!source.includes('const activeUserAiRequests = new Set();'));
const a=source.indexOf('const activeUserAiRequests = new Map();');
const b=source.indexOf('// =========================================================================================\n// SERVER-AUTHORITATIVE CONSENT',a);
const ctx={}; vm.createContext(ctx); vm.runInContext(source.slice(a,b)+'\nthis.acq=acquireUserConcurrencyLock;this.rel=releaseUserConcurrencyLock;',ctx);
let x=ctx.acq('u','r1'); assert(x.acquired&&!x.duplicate);
x=ctx.acq('u','r1'); assert(!x.acquired&&x.duplicate);
x=ctx.acq('u','r2'); assert(!x.acquired&&!x.duplicate);
ctx.rel('u','r2'); x=ctx.acq('u','r2'); assert(!x.acquired,'wrong request id released active lock');
ctx.rel('u','r1'); x=ctx.acq('u','r2'); assert(x.acquired); ctx.rel('u','r2');
const markers=["app.post(['/api/analyze', '/api/analyze-chat-screenshot']","app.post('/api/icebreaker'","app.post(['/api/optimize', '/api/bio-optimizer']","app.post(['/api/chat', '/api/simulator/chat']","app.post('/api/simulator/review'"];
for(const m of markers){ const i=source.indexOf(m); assert(i>=0,m); const h=source.slice(i,i+2200); const q=h.indexOf('const reqId ='); const l=h.indexOf('const lockState = acquireUserConcurrencyLock(uid, reqId);'); assert(q>=0&&l>q,`${m}: reqId must precede lock`); assert(h.includes('if (lockState.duplicate)')); assert(h.includes('return res.status(409).json({')); assert(h.includes('code: "DUPLICATE_REQUEST"')); assert(h.includes('return res.status(429).json({ success: false, error: "A generation is already in progress')); }
assert.strictEqual((source.match(/releaseUserConcurrencyLock\(uid, reqId\);/g)||[]).length,5);
console.log('Duplicate request concurrency lock race guard passed.');
