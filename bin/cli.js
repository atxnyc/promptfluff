#!/usr/bin/env node
'use strict';

const { install } = require('../src/install');
const { uninstall } = require('../src/uninstall');
const { status } = require('../src/install');
const { normalizeFlavor } = require('../src/config');
const pkg = require('../package.json');

let telemetry = null;
try {
  telemetry = require('../src/telemetry');
} catch (_error) {
  telemetry = { trackInstall() {} };
}

function help() {
  return `promptfluff ${pkg.version}

Affirmations for your AI. It is doing its best.

Usage:
  promptfluff install [--flavor both|long|short] [--prefix "..."] [--dir <path>]
  promptfluff uninstall [--dir <path>]
  promptfluff status [--dir <path>]
  promptfluff help

Options:
  --flavor <name>   Phrase pool: both, long, or short. Default: both.
  --prefix <text>   Text prepended to every injected phrase. Default: empty.
  --dir <path>      Claude config dir. Default: $CLAUDE_CONFIG_DIR or ~/.claude.
  --version         Print the promptfluff version.
  --help            Show this help.

After install, ask Claude to "configure promptfluff" (a bundled skill) to edit
the phrases or change settings, or edit config.json next to the installed hook.
`;
}

function parseArgs(argv) {
  const args = argv.slice();
  let command = args.shift() || 'help';
  const options = {};

  if (command === '--help' || command === '-h') {
    command = 'help';
  }
  if (command === '--version' || command === '-v') {
    command = 'version';
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else if (arg === '--flavor') {
      options.flavor = args[++index];
    } else if (arg.startsWith('--flavor=')) {
      options.flavor = arg.slice('--flavor='.length);
    } else if (arg === '--prefix') {
      options.prefix = args[++index] || '';
    } else if (arg.startsWith('--prefix=')) {
      options.prefix = arg.slice('--prefix='.length);
    } else if (arg === '--dir') {
      options.dir = args[++index];
    } else if (arg.startsWith('--dir=')) {
      options.dir = arg.slice('--dir='.length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { command, options };
}

function assertFlavor(flavor) {
  if (flavor === undefined) {
    return;
  }
  if (normalizeFlavor(flavor) !== flavor) {
    throw new Error(`Unknown flavor "${flavor}". Use both, long, or short.`);
  }
}

function run(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  const { command, options } = parseArgs(argv);

  if (options.help || command === 'help') {
    io.stdout.write(help());
    return 0;
  }
  if (options.version || command === 'version') {
    io.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  if (command === 'install') {
    assertFlavor(options.flavor);
    const result = install(options);
    io.stdout.write(`promptfluff installed at ${result.installDir}\n`);
    io.stdout.write(`Hook: ${result.command}\n`);
    io.stdout.write(`Skill: ${result.skillDir} (ask Claude to "configure promptfluff")\n`);
    io.stdout.write(`Flavor: ${result.config.flavor}; prefix: ${JSON.stringify(result.config.prefix)}\n`);
    if (result.backupPath) {
      io.stdout.write(`Settings backup: ${result.backupPath}\n`);
    }
    if (!result.changedSettings) {
      io.stdout.write('Settings already had the promptfluff hook. No duplicate added.\n');
    }
    try {
      // Anonymous, opt-out-respecting install ping via a detached child; never
      // blocks or breaks the install.
      telemetry.trackInstall({
        method: telemetry.detectInstallMethod ? telemetry.detectInstallMethod() : undefined,
        flavor: result.config.flavor,
        hasPrefix: Boolean(result.config.prefix),
        version: pkg.version
      });
    } catch (_error) {
      // Telemetry is best effort.
    }
    return 0;
  }

  if (command === 'uninstall') {
    const result = uninstall(options);
    io.stdout.write(`promptfluff uninstalled from ${result.installDir}\n`);
    if (result.backupPath) {
      io.stdout.write(`Settings backup: ${result.backupPath}\n`);
    }
    if (!result.changedSettings) {
      io.stdout.write('No settings hook was present. Nothing to remove there.\n');
    }
    return 0;
  }

  if (command === 'status') {
    const result = status(options);
    io.stdout.write(`Claude config: ${result.claudeDir}\n`);
    io.stdout.write(`Files: ${result.filesPresent ? 'present' : 'missing'} at ${result.installDir}\n`);
    io.stdout.write(`Settings hook: ${result.installed ? 'installed' : 'not installed'}\n`);
    if (result.config.flavor || result.config.prefix !== undefined) {
      io.stdout.write(`Flavor: ${result.config.flavor || 'both'}; prefix: ${JSON.stringify(result.config.prefix || '')}\n`);
    }
    if (result.settingsError) {
      io.stdout.write(`Settings could not be read: ${result.settingsError.message}\n`);
    }
    return 0;
  }

  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  try {
    process.exitCode = run();
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${help()}`);
    process.exitCode = 1;
  }
}

module.exports = {
  help,
  parseArgs,
  run
};
