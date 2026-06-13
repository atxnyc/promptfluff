#!/usr/bin/env node
'use strict';

// promptfluff phrase + config manager — used by the promptfluff configuration
// skill (and runnable by hand). Zero dependencies, Node 18+.
//
// It edits the INSTALLED copy of promptfluff (the files next to the running
// hook), never the repo. It keeps the invariant the hook relies on: the merged
// `encouragements.json` always equals long ++ short.
//
// Usage:
//   node phrases.js where
//   node phrases.js list [long|short|all]
//   node phrases.js add long|short "phrase text"
//   node phrases.js remove long|short <index>
//   node phrases.js rebuild
//   node phrases.js config [get]
//   node phrases.js config set <flavor|prefix|gate|announce|dadJokeOdds> <value>
//
// Target dir resolution: $PROMPTFLUFF_DIR, else
// $CLAUDE_CONFIG_DIR/hooks/promptfluff, else ~/.claude/hooks/promptfluff.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const USAGE = `promptfluff phrase + config manager

  node phrases.js where
  node phrases.js list [long|short|all]
  node phrases.js add long|short "phrase text"
  node phrases.js remove long|short <index>
  node phrases.js rebuild
  node phrases.js config [get]
  node phrases.js config set <flavor|prefix|gate|announce|dadJokeOdds> <value>

Edits the installed copy ($PROMPTFLUFF_DIR, else
$CLAUDE_CONFIG_DIR/hooks/promptfluff, else ~/.claude/hooks/promptfluff) and
keeps encouragements.json == long ++ short.`;

const FLAVORS = ['both', 'long', 'short'];
const CONFIG_KEYS = ['flavor', 'prefix', 'gate', 'announce', 'dadJokeOdds'];
const POOL_FILE = { long: 'encouragements-long.json', short: 'encouragements-short.json', both: 'encouragements.json' };

function expandTilde(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function hasPool(dir) {
  return fs.existsSync(path.join(dir, 'encouragements-long.json'));
}

function installDir() {
  if (process.env.PROMPTFLUFF_DIR) return path.resolve(expandTilde(process.env.PROMPTFLUFF_DIR));
  const base = process.env.CLAUDE_CONFIG_DIR
    ? path.resolve(expandTilde(process.env.CLAUDE_CONFIG_DIR))
    : path.join(os.homedir(), '.claude');
  // Standard install lives in hooks/promptfluff/; a personal/flat setup keeps
  // the phrase files directly in hooks/. Prefer whichever actually has them.
  const candidates = [path.join(base, 'hooks', 'promptfluff'), path.join(base, 'hooks')];
  for (const dir of candidates) {
    if (hasPool(dir)) return dir;
  }
  return candidates[0];
}

function poolPath(dir, which) {
  return path.join(dir, POOL_FILE[which]);
}

function readPool(dir, which) {
  const file = poolPath(dir, which);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`${file} is not a JSON array`);
  return data;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function rebuild(dir) {
  const long = readPool(dir, 'long');
  const short = readPool(dir, 'short');
  writeJson(poolPath(dir, 'both'), long.concat(short));
  return { long: long.length, short: short.length, combined: long.length + short.length };
}

function readConfig(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function parseBool(value) {
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'on', 'yes', 'y'].includes(v)) return true;
  if (['0', 'false', 'off', 'no', 'n'].includes(v)) return false;
  throw new Error(`expected a boolean (on/off), got "${value}"`);
}

function setConfig(dir, key, rawValue) {
  if (!CONFIG_KEYS.includes(key)) {
    throw new Error(`unknown config key "${key}". Valid: ${CONFIG_KEYS.join(', ')}`);
  }
  const config = readConfig(dir);
  if (key === 'flavor') {
    if (!FLAVORS.includes(rawValue)) throw new Error(`flavor must be one of ${FLAVORS.join(', ')}`);
    config.flavor = rawValue;
  } else if (key === 'prefix') {
    config.prefix = String(rawValue);
  } else if (key === 'gate' || key === 'announce') {
    config[key] = parseBool(rawValue);
  } else if (key === 'dadJokeOdds') {
    const n = Number(rawValue);
    if (!Number.isInteger(n) || n < 0) throw new Error('dadJokeOdds must be a non-negative integer (0 disables)');
    config.dadJokeOdds = n;
  }
  writeJson(path.join(dir, 'config.json'), config);
  return config;
}

function requireFlavorArg(which, { allowAll } = {}) {
  const ok = allowAll ? ['long', 'short', 'all'] : ['long', 'short'];
  if (!ok.includes(which)) throw new Error(`expected ${ok.join(' | ')}, got "${which || ''}"`);
}

function main(argv) {
  const [command, ...rest] = argv;
  const dir = installDir();

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (command === 'where') {
    process.stdout.write(`${dir}\n`);
    return 0;
  }

  if (!fs.existsSync(dir)) {
    throw new Error(`promptfluff is not installed at ${dir} (set PROMPTFLUFF_DIR or CLAUDE_CONFIG_DIR if it lives elsewhere)`);
  }

  if (command === 'list') {
    const which = rest[0] || 'all';
    requireFlavorArg(which, { allowAll: true });
    const show = (label) => {
      const pool = readPool(dir, label);
      process.stdout.write(`# ${label} (${pool.length})\n`);
      pool.forEach((p, i) => process.stdout.write(`${i}\t${p}\n`));
    };
    if (which === 'all' || which === 'long') show('long');
    if (which === 'all' || which === 'short') show('short');
    return 0;
  }

  if (command === 'add') {
    const which = rest[0];
    const text = rest.slice(1).join(' ').trim();
    requireFlavorArg(which);
    if (!text) throw new Error('add needs phrase text');
    const pool = readPool(dir, which);
    pool.push(text);
    writeJson(poolPath(dir, which), pool);
    const counts = rebuild(dir);
    process.stdout.write(`added to ${which} (now ${pool.length}); combined rebuilt to ${counts.combined}\n`);
    return 0;
  }

  if (command === 'remove') {
    const which = rest[0];
    const index = Number(rest[1]);
    requireFlavorArg(which);
    const pool = readPool(dir, which);
    if (!Number.isInteger(index) || index < 0 || index >= pool.length) {
      throw new Error(`index out of range 0..${pool.length - 1}`);
    }
    const [removed] = pool.splice(index, 1);
    writeJson(poolPath(dir, which), pool);
    const counts = rebuild(dir);
    process.stdout.write(`removed from ${which}: ${JSON.stringify(removed)} (now ${pool.length}); combined ${counts.combined}\n`);
    return 0;
  }

  if (command === 'rebuild') {
    const counts = rebuild(dir);
    process.stdout.write(`combined rebuilt: ${counts.long} long + ${counts.short} short = ${counts.combined}\n`);
    return 0;
  }

  if (command === 'config') {
    const sub = rest[0] || 'get';
    if (sub === 'get') {
      process.stdout.write(`${JSON.stringify(readConfig(dir), null, 2)}\n`);
      return 0;
    }
    if (sub === 'set') {
      const config = setConfig(dir, rest[1], rest.slice(2).join(' '));
      process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
      return 0;
    }
    throw new Error(`unknown config subcommand "${sub}" (use get | set)`);
  }

  throw new Error(`unknown command "${command}" (try: where, list, add, remove, rebuild, config)`);
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`promptfluff: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { installDir, rebuild, readConfig, setConfig };
