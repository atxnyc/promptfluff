---
name: promptfluff
description: >-
  Configure promptfluff — the encouragement hook. Use when the user wants to
  edit the words of encouragement (add / remove / reword / retheme phrases),
  change the flavor (short / long / both), set a prefix, or turn the visible 💌
  announcement or the gating on/off.
  Triggers: "edit the encouragements", "add a phrase to promptfluff", "make
  promptfluff nicer/meaner", "switch promptfluff to short", "promptfluff settings".
---

# Configuring promptfluff

promptfluff is an installed Claude Code `UserPromptSubmit` hook. This skill edits
the **installed** copy — the files next to the running hook — so changes take
effect on the user's next prompt. Never edit the source repo for this.

## 1. Find the install

Run the bundled helper to locate it (it resolves `$PROMPTFLUFF_DIR`, else
`$CLAUDE_CONFIG_DIR/hooks/promptfluff`, else `~/.claude/hooks/promptfluff`):

```sh
node "$CLAUDE_PLUGIN_ROOT/skills/promptfluff/phrases.js" where   # plugin install
# or, for an npx/curl install, the skill sits in ~/.claude/skills/promptfluff/:
node ~/.claude/skills/promptfluff/phrases.js where
```

The directory holds: `encouragements-long.json` (50 long blocks),
`encouragements-short.json` (50 short kickers), `encouragements.json` (the merged
pool), and `config.json`.

**Invariant:** `encouragements.json` must always equal `long ++ short`. The
helper maintains this for you; if you edit the long/short files by hand, run
`node phrases.js rebuild` afterward.

## 2. Edit phrases

Prefer the helper for mechanical edits — it validates and rebuilds the merged
pool automatically:

```sh
node phrases.js list short                       # numbered, to find an index
node phrases.js add short "You're a marvel. Go."  # append a short kicker
node phrases.js add long  "A whole paragraph of warmth that runs ~30+ words ..."
node phrases.js remove long 7                     # delete long phrase #7
```

For richer changes — rewording many phrases, retheming the whole pool (e.g.
"make them all pirate-themed"), bulk edits — edit `encouragements-long.json` /
`encouragements-short.json` directly with your normal file tools, keep them as
JSON arrays of non-empty strings, then run `node phrases.js rebuild`.

Guidance on the two pools: **long** = heartfelt, multi-sentence (~30–47 words);
**short** = punchy one-liners (~3–8 words). On the `both` flavor the hook pairs
one of each, so keep that contrast.

## 3. Change settings (`config.json`)

```sh
node phrases.js config get                  # show current settings
node phrases.js config set flavor short     # both | long | short
node phrases.js config set prefix "psst — " # text prepended to the injected note
node phrases.js config set gate off         # off = encourage EVERY prompt (default on)
node phrases.js config set announce off     # off = inject silently, no visible 💌 line
```

What each does:

- **flavor** — which pool to draw from. `short` (default) is a single punchy
  kicker; `both` pairs a long block with a short kicker; `long` uses one long phrase.
- **prefix** — string prepended to the phrase injected into the model's context.
- **gate** — when `on` (default) only substantive prompts get encouragement
  (long asks, build/fix commands, frustration, file/error references); trivial
  chatter ("thanks") gets nothing. `off` restores the original "every prompt".
- **announce** — when `on` (default) the pick is shown to the user as a visible
  `💌` line; `off` keeps it model-only.

Settings also accept env-var overrides at runtime (`PROMPTFLUFF_FLAVOR`,
`PROMPTFLUFF_PREFIX`, `PROMPTFLUFF_GATE`, `PROMPTFLUFF_ANNOUNCE`), which win
over `config.json`.

## 4. Confirm

After any change, show the user what you changed (the new phrase, or
`config get` output). The next prompt they send will reflect it — no restart.
