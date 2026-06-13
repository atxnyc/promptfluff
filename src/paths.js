'use strict';

const os = require('node:os');
const path = require('node:path');

function expandTilde(value, homeDir = os.homedir()) {
  if (typeof value !== 'string') {
    return value;
  }
  if (value === '~') {
    return homeDir;
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(homeDir, value.slice(2));
  }
  return value;
}

function absoluteDir(value, homeDir = os.homedir()) {
  return path.resolve(expandTilde(value, homeDir));
}

function claudeDir(options = {}) {
  if (options.dir) {
    return absoluteDir(options.dir, options.homeDir);
  }
  const env = options.env || process.env;
  if (env.CLAUDE_CONFIG_DIR) {
    return absoluteDir(env.CLAUDE_CONFIG_DIR, options.homeDir);
  }
  return path.join(options.homeDir || os.homedir(), '.claude');
}

function settingsPath(options = {}) {
  return path.join(claudeDir(options), 'settings.json');
}

function hooksInstallDir(options = {}) {
  return path.join(claudeDir(options), 'hooks', options.name || 'promptfluff');
}

function skillsInstallDir(options = {}) {
  return path.join(claudeDir(options), 'skills', options.name || 'promptfluff');
}

module.exports = {
  expandTilde,
  claudeDir,
  settingsPath,
  hooksInstallDir,
  skillsInstallDir
};
