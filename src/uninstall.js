'use strict';

const fs = require('node:fs');

const { hooksInstallDir, skillsInstallDir, settingsPath, claudeDir } = require('./paths');
const { removeHook } = require('./settings');
const { backupSettings, readSettingsFile, writeSettingsFile } = require('./install');

function uninstall(options = {}) {
  const targetDir = claudeDir(options);
  const installDir = hooksInstallDir(options);
  const skillDir = skillsInstallDir(options);
  const settingsFile = settingsPath(options);
  const current = readSettingsFile(settingsFile);
  const next = removeHook(current.settings);
  const changedSettings = JSON.stringify(current.settings) !== JSON.stringify(next);

  let backupPath = null;
  if (changedSettings) {
    backupPath = backupSettings(settingsFile);
    writeSettingsFile(settingsFile, next, current.indent);
  }

  fs.rmSync(installDir, { recursive: true, force: true });
  fs.rmSync(skillDir, { recursive: true, force: true });

  return {
    claudeDir: targetDir,
    installDir,
    skillDir,
    settingsPath: settingsFile,
    changedSettings,
    backupPath
  };
}

module.exports = {
  uninstall
};
