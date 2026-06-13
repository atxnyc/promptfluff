#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

let config = null;
try {
  config = require('./config');
} catch (_error) {
  config = {
    resolveConfig() {
      return { flavor: 'both', prefix: '', gate: true, announce: true, dadJokeOdds: 420 };
    },
    poolFileForFlavor() {
      return 'encouragements.json';
    }
  };
}

let telemetry = null;
try {
  telemetry = require('./telemetry');
} catch (_error) {
  telemetry = { recordHookRun() {} };
}

// We retain stdin both to pull `session_id` for telemetry and the `prompt`
// text for gating, while still draining the rest of a large payload.
const STDIN_CAPTURE_CAP = 1 << 18;

// --- Gating -----------------------------------------------------------------
// Encourage a prompt only when it's a real moment of work — not trivial chatter
// ("thanks", "yes do it", "is it working?"). The threshold and signal lists are
// calibrated against ~3,900 real user prompts mined from session history.
// A prompt qualifies on ANY of:
//   1. length      — a substantive ask (>= MIN_WORDS words)
//   2. command     — short, but opens with a build/fix task verb
//   3. frustration — friction phrasings; the whole bit is that the little AI
//                    most needs to hear it's doing its best when things break
//   4. file ref    — points at a file / doc / handoff (reliably real work)
//   5. error       — pasted stack trace / error / code fence
//   6. shout       — short all-caps (anger); long caps tables fire on length
const MIN_WORDS = 10;

const LEAD_IN = new Set([
  'please', 'pls', 'hey', 'ok', 'okay', 'so', 'now', 'also', 'and', 'then',
  'lets', "let's", 'can', 'could', 'would', 'will', 'you', 'go', 'ahead',
  'just', 'kindly', 'quick', 'quickly', 'i', 'id', "i'd", 'we'
]);

const TASK_VERBS = new Set([
  'build', 'create', 'implement', 'fix', 'refactor', 'debug', 'rewrite',
  'redesign', 'design', 'add', 'write', 'ship', 'migrate', 'optimize',
  'optimise', 'integrate', 'deploy', 'scaffold', 'port', 'generate',
  'automate', 'configure', 'prototype', 'investigate', 'diagnose',
  'troubleshoot', 'draft', 'update', 'remove', 'delete', 'rename',
  'extract', 'wire', 'set', 'install', 'upgrade', 'enable', 'disable',
  'replace', 'convert', 'tweak'
]);

// Lowercased substring match. Deliberately high-precision: bare "just", "stop",
// "still" and "error" were dropped — their false-positive rates in the data were
// far too high (e.g. "just make it", "stop the server", "url is still X").
const FRUSTRATION = [
  'still no', 'still not', 'still doesn', 'still failing', 'still see',
  'stopped working', "doesn't work", 'doesnt work', 'not working',
  "didn't work", "won't work", "isn't working",
  'crashed again', 'keeps failing', 'keeps crashing',
  'why is it', 'why does it', "why isn't", "why can't", "why won't",
  'why did you', 'why do you keep', 'why are you',
  'you keep', 'i already', 'i told you', "that's not what", 'i just meant',
  'makes no sense', "doesn't make sense",
  'ugh', 'wtf', 'for fuck', 'fucking', 'unfuck', 'fucked up', 'goddamn',
  'dear god', 'you broke', 'you removed', 'you deleted', 'you are wrong',
  "that's wrong"
];

// Regex fragments tested against the lowercased prompt. Any hit => real work.
const FILE_REFERENCE = [
  /\.md\b/, /\.json\b/, /\.(ts|tsx|js|jsx|py|go|rs|sh|ya?ml|toml|env|css|html)\b/,
  /\bclaude\.md\b/, /\bagents?\.md\b/, /\breadme\b/, /\bhandoff\b/,
  /\bdocs?\//, /\bsrc\//, /@[\w./-]+/, /`[^`]+`/,
  /\bthe (spec|plan|doc|handoff|brief|template|roadmap)\b/, /\/home\/[\w./-]+/
];

