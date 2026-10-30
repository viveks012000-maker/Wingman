'use strict';

const { PRODUCTION_RAILWAY_ENVIRONMENT_ID } = require('./securityBoundaries');
const RAILWAY_ENVIRONMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Railway injects both variables into every build and deployment. The environment ID is
// the stable identity; the name is retained as a readable consistency check.
function hasRailwayRuntimeIdentity(env = process.env) {
    return typeof env.RAILWAY_ENVIRONMENT_ID === 'string' && RAILWAY_ENVIRONMENT_ID_PATTERN.test(env.RAILWAY_ENVIRONMENT_ID) &&
        typeof env.RAILWAY_ENVIRONMENT_NAME === 'string' && env.RAILWAY_ENVIRONMENT_NAME.trim() !== '';
}

function isRailwayRuntime(env = process.env) {
    return hasRailwayRuntimeIdentity(env);
}

function isProductionRuntime(env = process.env) {
    return env.NODE_ENV === 'production' || isRailwayRuntime(env);
}

function isProductionRailwayEnvironment(env = process.env) {
    return hasRailwayRuntimeIdentity(env) &&
        env.RAILWAY_ENVIRONMENT_ID === PRODUCTION_RAILWAY_ENVIRONMENT_ID &&
        env.RAILWAY_ENVIRONMENT_NAME.trim().toLowerCase() === 'production';
}

module.exports = {
    hasRailwayRuntimeIdentity,
    isRailwayRuntime,
    isProductionRuntime,
    isProductionRailwayEnvironment
};
