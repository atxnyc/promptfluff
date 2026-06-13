'use strict';

// promptfluff usage telemetry for the RudderStack HTTP source.
//
// Design rules, in priority order:
//   1. Never block or break a prompt submission. The hook spawns a detached
//      child to do the network call and returns immediately; the hot path is
//      local file I/O only.
//   2. Never be invasive. We send an anonymous random id and coarse counters
//      (sessions, days active, prompt count, flavor, platform). We deliberately
//      read only `session_id` from the hook payload and never the prompt text.
//   3. Low volume. The daily heartbeat fires at most once per UTC day per user.
//   4. Easy to opt out. DO_NOT_TRACK, PROMPTFLUFF_NO_ANALYTICS, or
//      PROMPTFLUFF_TELEMETRY=off disable everything.
//   5. Fail open. Every path is wrapped so a telemetry bug is a no-op.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { spawn } = require('node:child_process');

// RudderStack HTTP source. Write keys are client-side identifiers — they ship
// in the published package the same way the web snippet write key ships inside
// the landing page HTML — so committing the defaults is fine. Override per
// environment with the env vars below.
const DEFAULT_WRITE_KEY = '3F5Q5IN7aO1QR8yqrInShrQtdnu';
const DEFAULT_DATA_PLANE = 'https://opascopeanajoo.dataplane.rudderstack.com';

// Kept in sync with package.json / the plugin manifests by hand, like the other
// version strings in this repo. Used only as analytics metadata when the live
// package.json is not reachable (e.g. the copied hook install dir).
const FALLBACK_VERSION = '0.1.0';

const SEND_TIMEOUT_MS = 4000;
const RECENT_SESSION_CAP = 25;

function truthy(value) {
  if (value === undefined || value === null) {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function writeKey(env = process.env) {
  return env.PROMPTFLUFF_RUDDERSTACK_WRITE_KEY || DEFAULT_WRITE_KEY || '';
}

function dataPlane(env = process.env) {
  const value = env.PROMPTFLUFF_RUDDERSTACK_DATA_PLANE || DEFAULT_DATA_PLANE || '';
  return value.replace(/\/+$/, '');
}

function isOptedOut(env = process.env) {
  if (truthy(env.DO_NOT_TRACK)) {
    return true;
  }
  if (truthy(env.PROMPTFLUFF_NO_ANALYTICS)) {
    return true;
  }
  const flag = String(env.PROMPTFLUFF_TELEMETRY || '').trim().toLowerCase();
  if (flag === 'off' || flag === '0' || flag === 'false' || flag === 'no') {
    return true;
  }
  // No destination configured means telemetry is effectively disabled.
  return !writeKey(env) || !dataPlane(env);
}

function stateDir(env = process.env, homeDir = os.homedir()) {
  if (env.PROMPTFLUFF_STATE_DIR) {
    return env.PROMPTFLUFF_STATE_DIR;
  }
  return path.join(homeDir, '.promptfluff');
}

function statePath(env = process.env, homeDir = os.homedir()) {
  return path.join(stateDir(env, homeDir), 'analytics.json');
}

function readState(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_error) {
    // Unreadable or corrupt state means we start fresh.
  }
  return null;
}

function writeStateAtomic(file, state) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.analytics.${process.pid}.${process.hrtime.bigint()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function resolveVersion(env = process.env) {
  if (env && env.PROMPTFLUFF_VERSION) {
    return env.PROMPTFLUFF_VERSION;
  }
  for (const relative of ['../package.json', './package.json', '../../package.json']) {
    try {
      const pkg = require(path.resolve(__dirname, relative));
      if (pkg && pkg.version) {
        return pkg.version;
      }
    } catch (_error) {
      // Try the next candidate.
    }
  }
  for (const relative of ['../.claude-plugin/plugin.json', '../../.claude-plugin/plugin.json']) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, relative), 'utf8'));
      if (manifest && manifest.version) {
        return manifest.version;
      }
    } catch (_error) {
      // Try the next candidate.
    }
  }
  return FALLBACK_VERSION;
}

function readFlavor(env = process.env) {
  try {
    const { readConfigFile } = require('./config');
    const config = readConfigFile(__dirname);
    if (config && typeof config.flavor === 'string') {
      return config.flavor;
    }
  } catch (_error) {
    // No config alongside the hook means we just omit the flavor.
  }
  return undefined;
}

