# dsh-plugin-notify-sounds

**[中文文档](README.zh.md)**

Notification sounds for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH): a soft synthesized chime when the agent **needs your decision** (an approval or a question appears) or when a **task finishes** (a session goes from running to idle). Ships with a dedicated Settings section — 提示音 / Sounds — styled exactly like DSH's own preference pages.

## Features

- **Decision trigger** — plays when a session gains a pending approval, plan review, or question. Reads `uiSession.sessionStatus` (the same facts the sidebar status dots use), so it observes without touching the event waterfall. **Approvals and questions get separate sound pickers** (the interaction objects carry a `kind` discriminator).
- **Completion trigger** — plays when any session transitions running → idle.
- **Custom ringtone** — upload a local audio file (mp3/wav/ogg, ≤512KB); it is decode-checked and peak-normalized, then offered as a "Custom" option in all three pickers. Stored as base64 in the plugin config — no file server needed.
- **System notifications** — while the page is hidden, also show an OS notification (body taken from the approval reason or question text); click returns to the window (see below). Permission is requested only when the toggle is turned on, and its live state shows inline.
- **Click-to-return, Desktop and browser told apart automatically** — the click posts to the Host `/notify-sounds/focus` route, fenced like DSH's own open-in-app routes. The Desktop's renderer fetches from its own `dsh-app://app/` origin and the shell strips `Origin` when forwarding, while a real browser always sends one: no `Origin` means Desktop, so the Host raises the window; an `Origin` means browser, where the OS already activates the window on click and raising the Desktop window would be the wrong window. No setting to choose.
- **Window title alert** — mark the window title with a bell while a decision is pending and the page is hidden; cleared on return.
- **Repeat reminder** — re-ping unanswered decisions at 1/5/15/30 minute intervals until handled.
- **Quiet hours** — a daily time range (wrap-around supported) with no sounds or notifications.
- **Nine synthesized presets** + custom + silent. No assets, no network.
- **Settings section** (between General and Models) — every feature has its own toggle, styled like DSH's own preference pages.
- **Live preferences** — values persist through the Host `notify-sounds` config namespace and apply immediately.

## Changelog

- **v1.3.1** — fix the window raise being intermittent: the log showed `SetForegroundWindow` refused by Windows' foreground lock about half the time (`setfg=false`), which lifts the window in Z-order without focusing it and reads as "the click did nothing". A bare ALT tap (`keybd_event`) and an `AttachThreadInput` attach now run before the request; three consecutive tries from a minimized window reported `setfg=true`.
- **v1.3.0** — the raise now runs in-process over FFI: the Host borrows the Desktop's own `koffi` (already there for `node-pty`, so no new dependency) and calls `user32.dll`, finding the window by title. It no longer starts PowerShell or compiles C#, shapes a security suite flags as malware and attributes to the Desktop's own executable. The route also derives Desktop vs browser from the `Origin` header, so a browser click no longer pulls the Desktop window forward.
- **v1.2.1** — fix the click doing nothing: the fetch now goes first (it was gated behind `close()`/`focus()` calls that could throw), and the notification is held so its `onclick` cannot be collected.
- **v1.2.0** — added the Host `/notify-sounds/focus` route (connection fence). The `dsh://open` deep link it used **did not actually raise the window**; corrected in v1.3.0/v1.3.1.
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
