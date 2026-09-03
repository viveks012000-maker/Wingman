'use strict';
/**
 * Preload stub for the live-provider origin-lock probe.
 * Intercepts ALL fetches in the child process, records {url, auth, model} to ORIGIN_LOG,
 * and serves deterministic in-process responses for the OFFICIAL origin (no network):
 *   - Stage 1 vision model -> choices with parsed content
 *   - Stage 2 generation model -> choices with a 10-option JSON payload
 * Any non-official URL gets a 403 and is flagged. No real network call is ever made.
 */
const fs = require('fs');
const LOG = process.env.ORIGIN_LOG;
const attempts = [];

function stageReply(body) {
    let model = '';
    try { model = String(JSON.parse(body).model || ''); } catch (_) {}
    if (model.includes('235b-a22b-2507')) {
        const options = Array.from({ length: 10 }, (_, i) => 'option ' + (i + 1));
        return JSON.stringify({ choices: [{ message: { content: JSON.stringify({ options }) } }] });
    }
    return JSON.stringify({ choices: [{ message: { content: 'optical parse ok' } }] });
}

globalThis.fetch = async function originLockFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const headers = (init && init.headers) || {};
    const auth = headers['Authorization'] || headers.authorization || '';
    const official = url.startsWith('https://api.aicredits.in/v1');
    attempts.push({ url: String(url), hasAuth: Boolean(auth), official });
    if (LOG) fs.writeFileSync(LOG, JSON.stringify(attempts, null, 1));
    if (!official) {
        return { ok: false, status: 403, json: async () => ({ error: 'origin-lock-stub-nonofficial' }), arrayBuffer: async () => Buffer.from('{}'), text: async () => '{}' };
    }
    return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(stageReply(init.body)),
        arrayBuffer: async () => Buffer.from('{}'),
        text: async () => '{}'
    };
};
