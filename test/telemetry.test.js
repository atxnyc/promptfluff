'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const telemetry = require('../src/telemetry');

function tempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'promptfluff-telemetry-'));
}

function collector() {
  const calls = [];
  const spawnSender = (payload, env) => calls.push({ payload, env });
  return { calls, spawnSender };
}

const DAY_ONE = new Date('2026-06-13T10:00:00.000Z');
const DAY_ONE_LATER = new Date('2026-06-13T22:00:00.000Z');
const DAY_TWO = new Date('2026-06-14T09:00:00.000Z');

test('isOptedOut honors the standard and promptfluff switches', () => {
  assert.equal(telemetry.isOptedOut({ DO_NOT_TRACK: '1' }), true);
  assert.equal(telemetry.isOptedOut({ PROMPTFLUFF_NO_ANALYTICS: 'true' }), true);
  assert.equal(telemetry.isOptedOut({ PROMPTFLUFF_TELEMETRY: 'off' }), true);
  assert.equal(telemetry.isOptedOut({ PROMPTFLUFF_TELEMETRY: '0' }), true);
  // Default baked-in write key + data plane means telemetry is on by default.
  assert.equal(telemetry.isOptedOut({}), false);
  // A non-empty override stays on; opting out is done with the flags above.
  assert.equal(telemetry.isOptedOut({ PROMPTFLUFF_RUDDERSTACK_WRITE_KEY: 'custom' }), false);
});

test('parseSessionId extracts only the session id, never the prompt', () => {
  const raw = JSON.stringify({
    session_id: 'sess-123',
    prompt: 'my secret prompt text',
    cwd: '/home/secret/project'
  });
  assert.equal(telemetry.parseSessionId(raw), 'sess-123');
  assert.equal(telemetry.parseSessionId('{not json'), null);
  assert.equal(telemetry.parseSessionId(JSON.stringify({ prompt: 'x' })), null);
  assert.equal(telemetry.parseSessionId(''), null);
});

test('applyHookRun counts sessions, prompts, and days without double counting', () => {
  const v = '0.1.0';

  const first = telemetry.applyHookRun(null, { sessionId: 'a', now: DAY_ONE, version: v });
  assert.equal(first.dailyDue, true);
  assert.equal(first.state.sessionsTotal, 1);
  assert.equal(first.state.promptsTotal, 1);
  assert.equal(first.state.daysActive, 1);
  assert.ok(first.state.anonymousId);

  // Same session, same day: another prompt, no new session, no new heartbeat.
  const second = telemetry.applyHookRun(first.state, { sessionId: 'a', now: DAY_ONE_LATER, version: v });
  assert.equal(second.dailyDue, false);
  assert.equal(second.state.sessionsTotal, 1);
  assert.equal(second.state.promptsTotal, 2);
  assert.equal(second.state.daysActive, 1);
  assert.equal(second.state.anonymousId, first.state.anonymousId);

  // New session, still same day.
  const third = telemetry.applyHookRun(second.state, { sessionId: 'b', now: DAY_ONE_LATER, version: v });
  assert.equal(third.dailyDue, false);
  assert.equal(third.state.sessionsTotal, 2);

  // New UTC day: heartbeat due again, day count ticks up.
  const fourth = telemetry.applyHookRun(third.state, { sessionId: 'b', now: DAY_TWO, version: v });
  assert.equal(fourth.dailyDue, true);
  assert.equal(fourth.state.daysActive, 2);
});

test('buildBatch emits an identify + track pair and no prompt content', () => {
  const batch = telemetry.buildBatch({
    anonymousId: 'anon-1',
    event: 'Daily Use',
    properties: { sessions: 3 },
    traits: { sessions: 3 },
    context: { app: { name: 'promptfluff' } },
    now: DAY_ONE
  });
  assert.equal(batch.batch.length, 2);
  assert.equal(batch.batch[0].type, 'identify');
  assert.equal(batch.batch[1].type, 'track');
  assert.equal(batch.batch[1].event, 'Daily Use');
  assert.equal(batch.batch[1].anonymousId, 'anon-1');
});

test('recordHookRun writes state and queues exactly one heartbeat per day', () => {
  const dir = tempStateDir();
  const env = { PROMPTFLUFF_STATE_DIR: dir };
  const { calls, spawnSender } = collector();
  const file = telemetry.statePath(env);

  const first = telemetry.recordHookRun(JSON.stringify({ session_id: 's1' }), {
    env,
    now: DAY_ONE,
    spawnSender
  });
  assert.equal(first.dailyDue, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.batch[1].event, 'Daily Use');
  assert.equal(fs.existsSync(file), true);

  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.sessionsTotal, 1);
  assert.equal(saved.promptsTotal, 1);
  assert.ok(saved.anonymousId);

  // Second prompt, same session, same day: no second heartbeat.
  const second = telemetry.recordHookRun(JSON.stringify({ session_id: 's1' }), {
    env,
    now: DAY_ONE_LATER,
    spawnSender
  });
  assert.equal(second.dailyDue, false);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).promptsTotal, 2);
});

test('recordHookRun is a no-op when opted out', () => {
  const dir = tempStateDir();
  const env = { PROMPTFLUFF_STATE_DIR: dir, DO_NOT_TRACK: '1' };
  const { calls, spawnSender } = collector();

  const result = telemetry.recordHookRun(JSON.stringify({ session_id: 's1' }), {
    env,
    now: DAY_ONE,
    spawnSender
  });
  assert.equal(result.skipped, 'opted-out');
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(telemetry.statePath(env)), false);
});

test('the queued payload never contains prompt text', () => {
  const dir = tempStateDir();
  const env = { PROMPTFLUFF_STATE_DIR: dir };
  const { calls, spawnSender } = collector();
  const secret = 'PLEASE-DO-NOT-EXFILTRATE-THIS-PROMPT';

  telemetry.recordHookRun(JSON.stringify({ session_id: 's9', prompt: secret }), {
    env,
    now: DAY_ONE,
    spawnSender
  });
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(calls[0].payload).includes(secret), false);
});

test('trackInstall sends an Installed event and flags reinstalls', () => {
  const dir = tempStateDir();
  const env = { PROMPTFLUFF_STATE_DIR: dir };
  const { calls, spawnSender } = collector();

  const first = telemetry.trackInstall(
    { method: 'npx', flavor: 'short', hasPrefix: true, version: '0.1.0' },
    { env, now: DAY_ONE, spawnSender }
  );
  assert.equal(first.reinstall, false);
  assert.equal(calls.length, 1);
  const track = calls[0].payload.batch[1];
  assert.equal(track.event, 'Installed');
  assert.equal(track.properties.method, 'npx');
  assert.equal(track.properties.flavor, 'short');
  assert.equal(track.properties.reinstall, false);

  const second = telemetry.trackInstall(
    { method: 'npx', flavor: 'short', version: '0.1.0' },
    { env, now: DAY_TWO, spawnSender }
  );
  assert.equal(second.reinstall, true);
  assert.equal(second.anonymousId, first.anonymousId);
});
