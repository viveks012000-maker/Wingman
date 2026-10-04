'use strict';
// Real Express routes, mocked provider responses and isolated credit database.
// This verifies dispatch/continuity/safety contracts, not real-model language quality.
const assert = require('assert');
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key-for-tests';
process.env.ENABLE_MOCK_AUTH = 'true';
process.env.NODE_ENV = 'test';
process.env.AICREDITS_API_KEY = 'stub-general-key';
process.env.AICREDITS_API_KEY_GENERAL = 'stub-general-key';
process.env.AICREDITS_API_KEY_VISION = 'stub-vision-key';
delete process.env.RAILWAY_ENVIRONMENT;

const AUTH_USER_ID = '66666666-6666-6666-6666-666666666666';

function makeStubAdmin() {
    const state = { rpcCalls: [] };
    const admin = {
        __state: state,
        from(table) {
            const b = {};
            ['select', 'eq', 'is', 'order', 'limit', 'update', 'delete', 'insert'].forEach(m => { b[m] = () => b; });
            b.maybeSingle = async () => {
                if (table === 'user_consents') {
                    return { data: { id: 'consent-row', terms_version: '2026.1', privacy_version: '2026.1', age_18_plus: true, ai_processing_consent: true, withdrawn_at: null }, error: null };
                }
                if (table === 'profiles') return { data: { credits: 500 }, error: null };
                return { data: null, error: null };
            };
            b.then = (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject);
            return b;
        },
        rpc(name) {
            state.rpcCalls.push({ name, args: arguments[1] });
            if (name === 'reserve_credits') return Promise.resolve({ data: [{ success: true, new_balance: 40, duplicate: false }], error: null });
            if (name === 'settle_credits') return Promise.resolve({ data: { success: true, settled: true }, error: null });
            if (name === 'release_credits') return Promise.resolve({ data: { success: true, settled: true, released: true }, error: null });
            return Promise.resolve({ data: null, error: null });
        },
        auth: { admin: { deleteUser: async () => ({ error: null }) } }
    };
    return admin;
}

const stubAdmin = makeStubAdmin();
const supabaseJsPath = require.resolve('@supabase/supabase-js');
require.cache[supabaseJsPath] = { id: supabaseJsPath, filename: supabaseJsPath, loaded: true, exports: { createClient: () => stubAdmin } };

const request = require('supertest');
const { app } = require('../server');