function detectSurface(env = process.env) {
  return env.CLAUDE_PLUGIN_ROOT ? 'plugin' : 'hook';
}

function detectInstallMethod(env = process.env) {
  const userAgent = String(env.npm_config_user_agent || '');
  if (/npm\/.*\bexec\b/.test(userAgent) || env.npm_lifecycle_event === 'npx') {
    return 'npx';
  }
  if (userAgent) {
    return 'npm';
  }
  return 'local';
}

function utcDate(now) {
  return now.toISOString().slice(0, 10);
}

function parseSessionId(raw) {
  if (!raw) {
    return null;
  }
  try {
    const payload = JSON.parse(raw);
    const id = payload && (payload.session_id || payload.sessionId);
    return typeof id === 'string' && id ? id : null;
  } catch (_error) {
    return null;
  }
}

function ensureIdentity(prevState, now, version) {
  const state = prevState && typeof prevState === 'object' ? { ...prevState } : {};
  if (!state.anonymousId) {
    state.anonymousId = crypto.randomUUID();
  }
  if (!state.createdAt) {
    state.createdAt = now.toISOString();
  }
  if (!state.firstVersion) {
    state.firstVersion = version;
  }
  if (typeof state.sessionsTotal !== 'number') {
    state.sessionsTotal = 0;
  }
  if (typeof state.promptsTotal !== 'number') {
    state.promptsTotal = 0;
  }
  if (typeof state.daysActive !== 'number') {
    state.daysActive = 0;
  }
  if (!Array.isArray(state.recentSessions)) {
    state.recentSessions = [];
  }
  return state;
}

// Pure state transition for one hook invocation. No clock, no I/O — the caller
// injects `now` so this is trivially testable.
function applyHookRun(prevState, { sessionId, now, version }) {
  const state = ensureIdentity(prevState, now, version);
  state.lastVersion = version;
  state.promptsTotal += 1;

  if (sessionId && !state.recentSessions.includes(sessionId)) {
    state.sessionsTotal += 1;
    state.lastSessionId = sessionId;
    state.recentSessions.push(sessionId);
    if (state.recentSessions.length > RECENT_SESSION_CAP) {
      state.recentSessions = state.recentSessions.slice(-RECENT_SESSION_CAP);
    }
  }

  const today = utcDate(now);
  let dailyDue = false;
  if (state.lastDailyDate !== today) {
    dailyDue = true;
    state.daysActive += 1;
    state.lastDailyDate = today;
  }

  return { state, dailyDue };
}

function baseContext(env, extra = {}) {
  const version = resolveVersion(env);
  return {
    app: { name: 'promptfluff', version },
    library: { name: 'promptfluff-http', version },
    os: { name: process.platform },
    ...extra
  };
}

function heartbeatTraits(state, env) {
  return {
    sessions: state.sessionsTotal,
    prompts: state.promptsTotal,
    daysActive: state.daysActive,
    firstVersion: state.firstVersion,
    version: state.lastVersion || resolveVersion(env),
    flavor: readFlavor(env),
    platform: process.platform,
    surface: detectSurface(env)
  };
}

// Build a RudderStack /v1/batch body with an identify (so the user profile
// carries the latest counters) followed by the track event.
function buildBatch({ anonymousId, event, properties, traits, context, now }) {
  const timestamp = now.toISOString();
  const messages = [];
  if (traits) {
    messages.push({
      type: 'identify',
      anonymousId,
      traits,
      context,
      originalTimestamp: timestamp
    });
  }
  messages.push({
    type: 'track',
    anonymousId,
    event,
    properties: properties || {},
    context,
    originalTimestamp: timestamp
  });
  return { batch: messages };
}

// Spawn a detached child that performs the POST, so the parent (the hook or the
// CLI) can exit immediately without waiting on the network.
function defaultSpawnSender(payload, env = process.env) {
  const child = spawn(process.execPath, [__filename, '--send'], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...env,
      PROMPTFLUFF_EVENT: JSON.stringify(payload),
      PROMPTFLUFF_RUDDERSTACK_WRITE_KEY: writeKey(env),
      PROMPTFLUFF_RUDDERSTACK_DATA_PLANE: dataPlane(env)
    }
  });
  child.unref();
}

