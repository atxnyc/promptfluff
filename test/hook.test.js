'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const hook = require('../src/hook');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const COMBINED = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'encouragements.json'), 'utf8'));
const LONG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'encouragements-long.json'), 'utf8'));
const SHORT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'encouragements-short.json'), 'utf8'));

// A prompt that clears the gate on length alone (>= 10 words).
const REAL_PROMPT = 'Can you take a careful look at the navbar spacing and fix it';

function runHook(scriptDir, env = {}, input = JSON.stringify({ prompt: REAL_PROMPT })) {
  return spawnSync(process.execPath, [path.join(scriptDir, 'hook.js')], {
    input,
    encoding: 'utf8',
    // Keep telemetry off and the dad-joke roll deterministic (disabled) so the
    // hook tests stay hermetic. Telemetry/dad-joke are exercised explicitly.
    env: {
      ...process.env,
      PROMPTFLUFF_NO_ANALYTICS: '1',
      PROMPTFLUFF_DAD_JOKE_ODDS: '0',
      ...env
    }
  });
}

function tempHookTree(longText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptfluff-hook-'));
  const srcDir = path.join(root, 'src');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.copyFileSync(path.join(SRC_DIR, 'hook.js'), path.join(srcDir, 'hook.js'));
  fs.copyFileSync(path.join(SRC_DIR, 'config.js'), path.join(srcDir, 'config.js'));
  if (longText !== undefined) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'encouragements-long.json'), longText);
  }
  return srcDir;
}

// --- gating ----------------------------------------------------------------
test('deservesEncouragement: trivial chatter is suppressed', () => {
  for (const trivial of ['thanks!', 'ok perfect', 'yes do it', 'And you did this live?', 'is it working?']) {
    assert.equal(hook.deservesEncouragement(trivial), false, trivial);
  }
});

test('deservesEncouragement: substantive + override signals fire', () => {
  const cases = {
    length: 'Can you take a careful look at the navbar spacing and fix it',
    command: 'fix the navbar spacing',
    frustration: "that's not what i meant",
    'frustration-short': 'ugh',
    fileRef: 'check the handoff.md before you start',
    error: 'TypeError: cannot read properties of undefined',
    codeFence: 'here:\n```\nconst x = 1\n```',
    shout: 'WHY IS THIS BROKEN'
  };
  for (const [label, prompt] of Object.entries(cases)) {
    assert.equal(hook.deservesEncouragement(prompt), true, label);
  }
});

test('buildOutputFromFiles suppresses a gated (trivial) prompt', () => {
  const output = hook.buildOutputFromFiles({
    scriptDir: SRC_DIR,
    prompt: 'thanks',
    dadJoke: false,
    random: () => 0
  });
  assert.equal(output, null);
});

test('gate:off (env) encourages even trivial prompts', () => {
  const output = hook.buildOutputFromFiles({
    scriptDir: SRC_DIR,
    env: { PROMPTFLUFF_GATE: 'off', PROMPTFLUFF_FLAVOR: 'short' },
    prompt: 'thanks',
    dadJoke: false,
    random: () => 0
  });
  assert.equal(output.hookSpecificOutput.additionalContext, SHORT[0]);
});

// --- pairing / flavors -----------------------------------------------------
test('both flavor: a big ask leads long, closes on the short kicker', () => {
  const output = hook.buildOutputFromFiles({
    scriptDir: SRC_DIR,
    env: { PROMPTFLUFF_FLAVOR: 'both' },
    prompt: REAL_PROMPT, // >= 10 words -> big
    dadJoke: false,
    random: () => 0
  });
  assert.equal(output.hookSpecificOutput.additionalContext, `${LONG[0]}\n${SHORT[0]}`);
  assert.equal(output.systemMessage, `💌 ${LONG[0]}\n— ${SHORT[0]}`);
});

test('both flavor: a short ask gets a short kicker', () => {
  const output = hook.buildOutputFromFiles({
    scriptDir: SRC_DIR,
    env: { PROMPTFLUFF_FLAVOR: 'both' },
    prompt: 'fix the navbar', // short command -> passes gate, not big
    dadJoke: false,
    random: () => 0
  });
  assert.equal(output.hookSpecificOutput.additionalContext, SHORT[0]);
  assert.equal(output.systemMessage, `💌 ${SHORT[0]}`);
});

test('both flavor: a markdown/file reference is big (long + kicker)', () => {
  const output = hook.buildOutputFromFiles({
    scriptDir: SRC_DIR,
    env: { PROMPTFLUFF_FLAVOR: 'both' },
    prompt: 'check the handoff.md', // short, but a file ref -> big
    dadJoke: false,
    random: () => 0
  });
  assert.equal(output.hookSpecificOutput.additionalContext, `${LONG[0]}\n${SHORT[0]}`);
});

