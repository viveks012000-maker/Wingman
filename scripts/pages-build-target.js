'use strict';

const {
  ISOLATED_STAGING_PREVIEW_BRANCH,
  PRODUCTION_API_ORIGIN,
  STAGING_API_ORIGIN
} = require('../middleware/securityBoundaries');

function resolvePagesBuildTarget(environment = process.env) {
  const isPreview = environment.CF_PAGES_BRANCH === ISOLATED_STAGING_PREVIEW_BRANCH;
  return Object.freeze({
    isPreview,
    apiOrigin: isPreview ? STAGING_API_ORIGIN : PRODUCTION_API_ORIGIN
  });
}

function rewriteBackendOrigin(source, target) {
  if (typeof source !== 'string' || !target || typeof target.apiOrigin !== 'string') {
    throw new TypeError('A source string and resolved Pages build target are required.');
  }
  return source.split(PRODUCTION_API_ORIGIN).join(target.apiOrigin);
}

module.exports = {
  resolvePagesBuildTarget,
  rewriteBackendOrigin,
  ISOLATED_STAGING_PREVIEW_BRANCH,
  PRODUCTION_API_ORIGIN,
  STAGING_API_ORIGIN
};
