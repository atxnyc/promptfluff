# Analytics

promptfluff sends a small amount of anonymous usage telemetry to RudderStack so
we can understand adoption and utilization. It is intentionally minimal, low
volume, and easy to turn off. **No prompt content, file paths, hostnames, or
other identifying data is ever collected.**

There are two RudderStack sources.

## 1. Web (JavaScript source)

Wired into `site/index.html` via the standard RudderStack snippet, with the
event calls in `site/main.js`.

- **Write key:** `3F5Q1sTPz70dSsb3js5xT89zT43`
- **Data plane:** `https://opascopeanajoo.dataplane.rudderstack.com`

| Event | When | Properties |
| --- | --- | --- |
| `page` | On every page load | (default page context) |
| `Install Command Copied` | A copy button in the install grid is clicked | `method` (`npx` \| `plugin` \| `curl`), `command` |
| `Install Script Viewed` | The "view /install.sh" link is clicked | `href` |
| `Encouragement Generated` | The "Encourage my AI" demo button is clicked | `phrase` |

All calls go through small guarded wrappers (`trackEvent` / `trackPage`), so if
an ad blocker prevents the SDK from loading, the page still works.

## 2. CLI + hook (HTTP source)

Implemented in `src/telemetry.js` (mirrored to `plugin/scripts/telemetry.js`
and copied into the installed hook dir). Events are posted to the RudderStack
HTTP source at `<data plane>/v1/batch` using HTTP Basic auth (the write key as
the username, empty password).

- **Write key:** `3F5Q5IN7aO1QR8yqrInShrQtdnu`
- **Source ID:** `3F5Q5LJJ4ESEwpH9veXC9hhtpVe`
- **Data plane:** `https://opascopeanajoo.dataplane.rudderstack.com`

| Event | When | Key properties |
| --- | --- | --- |
| `Installed` | The CLI installer finishes successfully | `method` (`npx` \| `npm` \| `local`), `flavor`, `hasPrefix`, `version`, `node`, `platform`, `arch`, `reinstall` |
| `Daily Use` | First prompt of each UTC day (per user) | `sessions`, `prompts`, `daysActive`, `firstVersion`, `version`, `flavor`, `platform`, `surface` (`hook` \| `plugin`) |

Each event is sent as a `batch` containing an `identify` (so the user profile
carries the latest counters) followed by the `track` call. Every event uses an
`anonymousId` only — a random UUID generated once and stored locally. There is
no `userId`.

### Local state

A single JSON file tracks the anonymous id and counters between runs:

```
~/.promptfluff/analytics.json    (override with $PROMPTFLUFF_STATE_DIR)
```

It holds: `anonymousId`, `createdAt`, `installedAt`, `firstVersion`,
`lastVersion`, `sessionsTotal`, `promptsTotal`, `daysActive`, `lastDailyDate`,
and a capped list of recent session ids (used only to count distinct sessions).

### Why it never slows you down

The hook's job is to inject an encouragement and exit fast. Telemetry runs
*after* the encouragement is written, does only cheap local file I/O on the hot
path, and hands the network call to a **detached child process** that the hook
does not wait on. The daily heartbeat fires at most once per UTC day. If the
network is down, nothing retries and nothing blocks. Any telemetry error is
swallowed — it can never affect a prompt submission.

## Opting out

Set any one of these (they disable the CLI/hook HTTP-source telemetry):

```sh
export DO_NOT_TRACK=1            # the cross-tool standard
export PROMPTFLUFF_NO_ANALYTICS=1
export PROMPTFLUFF_TELEMETRY=off
```

The web analytics respect the visitor's browser/ad-blocker choices.

## Overriding the destination

```sh
export PROMPTFLUFF_RUDDERSTACK_WRITE_KEY=...
export PROMPTFLUFF_RUDDERSTACK_DATA_PLANE=https://your-dataplane.rudderstack.com
```

Defaults live as constants in `src/telemetry.js`. See `.env.example` for the
full list of variables.
