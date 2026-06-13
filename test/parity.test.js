'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath));
}

test('plugin hook and config helpers match source bytes', () => {
  assert.deepEqual(read('plugin/scripts/hook.js'), read('src/hook.js'));
  assert.deepEqual(read('plugin/scripts/config.js'), read('src/config.js'));
  assert.deepEqual(read('plugin/scripts/telemetry.js'), read('src/telemetry.js'));
});

test('plugin skill matches source bytes', () => {
  for (const file of ['SKILL.md', 'phrases.js']) {
    assert.deepEqual(read(`plugin/skills/promptfluff/${file}`), read(`skills/promptfluff/${file}`));
  }
});

test('plugin phrase data matches package data bytes', () => {
  for (const file of [
    'encouragements.json',
    'encouragements-long.json',
    'encouragements-short.json'
  ]) {
    assert.deepEqual(read(`plugin/data/${file}`), read(`data/${file}`));
  }
});

test('combined phrase data equals long then short', () => {
  const combined = JSON.parse(read('data/encouragements.json').toString('utf8'));
  const long = JSON.parse(read('data/encouragements-long.json').toString('utf8'));
  const short = JSON.parse(read('data/encouragements-short.json').toString('utf8'));

  assert.equal(combined.length, 100);
  assert.equal(long.length, 50);
  assert.equal(short.length, 50);
  assert.deepEqual(combined, long.concat(short));
});
