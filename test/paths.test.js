'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { claudeDir, expandTilde, hooksInstallDir, settingsPath } = require('../src/paths');

test('expandTilde expands bare tilde and tilde slash', () => {
  assert.equal(expandTilde('~', '/tmp/home'), '/tmp/home');
  assert.equal(expandTilde('~/x', '/tmp/home'), path.join('/tmp/home', 'x'));
  assert.equal(expandTilde('~\\x', '/tmp/home'), path.join('/tmp/home', 'x'));
});

test('expandTilde leaves non-tilde values untouched', () => {
  assert.equal(expandTilde('/tmp/x', '/tmp/home'), '/tmp/x');
  assert.equal(expandTilde('relative/x', '/tmp/home'), 'relative/x');
  assert.equal(expandTilde('~alex/x', '/tmp/home'), '~alex/x');
});

test('CLAUDE_CONFIG_DIR wins over the default home path', () => {
  const env = { CLAUDE_CONFIG_DIR: '~/claude-config' };
  const dir = claudeDir({ env, homeDir: '/tmp/home' });

  assert.equal(dir, path.resolve('/tmp/home/claude-config'));
  assert.equal(settingsPath({ env, homeDir: '/tmp/home' }), path.join(dir, 'settings.json'));
  assert.equal(hooksInstallDir({ env, homeDir: '/tmp/home' }), path.join(dir, 'hooks', 'promptfluff'));
});

test('--dir style overrides CLAUDE_CONFIG_DIR', () => {
  const dir = claudeDir({
    dir: '~/custom',
    env: { CLAUDE_CONFIG_DIR: '/tmp/ignored' },
    homeDir: '/tmp/home'
  });

  assert.equal(dir, path.resolve('/tmp/home/custom'));
});
