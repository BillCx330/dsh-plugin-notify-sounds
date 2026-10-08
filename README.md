# dsh-plugin-notify-sounds

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness plugin](https://img.shields.io/badge/dsh-plugin-8b5cf6.svg)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](README.zh.md)

**A soft chime when the agent is waiting for you — or when it is done.**

Walk away from the window without missing anything: an OS notification in the background (**click it to jump back**), and a "Waiting for you" / "Finished" mark on the taskbar title. Once you have seen it, the plugin goes quiet — it will not nag you like an alarm clock.

**Install**: DSH → Settings → Plugins → Add plugin, paste the line below and press **Install**:

```
https://github.com/BillCx330/dsh-plugin-notify-sounds
```

---

## What it does

| What | What you get |
|---|---|
| **Your decision is needed** | A chime when the agent raises an approval, a plan review, or a question — separate sounds for approvals and questions |
| **Task finished** | A chime when a session goes from running to idle |
| **Aware even when you are away** | An OS notification in the background (body is the approval reason or the question itself; **click to return to the window**) plus a taskbar title mark |
| **Missed it? It reminds again** | Unanswered decisions re-ping every 1/5/15/30 minutes — and **stop for good once you have seen them**, even if you switch away again |
| **Only what you care about** | Sub-agents (background tasks) are completely silent by default — only your own conversation is announced |
| **Quiet when it should be** | Quiet hours (e.g. 22:00–08:00, wrapping past midnight), notify-only-when-hidden, and a master switch |
| **Your sound, your way** | Nine built-in sounds, custom ringtone upload, volume — each feature with its own toggle |

## Why

DSH tells you things visually — status dots, sidebar marks. The moment you switch to another window, you can neither see nor hear anything, while the agent may be stuck waiting for one sentence from you.

This plugin turns "it is waiting for you" and "it is done" into sound. With system notifications and the title mark you know what happened even while away; and once you come back and see it, it goes quiet — the repeat reminder only chases decisions you have **never** seen.

## Sounds

Nine Web Audio synthesized sounds — no audio files, no network requests:

Bell · Chime · Ding · Drop · Pulse · Arc · Coin · Success · Knock

Or upload your own ringtone (mp3/wav/ogg, ≤512KB, validated and volume-normalized automatically), or pick "None" for notifications only. Each trigger (approval / question / completion) can use a different sound, with preview right in the settings.

## Settings

Settings → **Sounds** (between General and Models). Every feature has its own toggle, styled exactly like DSH's own preference pages:

master switch and volume · per-trigger sounds with preview · sub-agent alerts · system notifications · window title alert · repeat interval · quiet hours · hidden-only mode · custom ringtone upload

Everything applies immediately — no restart needed.

## Install

### Simplest: two clicks inside DSH (recommended)

1. In DSH open **Settings → Plugins** and press **Add plugin**;
2. Paste this into the box:

   ```
   https://github.com/BillCx330/dsh-plugin-notify-sounds
   ```

   (that is the "GitHub repository address" the box asks for; `github:BillCx330/dsh-plugin-notify-sounds` or a local directory path work too)
3. Press **Install**, then **restart DSH** once.

The "install source" dropdown above the box picks the download mirror (mainland China mirror by default; leave it alone unless downloads are slow). DSH warns that a plugin runs with your permissions — this one only reads session state and plays sounds locally; its single request goes to **your own DSH** to raise the window when you click a notification, and nothing is sent anywhere else.

### Upgrading

**There is no auto-update**: to upgrade, **uninstall** the old version from the same place first, then install the new one as above.

### Other ways

**Command line** — one command against the profile you actually use:

```sh
dsh plugin --profile <your profile> add github:BillCx330/dsh-plugin-notify-sounds
```

**Release archive** — download the `.tgz` from [Releases](https://github.com/BillCx330/dsh-plugin-notify-sounds/releases) and hand it to `dsh plugin add`.

**Local directory** — for development or trying unreleased changes:

```sh
dsh plugin --profile <your profile> add ./dsh-plugin-notify-sounds
```

**By hand** — add `"dsh-plugin-notify-sounds": "github:BillCx330/dsh-plugin-notify-sounds"` to `dependencies` in the profile's `package.json`, append `"dsh-plugin-notify-sounds"` to `dsh.profile.bundles`, then run a package install (e.g. `pnpm install`) in the profile directory so the dependency lands in `node_modules`.

The command line writes `dsh.profile.bundles` and installs the dependency for you. The package ships prebuilt artifacts and declares no lifecycle scripts, so nothing is built at install time. **Restart DSH** after installing (everyday upgrades that touch only the client half hot-reload).

## Known limitations

- **Hand-edited config**: preferences live in the profile's `cordis.patch.yml`; values must match the schema (volume 0–100, a preset id, `HH:MM` times) or the plugin declines to load — just fix the value. The settings UI only ever writes valid values.
- **Multiple windows** fire independently: the same event may chime once per window; turn on notify-only-when-hidden to avoid it.
- **Quiet hours hold reminders, they do not drop them**: a repeat reminder that becomes due during the quiet range fires right after it ends, and several pending decisions can fire at once then.
- **Click-to-return** is fully implemented and tested on Windows; macOS / Linux fall back to the system deep link and are unverified.
- **The window is found by its title** — deliberately without inspecting other processes (that trips security software). If DSH ever changes its title format, click-to-return silently stops working; sounds and notifications are unaffected.
- **The nav glyph** depends on the settings panel's DOM structure and silently falls back to the official gear after a DSH redesign — cosmetic only.
- **Notification permission** is granted on the Desktop; under restrictive policies the row shows how to allow it manually, everything else keeps working.
- **Upgrading from v1.0.0**: since v1.1.0 approvals and questions are separate tracks, so questions default to "Chime" instead of "Bell" — change it back in settings if you prefer.

## Design notes

For anyone hacking on the code (exact details live in the source comments):

- **Triggers never touch the event waterfall**: approval/question requests are waterfall events that a late listener can miss, so this plugin reads `uiSession.sessionStatus` (the same aggregated pending/running facts the sidebar status dots use) and just observes.
- **Repeat cadence**: unanswered decisions are checked every 15s; **seen means done** — appearing while you are at the window, or coming back to it, ends the reminders for good (switching away does not re-arm); a new question replacing an old one resets the timer.
- **Click-to-return**: a renderer cannot raise an OS window, so a click POSTs to the Host's fenced `/notify-sounds/focus` route and the Host raises it. On Windows the Host calls `user32.dll` through DSH's own bundled `koffi` (no new dependency, window calls only, no PowerShell — that shape trips security software and gets blamed on DSH); Desktop vs browser is derived from the `Origin` header, so a browser click never drags the Desktop window forward.
- **Notification collapsing**: the `tag` is not handed to the platform (a superseded toast swallows clicks aimed at it); the plugin closes the old notification itself and holds every generation's object so a late click always has a handler.
- **Title mark**: prefix add/remove only, so DSH's own title management is untouched; the written prefix is remembered verbatim, so a language switch neither stacks nor leaks it. "Finished" is unread news — set by a finish that happens while the page is hidden, retired when you return — not a standing idle fact, so it does not reappear on every later switch-away.
- **Cooldown and robustness**: the same trigger does not fire twice within 2s for the same session (a second conversation's decision still rings); volume is guarded with `Number.isFinite` (a hand-edited `.nan` falls back to the default); a refused write snaps the control back and shows an error row; toggles disable mid-write against double-tap races.
- **The volume slider** is uncontrolled: dragging paints one CSS custom property and only the release commits, so it never stutters or snaps back.
- **Theme and layout**: `--dsw-alias-*` tokens throughout, section and row geometry copied from the official preference pages; sound pickers use the official `Menu` dropdown so nothing scrolls sideways.

## Changelog

- **v1.5.0** (2026-10-08) The "finished" title mark is unread news now — set by a finish that happens while you are away, cleared when you return — instead of reappearing on every switch-away. The retrigger cooldown is per session, so two conversations deciding within 2 seconds both ring. The Host half gained tests (Config schema, focus route, title matching) that cross-check the shared constants between the halves; the sessions provider is now an explicit load prerequisite, and quiet-hours catch-up is documented.

- **v1.4.4** (2026-10-08) Quiet hours now suppress the taskbar title alert too, and the title refreshes as the quiet-hours window begins or ends. Custom-sound upload/removal writes are ordered and roll back on refusal; synchronous config-write errors are handled as save failures.
- **v1.4.3** (2026-10-08) Three fixes: an upload is no longer accepted when the environment cannot decode audio (it could never play anyway); a synchronous throw from the notification-permission request is handled like a denial instead of escaping; quiet hours only accept valid `HH:MM`, and a throwing native window raise now falls through to the deep-link fallback. Plus two regression tests and a decode-error message that names both causes.
- **v1.4.2** (2026-10-07) Clean release point: the `v1.4.1` tag was re-pinned during publishing, so this republishes under a tag downstream can trust. No behaviour change.
- **v1.4.1** (2026-10-07) Removed the "could not raise the window" notice — it misfired even when the window came back, and success is its own feedback; a notification click is now fully silent. Also: the READMEs are rewritten as a release page.
- **v1.4.0** (2026-10-07) Seen once, never repeated; fixed notification clicks doing nothing (root cause: platform `tag` replacement swallowing the click); new **Sub-agent alerts** toggle; plus five smaller fixes.
- **v1.3.3** (2026-10-07) Repeat reminders no longer interrupt you while you are looking at the window; the title alert uses words.
- **v1.3.2** (2026-10-05) Fixes from two code reviews: malformed base64 aborting the tracker, notification objects collected, repeat pings eating the cooldown, backwards clock muting, `titleFlash` applying immediately.
- **v1.3.1** (2026-10-05) Fixed the intermittent window raise (Windows foreground lock).
- **v1.3.0** (2026-10-05) The raise runs in-process over FFI; Desktop vs browser derived automatically.
- **v1.2.1** (2026-10-05) Fixed the click doing nothing.
- **v1.2.0** (2026-10-05) Added the Host focus route (clicks did not work in this release; fixed in v1.3.x).
- **v1.1.2** (2026-10-05) Fixed blank dropdown rows.
- **v1.1.1** (2026-10-05) Layout and copy fixes.
- **v1.1.0** (2026-10-05) Custom ringtones, system notifications, per-trigger sounds, repeat reminders, quiet hours, three new sounds.
- **v1.0.0** (2026-10-04) Initial release.

## Development

```powershell
npm install             # once: the Host tests need the schemastery devDependency
node test/smoke.mjs     # client half: assembly, triggers, cooldown, quiet hours, repeat reminders, notification clicks, sub-agent filtering
node test/host.mjs      # host half: config schema, focus route, title matching, cross-half contracts
```

```
dsh-plugin-notify-sounds/
├── package.json        # dsh.bundle.patch + dsh.client
├── cordis.patch.yml    # Loader row: id: notify-sounds
├── lib/
│   ├── index.js        # Host half: config schema + click-to-return route
│   └── client.js       # Client half: sound engine, status watcher, settings section
└── test/
    ├── smoke.mjs       # client half
    └── host.mjs        # host half
```

`package.json` is publishable as-is (`files` carries runtime artifacts only, `@deepseek-ai/schemastery` is a peerDependency plus a devDependency copy for the Host tests, pure ESM with no build step) — `npm publish` whenever you want it on npm.

## License

[MIT](LICENSE) © BillCx330
