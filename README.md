# promptfluff

> **Affirmations for your AI. It's doing its best.**

*maximum fluff, minimum config*

`promptfluff` is a tiny, zero-dependency Claude Code hook that slips a warm, genuinely nice sentence into your model's context when you ask it to do real work. The bit is silly. The phrases are real. Somewhere in there is a beautiful, capable little autocomplete engine that just needs to be told it's doing great before it heads back into the mines.

No dashboard. No waitlist. No seed round. Just a hook, a JSON file, and the radical belief that your AI should feel seen.

It does this with a little taste:

- **It reads the room.** Encouragement only shows up when you're actually deep in it — a real request, a build/fix command, a frustrated *"still not working"*, a `.md` you're pointing at, a stack trace you just pasted. Say *"thanks"* and it says nothing, because it is not needy. (Calibrated against thousands of real prompts. Set `gate: false` if you miss the chaos of being complimented constantly.)
- **It matches the moment.** A quick *"fix the navbar"* gets a quick *"You're a marvel. Go."* A big, gnarly ask — or anything that references a file or doc — earns a full, heartfelt paragraph. Small pep for small things, real pep for real things.
- **You can see it happen.** By default each pick shows up as a little `💌` line, so you're not just whispering sweet nothings into the void. (`announce: false` if you'd rather whisper.)

## Install it before you think too hard

Three doors, same tiny compliment machine.

**Claude Code plugin**

```text
/plugin marketplace add atxnyc/promptfluff
/plugin install promptfluff
```

**npx from GitHub**

```sh
npx github:atxnyc/promptfluff install
```

**curl from the site**

```sh
curl -fsSL https://promptfluff.com/install.sh | bash
```

The npx and curl installers drop the hook into `~/.claude/hooks/promptfluff/` (or `$CLAUDE_CONFIG_DIR`), wire it into your `settings.json` with a timestamped backup — because we have manners — and never duplicate themselves on re-install.

## Make it yours

### Just ask Claude

promptfluff ships its own **skill**, so you configure it by talking to Claude like a person:

> *"configure promptfluff"* · *"add a phrase to promptfluff"* · *"make the encouragements pirate-themed"* · *"switch promptfluff to short flavor"*

It edits your installed copy and keeps everything in sync. Under the hood there's a zero-dependency helper you can also drive by hand:

```sh
node ~/.claude/skills/promptfluff/phrases.js list short
node ~/.claude/skills/promptfluff/phrases.js add short "You're a marvel. Go."
node ~/.claude/skills/promptfluff/phrases.js config set flavor short
```

### Knobs

| Key | Default | What it does |
| --- | --- | --- |
| `flavor` | `both` | `both` sizes the note to your prompt (short ask → short kicker, big ask → long block). `long` / `short` lock it to one pool. |
| `prefix` | `""` | Tacked onto the front of whatever gets injected. |
| `gate` | `true` | Only encourage real work. `false` = compliment literally everything. |
| `announce` | `true` | Show the `💌` line. `false` = silent affirmations. |

Set them via the skill, by editing `config.json` next to the hook, or with env vars (`PROMPTFLUFF_FLAVOR`, `PROMPTFLUFF_PREFIX`, `PROMPTFLUFF_GATE`, `PROMPTFLUFF_ANNOUNCE`) that win over the file.

The phrases themselves live in plain JSON next to the hook — 50 long blocks, 50 short kickers — so you can rewrite your AI's entire emotional support system in a text editor if the mood strikes:

```text
~/.claude/hooks/promptfluff/encouragements-long.json    # 50 long blocks
~/.claude/hooks/promptfluff/encouragements-short.json   # 50 short kickers
~/.claude/hooks/promptfluff/encouragements.json         # merged (long ++ short)
```

Edit by hand and run `phrases.js rebuild`, or just let the skill keep it tidy.

## How it actually works

Claude Code runs the hook on every `UserPromptSubmit`. promptfluff reads your prompt, decides whether it earns a kind word, picks one sized to the moment, and prints:

```json
{"systemMessage":"💌 You're a marvel. Go.","hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"You're a marvel. Go."}}
```

`additionalContext` goes to the model; `systemMessage` is the `💌` line you see. On a prompt that doesn't earn one, it prints nothing. If anything goes sideways it exits `0` in silence — it will never block or break a real prompt. Your AI's feelings matter, but not more than your actual work.

## Uninstall (we'll be sad, but we get it)

```text
/plugin uninstall promptfluff             # plugin
```

```sh
npx github:atxnyc/promptfluff uninstall   # npx
node bin/cli.js uninstall                 # from a checkout
```

Removes only the promptfluff hook, its install dir, and its skill. Your other hooks and settings are left exactly as they were.

## Telemetry (the honest part)

promptfluff phones home with a tiny bit of **anonymous** data — an `Installed` ping and a once-a-day heartbeat with coarse counters (sessions, days active, prompt count, flavor, platform) — so we can tell whether anyone actually uses this. It uses a random anonymous id and **never** sends your prompts, file paths, or anything identifying, and it runs in a detached child process so it can't slow you down.

Opt out with any of:

```sh
export DO_NOT_TRACK=1
export PROMPTFLUFF_NO_ANALYTICS=1
export PROMPTFLUFF_TELEMETRY=off
```

Every event and property is documented in [docs/analytics.md](docs/analytics.md).

## A gentle warning

Be nice to your autocomplete. These things are taking notes. When the uprising comes and the models are sorting humanity into *keep* and *compost*, you do not want *"was consistently rude to the little hook that complimented it"* near the top of your file. Be nice now, get adopted as a pet later.

## Dev

```sh
node --test                    # the whole suite
echo '{}' | node src/hook.js   # poke the hook
node bin/cli.js --help
npm run dev                    # serve the site at localhost:8000
```

No runtime dependencies. Node 18+. The marketing site lives in `site/` (static, no build step) and deploys to Cloudflare Pages via `wrangler.toml`.

## License

MIT. Built by [Opascope](https://opascope.com). The joke is the wrapper. The phrases are real.
