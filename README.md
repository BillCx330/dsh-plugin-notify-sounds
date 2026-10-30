# dsh-plugin-notify-sounds

[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/billcx330/dsh-plugin-notify-sounds)
[![DeepSeek Harness plugin](https://img.shields.io/badge/dsh-plugin-8b5cf6.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![npm version](https://img.shields.io/npm/v/dsh-plugin-notify-sounds.svg)](https://www.npmjs.com/package/dsh-plugin-notify-sounds)
[![npm downloads](https://img.shields.io/npm/dm/dsh-plugin-notify-sounds.svg)](https://www.npmjs.com/package/dsh-plugin-notify-sounds)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English | [中文](README.zh.md)

**A soft chime when the agent is waiting for you — or when it is done.**

Walk away from the window without missing anything: an OS notification in the background (**click it to jump back**), and a "Waiting for you" / "Finished" mark on the taskbar title. Once you have seen it, the plugin goes quiet — it will not nag you like an alarm clock.

**Install**: DSH → **Plugins** in the left sidebar → Add plugin, paste the line below (keep the version — a release younger than 24 hours is resolved back to the previous one by pnpm's `minimumReleaseAge`) and press **Install**:

```
dsh-plugin-notify-sounds@1.9.2
```

---

## 🎨 Consistent with DSH's design language

Every visual detail of the settings section comes from DSH's own design system: row geometry, dividers, type sizes and spacing use the official design tokens, the sound picker is the official `Menu` primitive, the icons come from the official family, and the layout follows the native text-left, control-right row shape. Installing it does not introduce a visually disjoint third-party block into your settings.

## ✨ What it can do

| What | What you get |
|---|---|
| **Your decision is needed** | A chime when the agent raises an approval, a plan review, or a question — separate sounds for approvals and questions |
| **Task finished** | A chime when a session goes from running to idle |
| **Aware even when you are away** | An OS notification in the background (body is the approval reason or the question itself; **click to return to the window**) plus a taskbar title mark |
| **Missed it? It reminds again** | Unanswered decisions re-ping every 1/5/15/30 minutes — and **stop for good once you have seen them**, even if you switch away again |
| **Only what you care about** | Sub-agents (background tasks) are completely silent by default — only your own conversation is announced |
| **Quiet when it should be** | Quiet hours (e.g. 22:00–08:00, wrapping past midnight), notify-only-when-hidden, and a master switch |
| **Your sound, your way** | Nine built-in sounds, levelled to each other; **up to three of your own clips**, named and assignable to any alert (mp3 / wav / ogg / m4a, up to 15s each); volume — each feature with its own toggle |
| **Update checks** | Checks npm for a newer version and points at the route that installs it — the **Plugins** panel in the sidebar (uninstall, then add again), the marketplace, or `dsh plugin add` on a web profile; the row also flags an install the profile's lockfile does not match |

## 💡 Why

DSH tells you things visually — status dots, sidebar marks. The moment you switch to another window, you can neither see nor hear anything, while the agent may be stuck waiting for one sentence from you.

This plugin turns "it is waiting for you" and "it is done" into sound. With system notifications and the title mark you know what happened even while away; and once you come back and see it, it goes quiet — the repeat reminder only chases decisions you have **never** seen.

## 🔔 Sounds

Bell · Chime · Ding · Drop · Pulse · Arc · Coin · Success · Knock — nine built-in sounds, all synthesized live with Web Audio: no audio files, no network requests.

Or upload your own audio (mp3 / wav / ogg / m4a, up to 15s and 3MB each, validated and loudness-normalized), or pick "None" for notifications only. Each trigger (approval / question / completion) gets its own sound, with preview right in the settings.

## ⚙️ Settings

Settings → **Sounds** (between General and Models). Every feature has its own toggle, styled exactly like DSH's own preference pages:

master switch and volume · per-trigger sounds with preview · sub-agent alerts · system notifications · window title alert · repeat interval · quiet hours · hidden-only mode · up to three named clips of your own · update checks (installs go through the package manager)

Everything applies immediately — no restart needed.

## 📦 Install

### 🖱️ Simplest: two clicks inside DSH (recommended)

1. In DSH open the **Plugins** panel in the left sidebar and press **Add plugin**;
2. Paste the package name **with a version** (this plugin is published on [npm](https://www.npmjs.com/package/dsh-plugin-notify-sounds)):

   ```
   dsh-plugin-notify-sounds@1.9.2
   ```

   Do not drop the version: pnpm's `minimumReleaseAge` policy keeps a release younger than 24 hours out of automatic resolution, so the bare name resolves to the previous one. The current version is on [npm](https://www.npmjs.com/package/dsh-plugin-notify-sounds?activeTab=versions) and in [Releases](https://github.com/BillCx330/dsh-plugin-notify-sounds/releases).
   (The GitHub repository address `https://github.com/BillCx330/dsh-plugin-notify-sounds` or a local directory path work too, but neither pins a version.)
3. Press **Install**, then **restart DSH** once.

The "install source" dropdown above the box picks the download mirror (mainland China mirror by default; leave it alone unless downloads are slow). DSH warns that a plugin runs with your permissions — this one only reads session state and plays sounds locally; its single request goes to **your own DSH** to raise the window when you click a notification, and nothing is sent anywhere else.

### ⬆️ Upgrading

**Upgrades are installed by the package manager**, so the profile's lockfile moves with the files — a DSH plugin cannot install its own update durably (the manager refuses a package that is already declared, and its remove-then-install step unloads the very code that would finish the install). The plugin therefore only *checks*, and tells you where to install:

- **Inside DSH (recommended, and the only path verified on the Desktop)**: **Plugins** in the left sidebar → uninstall this plugin under *Installed plugins* → **Add plugin** → paste `dsh-plugin-notify-sounds@<version>` → Install → restart DSH. (Keep the version: pnpm's `minimumReleaseAge` policy keeps a freshly published version out of automatic resolution for its first 24 hours, so the bare name can resolve to the previous release.)

Uninstalling keeps your settings: preferences and uploaded audio live in the profile (`cordis.patch.yml` and `notify-sounds/sounds/`), so a reinstall restores them — including a clip migrated out of a pre-1.9.0 install.
- **With the marketplace plugin** ([dshmarket](https://www.npmjs.com/package/dshmarket)): update it in one click there.
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
dsh plugin --profile <your profile> add ./dsh-plugin-notify-sounds-1.9.2.tgz
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
- **Upgrades are installed by the package manager, not by the plugin**: 1.8.0 removed the self-installer (writing files in place never updated the profile's lockfile, so the next plugin install silently restored the old version). The update row still checks npm and reports a newer version, then points at the route that installs — the **Plugins** panel in the sidebar (uninstall, then add again), the marketplace, or `dsh plugin add` on a web profile.
- **Versions up to 1.7.0** reach 1.8.0 through their own updater (1.8.0 keeps the same seven filenames), but that arrival is not registered with pnpm: reinstall once through the package manager as above and every later upgrade stays in place. Versions up to 1.6.9 cannot install a release that adds a file — their fixed whitelist refuses it safely; the same one-time reinstall fixes that too.
- **Multiple windows** elect one page to speak (since 1.7.0): sounds, system notifications and repeat reminders therefore fire once for the whole GUI, not once per window. Title marks stay per-window, because each window has its own title. If the speaking page closes or crashes, another takes over within seconds.
- **Click-to-return** is fully implemented and tested on Windows; macOS / Linux fall back to the system deep link and are unverified.
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
- **Title mark**: prefix add/remove only, so DSH's own title management is untouched; the written prefix is remembered verbatim, so a language switch neither stacks nor leaks it. "Finished" is unread news — set by a finish that happens while the page is hidden, retired when you return — not a standing idle fact, so it does not reappear on every later switch-away.
- **Quiet hours mean forgotten, not queued**: a decision or finish that arrives during the quiet range is not recorded at all — no sound, no notification, no title mark — and nothing that was missed overnight is delivered when the window ends.
- **Cooldown and robustness**: the same trigger does not fire twice within 2s for the same session (a second conversation's decision still rings); volume is guarded with `Number.isFinite` (a hand-edited `.nan` falls back to the default); a refused write snaps the control back and shows an error row; toggles disable mid-write against double-tap races.
- **The volume slider** is uncontrolled: dragging paints one CSS custom property and only the release commits, so it never stutters or snaps back.
- **Theme and layout**: `--dsw-alias-*` tokens throughout, section and row geometry copied from the official preference pages; sound pickers use the official `Menu` dropdown so nothing scrolls sideways.

## 📜 Changelog

- **v1.9.2** (2026-10-30) **System notifications are titled with the conversation name.** They used to read "Task finished / The agent has finished the current task", so with several conversations open you had to click through to learn which one. The title now carries the conversation's name (from the `title` already on DSH's session rows, falling back to the workspace folder), and the body is unchanged; a decision toast prefixes its body with the event so nothing is lost. Titles are trimmed at 48 characters, an untitled session keeps the old wording, and a raw session id is never shown. These fields exist since DSH 0.2.0 — not a new API — and when they are missing the behaviour is exactly what it was. **One cross-platform fix came along**: on Windows two windows uploading the same clip at once made the second report "not audio" (415) — POSIX lets `rename` overwrite, Windows refuses — and that refusal is now treated as success.
- **v1.9.1** (2026-10-29) **Fixed "too quiet": the nine presets are now levelled by loudness, not by peak.** A user reported that even 100% was quiet. Two things were stacked: the presets had never been matched to each other (`coin` peaks at 0.105, `ding` at 0.315 — 9.5 dB apart), and all of them sat about 12 dB below a decoded clip (a preset played at -16 dBFS at 100%, an imported file at -4). The same slider number meant two loudnesses. The first cut levelled them by peak, which made the coin sound louder still: a square carries 3 dB more energy than a sine at the same peak (RMS/peak 1.0 vs 0.707). Levels now use a crest-corrected peak — sines and squares land on the same energy, and triangles are capped at the ceiling rather than pushed past it. The same number is about 12 dB louder, and the nine sounds agree with each other. **The saved volume is re-scaled once on upgrade**: at the new scale the same number is ~10 dB louder, so the stored value is halved (60 → 30, 100 → 50) — about 3.5 dB above where you were. Turn it up for the new headroom.
- **v1.9.0** (2026-10-27) **Your own sounds become a small library: three at most, each renameable and assignable.** All three alerts used to share a single "Custom" upload, so giving "finished" its own sound while "approval needed" kept a preset was impossible. The "Custom sound" row now holds everything: press **Add audio**, and the file is listed underneath (three at most) where it can be renamed, previewed or removed; the three alert pickers list your sounds by name, so each alert plays the one you point it at. **The bytes moved out of the config**: a 512KB clip used to become 699,052 characters of base64 inside `cordis.patch.yml` — 277× the whole file, rewritten on every settings change — so audio is now stored under `profiles/<profile>/notify-sounds/sounds/<hash>.<ext>` with only the name in the config. Three gaps closed as well: **3MB and 15 seconds per sound** (a long clip turns an alert into background music and can cost tens of MB once decoded); **silent and near-zero-length files are refused at upload**; and **anything unreadable falls back to that alert's default sound** — a damaged payload used to silence all three with nothing in the UI to explain it. The list marks a file that has gone missing, and one no alert uses yet. Existing audio from an older release is moved into the library on first run; if that fails it stays where it was and keeps playing.
- **v1.8.6** (2026-10-23) **A full audit, paid off — no new features.** Fixed: with goal-only alerting on, turning the switch **off** while the watcher waited still produced the chime it was holding at the end of the goal (the watcher now re-reads the preference); the update check cached a FAILURE for the full day, so one network blip left the row reading "check failed" until tomorrow (failures are now cached for a minute, and the row no longer blames the network — it says neither source returned a usable answer); a `pnpm-lock.yaml` key carrying a peer suffix (`pkg@1.8.4(@scope/peer@3.18.4)`) was read as a version, which flagged a perfectly good install as unregistered and told the user to reinstall it; an unreadable current version rendered as "This version ? · Up to date", which is now its own message; the repeat-interval control displayed a hand-edited 7 as "5 min" while reminders fired every seven (display and timer now share one snap); identical quiet-hours bounds were silently treated as "no quiet" and the description now says so; the client's time parser accepted `9:05` while the Host schema rejected it (both are strict now); a custom-sound read failure was reported as "could not decode"; and one refused notification construction left the row permanently "unsupported" (a successful one now clears it). **Update guidance**: on the Desktop the plugin manager is a **sidebar panel named Plugins**, not "Settings → Plugins" — 1.8.5 got that wrong; every install command now pins the version (it rendered as `@v1.8.5`, and the display prefix does not belong in a command a package manager parses), and the copy explains that a release younger than pnpm's `minimumReleaseAge` window resolves back to the previous one. **Cleanup**: removed the 527-line unreachable self-installer from 1.8.0 (the Host file drops from 1553 to 1023 lines, along with 10 imports that existed only for it), the update notice that could never render, eight dead dictionary keys, and the tests that pinned the dead code; all three route paths are now cross-checked between the halves (`/notify-sounds/goal` was missing, and it is the one that has already drifted once). The README's "multiple windows fire independently" claim contradicted the speaking-page election shipped in 1.7.0 and is corrected.
- **v1.8.5** (2026-10-20) **The wording catches up with the mechanism.** The update row still said a newer version could be installed "in one click" — it cannot since 1.8.0: the row only checks and points at the package manager. The row now says exactly that, and its in-app guidance carries the version (`dsh-plugin-notify-sounds@{version}`) so a fresh release is not silently resolved to the previous one by pnpm's `minimumReleaseAge` policy. The README feature table, settings summary and install step no longer promise one-click installs; historical changelog entries are left untouched.
- **v1.8.4** (2026-10-20) **A click always finds the window.** A trace of a real click showed the native raise giving up with "no window found" while the window existed: a hidden or repainting window can transiently answer with an empty title, and the search had nothing else to match on. The window search now also matches the process that owns the window (the Desktop shell is this Host's parent), and the foreground request is retried three times before the deep-link fallback is paid for.
- **v1.8.3** (2026-10-20) **Click-to-return works when the window is closed to the tray.** The Win32 raise searched only *visible* windows, so a DSH window hidden to the tray was never found and the click fell back to the slow deep-link route — which reads as "clicked the notification, nothing happened". The search now also remembers an invisible window whose title matches, and the raise shows it (`SW_SHOW`) before restoring and focusing it; the deep link stays as the last resort.
- **v1.8.2** (2026-10-20) **Actually fixes goal-mode alerting.** The 1.8.1 host route read `stateOf(session, "goal")` but took `current.phase`, while the projection value nests the goal: `current.goal.phase`. Every read therefore came back empty and every round chimed. The route now reads the nested field (with a fallback for a flattened shape), and a Host-side debug trace confirmed `current.goal.phase` is `active` on intermediate rounds and `complete` on the final one.
- **v1.8.1** (2026-10-20) **Fixes goal-mode alerting.** The 1.8.0 switch read the phase from the browser's own session projection, which only carries sessions that page has opened — for a goal in a session it never opened the read came back empty, which the code treated as "no goal", so every round chimed again. The browser half now asks the Host's new read-only `/notify-sounds/goal` route, whose projection store is authoritative, and re-checks it while the goal is still `active` (the single chime lands when the goal completes, pauses or blocks; a session that starts running again stays silent). A Host that does not answer the route keeps the old behaviour.
- **v1.8.0** (2026-10-20) **The plugin stops installing itself; the package manager owns upgrades.** Writing files in place never updated the profile's lockfile, so the next plugin install — or a market upgrade — silently restored the version pnpm had recorded: a 1.7.0 install could roll back to 1.6.9 with no warning. DSH 0.2.1 makes a durable self-install impossible from inside a plugin (the manager refuses a package that is already declared, and its remove-then-install step unloads the very code that would finish the install), so the self-installer is gone: the update row checks npm, reports the newer version, and points at the route that installs — Settings → Plugins (remove, then add again), the marketplace, or `dsh plugin add` on a web profile. It also compares the running version with the version the profile's lockfile would restore and **says so when they differ**, turning the silent rollback into a self-service fix. **New: goal-mode alerts wait for the goal to end** (issue #2) — a goal runs several automatic rounds and every round used to chime; the new switch **Only alert on the final goal round** stays silent on intermediate rounds and chimes once when the goal completes, pauses or blocks (ordinary sessions are unaffected; off by default). The release keeps the same seven filenames, so 1.6.9 / 1.7.0 installations still reach it through their own updater — after one reinstall through the package manager the upgrade is permanent.
- **v1.7.0** (2026-10-16) **The update mechanism turns a corner**: one-click update is no longer limited by a fixed list of seven filenames. It now accepts any regular file inside the package directory, governed by rules instead of an inventory — path traversal, absolute paths, symlinks, non-file entries, reserved names (its own backup/temp names and its record file, `.git`, `node_modules`, `.npmrc`), paths containing `:`, names colliding only by case, and a file that differs from the entry point `package.json` declares only by case are all still refused, with the file count and the decompressed size capped (enforced while inflating). **1.7.0 and later update cleanly into a release that adds or drops any number of files**: a file a later release drops is now actually deleted, based on the `.update-manifest.json` record this updater leaves behind — **only files an update installed are ever deleted**, anything you put in that directory yourself is left alone, and installations older than the first record are never guessed at. **1.6.9 and earlier will fail** (safely — nothing is written, the installed version keeps working) if a newer release adds a file, and the README says to reinstall once. Fixed: turning auto-check off ended the daily check chain for good, even after turning it back on; clicking a notification did nothing when the window title changed between the two Win32 reads; prerelease versions compared as strings (`rc.10` looked older than `rc.9`); **two tabs — or two windows — of the same GUI each rang the sound, raised their own system notification and ran their own repeat reminder** (one page is now elected to speak, via BroadcastChannel plus a shared claim, and the others stay silent until it disappears; per-window title marks are unaffected); and custom-sound normalization now visits **every sample** (taking every 8th frame aliased against content near fs/8 and systematically underestimated the peak). A failed update now gives **stage-appropriate advice** — retry for network failures, and the repository plus the uninstall/reinstall steps when the payload itself could not be applied, naming both versions — `package.json` is written **last** (a crash mid-swap leaves the old version number over the new code, so the next check still offers the update instead of declaring success), and the archive's manifest is verified to be this package at the version the registry named. The custom-sound row moved to sit **directly under the three trigger sounds** it is used by, and the smaller fixes on top: the cooldown table is a real LRU rather than FIFO (the session that fired most often was evicted first), one session-list snapshot per pass instead of per session, the macOS Desktop's window-title switch is now disabled rather than merely re-described, the full-width punctuation that leaked into the English update message is gone, and the README's release-archive instructions now give a command that actually works.
- **v1.6.9** (2026-10-12) Fixes a README filename compatibility issue in v1.6.8: reverted to `README.md` (English) + `README.zh.md` (Chinese) so the update whitelist in every prior version can recognise them. A new filename would be refused by old users' updates — the whitelist is one-directional because the update runs old code.
- **v1.6.8** (2026-10-12) Review fixes and optimizations: the auto-check first-frame timing gap is closed (`undefined` is no longer treated as permission to reach out); an orphaned JSDoc is removed; the teardown assertion now actually verifies listener removal; `normalizedGain` samples every 8th frame (2.6M → 330K iterations for a 30-second upload); the master gain disconnects after playback ends (no more audio-node leak); `swapNavIcon` is wrapped in try/catch and preserves the original node for restore on dispose (React re-renders can no longer crash it); the cooldown table evicts the oldest entry instead of clearing all; and `sessionRows` caches one snapshot per synchronous block.
- **v1.6.7** (2026-10-12) Three fixes from the review: a macOS browser tab is no longer mislabeled "not supported" for the title alert (`isDesktopShell` is the right criterion, not `isMac` alone); the first-frame timing gap in the auto-check guard is closed (`undefined` is no longer treated as permission); and three comments that no longer matched the code are corrected. Plus BUG-1 regression tests covering the suspended AudioContext path.
- **v1.6.6** (2026-10-12) Nine fixes from an audit: sounds are no longer lost under the browser autoplay policy, and no longer "banked" to fire together at some later click (first-gesture unlock, and nothing is scheduled while the context cannot play); the macOS window raise now activates by bundle id with the deep link as fallback and logs its failures; update rollback is complete — files the update added are removed again, no temp file survives, and the backup is cleaned up once the swap succeeds; checks and updates are single-flight, so two pages clicking at once neither collide nor double-request; turning automatic checks off now really keeps the plugin quiet; a mobile browser that refuses to build a notification is reported as unsupported instead of showing a switch that can never work; and the nav glyph is back on the artwork's own 17×17 coordinate system. Platform notes are now labelled where they apply: the title alert says macOS does not support it, and repeat reminders note that background browser tabs throttle timers.
- **v1.6.5** (2026-10-11) Quiet hours now mean forgotten, not queued: decisions and finishes that arrive during the quiet range get no reminder and no title mark, and nothing that was missed overnight is delivered when the window ends; reminders that come due inside it are dropped rather than deferred. The update outcome now appears at the top of the section (visible the moment the page reloads, no scrolling), and the update row's copy is simpler.
- **v1.6.4** (2026-10-11) No more scrolling to find the news: an update swaps the plugin's own client file and the page reloads at the top, so the row now scrolls itself back into view when the outcome appears.
- **v1.6.3** (2026-10-11) The update-success message no longer flashes and vanishes: the Host remembers the install and repeats it with every check, so "Updated, restart DSH to load it" survives the page reload the update itself triggers (it swaps the client half's own file) and stays until the restart. The cached check is invalidated after an install too, so the row can no longer claim a newer version than the one it just wrote.
- **v1.6.2** (2026-10-11) Fixed one-click update always failing when the mainland mirror answered the check: the mirror serves its tarballs from its CDN, and the downloader refused every redirect — so the download could never finish (found by the live drill). Redirects are now followed one hop at a time with every hop checked against the trusted hosts (the mirror's CDN is the one legitimate hop); the sha512 check is unchanged. A failure now names the stage it died at (check / download / verify / unpack / replace).
- **v1.6.1** (2026-10-11) The README is rebuilt as a release page: a new **Consistent with DSH's own UI** section on how the UI matches DSH's own settings, copy polished throughout, and the upgrade notes corrected — the plugin updates itself, so no uninstall is needed. This release doubles as the live drill for one-click update.
- **v1.6.0** (2026-10-11) New: **check for updates and install them in one click**. The settings section can fetch the newest npm version and install it: the download is checked against the registry's published sha512, only whitelisted files are unpacked (symlinks and path traversal are refused), the old files are kept aside, and any failure restores them. Downloaded code is never executed — the new code loads when DSH restarts. Automatic checks run at most once a day and can be turned off, with the mainland-China mirror as fallback.
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

## 💻 Development

```powershell
npm install             # once: the Host tests need the schemastery devDependency
node test/smoke.mjs     # client half: assembly, triggers, cooldown, quiet hours, repeat reminders, notification clicks, sub-agent filtering
node test/host.mjs      # host half: config schema, focus route, title matching, cross-half contracts
```

To publish to npm: bump the version, then `npm publish` (`npm login` and 2FA the first time). **npm versions are immutable** — bump for every change.

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

## 📄 License

[MIT](LICENSE) © BillCx330