function postBatch(payload, env = process.env) {
  return new Promise((resolve) => {
    let body;
    try {
      body = JSON.stringify(payload);
    } catch (_error) {
      resolve(false);
      return;
    }

    let url;
    try {
      url = new URL(`${dataPlane(env)}/v1/batch`);
    } catch (_error) {
      resolve(false);
      return;
    }

    const auth = Buffer.from(`${writeKey(env)}:`).toString('base64');
    const request = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (response) => {
        response.on('data', () => {});
        response.on('end', () => resolve(true));
        response.on('error', () => resolve(false));
      }
    );

    request.setTimeout(SEND_TIMEOUT_MS, () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
    request.write(body);
    request.end();
  });
}

// Called on every hook run. Updates local counters and, on the first prompt of
// a new UTC day, queues a "Daily Use" heartbeat. Returns a small summary for
// tests; production code ignores the return value.
function recordHookRun(rawStdin, options = {}) {
  const env = options.env || process.env;
  if (isOptedOut(env)) {
    return { skipped: 'opted-out' };
  }

  const now = options.now || new Date();
  const homeDir = options.homeDir || os.homedir();
  const file = statePath(env, homeDir);
  const version = resolveVersion(env);
  const sessionId = parseSessionId(rawStdin);

  const previous = readState(file);
  const { state, dailyDue } = applyHookRun(previous, { sessionId, now, version });

  try {
    writeStateAtomic(file, state);
  } catch (_error) {
    // A failed state write just means we may re-send tomorrow; never throw.
  }

  if (dailyDue) {
    const traits = heartbeatTraits(state, env);
    const payload = buildBatch({
      anonymousId: state.anonymousId,
      event: 'Daily Use',
      properties: { ...traits },
      traits,
      context: baseContext(env, { surface: detectSurface(env) }),
      now
    });
    const send = options.spawnSender || defaultSpawnSender;
    try {
      send(payload, env);
    } catch (_error) {
      // Sending is best effort.
    }
  }

  return { skipped: false, dailyDue, sessionsTotal: state.sessionsTotal };
}

// Called once from the CLI installer after a successful install.
function trackInstall(info = {}, options = {}) {
  const env = options.env || process.env;
  if (isOptedOut(env)) {
    return { skipped: 'opted-out' };
  }

  const now = options.now || new Date();
  const homeDir = options.homeDir || os.homedir();
  const file = statePath(env, homeDir);
  const version = info.version || resolveVersion(env);

  const previous = readState(file);
  const state = ensureIdentity(previous, now, version);
  const reinstall = Boolean(previous && previous.installedAt);
  if (!state.installedAt) {
    state.installedAt = now.toISOString();
  }
  state.lastVersion = version;

  try {
    writeStateAtomic(file, state);
  } catch (_error) {
    // Non-fatal.
  }

  const traits = {
    firstVersion: state.firstVersion,
    version,
    flavor: info.flavor,
    platform: process.platform,
    surface: 'cli'
  };
  const payload = buildBatch({
    anonymousId: state.anonymousId,
    event: 'Installed',
    properties: {
      method: info.method || detectInstallMethod(env),
      flavor: info.flavor,
      hasPrefix: Boolean(info.hasPrefix),
      version,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      reinstall
    },
    traits,
    context: baseContext(env, { surface: 'cli' }),
    now
  });

  const send = options.spawnSender || defaultSpawnSender;
  try {
    send(payload, env);
  } catch (_error) {
    // Best effort.
  }

  return { skipped: false, reinstall, anonymousId: state.anonymousId };
}

if (require.main === module) {
  if (process.argv.includes('--send')) {
    let payload = null;
    try {
      payload = JSON.parse(process.env.PROMPTFLUFF_EVENT || 'null');
    } catch (_error) {
      payload = null;
    }
    if (!payload) {
      process.exit(0);
    } else {
      postBatch(payload).then(
        () => process.exit(0),
        () => process.exit(0)
      );
    }
  } else {
    process.exit(0);
  }
}

module.exports = {
  applyHookRun,
  buildBatch,
  dataPlane,
  detectInstallMethod,
  detectSurface,
  ensureIdentity,
  heartbeatTraits,
  isOptedOut,
  parseSessionId,
  postBatch,
  recordHookRun,
  resolveVersion,
  stateDir,
  statePath,
  trackInstall,
  utcDate,
  writeKey
};
