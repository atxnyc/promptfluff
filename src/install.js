'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { configForInstall, readConfigFile } = require('./config');
const { hooksInstallDir, skillsInstallDir, settingsPath, claudeDir } = require('./paths');
const { hasPromptfluffHook, mergeHook } = require('./settings');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const DATA_FILES = [
  'encouragements.json',
  'encouragements-long.json',
  'encouragements-short.json'
];
const SUPPORT_FILES = ['hook.js', 'config.js', 'telemetry.js'];
const SKILL_FILES = ['SKILL.md', 'phrases.js'];

function timestamp() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
}

function backupSettings(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const backupPath = `${filePath}.bak.${timestamp()}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function detectIndent(raw) {
  const match = raw.match(/\n( +)"/);
  return match ? match[1].length : 2;
}

function readSettingsFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    try {
      const settings = raw.trim() ? JSON.parse(raw) : {};
      return { settings, raw, indent: detectIndent(raw), exists: true };
    } catch (error) {
      const backupPath = backupSettings(filePath);
      const wrapped = new Error(
        `Could not parse ${filePath}. Backed it up to ${backupPath}. Fix or remove it, then rerun promptfluff.`
      );
      wrapped.code = 'EPROMPTFLUFF_SETTINGS_JSON';
      wrapped.cause = error;
      wrapped.backupPath = backupPath;
      throw wrapped;
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { settings: {}, raw: '', indent: 2, exists: false };
    }
    throw error;
  }
}

function writeSettingsFile(filePath, settings, indent) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(settings, null, indent)}\n`);
}

function quoteCommand(filePath) {
  return `node "${filePath.replace(/"/g, '\\"')}"`;
}

function copyHookFiles(installDir) {
  fs.mkdirSync(installDir, { recursive: true });
  for (const file of SUPPORT_FILES) {
    fs.copyFileSync(path.join(__dirname, file), path.join(installDir, file));
  }
  for (const file of DATA_FILES) {
    fs.copyFileSync(path.join(PACKAGE_ROOT, 'data', file), path.join(installDir, file));
  }
}

function writeConfig(installDir, config) {
  fs.writeFileSync(path.join(installDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
}

function copySkillFiles(skillDir) {
  fs.mkdirSync(skillDir, { recursive: true });
  for (const file of SKILL_FILES) {
    fs.copyFileSync(
      path.join(PACKAGE_ROOT, 'skills', 'promptfluff', file),
      path.join(skillDir, file)
    );
  }
}

function install(options = {}) {
  const targetDir = claudeDir(options);
  const installDir = hooksInstallDir(options);
  const skillDir = skillsInstallDir(options);
  const hookPath = path.join(installDir, 'hook.js');
  const command = quoteCommand(hookPath);
  const settingsFile = settingsPath(options);
  const config = configForInstall(options);
  const current = readSettingsFile(settingsFile);
  const next = mergeHook(current.settings, command);
  const changedSettings = JSON.stringify(current.settings) !== JSON.stringify(next);

  copyHookFiles(installDir);
  writeConfig(installDir, config);
  copySkillFiles(skillDir);

  let backupPath = null;
  if (changedSettings) {
    backupPath = backupSettings(settingsFile);
    writeSettingsFile(settingsFile, next, current.indent);
  }

  return {
    claudeDir: targetDir,
    installDir,
    skillDir,
    settingsPath: settingsFile,
    command,
    config,
    changedSettings,
    backupPath
  };
}

function status(options = {}) {
  const targetDir = claudeDir(options);
  const installDir = hooksInstallDir(options);
  const hookPath = path.join(installDir, 'hook.js');
  const settingsFile = settingsPath(options);
  let settings = {};
  let settingsReadable = false;
  let settingsError = null;

  try {
    settings = readSettingsFile(settingsFile).settings;
    settingsReadable = true;
  } catch (error) {
    settingsError = error;
  }

  return {
    claudeDir: targetDir,
    installDir,
    settingsPath: settingsFile,
    hookPath,
    filesPresent: fs.existsSync(hookPath),
    settingsReadable,
    settingsError,
    installed: settingsReadable && hasPromptfluffHook(settings),
    config: fs.existsSync(installDir) ? readConfigFile(installDir) : {}
  };
}

module.exports = {
  DATA_FILES,
  SUPPORT_FILES,
  SKILL_FILES,
  backupSettings,
  copyHookFiles,
  copySkillFiles,
  install,
  quoteCommand,
  readSettingsFile,
  status,
  writeSettingsFile
};
