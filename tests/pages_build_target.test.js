'use strict';

const assert = require('node:assert/strict');
const {
  ISOLATED_STAGING_PREVIEW_BRANCH,
  PRODUCTION_API_ORIGIN,
  STAGING_API_ORIGIN,
  resolvePagesBuildTarget,
  rewriteBackendOrigin
} = require('../scripts/pages-build-target');

const preview = resolvePagesBuildTarget({ CF_PAGES_BRANCH: ISOLATED_STAGING_PREVIEW_BRANCH });
assert.equal(preview.apiOrigin, STAGING_API_ORIGIN, 'the candidate Pages branch must use the isolated staging API');
assert.equal(preview.isPreview, true, 'the candidate branch must be identified as a preview build');

const production = resolvePagesBuildTarget({ CF_PAGES_BRANCH: 'main' });
assert.equal(production.apiOrigin, PRODUCTION_API_ORIGIN, 'the production Pages branch must keep the production API');
assert.equal(production.isPreview, false, 'the production branch must not be treated as a preview');

const otherPreview = resolvePagesBuildTarget({ CF_PAGES_BRANCH: 'codex/unapproved-branch' });
assert.equal(otherPreview.apiOrigin, PRODUCTION_API_ORIGIN, 'unapproved preview branches must never receive the staging API');
assert.equal(otherPreview.isPreview, false, 'only the exact candidate branch may be treated as the isolated preview');

const configSource = `window.WINGMAN_CONFIG = { API_BASE_URL: "${PRODUCTION_API_ORIGIN}" };`;
const cspSource = `connect-src 'self' ${PRODUCTION_API_ORIGIN};`;
assert.equal(
  rewriteBackendOrigin(configSource, preview),
  `window.WINGMAN_CONFIG = { API_BASE_URL: "${STAGING_API_ORIGIN}" };`,
  'preview config must point to staging'
);
assert.equal(
  rewriteBackendOrigin(cspSource, preview),
  `connect-src 'self' ${STAGING_API_ORIGIN};`,
  'preview CSP must allow the staging API while excluding production'
);
assert.equal(rewriteBackendOrigin(configSource, production), configSource, 'production config must remain byte-for-byte unchanged');
assert.equal(rewriteBackendOrigin('connect-src https://attacker.example;', preview), 'connect-src https://attacker.example;', 'unrelated origins must remain unchanged');

console.log('✔ Cloudflare Pages build target routes the candidate preview to staging and production to production.');
