'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

const submitStart = app.indexOf('window.submitChatboxMessage = async function()');
const submit = app.slice(submitStart);

assert(submit.includes("'X-Idempotency-Key': idempotencyKey"), 'direct chat requests must send an idempotency header');
assert(submit.includes('idempotencyKey'), 'direct chat requests must include the idempotency key in the payload');
assert(submit.includes('simulatorGeneration'), 'chat responses must be associated with the active simulator generation');
assert(submit.includes('requestGeneration !== simulatorGeneration'), 'stale simulator responses must not mutate the active thread');

const routeStart = server.indexOf("app.post(['/api/chat', '/api/simulator/chat']");
const routeEnd = server.indexOf("app.post('/api/simulator/review'", routeStart);
const route = server.slice(routeStart, routeEnd > routeStart ? routeEnd : server.length);

assert(route.includes('hasExplicitHotline'), 'explicit isHotline boolean must control conflicting mode/scenario values');
assert(/\?\s+req\.body\.isHotline/.test(route), 'explicit false isHotline must not be overridden by mode/scenario');
assert(route.includes('Array.isArray(messages)'), 'chat history normalization must validate the messages array');
assert(route.includes('Array.isArray(conversationHistory)'), 'chat history normalization must support conversationHistory');
assert(route.includes('Please enter a message before sending.'), 'empty chat messages must be rejected before credit reservation');
assert(route.includes('lastMessage && typeof lastMessage === \'object\''), 'malformed last messages must not throw during extraction');

const sqliteStart = server.indexOf('async function verifyAndDeductCreditsSQLite');
const sqlite = server.slice(sqliteStart, server.indexOf('// Persistent Credit Top-Up', sqliteStart));
assert(sqlite.includes('SELECT id FROM credit_deductions WHERE user_id = ? AND request_id = ?'), 'SQLite fallback must check request idempotency before deduction');
assert(sqlite.includes('duplicate: true'), 'SQLite duplicate requests must not deduct again');

console.log('Chat contract guard passed.');
