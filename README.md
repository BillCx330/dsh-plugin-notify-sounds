# dsh-plugin-notify-sounds

**[中文文档](README.zh.md)**

Notification sounds for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH): a soft synthesized chime when the agent **needs your decision** (an approval or a question appears) or when a **task finishes** (a session goes from running to idle). Ships with a dedicated Settings section — 提示音 / Sounds — styled exactly like DSH's own preference pages.

## Features

- **Decision trigger** — plays when a session gains a pending approval, plan review, or question. Reads `uiSession.sessionStatus` (the same facts the sidebar status dots use), so it observes without touching the event waterfall. **Approvals and questions get separate sound pickers** (the interaction objects carry a `kind` discriminator).
- **Completion trigger** — plays when any session transitions running → idle.
- **Custom ringtone** — upload a local audio file (mp3/wav/ogg, ≤512KB); it is decode-checked and peak-normalized, then offered as a "Custom" option in all three pickers. Stored as base64 in the plugin config — no file server needed.
- **System notifications** — while the page is hidden, also show an OS notification (body taken from the approval reason or question text); click focuses the window. Permission is requested only when the toggle is turned on, and its live state shows inline.
- **Window title alert** — mark the window title with a bell while a decision is pending and the page is hidden; cleared on return.
- **Repeat reminder** — re-ping unanswered decisions at 1/5/15/30 minute intervals until handled.
- **Quiet hours** — a daily time range (wrap-around supported) with no sounds or notifications.
- **Nine synthesized presets** + custom + silent. No assets, no network.
- **Settings section** (between General and Models) — every feature has its own toggle, styled like DSH's own preference pages.
- **Live preferences** — values persist through the Host `notify-sounds` config namespace and apply immediately.

## Changelog

- **v1.1.2** — fix blank dropdown rows: the official `Menu` reads item text from `label` (`text` is reserved for group headings); v1.1.1 passed the wrong field. The smoke test now asserts every entry carries a non-empty label.
- **v1.1.1** — layout and copy fixes: sound pickers rebuilt on the official `Menu` dropdown (no more sideways panel scrolling), all rows in the official text-left/control-right geometry, descriptions rewritten (no browser-only wording, no emoji), and a picker pointing at a removed custom sound falls back in the UI too.
- **v1.1.0** — custom ringtones, system notifications, approval/question split, repeat reminders, quiet hours, three new presets.
- **v1.0.0** — initial release: decision/completion triggers, volume slider, six presets, hidden-only mode.

## Requirements

- DSH desktop app with the plugin loader (profile bundles).

## Install

Add the bundle to your DSH profile (pnpm-style dependency), then list it in `dsh.profile.bundles`:

```jsonc
// <profile>/package.json
"dependencies": {
  "dsh-plugin-notify-sounds": "github:BillCx330/dsh-plugin-notify-sounds"
}
```

```jsonc
// <profile>/dsh.profile.json (or wherever your profile keeps bundle lists)
"dsh.profile.bundles": ["dsh-plugin-notify-sounds"]
```

Or clone it anywhere and use a `file:` dependency pointing at the checkout — both work; the plugin is pure ESM with no build step.

## Development

```powershell
node test/smoke.mjs   # stubbed Module Loader + fake DOM + recording AudioContext
```

## License

[MIT](LICENSE) © BillCx330
