'use strict';

const assert = require('node:assert/strict');
const {
    hasRailwayRuntimeIdentity,
    isRailwayRuntime,
    isProductionRuntime,
    isProductionRailwayEnvironment
} = require('../middleware/railwayEnvironment');

const production = {
    NODE_ENV: 'production',
    RAILWAY_ENVIRONMENT_NAME: 'production',
    RAILWAY_ENVIRONMENT_ID: '30e98667-a8a1-415d-8cf1-55e670f45bd0'
};
const staging = {
    NODE_ENV: 'production',
    RAILWAY_ENVIRONMENT_NAME: 'razorpay-staging',
    RAILWAY_ENVIRONMENT_ID: '438d986c-d799-42a0-9149-ef0eef809486'
};

assert.equal(hasRailwayRuntimeIdentity(production), true);
assert.equal(isRailwayRuntime(production), true);
assert.equal(isProductionRuntime(production), true);
assert.equal(isProductionRailwayEnvironment(production), true);

assert.equal(isRailwayRuntime(staging), true);
assert.equal(isProductionRuntime(staging), true, 'every Railway deployment keeps production-safe auth defaults');
assert.equal(isProductionRailwayEnvironment(staging), false, 'staging cannot pass the exact production environment gate');
assert.equal(isProductionRailwayEnvironment({
    ...production,
    RAILWAY_ENVIRONMENT_ID: '438d986c-d799-42a0-9149-ef0eef809486'
}), false, 'a production-looking name cannot override a different Railway environment ID');
assert.equal(isProductionRailwayEnvironment({
    ...production,
    RAILWAY_ENVIRONMENT_NAME: 'preview'
}), false, 'a production ID with a different environment name fails closed');

assert.equal(hasRailwayRuntimeIdentity({ RAILWAY_ENVIRONMENT: 'production' }), false);
assert.equal(isRailwayRuntime({ RAILWAY_ENVIRONMENT_ID: production.RAILWAY_ENVIRONMENT_ID }), false,
    'an incomplete Railway identity is not trusted as a running Railway deployment');
assert.equal(isProductionRuntime({ RAILWAY_ENVIRONMENT: 'production' }), false,
    'the obsolete undocumented variable does not establish production runtime');
assert.equal(isRailwayRuntime({
    RAILWAY_ENVIRONMENT_NAME: 'production',
    RAILWAY_ENVIRONMENT_ID: 'not-a-railway-uuid'
}), false, 'a hand-written environment-like value is not accepted as Railway identity');

console.log('PASS: Railway runtime detection trusts documented environment name and stable environment ID.');
