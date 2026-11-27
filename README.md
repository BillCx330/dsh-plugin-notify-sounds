# dsh-plugin-notify-sounds

[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/billcx330/dsh-plugin-notify-sounds)
[![DeepSeek Harness plugin](https://img.shields.io/badge/dsh-plugin-8b5cf6.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![npm version](https://img.shields.io/npm/v/dsh-plugin-notify-sounds.svg)](https://www.npmjs.com/package/dsh-plugin-notify-sounds)
[![npm downloads](https://img.shields.io/npm/dm/dsh-plugin-notify-sounds.svg)](https://www.npmjs.com/package/dsh-plugin-notify-sounds)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English | [中文](README.zh.md)

**A soft chime when the agent is waiting for you — or when it is done.**

Walk away from the window without missing anything: an OS notification whether the window is minimised, covered, or merely unfocused (**click it to jump back**), and a "Waiting for you" / "Finished" mark on the window title — the taskbar on Windows, the Window menu, Mission Control and the Dock's window list on macOS. Once you have seen it, the plugin goes quiet — it will not nag you like an alarm clock.

**Install**: DSH → **Plugins** in the left sidebar → Add plugin, paste the line below (keep the version — a release younger than 24 hours is resolved back to the previous one by pnpm's `minimumReleaseAge`) and press **Install**:

```
dsh-plugin-notify-sounds@1.9.7
```

---

## 🎨 Consistent with DSH's design language

Every visual detail of the settings section comes from DSH's own design system: row geometry, dividers, type sizes and spacing use the official design tokens, the sound picker is the official `Menu` primitive, the icons come from the official family, and the layout follows the native text-left, control-right row shape. Installing it does not introduce a visually disjoint third-party block into your settings.

## ✨ What it can do

| What | What you get |
|---|---|
| **Your decision is needed** | A chime when the agent raises an approval, a plan review, or a question — separate sounds for approvals and questions |
| **Task finished** | A chime when a session goes from running to idle |
| **Aware even when you are away** | An OS notification whenever the window is minimised, covered, or merely unfocused (body is the approval reason or the question itself; **click to return to the window**) plus a mark on the window title (the taskbar on Windows; the Window menu, Mission Control and the Dock's window list on macOS) |
| **Missed it? It reminds again** | Unanswered decisions re-ping every 1/5/15/30 minutes — and **stop for good once you have seen them**, even if you switch away again |
| **Only what you care about** | Sub-agents (background tasks) are completely silent by default — only your own conversation is announced |
| **Quiet when it should be** | Quiet hours (e.g. 22:00–08:00, wrapping past midnight), notify-only-when-away, and a master switch |
| **Your sound, your way** | Nine built-in sounds, levelled to each other; **up to three of your own clips**, named and assignable to any alert (mp3 / wav / ogg / m4a, up to 15s each); volume — each feature with its own toggle |
| **Update checks** | Checks npm for a newer version and gives the shortest route for your shell: **0.2.2 and later update in place from the Plugins panel**; 0.2.1 and earlier get the uninstall-and-add steps; a web profile gets the command line. The row also flags an install the profile's lockfile does not match |

## 💡 Why

DSH tells you things visually — status dots, sidebar marks. The moment you switch to another window, you can neither see nor hear anything, while the agent may be stuck waiting for one sentence from you.

This plugin turns "it is waiting for you" and "it is done" into sound. With system notifications and the title mark you know what happened even while away; and once you come back and see it, it goes quiet — the repeat reminder only chases decisions you have **never** seen.

## 🔔 Sounds

Bell · Chime · Ding · Drop · Pulse · Arc · Coin · Success · Knock — nine built-in sounds, all synthesized live with Web Audio: no audio files, no network requests.

Or upload your own audio (mp3 / wav / ogg / m4a, up to 15s and 3MB each, validated and loudness-normalized), or pick "None" for notifications only. Each trigger (approval / question / completion) gets its own sound, with preview right in the settings.

## ⚙️ Settings

Settings → **Sounds** (between General and Models). Every feature has its own toggle, styled exactly like DSH's own preference pages:

master switch and volume · per-trigger sounds with preview · sub-agent alerts · system notifications · window title alert · repeat interval · quiet hours · away-only mode · up to three named clips of your own · update checks (upgrades happen in the Plugins panel)

Everything applies immediately — no restart needed.

## 📦 Install

### 🖱️ Simplest: two clicks inside DSH (recommended)

1. In DSH open the **Plugins** panel in the left sidebar and press **Add plugin**;
2. Paste the package name **with a version** (this plugin is published on [npm](https://www.npmjs.com/package/dsh-plugin-notify-sounds)):

   ```
   dsh-plugin-notify-sounds@1.9.7
   ```

   Do not drop the version: pnpm's `minimumReleaseAge` policy keeps a release younger than 24 hours out of automatic resolution, so the bare name resolves to the previous one. The current version is on [npm](https://www.npmjs.com/package/dsh-plugin-notify-sounds?activeTab=versions) and in [Releases](https://github.com/BillCx330/dsh-plugin-notify-sounds/releases).
   (The GitHub repository address `https://github.com/BillCx330/dsh-plugin-notify-sounds` or a local directory path work too, but neither pins a version.)
3. Press **Install**, then **restart DSH** once.

The "install source" dropdown above the box picks the download mirror (mainland China mirror by default; leave it alone unless downloads are slow). DSH warns that a plugin runs with your permissions — this one only reads session state and plays sounds locally. Its one outbound request is the update check against npm (at most once a day, and it can be switched off in Settings); clicking a notification asks **your own DSH** to raise the window, and nothing else leaves the machine.

### ⬆️ Upgrading

**Upgrades are installed by the package manager**, so the profile's lockfile moves with the files — a DSH plugin cannot install its own update durably (the manager refuses a package that is already declared, and its remove-then-install step unloads the very code that would finish the install). The plugin therefore only *checks*, and tells you where to install:

- **0.2.2 and later**: **Plugins** in the sidebar → the row shows its version state, click update (no uninstall-and-add).
- **0.2.1 and earlier**: **Plugins** in the left sidebar → uninstall this plugin under *Installed plugins* → **Add plugin** → paste `dsh-plugin-notify-sounds@<version>` → Install → restart DSH. (Keep the version: pnpm's `minimumReleaseAge` policy keeps a freshly published version out of automatic resolution for its first 24 hours, so the bare name can resolve to the previous release.)

Uninstalling keeps your settings: preferences and uploaded audio live in the profile (`cordis.patch.yml` and `notify-sounds/sounds/`), so a reinstall restores them — including a clip migrated out of a pre-1.9.0 install.
- **On a `web` profile**: `dsh plugin --profile <your profile> add dsh-plugin-notify-sounds@<version>`.

The update row also warns when the running version is not what the profile's lockfile records — the state left behind by the pre-1.8.0 self-updater. One reinstall through the package manager fixes it for good.

### 🛠️ Other ways

**Command line** — one command against the profile you actually use:

```sh
dsh plugin --profile <your profile> add github:BillCx330/dsh-plugin-notify-sounds
```

(A Git install follows the repository's default branch and pins no version; use `package@version` above when the install has to be reproducible.)

**Release archive** — download the `.tgz` from [Releases](https://github.com/BillCx330/dsh-plugin-notify-sounds/releases) and install it by its **path on disk**:

```sh
dsh plugin --profile <your profile> add ./dsh-plugin-notify-sounds-1.9.7.tgz
```

(`dsh plugin add` hands its argument straight to the package manager, so it takes a local file path — a download URL will not work.)

**Local directory** — for development or trying unreleased changes:

```sh
dsh plugin --profile <your profile> add ./dsh-plugin-notify-sounds
```

**By hand** — add `"dsh-plugin-notify-sounds": "github:BillCx330/dsh-plugin-notify-sounds"` to `dependencies` in the profile's `package.json`, append `"dsh-plugin-notify-sounds"` to `dsh.profile.bundles`, then run a package install (e.g. `pnpm install`) in the profile directory so the dependency lands in `node_modules`.

The command line writes `dsh.profile.bundles` and installs the dependency for you. The package ships prebuilt artifacts and declares no lifecycle scripts, so nothing is built at install time. **Restart DSH** after installing (everyday upgrades that touch only the client half hot-reload).

## ⚠️ Known limitations

- **Where custom audio lives**: each file is stored by content hash under `profiles/<profile>/notify-sounds/sounds/<sha256>.<ext>`, and the config keeps only its name. **Back up (or move) the whole profile directory** — copying `cordis.patch.yml` alone does not carry the audio. After uninstalling, at most the last file stays behind (a few hundred KB).
- **Hand-edited config**: preferences live in the profile's `cordis.patch.yml`; values must match the schema (volume 0–100, a preset id, `HH:MM` times) or the plugin declines to load — just fix the value. The settings UI only ever writes valid values.
- **Upgrades are installed by the package manager, not by the plugin**: 1.8.0 removed the self-installer (writing files in place never updated the profile's lockfile, so the next plugin install silently restored the old version). The update row still checks npm and reports a newer version, then gives the shortest route for your shell: **0.2.2 and later click Update in the Plugins panel**; 0.2.1 and earlier uninstall and add again; a web profile runs `dsh plugin add`.
- **Versions up to 1.7.0** reach 1.8.0 through their own updater (1.8.0 keeps the same seven filenames), but that arrival is not registered with pnpm: reinstall once through the package manager as above and every later upgrade stays in place. Versions up to 1.6.9 cannot install a release that adds a file — their fixed whitelist refuses it safely; the same one-time reinstall fixes that too.
- **Multiple windows** elect one page to speak (since 1.7.0): sounds, system notifications and repeat reminders therefore fire once for the whole GUI, not once per window. Title marks stay per-window, because each window has its own title. If the speaking page closes or crashes, another takes over within seconds.
- **Where the macOS title mark shows up**: the Desktop hides the title-bar text by the platform's own convention (`titleBarStyle: "hiddenInset"`), so the mark is not drawn on the bar. It is still the window's real title, so it appears in the Window menu, the Mission Control / App Exposé window labels, and the Dock icon's window list ("Waiting for you <session> — DeepSeek Harness"). The switch works as usual, and the settings row says where to look; "Finished" is still unread news and retires when you return.
- **Click-to-return** is fully implemented and tested on Windows; macOS / Linux fall back to the system deep link and are unverified.
- **A click is slower when the window was closed to the tray**: that case goes through the deep link so Electron can `show()` the window itself (otherwise the frame comes back while the page stays paused) — about 0.5–1.5s slower. On the welcome screen the deep link may do nothing.
- **Third-party desktop wrappers** (e.g. DSH NEXT) register no `dsh://` protocol and expose no focus API, so clicking a notification cannot return you to the window there — the gap is on the host side, not something a plugin can close.
- **The window is found by its title** — deliberately without inspecting other processes (that trips security software). If DSH ever changes its title format, click-to-return silently stops working; sounds and notifications are unaffected.
- **The nav glyph** depends on the settings panel's DOM structure and silently falls back to the official gear after a DSH redesign — cosmetic only.
- **Notification permission** is granted on the Desktop; under restrictive policies the row shows how to allow it manually, everything else keeps working.
- **macOS system notifications**: the desktop shell grants every permission request, so settings always say "granted" — whether a banner actually appears is up to macOS (System Settings → Notifications → DeepSeek Harness), and unsigned development builds may fail silently. "It says granted but nothing shows" is usually not this plugin.
- **Upgrading from v1.0.0**: since v1.1.0 approvals and questions are separate tracks, so questions default to "Chime" instead of "Bell" — change it back in settings if you prefer.

## 🧩 Design notes

For anyone hacking on the code (exact details live in the source comments):

- **Triggers never touch the event waterfall**: approval/question requests are waterfall events that a late listener can miss, so this plugin reads `uiSession.sessionStatus` (the same aggregated pending/running facts the sidebar status dots use) and just observes.
- **Repeat cadence**: unanswered decisions are checked every 15s; **seen means done** — appearing while you are at the window, or coming back to it, ends the reminders for good (switching away does not re-arm); a new question replacing an old one resets the timer. A reminder that comes due during quiet hours is dropped rather than deferred.
- **Click-to-return**: a renderer cannot raise an OS window, so a click POSTs to the Host's fenced `/notify-sounds/focus` route and the Host raises it. On Windows the Host calls `user32.dll` through DSH's own bundled `koffi` (no new dependency, window calls only, no PowerShell — that shape trips security software and gets blamed on DSH); Desktop vs browser is derived from the `Origin` header, so a browser click never drags the Desktop window forward.
- **Notification collapsing**: the `tag` is not handed to the platform (a superseded toast swallows clicks aimed at it); the plugin closes the old notification itself and holds every generation's object so a late click always has a handler.
- **Title mark**: prefix add/remove only, so DSH's own title management is untouched; the written prefix is remembered verbatim, so a language switch neither stacks nor leaks it. "Finished" is unread news — set by a finish that happens while the page is hidden, retired when you return — not a standing idle fact, so it does not reappear on every later switch-away. The macOS Desktop draws no title-bar text by the platform's convention, so the same mark is read from the Window menu, Mission Control and the Dock's window list (see Known limitations); the switch stays available there and only the row's copy says where to look.
- **Quiet hours mean forgotten, not queued**: a decision or finish that arrives during the quiet range is not recorded at all — no sound, no notification, no title mark — and nothing that was missed overnight is delivered when the window ends.
- **Cooldown and robustness**: the same trigger does not fire twice within 2s for the same session (a second conversation's decision still rings); volume is guarded with `Number.isFinite` (a hand-edited `.nan` falls back to the default); a refused write snaps the control back and shows an error row; toggles disable mid-write against double-tap races.
- **The volume slider** is uncontrolled: dragging paints one CSS custom property and only the release commits, so it never stutters or snaps back.
- **Theme and layout**: `--dsw-alias-*` tokens throughout, section and row geometry copied from the official preference pages; sound pickers use the official `Menu` dropdown so nothing scrolls sideways.

## 📜 Changelog

- **v1.9.7** (2026-11-27) **Works with DSH 0.2.3-alpha again** ([#8](https://github.com/BillCx330/dsh-plugin-notify-sounds/issues/8), thanks @zuosus). Two APIs changed shape: (1) the session status table became a service of its own and Cordis now rejects an undeclared member read, so the plugin threw `cannot get property "uiSession.sessionStatus" without inject` while loading; (2) `connection.requestRejection` was removed in favour of `admit`, and all four routes (focus / update check / goal phase / sound upload) authorize through it, so the first request would have failed. Both are resolved at runtime: read the status member the old way and fall back to the service, and prefer the old trust check, calling `admit` only when it is gone. 0.2.2 and earlier take the same paths they always did.
- **v1.9.6** (2026-11-22) **"Only when away" now really means unfocused too, and the title alert works on macOS again** ([#6](https://github.com/BillCx330/dsh-plugin-notify-sounds/pull/6), [#7](https://github.com/BillCx330/dsh-plugin-notify-sounds/pull/7), thanks @jasonwentf). (1) That setting used to read visibility alone: a window sitting on screen while you typed in another app still counted as "visible" and stayed silent. It now shares the system notification's test — hidden **or** unfocused — and the row's own wording changed to "Only when you are away". (2) The macOS Desktop draws no title-bar text, so the title alert used to be disabled there outright; the window title still reaches the Window menu, Mission Control and the Dock's window list, so the switch is enabled again with a hint saying where to look. The macOS half was verified by the contributor; Windows behaviour is unchanged.
- **v1.9.5** (2026-11-07) **Adapted to DSH 0.2.2-rc.1: the Settings glyph is back, at the size of its neighbours.** 0.2.2 wraps the nav glyph in a `<span>`, so the old "find the svg and replace it" patch no longer matched and the cell fell back to the default gear; that release also added the supported `settings.section.icon` slot, so the glyph is now a registered component. Its size was fixed along the way: the alarm clock was drawn in 17 units and rendered into a 16px slot, shrinking it 6% and thinning the stroke from 1.3px to 1.22px; the paths are now refitted to the 16 unit box, so the weight matches the rest of the nav. 0.2.1 keeps the DOM swap; both paths stay. The upgrade notes point at 0.2.2's in-place update, and the in-app update hint follows the DSH version: 0.2.2 and later just say "click Update", older builds still get the full uninstall-and-add steps. The README's marketplace-update bullet is gone.

The other 39 versions are in [CHANGELOG.en.md](https://github.com/BillCx330/dsh-plugin-notify-sounds/blob/main/CHANGELOG.en.md).
