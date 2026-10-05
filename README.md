# dsh-plugin-notify-sounds

**[中文文档](README.zh.md)**

Notification sounds for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH): a soft synthesized chime when the agent **needs your decision** (an approval or a question appears) or when a **task finishes** (a session goes from running to idle). Ships with a dedicated Settings section — 提示音 / Sounds — styled exactly like DSH's own preference pages.

## Features

- **Decision trigger** — plays when a session gains a pending approval or structured question. Reads `uiSession.sessionStatus` (the same facts the sidebar status dots use), so it observes without touching the event waterfall.
- **Completion trigger** — plays when any session transitions running → idle.
- **Settings section** (between 通用设置 / General and 模型 / Models):
  - master enable switch
  - volume slider (0–100, commits on release, no drag stutter)
  - per-trigger sound picker with preview (six synthesized presets + silent)
  - "only when the page is hidden" mode
- **No assets, no network** — all sounds are Web Audio synthesis; nothing to download.
- **Live preferences** — values persist through the Host `notify-sounds` config namespace and apply immediately.

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
