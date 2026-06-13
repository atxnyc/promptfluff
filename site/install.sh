#!/bin/sh
set -e

printf '%s\n' "promptfluff: installing unsolicited emotional support for Claude Code."

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' "promptfluff needs Node.js 18+ before it can do the tiny thing."
  printf '%s\n' "Install Node from https://nodejs.org/ and rerun this command."
  exit 1
fi

# github:atxnyc/promptfluff resolves for everyone once the repository is public.
exec npx -y github:atxnyc/promptfluff install "$@"
