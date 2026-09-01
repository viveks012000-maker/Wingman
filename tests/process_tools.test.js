'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { resolveGitExecutable, resolveNpmCli, currentGitSha } = require('../scripts/process-tools');

const ROOT = path.resolve(__dirname, '..');
const git = resolveGitExecutable();
const npmCli = resolveNpmCli();

assert(git, 'a usable Git executable must be discoverable without relying only on PATH');
assert(fs.existsSync(git), `resolved Git executable must exist: ${git}`);
assert(/^[0-9a-f]{40}$/i.test(currentGitSha(ROOT)), 'resolved Git executable must read the checkout HEAD');
assert(npmCli && fs.existsSync(npmCli), 'npm CLI JavaScript entrypoint must be discoverable');
assert(!/\.cmd$/i.test(npmCli), 'Windows npm execution must not depend on npm.cmd child-process spawning');

console.log(`Process tools resolved Git at ${git} and npm at ${npmCli}.`);
