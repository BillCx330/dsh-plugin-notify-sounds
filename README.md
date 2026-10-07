# dsh-plugin-notify-sounds

**[中文文档](README.zh.md)**

Notification sounds for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH): a soft synthesized chime when the agent **needs your decision** (an approval or a question appears) or when a **task finishes** (a session goes from running to idle). Ships with a dedicated Settings section — 提示音 / Sounds — styled exactly like DSH's own preference pages.

## Features

- **Decision trigger** — plays when a session gains a pending approval, plan review, or question. Reads `uiSession.sessionStatus` (the same facts the sidebar status dots use), so it observes without touching the event waterfall. **Approvals and questions get separate sound pickers** (the interaction objects carry a `kind` discriminator).
- **Completion trigger** — plays when any session transitions running → idle.
- **Main conversation only** — a new **Sub-agent alerts** toggle (off by default). Sub-agent sessions (background tasks, Agent Teams teammates) stay **completely silent**: no chime, no notification, no title mark, no repeat reminder. Turn it on and they behave exactly like your own conversations. Classification uses the very field DSH uses to keep sub-agents out of the sidebar (`origin: 'subagent'`), so a forked conversation is unaffected.
- **Custom ringtone** — upload a local audio file (mp3/wav/ogg, ≤512KB); it is decode-checked and peak-normalized, then offered as a "Custom" option in all three pickers. Stored as base64 in the plugin config — no file server needed.
- **System notifications** — while the page is hidden, also show an OS notification (body taken from the approval reason or question text); click returns to the window (see below). Permission is requested only when the toggle is turned on, and its live state shows inline.
- **Click-to-return, Desktop and browser told apart automatically** — the click posts to the Host `/notify-sounds/focus` route, fenced like DSH's own open-in-app routes. The Desktop's renderer fetches from its own `dsh-app://app/` origin and the shell strips `Origin` when forwarding, while a real browser always sends one: no `Origin` means Desktop, so the Host raises the window; an `Origin` means browser, where the OS already activates the window on click and raising the Desktop window would be the wrong window. No setting to choose.
- **Window title alert** — while the page is hidden, mark the window title with a word: "待处理" when a decision is waiting for you, "已完成" when everything is idle. Cleared on return.
- **Repeat reminder** — re-ping unanswered decisions at 1/5/15/30 minute intervals, but **never again once you have seen one**: appearing while you were at the window, or coming back to it, both count as seen, and leaving again does not re-arm it. Only a decision that appeared while you were elsewhere and that you have never come back to is re-pinged, until it is handled.
- **Quiet hours** — a daily time range (wrap-around supported) with no sounds or notifications.
- **Nine synthesized presets** + custom + silent. No assets, no network.
- **Settings section** (between General and Models) — every feature has its own toggle, styled like DSH's own preference pages.
- **Live preferences** — values persist through the Host `notify-sounds` config namespace and apply immediately.

## Changelog

- **v1.4.0** — **seen once, never repeated**, plus a new setting (this release carries a feature, hence the minor bump). v1.3.3 only stopped pinging while the page was visible; the countdown still re-armed, so "came back, read it, switched away" rang again a whole interval later. A decision the user has now seen — it appeared while they were at the window, or they came back to it — leaves the reminder for good, and switching away does not revive it; only decisions never seen are re-pinged. Also fixed **notification clicks doing nothing** (root cause measured): collapsing repeats through the platform `tag` means the platform supersedes the previous toast, and a click aimed at the superseded toast is dropped with it — a dead button, and that is exactly the toast users click. Collapsing is now done by the plugin itself (close the old, show the new, **no platform `tag`**), so there is only ever one live toast; a click is also **failure-notified**: success stays quiet (the window coming back is the feedback), and only a raise that actually fails says so with one short "Could not raise the window" notice — the acknowledgement toast and pinned notifications used while debugging are gone, and notifications auto-dismiss as usual. The Host logs one line per click (`focus click` / `window raised`). Plus: the title prefix no longer stacks or leaks across a language switch (the prefix written is remembered and removed verbatim instead of being guessed from the current labels), the title alert no longer rewrites the title when nothing changed, a cleared quiet-hours time input no longer reports a bogus save failure, a rejected notification-permission request no longer leaves an unhandled rejection and a lying toggle, and a hot-reloaded bundle now refreshes its stylesheet. Also new: a **Sub-agent alerts** toggle (off by default) — sub-agent sessions (background tasks, Agent Teams teammates) stay completely silent by default so only your own conversation is announced; classification uses the same `origin: 'subagent'` field DSH uses to keep sub-agents out of the sidebar, so a forked conversation is unaffected.
- **v1.3.3** — two behaviour fixes. **Repeat reminders no longer interrupt you while you are looking at the window**: they used to re-fire on a fixed countdown from when the decision appeared, so they arrived even after you had handled it or returned; a visible page is now never pinged, and the countdown re-arms so it takes a full interval after you leave again. **The title alert uses words instead of a symbol**: "待处理" while a decision waits, "已完成" when idle (localized — the English UI shows "Waiting for you" / "Finished").
- **v1.3.2** — fixes from two independent reviews (each cross-checked against DSH's own source). Host: `SetForegroundWindow`'s result was discarded, so the fallback could never run in the one case it exists for — success is now read back from `GetForegroundWindow`; the fallback spawns asynchronously instead of blocking the Host's event loop for up to 8s; the `AttachThreadInput` detach moved into a `finally`; a failed FFI load now warns once. Client: **fixed a bug that could disable the core triggers together** — a malformed `customSound` made `atob` throw synchronously from inside the session-status diff and the reminder interval, aborting the whole read and taking the title flash and reminder tracker with it; the notification reference became a `Set` (a decision and a completion toast are alive at once); repeat pings no longer consume the retrigger cooldown or record themselves as sent; the cooldown survives a backwards clock correction; `titleFlash` applies immediately. A regression test covers the crash and was checked to fail without the guard.
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