test('default flavor is short: even a big ask gets only the short kicker', () => {
  const output = hook.buildOutputFromFiles({
    scriptDir: SRC_DIR,
    prompt: REAL_PROMPT, // big, but default flavor short -> kicker only
    dadJoke: false,
    random: () => 0
  });
  assert.equal(output.hookSpecificOutput.additionalContext, SHORT[0]);
  assert.equal(output.systemMessage, `💌 ${SHORT[0]}`);
});

test('isBigPrompt: long or file-ref is big, short chatter is not', () => {
  assert.equal(hook.isBigPrompt('please take a careful look at the whole flow here'), true);
  assert.equal(hook.isBigPrompt('see README'), true);
  assert.equal(hook.isBigPrompt('fix the navbar'), false);
});

test('short flavor + custom prefix from env', () => {
  const output = hook.buildOutputFromFiles({
    scriptDir: SRC_DIR,
    env: { PROMPTFLUFF_FLAVOR: 'short', PROMPTFLUFF_PREFIX: 'Tiny pep: ' },
    prompt: REAL_PROMPT,
    dadJoke: false,
    random: () => 0
  });
  assert.equal(output.hookSpecificOutput.additionalContext, `Tiny pep: ${SHORT[0]}`);
});

test('announce:off drops the visible systemMessage', () => {
  const output = hook.buildOutputFromFiles({
    scriptDir: SRC_DIR,
    env: { PROMPTFLUFF_ANNOUNCE: 'off' },
    prompt: REAL_PROMPT,
    dadJoke: false,
    random: () => 0
  });
  assert.equal('systemMessage' in output, false);
  assert.ok(output.hookSpecificOutput.additionalContext);
});

// --- dad joke --------------------------------------------------------------
test('rollDadJoke honors odds and disables on 0', () => {
  assert.equal(hook.rollDadJoke(1, () => 0.5), true); // 1-in-1 always fires
  assert.equal(hook.rollDadJoke(0, () => 0), false); // disabled
  assert.equal(hook.rollDadJoke(420, () => 0.999), false); // miss
  assert.equal(hook.rollDadJoke(420, () => 0), true); // hit
});

test('dad joke injects a request but never gets a visible reveal', () => {
  const output = hook.buildOutputFromFiles({
    scriptDir: SRC_DIR,
    prompt: 'thanks', // gated out: dad joke stands alone
    dadJoke: true
  });
  assert.match(output.hookSpecificOutput.additionalContext, /🃏.*dad joke/i);
  // Unlike encouragement, the dad joke is quiet — no 💌-style systemMessage.
  assert.equal('systemMessage' in output, false);
});

test('dad joke is de-personalized (no name leak to other installs)', () => {
  const output = hook.buildOutputFromFiles({ scriptDir: SRC_DIR, prompt: 'thanks', dadJoke: true });
  assert.equal(/\bAlex\b/.test(output.hookSpecificOutput.additionalContext), false);
});

test('"djdj" in a prompt force-fires the dad joke even on a roll miss', () => {
  const output = hook.buildOutputFromFiles({
    scriptDir: SRC_DIR,
    prompt: 'djdj', // trivial + roll misses, but the test token forces it
    rollRandom: () => 0.999,
    random: () => 0.999
  });
  assert.match(output.hookSpecificOutput.additionalContext, /🃏.*dad joke/i);
  assert.equal('systemMessage' in output, false); // gated-out prompt → no reveal
});

// --- low-level + end-to-end -------------------------------------------------
test('buildOutput returns the Claude hook output shape', () => {
  assert.deepEqual(hook.buildOutput({ phrase: 'You got this.', prefix: 'Note: ' }), {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: 'Note: You got this.'
    }
  });
});

test('executed hook prints one-line valid JSON for a real ask', () => {
  const result = runHook(SRC_DIR);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  const line = result.stdout.trim();
  assert.equal(line.includes('\n'), false);
  const parsed = JSON.parse(line);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.ok(parsed.hookSpecificOutput.additionalContext.length > 0);
  assert.match(parsed.systemMessage, /^💌 /);
});

test('executed hook stays silent on trivial chatter', () => {
  const result = runHook(SRC_DIR, {}, JSON.stringify({ prompt: 'thanks' }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('missing pool file prints nothing and exits 0', () => {
  const result = runHook(tempHookTree(), { PROMPTFLUFF_FLAVOR: 'long' });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('corrupt pool file prints nothing and exits 0', () => {
  const result = runHook(tempHookTree('{not json'), { PROMPTFLUFF_FLAVOR: 'long' });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('empty pool prints nothing and exits 0', () => {
  const result = runHook(tempHookTree('[]'), { PROMPTFLUFF_FLAVOR: 'long' });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});