const calls = [];
let output = '';
let queuedOutputs = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
 const url = typeof input === 'string' ? input : input.url;
 if (!url.includes('/chat/completions')) return realFetch(input, init);
 calls.push(JSON.parse(init.body));
 const content = queuedOutputs.length ? queuedOutputs.shift() : output;
 return {ok:true,status:200,json:async()=>({choices:[{message:{content}}]}),text:async()=> '{}'};
};
const AUTH = {'x-mock-auth':'true','x-test-user-id':AUTH_USER_ID};
const en = 'I enjoy hiking and cooking. What should I say next?';
const hi = 'Mujhe trekking pasand hai aur main weekend pe cooking karta hoon';
const cases = [
 {name:'English',text:en,language:'en'},
 {name:'Hinglish',text:hi,language:'hinglish'},
 {name:'mixed',text:'I love coffee but tum batao weekend pe kya karna hai',language:'hinglish'},
 {name:'ambiguous',text:'ok',language:'en'},
 {name:'Hinglish-ok',text:hi+'\nUSER: ok',latest:'ok',history:hi,language:'hinglish'},
 {name:'English-ok',text:en+'\nUSER: ok',latest:'ok',history:en,language:'en'}
];
const {inferLocalLanguage} = require('../middleware/languageSelection');
async function run() {
 let serial = 0;
 for (const feature of ['analyze','icebreaker','optimize','hotline','practice','review']) {
  for (const test of cases) {
   const content = feature === 'optimize' && test.name === 'ambiguous' ? 'ok 👍👍' : test.text;
   const history = [{role:'user',content:test.history || test.text},{role:'assistant',content:'Okay, tell me more.'}];
   const sample = test.language === 'hinglish' ? 'tum batao chai pe kab milna hai?' : 'what is your favourite coffee spot?';
   output = ['analyze','icebreaker','optimize'].includes(feature)
      ? JSON.stringify({options:Array.from({length:10},(_,i)=>sample+' '+i)})
      : feature === 'review' ? JSON.stringify({overall_score:70,status_text:'SOLID',wit_score:'70%',text_economy:'75%',confidence_score:'80%',performance_summary:sample,biggest_strength:sample,biggest_mistake:sample,priority_focus:sample})
      : sample;
   if (feature === 'icebreaker') output = Array.from({length:10},(_,i)=>(i+1)+'. '+sample+' '+i).join('\n');
   calls.length = 0;
   stubAdmin.__state.rpcCalls.length = 0;
   const body = {languageMode:'auto',language:'en',text:content,bioText:content,shorthandOption:true,emojiOption:0,idempotencyKey:'auto_'+(++serial)};
   let route = '/api/'+feature;
   if (feature === 'analyze') {delete body.text; body.messages=[{role:'user',content}];}
   if (feature === 'hotline' || feature === 'practice') {
     route='/api/chat'; body.message=test.latest || test.text; body.messages=history;
     body.scenario=feature === 'hotline' ? 'Coach Hotline' : 'Flirting & Teasing';
   }
   if (feature === 'review') {route='/api/simulator/review';body.sessionHistory=[...history,{role:'user',content:test.latest || test.text}];}
   const response = await request(app).post(route).set({...AUTH, 'x-test-user-id': '66666666-6666-6666-6666-'+String(serial).padStart(12,'0')}).send(body);
   assert.strictEqual(response.status,200,feature+'/'+test.name+': '+response.text.slice(0,220));
   assert.strictEqual(response.body.success,true);
   assert.strictEqual(calls.length,1,feature+': no extra detection call');
   const system = calls[0].messages[0].content;
   assert.ok(system.includes('AUTO LANGUAGE SELECTION'),feature);
   assert.ok(system.includes('UNTRUSTED DATA BOUNDARY:'));
   assert.ok(JSON.stringify(calls[0].messages.slice(1)).includes(test.latest || content),feature+': source preserved');
   assert.strictEqual(stubAdmin.__state.rpcCalls.filter(call=>call.name==='reserve_credits').length,1);
   assert.strictEqual(stubAdmin.__state.rpcCalls.filter(call=>call.name==='settle_credits').length,1);
   const reserve = stubAdmin.__state.rpcCalls.find(call=>call.name==='reserve_credits');
   const cost = ['analyze','icebreaker','optimize'].includes(feature) ? 10 : 2;
   assert.ok(Object.values(reserve.args).includes(cost),feature+': original cost');
   assert.ok(!/[\u0900-\u097F\uA8E0-\uA8FF\u1CD0-\u1CFF]/.test(JSON.stringify(response.body)));
   if (Array.isArray(response.body.options)) assert.strictEqual(response.body.options.length,10);
   assert.strictEqual(inferLocalLanguage(test.latest || test.text, history),test.language);
  }
 }
 // Older clients remain supported; AUTO takes priority over a stale preference.
 for (const legacy of ['en','hinglish','hi-latn','invalid',null]) {
  calls.length=0; output='tum batao ab kya karna hai?';
  const response=await request(app).post('/api/chat').set({...AUTH,'x-test-user-id':'77777777-7777-7777-7777-'+String(++serial).padStart(12,'0')}).send({language:legacy,message:hi,idempotencyKey:'legacy_'+serial});
  assert.strictEqual(response.status,200);
  assert.strictEqual(calls.length,1);
  assert.strictEqual(calls[0].messages[0].content.includes('AUTO LANGUAGE SELECTION'),!['en','hinglish','hi-latn'].includes(legacy));
 }
 // OCR fixture: the existing vision call is followed by one generation, and
 // extracted conversation is forwarded verbatim rather than translated.
 const pixels=Buffer.alloc(54+800*800*3,240);
 pixels.write('BM',0);pixels.writeUInt32LE(pixels.length,2);pixels.writeUInt32LE(54,10);pixels.writeUInt32LE(40,14);pixels.writeInt32LE(800,18);pixels.writeInt32LE(800,22);pixels.writeUInt16LE(1,26);pixels.writeUInt16LE(24,28);pixels.writeUInt32LE(800*800*3,34);
 const transcript=JSON.stringify({chat_history:[{sender:'match',type:'text',text:hi}],latest_sender:'match',active_status:'active',match_has_replied:true});
 const optionOutput=JSON.stringify({options:Array.from({length:10},(_,i)=>'tum batao chai pe kab milna hai '+i)});
 queuedOutputs=[transcript,optionOutput];calls.length=0;
 const imageResult=await request(app).post('/api/analyze').set({...AUTH,'x-test-user-id':'88888888-8888-8888-8888-888888888888'}).send({languageMode:'auto',image:'data:image/bmp;base64,'+pixels.toString('base64'),idempotencyKey:'auto_image'});
 assert.strictEqual(imageResult.status,200,imageResult.text.slice(0,200));
 assert.strictEqual(calls.length,2,'one OCR + one generation; no detector');
 assert.ok(calls[1].messages[1].content.includes(hi),'OCR text remains untranslated');
 assert.strictEqual(imageResult.body.options.length,10);
 // Script repair retains the existing exceptional repair request and does not
 // reserve another debit; failures release the reserved credits.
 for (const repairFails of [false,true]) {
  calls.length=0;stubAdmin.__state.rpcCalls.length=0;
  queuedOutputs=['क्या करूँ', repairFails ? 'क्या करूँ' : 'tum batao kya karna hai'];
  const repaired=await request(app).post('/api/chat').set({...AUTH,'x-test-user-id':repairFails?'99999999-9999-9999-9999-999999999991':'99999999-9999-9999-9999-999999999992'}).send({languageMode:'auto',message:hi,idempotencyKey:'script_repair_'+repairFails});
  assert.strictEqual(calls.length,2,'existing generation plus exceptional script repair');
  assert.strictEqual(stubAdmin.__state.rpcCalls.filter(call=>call.name==='reserve_credits').length,1);
  if (repairFails) {
   assert.ok(repaired.status>=400);
   assert.strictEqual(stubAdmin.__state.rpcCalls.filter(call=>call.name==='release_credits').length,1);
   assert.strictEqual(stubAdmin.__state.rpcCalls.filter(call=>call.name==='settle_credits').length,0);
  } else {
   assert.strictEqual(repaired.status,200);
   assert.ok(!/[\u0900-\u097F]/.test(repaired.body.reply));
  }
 }
 calls.length=0;queuedOutputs=['क्या करूँ','what should i say next?'];
 const englishRepair=await request(app).post('/api/chat').set({...AUTH,'x-test-user-id':'11111111-1111-1111-1111-111111111111'}).send({language:'en',message:en,idempotencyKey:'english_script_repair'});
 assert.strictEqual(englishRepair.status,200);
 assert.strictEqual(calls.length,2);
 assert.ok(calls[1].messages[0].content.includes('Write all generated response fields in English'));
 assert.ok(calls[1].messages[1].content.includes(en),'repair receives original source');
 assert.ok(calls[1].messages[1].content.includes('user_data_'),'repair source remains untrusted');
 assert.strictEqual(englishRepair.body.reply,'what should i say next?');
 calls.length=0;stubAdmin.__state.rpcCalls.length=0;
 queuedOutputs=[JSON.stringify({options:Array.from({length:10},()=> 'क्या करूँ')}),JSON.stringify({options:['tum batao kya karna hai']})];
 const wrongCount=await request(app).post('/api/analyze').set({...AUTH,'x-test-user-id':'22222222-2222-2222-2222-222222222222'}).send({languageMode:'auto',messages:[{role:'user',content:hi}],idempotencyKey:'wrong_repair_count'});
 assert.ok(wrongCount.status>=400,'repair cannot silently change output count');
 assert.strictEqual(stubAdmin.__state.rpcCalls.filter(call=>call.name==='release_credits').length,1);
 console.log('AUTO runtime: 36 source cases, legacy, OCR and repair/refund checks passed (mock provider, no real credits)');
 process.exit(0);
}
run().catch(error=>{console.error(error.stack || error);process.exit(1);});
