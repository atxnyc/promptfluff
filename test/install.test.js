'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { install } = require('../src/install');
const { uninstall } = require('../src/uninstall');

function tempClaudeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'promptfluff-claude-'));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function backupCount(dir) {
  return fs.readdirSync(dir).filter((file) => file.startsWith('settings.json.bak.')).length;
}

function promptfluffHookCount(settings) {
  const groups = settings.hooks?.UserPromptSubmit || [];
  return groups.reduce((count, group) => {
    return count + (group.hooks || []).filter((hook) => /promptfluff[\\/]hook\.js/.test(hook.command)).length;
  }, 0);
}

test('install and uninstall round trip in a temp Claude config dir', () => {
  const dir = tempClaudeDir();
  const settingsPath = path.join(dir, 'settings.json');
  const original = {
    theme: 'dark',
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'node stop.js', timeout: 2 }] }]
    }
  };
  fs.writeFileSync(settingsPath, `${JSON.stringify(original, null, 2)}\n`);

  const first = install({ dir, flavor: 'short', prefix: 'Go: ' });
  const installDir = path.join(dir, 'hooks', 'promptfluff');
  const skillDir = path.join(dir, 'skills', 'promptfluff');

  assert.equal(fs.existsSync(path.join(installDir, 'hook.js')), true);
  assert.equal(fs.existsSync(path.join(installDir, 'config.js')), true);
  assert.equal(fs.existsSync(path.join(installDir, 'encouragements.json')), true);
  assert.equal(fs.existsSync(path.join(skillDir, 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(skillDir, 'phrases.js')), true);
  assert.deepEqual(readJson(path.join(installDir, 'config.json')), {
    flavor: 'short',
    prefix: 'Go: ',
    gate: true,
    announce: true,
    dadJokeOdds: 420
  });
  assert.equal(promptfluffHookCount(readJson(settingsPath)), 1);
  assert.equal(first.backupPath.startsWith(`${settingsPath}.bak.`), true);
  assert.equal(backupCount(dir), 1);

  const second = install({ dir, flavor: 'short', prefix: 'Go: ' });
  assert.equal(promptfluffHookCount(readJson(settingsPath)), 1);
  assert.equal(second.changedSettings, false);
  assert.equal(backupCount(dir), 1);

  const removed = uninstall({ dir });
  assert.deepEqual(readJson(settingsPath), original);
  assert.equal(fs.existsSync(installDir), false);
  assert.equal(fs.existsSync(skillDir), false);
  assert.equal(removed.backupPath.startsWith(`${settingsPath}.bak.`), true);
  assert.equal(backupCount(dir), 2);

  const removedAgain = uninstall({ dir });
  assert.equal(removedAgain.changedSettings, false);
  assert.deepEqual(readJson(settingsPath), original);
  assert.equal(backupCount(dir), 2);
});
