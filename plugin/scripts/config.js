'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG = Object.freeze({
  flavor: 'both',
  prefix: '',
  // Only encourage substantive prompts (real asks / work commands); trivial
  // chatter gets nothing. See hook.js deservesEncouragement.
  gate: true,
  // Surface the pick to the user via a top-level `systemMessage` (the visible
  // 💌 line) instead of only injecting it into the model's context.
  announce: true,
  // 1-in-N chance, per message, of asking Claude for a dad joke. 0 disables.
  dadJokeOdds: 420
});

const POOL_FILES = Object.freeze({
  both: 'encouragements.json',
  long: 'encouragements-long.json',
  short: 'encouragements-short.json'
});

function normalizeFlavor(value) {
  if (value === 'both' || value === 'long' || value === 'short') {
    return value;
  }
  return DEFAULT_CONFIG.flavor;
}

// Booleans arrive as real booleans from config.json or as strings from env
// vars. Blank/unrecognized values fall back rather than guessing.
function normalizeBool(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'on', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'off', 'no', 'n'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

// Non-negative integer odds. 0 disables the roll; anything invalid falls back.
function normalizeOdds(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }
  return fallback;
}

function readConfigFile(scriptDir) {
  try {
    const configPath = path.join(scriptDir, 'config.json');
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_error) {
    // Hooks must fail open; unreadable config means defaults.
  }
  return {};
}

// env (string) wins over config.json (typed) wins over the built-in default.
function pick(env, envKey, fileValue) {
  return env[envKey] !== undefined ? env[envKey] : fileValue;
}

function resolveConfig(options = {}) {
  const env = options.env || process.env;
  const scriptDir = options.scriptDir || __dirname;
  const fileConfig = options.fileConfig || readConfigFile(scriptDir);

  const prefixSource = pick(env, 'PROMPTFLUFF_PREFIX', fileConfig.prefix);

  return {
    flavor: normalizeFlavor(pick(env, 'PROMPTFLUFF_FLAVOR', fileConfig.flavor)),
    prefix: typeof prefixSource === 'string' ? prefixSource : DEFAULT_CONFIG.prefix,
    gate: normalizeBool(pick(env, 'PROMPTFLUFF_GATE', fileConfig.gate), DEFAULT_CONFIG.gate),
    announce: normalizeBool(
      pick(env, 'PROMPTFLUFF_ANNOUNCE', fileConfig.announce),
      DEFAULT_CONFIG.announce
    ),
    dadJokeOdds: normalizeOdds(
      pick(env, 'PROMPTFLUFF_DAD_JOKE_ODDS', fileConfig.dadJokeOdds),
      DEFAULT_CONFIG.dadJokeOdds
    )
  };
}

function poolFileForFlavor(flavor) {
  return POOL_FILES[normalizeFlavor(flavor)];
}

function configForInstall(options = {}) {
  return {
    flavor: normalizeFlavor(options.flavor),
    prefix: typeof options.prefix === 'string' ? options.prefix : DEFAULT_CONFIG.prefix,
    gate: normalizeBool(options.gate, DEFAULT_CONFIG.gate),
    announce: normalizeBool(options.announce, DEFAULT_CONFIG.announce),
    dadJokeOdds: normalizeOdds(options.dadJokeOdds, DEFAULT_CONFIG.dadJokeOdds)
  };
}

module.exports = {
  DEFAULT_CONFIG,
  POOL_FILES,
  normalizeFlavor,
  normalizeBool,
  normalizeOdds,
  readConfigFile,
  resolveConfig,
  poolFileForFlavor,
  configForInstall
};
