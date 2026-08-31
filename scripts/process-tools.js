'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

function existingFile(file) {
  return file && fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

function canRun(executable) {
  if (!executable) return false;
  const result = spawnSync(executable, ['--version'], {
    stdio: 'ignore',
    windowsHide: true
  });
  return !result.error && result.status === 0;
}

function githubDesktopGitCandidates() {
  if (process.platform !== 'win32') return [];
  const root = path.join(os.homedir(), 'AppData', 'Local', 'GitHubDesktop');
  let versions = [];
  try {
    versions = fs.readdirSync(root)
      .filter(name => /^app-/i.test(name))
      .sort()
      .reverse();
  } catch (_) {
    return [];
  }
  return versions.map(version => path.join(root, version, 'resources', 'app', 'git', 'cmd', 'git.exe'));
}

function resolveGitExecutable() {
  const candidates = [
    process.env.GIT_EXECUTABLE,
    'git',
    ...(process.platform === 'win32' ? [
      path.join(process.env.ProgramW6432 || '', 'Git', 'cmd', 'git.exe'),
      path.join(process.env.ProgramFiles || '', 'Git', 'cmd', 'git.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Git', 'cmd', 'git.exe'),
      path.join(process.env.ProgramW6432 || '', 'Git', 'bin', 'git.exe'),
      path.join(process.env.ProgramFiles || '', 'Git', 'bin', 'git.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Git', 'bin', 'git.exe'),
      ...githubDesktopGitCandidates()
    ] : [])
  ];

  for (const candidate of [...new Set(candidates)]) {
    if (!candidate || (path.isAbsolute(candidate) && !existingFile(candidate)) || !canRun(candidate)) continue;
    return candidate;
  }
  return null;
}

function currentGitSha(cwd, env = process.env) {
  const git = resolveGitExecutable();
  if (git) {
    try {
      const head = execFileSync(git, ['rev-parse', 'HEAD'], {
        cwd,
        encoding: 'utf8',
        windowsHide: true
      }).trim();
      if (/^[0-9a-f]{40}$/i.test(head)) return head.toLowerCase();
    } catch (_) {}
  }
  for (const value of [env.SOURCE_COMMIT, env.GITHUB_SHA]) {
    if (/^[0-9a-f]{40}$/i.test(value || '')) return value.toLowerCase();
  }
  return 'unknown';
}

function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ];
  for (const candidate of [...new Set(candidates)]) {
    if (existingFile(candidate) && !/\.cmd$/i.test(candidate)) return candidate;
  }
  return null;
}

function runNpmScript(script, options = {}) {
  const npmCli = resolveNpmCli();
  if (!npmCli) throw new Error('Could not locate npm-cli.js for a shell-free npm invocation.');
  const { args = [], ...execOptions } = options;
  return execFileSync(process.execPath, [npmCli, 'run', script, ...args], {
    ...execOptions,
    shell: false,
    windowsHide: true
  });
}

module.exports = { resolveGitExecutable, currentGitSha, resolveNpmCli, runNpmScript };