// Tested against the original-case prompt (stack lines / ErrorNames are cased).
const ERROR_SIGNAL = [
  /```/, /\b\w*Error\b/, /\b\w*Exception\b/, /traceback/i,
  /\b(400|401|403|404|500|502)\b/, /^\s*at \w/m, /errno|ENOENT|ECONNREFUSED/
];

// Three+ consecutive all-caps words. Only reached on short prompts (after the
// length gate), where caps reads as shouting rather than a pasted data table.
const SHOUT = /\b[A-Z]{2,}(?:\s+[A-Z]{2,}){2,}\b/;

function words(text) {
  return String(text || '').toLowerCase().match(/[a-z']+/g) || [];
}

function startsWithTaskVerb(toks) {
  let i = 0;
  while (i < toks.length && LEAD_IN.has(toks[i])) {
    i += 1;
  }
  return i < toks.length && TASK_VERBS.has(toks[i]);
}

function deservesEncouragement(prompt) {
  const text = String(prompt || '');
  if (!text.trim()) {
    return false;
  }
  const lower = text.toLowerCase();
  const toks = words(text);

  if (toks.length >= MIN_WORDS) {
    return true; // substantive length
  }
  if (startsWithTaskVerb(toks)) {
    return true; // short build/fix command
  }
  if (FRUSTRATION.some((needle) => lower.includes(needle))) {
    return true; // the AI earns its pep talk most when things are tense
  }
  if (FILE_REFERENCE.some((re) => re.test(lower))) {
    return true; // points at a file / doc / handoff
  }
  if (ERROR_SIGNAL.some((re) => re.test(text))) {
    return true; // pasted error / stack trace / code
  }
  return SHOUT.test(text); // short all-caps shouting
}

// --- Dad joke ---------------------------------------------------------------
// A rare easter egg: roll once per message, independent of gating. When it hits
// we ask the model for a dad joke (and announce the roll, if announce is on).
const DAD_JOKE_CONTEXT =
  'Before you do anything else, your human would love a dad joke — please tell one, then carry on.';

// Secret manual trigger: this token anywhere in a prompt force-fires the dad
// joke, so it can be tested on demand without waiting on the 1-in-N roll.
const DAD_JOKE_TEST = 'djdj';

function rollDadJoke(odds, random) {
  if (!odds || odds <= 0) {
    return false;
  }
  return Math.floor(random() * odds) === 0;
}

function dadJokeContext() {
  return `🃏 ${DAD_JOKE_CONTEXT}`;
}

// --- Phrase pools -----------------------------------------------------------
function drainStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    let raw = '';
    process.stdin.on('data', (chunk) => {
      if (raw.length < STDIN_CAPTURE_CAP) {
        raw += chunk;
      }
    });
    process.stdin.on('error', () => resolve(raw));
    process.stdin.on('end', () => resolve(raw));
    process.stdin.resume();
  });
}

function parsePrompt(raw) {
  if (!raw || !raw.trim()) {
    return '';
  }
  try {
    const payload = JSON.parse(raw);
    if (payload && typeof payload === 'object' && typeof payload.prompt === 'string') {
      return payload.prompt;
    }
  } catch (_error) {
    // Not JSON / no prompt — gate as if empty.
  }
  return '';
}

function dataDirCandidates(scriptDir) {
  return [
    scriptDir,
    path.join(scriptDir, 'data'),
    path.join(scriptDir, '..', 'data')
  ];
}

function resolvePoolPath(scriptDir, flavor) {
  const fileName = config.poolFileForFlavor(flavor);
  for (const dir of dataDirCandidates(scriptDir)) {
    const candidate = path.join(dir, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(scriptDir, fileName);
}

function readPool(poolPath) {
  const data = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
  if (!Array.isArray(data)) {
    return [];
  }
  return data.filter((item) => typeof item === 'string' && item.trim());
}

function readFlavorPool(scriptDir, flavor) {
  try {
    return readPool(resolvePoolPath(scriptDir, flavor));
  } catch (_error) {
    return [];
  }
}

function choosePhrase(pool, random = Math.random) {
  if (!Array.isArray(pool) || pool.length === 0) {
    return null;
  }
  return pool[Math.floor(random() * pool.length)];
}

// A "big" ask earns the long pool on the `both` flavor: a long message, or one
// that references a file / doc / markdown.
function isBigPrompt(prompt) {
  const text = String(prompt || '');
  if (words(text).length >= MIN_WORDS) {
    return true;
  }
  const lower = text.toLowerCase();
  return FILE_REFERENCE.some((re) => re.test(lower));
}

// Returns { context, visible } for the encouragement, or null. The `both`
// flavor sizes the note to the prompt: a big ask (long, or a file/doc/markdown
// reference) gets a long block; a short ask gets a short kicker. `long`/`short`
// are fixed to their pool.
function pickEncouragement(scriptDir, flavor, random, options = {}) {
  const effective = flavor === 'both' ? (options.big ? 'long' : 'short') : flavor;
  const pool = readFlavorPool(scriptDir, effective) || readFlavorPool(scriptDir, 'both');
  const msg = choosePhrase(pool, random);
  return msg ? { context: msg, visible: `💌 ${msg}` } : null;
}

// --- Output -----------------------------------------------------------------
// Low-level shaper. Pass either a ready `additionalContext`, or a
// `phrase`(+`prefix`)/`pool` to compose one. `systemMessage` (optional) is the
// user-visible line. Returns null when there is nothing to say.
function buildOutput(options = {}) {
  let additionalContext;
  if (options.additionalContext !== undefined) {
    additionalContext = options.additionalContext;
  } else {
    const phrase = options.phrase || choosePhrase(options.pool, options.random);
    additionalContext = phrase ? `${options.prefix || ''}${phrase}` : '';
  }

  if (!additionalContext && !options.systemMessage) {
    return null;
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext
    }
  };
  if (options.systemMessage) {
    output.systemMessage = options.systemMessage;
  }
  return output;
}

function buildOutputFromFiles(options = {}) {
  const scriptDir = options.scriptDir || __dirname;
  const env = options.env || process.env;
  const resolved = config.resolveConfig({ scriptDir, env });
  const prompt = typeof options.prompt === 'string' ? options.prompt : '';
  const random = options.random || Math.random;
  const rollRandom = options.rollRandom || random;

  const dadJoke = typeof options.dadJoke === 'boolean'
    ? options.dadJoke
    : prompt.toLowerCase().includes(DAD_JOKE_TEST) || rollDadJoke(resolved.dadJokeOdds, rollRandom);

  let encouragement = null;
  if (!resolved.gate || deservesEncouragement(prompt)) {
    encouragement = pickEncouragement(scriptDir, resolved.flavor, random, { big: isBigPrompt(prompt) });
  }

  if (!encouragement && !dadJoke) {
    return null;
  }

  const contextParts = [];
  if (encouragement) {
    contextParts.push(`${resolved.prefix || ''}${encouragement.context}`);
  }
  if (dadJoke) {
    contextParts.push(dadJokeContext());
  }

  // The dad joke is a quiet easter egg: unlike encouragement it never gets the
  // visible 💌-style systemMessage reveal — it only lands in the model's
  // context and surfaces as the joke Claude actually tells.
  let systemMessage;
  if (resolved.announce && encouragement) {
    systemMessage = encouragement.visible;
  }

  return buildOutput({ additionalContext: contextParts.join('\n'), systemMessage });
}

async function main() {
  try {
    const raw = await drainStdin();
    const prompt = parsePrompt(raw);
    const output = buildOutputFromFiles({ prompt });
    if (output) {
      process.stdout.write(`${JSON.stringify(output)}\n`);
    }
    try {
      // Runs after the encouragement is already written, queues at most one
      // network call per day via a detached child, and never throws.
      telemetry.recordHookRun(raw);
    } catch (_telemetryError) {
      // Telemetry must never affect prompt submission.
    }
  } catch (_error) {
    // Never let an encouragement bug interfere with a real prompt submit.
  }
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    () => process.exit(0)
  );
}

module.exports = {
  buildOutput,
  buildOutputFromFiles,
  choosePhrase,
  deservesEncouragement,
  isBigPrompt,
  parsePrompt,
  pickEncouragement,
  readPool,
  resolvePoolPath,
  rollDadJoke
};
