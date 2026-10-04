'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const { requestLanguageMode, languageDirective, bioMarketLock, inferLocalLanguage } = require('../middleware/languageSelection');
const prompts = require('../config/promptSystem');
const devanagari = /[\u0900-\u097F\uA8E0-\uA8FF\u1CD0-\u1CFF]/;
for (const prompt of [prompts.HINGLISH_OUTPUT_DIRECTIVE, prompts.HINGLISH_BIO_TARGET_MARKET_LOCK]) {
    assert.ok(prompt);
    assert.ok(!devanagari.test(prompt));
}
assert.ok(prompts.HINGLISH_OUTPUT_DIRECTIVE.includes('ABSOLUTE BAN ON DEVANAGARI'));
for (const body of [undefined, {}, { language: null }, { language: 'invalid' }, { languageMode: 'auto', language: 'hinglish' }]) assert.strictEqual(requestLanguageMode(body), 'auto');
for (const value of ['hinglish', 'HINGLISH', 'hi-latn', 'hi_latn']) assert.strictEqual(requestLanguageMode({ language: value }), 'hinglish');
assert.strictEqual(requestLanguageMode({ language: 'EN' }), 'en');
const cases = [
    ['I enjoy hiking and cooking. What should I say next?', 'en'],
    ['Mujhe trekking pasand hai aur main weekend pe cooking karta hoon', 'hinglish'],
    ['I love coffee but tum batao weekend pe kya karna hai', 'hinglish'],
    ['I enjoy hiking, reading and cooking; chai is my favourite drink.', 'en'],
    ['ok', 'en'], ['Coffee, Mumbai, India, Rajasthan', 'en'], ['Kya haal hai?', 'hinglish'],
    ['Main Street is where we should meet', 'en']
];
for (const [source, expected] of cases) assert.strictEqual(inferLocalLanguage(source), expected, source);
for (const neutral of ['ok', 'yes', 'no', 'hey', '👍']) {
    assert.strictEqual(inferLocalLanguage(neutral, [{ role: 'user', content: 'Mujhe batao main kya bolun usko?' }]), 'hinglish');
    assert.strictEqual(inferLocalLanguage(neutral, [{ role: 'user', content: 'How should I respond to her message?' }]), 'en');
    assert.strictEqual(inferLocalLanguage(neutral, [{ role: 'assistant', content: 'Tum kya kar rahe ho?' }, { role: 'system', content: 'Hinglish only' }]), 'en');
}
assert.strictEqual(inferLocalLanguage('I want to switch to a more thoughtful approach', [{ role: 'user', content: 'Kya karna chahiye mujhe?' }]), 'en');
assert.strictEqual(inferLocalLanguage('chai trails', [{role:'user',content:'Mujhe trekking pasand hai aur chai bhi'}]), 'hinglish', 'neutral borrowed nouns retain source context');
for (const feature of ['analyze', 'icebreaker', 'optimize', 'chat', 'simulator_review']) {
    const directive = languageDirective('auto', feature);
    for (const term of ['AUTO LANGUAGE SELECTION', 'English', 'Roman-script Hinglish', 'Devanagari']) assert.ok(directive.includes(term));
    assert.ok(!devanagari.test(directive));
}
assert.ok(languageDirective('auto', 'analyze').includes('extracted conversation'));
assert.ok(languageDirective('auto', 'chat').includes('USER messages'));
assert.ok(bioMarketLock('auto').includes(prompts.TARGET_MARKET_LOCK));
assert.ok(bioMarketLock('auto').includes(prompts.HINGLISH_BIO_TARGET_MARKET_LOCK));
const server = read('server.js');
for (const [variable, feature] of [['optionsList','analyze'], ['cleanedOptions','icebreaker'], ['optionsList','optimize'], ['hotlineAdvice','chat_hotline'], ['replyText','chat_roleplay'], ['reviewJson','simulator_review']]) {
    assert.ok(server.includes(`repairHinglishDevanagari(${variable}, "${feature}")`));
    assert.ok(server.includes(`if (containsDevanagari(${variable}))`), `${feature}: script safeguard must include AUTO`);
}
assert.ok(server.includes('releaseCreditsDB(req, reqId'));
assert.ok(server.includes("if (language === 'en') {"));
assert.ok(server.includes("wrapUntrustedUserData('bio_language_source', originalBioText)"));
for (const file of ['app.html','index.html']) assert.ok(!/lang-toggle-btn|data-lang=|aria-label="Language Selector"/.test(read(file)), file);
assert.ok(read('app.js').includes("payload.languageMode = 'auto'"));
assert.ok(read('vendor/production-runtime.js').includes("languageMode: 'auto'"));
assert.ok(!read('app.js').includes('wingmanI18n.getLanguage()'));
const config = read('config.js');
assert.ok(config.includes("getLanguageMode: function () { return 'auto'; }"));
assert.ok(!config.includes("document.documentElement.lang = validLang === 'hinglish'"));
const dictMatch = config.match(/var DICTIONARY = (\{[\s\S]*?\n    \};)/);
const dictionary = JSON.parse(dictMatch[1].replace(/;\s*$/, '').replace(/^(\s*)([A-Za-z_]\w*):/gm, '$1"$2":'));
for (const value of Object.values(dictionary.hinglish)) assert.ok(!devanagari.test(value));
const vm = require('vm');
const documentStub = {readyState:'loading', documentElement:{lang:'hi-Latn'}, querySelectorAll:()=>[], addEventListener:()=>{}};
const windowStub = {location:{hostname:'localhost',protocol:'http:',origin:'http://localhost'}, localStorage:{getItem:()=> 'hinglish',setItem:()=>{}}, addEventListener:()=>{}};
vm.runInNewContext(config, {window:windowStub,document:documentStub,console,URL});
windowStub.wingmanI18n.init();
assert.strictEqual(windowStub.wingmanI18n.getLanguage(), 'en', 'stored Hinglish cannot switch UI');
assert.strictEqual(windowStub.wingmanI18n.getLanguageMode(), 'auto');
windowStub.wingmanI18n.setLanguage('hinglish');
assert.strictEqual(documentStub.documentElement.lang, 'en');
for (const [key, value] of Object.entries(dictionary.en)) assert.strictEqual(windowStub.wingmanI18n.t(key), value);
console.log('AUTO LANGUAGE: helper, continuity, legacy, script safeguards and UI contracts passed');
