'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BUILD_SCRIPT = path.join(ROOT, 'scripts', 'build-netlify-dist.js');

function gitCandidates() {
  const candidates = [process.env.GIT_EXECUTABLE, 'git'];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const desktopRoot = path.join(process.env.LOCALAPPDATA, 'GitHubDesktop');
    try {
      const versions = fs.readdirSync(desktopRoot)
        .filter(name => /^app-/i.test(name))
        .sort()
        .reverse();
      for (const version of versions) {
        candidates.push(path.join(desktopRoot, version, 'resources', 'app', 'git', 'cmd', 'git.exe'));
      }
    } catch (_) {}
  }
  return [...new Set(candidates.filter(Boolean))];
}

function git(args) {
  for (const candidate of gitCandidates()) {
    try {
      return execFileSync(candidate, args, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
    } catch (_) {}
  }
  throw new Error('No usable Git executable found for checked-in source verification.');
}

const buildSource = fs.readFileSync(BUILD_SCRIPT, 'utf8');
if (buildSource.includes("require('./process-tools')")) {
  const dependencyPath = path.join(ROOT, 'scripts', 'process-tools.js');
  assert(fs.existsSync(dependencyPath), 'build-netlify-dist.js imports scripts/process-tools.js, which must be included in source archives');

  let gitAvailable = false;
  try {
    git(['--version']);
    gitAvailable = true;
  } catch (_) {}

  if (gitAvailable) {
    let tracked = false;
    try {
      git(['ls-files', '--error-unmatch', '--', 'scripts/process-tools.js']);
      tracked = true;
    } catch (_) {}
    assert(tracked, 'build-netlify-dist.js imports scripts/process-tools.js, which must be tracked when Git metadata is available');
  }
}

console.log('Build-script dependency guard passed.');
