/**
 * Client half of `dsh-plugin-notify-sounds`.
 *
 * A Module Loader package: this file is the package's `./client` export,
 * served to the page as a `window.__ModuleLoader__.load({ id, factory })`
 * registration. The factory receives the loader's `require`, so React and the
 * shared UI primitives are resolved from the module table instead of being
 * bundled a second time.
 *
 * What it contributes:
 *
 *   - a notification-sound engine over the Web Audio API: nine synthesized
 *     presets (no audio assets, nothing to download), an uploaded custom sound,
 *     and `none`;
 *   - two triggers read from `uiSession.sessionStatus`, the same facts the
 *     shipped sidebar status dots derive from — a pending approval or
 *     question appearing on a Session ("needs your decision"), and a
 *     running → idle transition ("task finished");
 *   - one `settings.section` page — 提示音 / Sounds — with the master
 *     switch, a volume slider, per-trigger preset pickers with preview, and
 *     a page-hidden-only option. Every row edits this package's volatile
 *     Host Config through `configForms`, exactly like DSH's own preference
 *     rows, so values persist in the profile patch and apply live.
 *
 * @module dsh-plugin-notify-sounds/client
 */

window.__ModuleLoader__.load({
	id: "dsh-plugin-notify-sounds",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		const { Button, IconChevronDownOutlineMedium, IconPlayOutlineRegular, Menu, SegmentedControl, Switch } = primitives;
		const { createElement: h, useCallback, useEffect, useRef, useState } = React;

		//#region styles
		/** Stylesheet identity, keyed so a reloaded bundle reuses its tag. */
		const STYLE_TAG_ID = "dsh-plugin-notify-sounds/NotifySoundsSection.module.css";
		const CSS = [
			".dsh-notify-sounds-section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}",
			".dsh-notify-sounds-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}",
			".dsh-notify-sounds-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}",
			".dsh-notify-sounds-rows{flex-direction:column;margin:12px 0 0;display:flex}",
			".dsh-notify-sounds-row{border-bottom:.5px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:16px 24px;padding:16px 0;display:flex;flex-wrap:wrap}",
			".dsh-notify-sounds-row>div:first-child{flex:1;min-width:200px}",
			".dsh-notify-sounds-rows>:last-child{border-bottom:none}",
			".dsh-notify-sounds-rowTitle{font-size:14px;line-height:20px}",
			".dsh-notify-sounds-rowDescription{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px}",
			".dsh-notify-sounds-error{color:var(--dsw-alias-state-error-primary);margin-top:4px;font-size:12px;line-height:18px}",
			".dsh-notify-sounds-volume{align-items:center;gap:10px;flex:none;display:flex}",
			".dsh-notify-sounds-slider{-webkit-appearance:none;appearance:none;box-sizing:content-box;height:4px;border-radius:999px;width:168px;outline:none;cursor:pointer;border:none;padding:0;margin:0;--dsh-notify-sounds-fill:60%;background:linear-gradient(to right,var(--dsw-alias-brand-primary) 0%,var(--dsw-alias-brand-primary) var(--dsh-notify-sounds-fill),var(--dsw-alias-border-l1) var(--dsh-notify-sounds-fill),var(--dsw-alias-border-l1) 100%)}",
			".dsh-notify-sounds-slider:disabled{cursor:default;opacity:.5}",
			".dsh-notify-sounds-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-brand-primary);border:none;box-shadow:none;cursor:pointer}",
			".dsh-notify-sounds-slider:disabled::-webkit-slider-thumb{cursor:default}",
			".dsh-notify-sounds-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-brand-primary);border:none;box-shadow:none;cursor:pointer}",
			".dsh-notify-sounds-slider:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:4px}",
			".dsh-notify-sounds-volumeValue{color:var(--dsw-alias-label-secondary);min-width:38px;text-align:right;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}",
			".dsh-notify-sounds-stackControl{align-items:center;justify-content:flex-end;gap:12px;flex-wrap:wrap;display:flex}",
			".dsh-notify-sounds-fileInput{display:none}",
			".dsh-notify-sounds-soundHead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
			".dsh-notify-sounds-soundIndex{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;min-width:48px}",
			".dsh-notify-sounds-soundName{width:200px;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;outline:none}",
			".dsh-notify-sounds-soundName:focus-visible{border-color:var(--dsw-alias-brand-primary)}",
			".dsh-notify-sounds-soundName:disabled{cursor:default;opacity:.5}",

			".dsh-notify-sounds-customName{color:var(--dsw-alias-label-secondary);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px}",
			".dsh-notify-sounds-time{color:var(--dsw-alias-label-primary);background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;font-size:12px;line-height:18px;height:28px;padding:0 8px;font-variant-numeric:tabular-nums;outline:none;cursor:pointer}",
			".dsh-notify-sounds-time:focus-visible{border-color:var(--dsw-alias-brand-primary)}",
			".dsh-notify-sounds-time:disabled{cursor:default;opacity:.5}",
			".dsh-notify-sounds-quietRange{align-items:center;gap:8px;display:flex}",
			".dsh-notify-sounds-quietDash{color:var(--dsw-alias-label-tertiary)}",
			".dsh-notify-sounds-hint{color:var(--dsw-alias-label-tertiary);margin-top:4px;font-size:12px;line-height:18px}",
		].join("");

		/**
		 * Whether this page is running inside the Desktop shell rather than a
		 * real browser.
		 *
		 * Derived from what the page can see: the shell serves the same bundle
		 * over its own `dsh-app:` protocol and ships an Electron user agent,
		 * while a browser serves it over http(s) with no Electron token. Either
		 * signal alone would do; using both keeps one of them changing its mind
		 * from flipping the answer.
		 */
		const isDesktopShell = () => {
			if (typeof location !== "undefined" && location.protocol === "dsh-app:") return true;
			return typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent ?? "");
		};

		/**
		 * Whether the page is on macOS.
		 *
		 * Note this is a pure OS check: it matches macOS browsers too. The
		 * places that need "macOS DESKTOP SHELL" combine this with
		 * `isDesktopShell()`, because the window chrome that breaks the title
		 * alert (`titleBarStyle: "hiddenInset"`) is the shell's own choice —
		 * a macOS browser tab shows the document title like any other.
		 */
		const isMac = () => typeof navigator !== "undefined" && /Mac/i.test(`${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`);

		/**
		 * Whether the window-title mark has anywhere to appear.
		 *
		 * Only the macOS Desktop shell fails this, for the reason above. The
		 * row's switch is DISABLED rather than merely re-described: an enabled
		 * switch that the user can turn on and that then never does anything is
		 * worse than one that says it is not available yet — the old copy read
		 * like a working feature with a caveat, so people turned it on and
		 * waited.
		 */
		const titleFlashUnavailable = () => isMac() && isDesktopShell();

		/** Stylesheet class names, one projection the components read. */
		const css = {
			section: "dsh-notify-sounds-section",
			title: "dsh-notify-sounds-title",
			intro: "dsh-notify-sounds-intro",
			rows: "dsh-notify-sounds-rows",
			row: "dsh-notify-sounds-row",
			rowTitle: "dsh-notify-sounds-rowTitle",
			rowDescription: "dsh-notify-sounds-rowDescription",
			error: "dsh-notify-sounds-error",
			hint: "dsh-notify-sounds-hint",
			volume: "dsh-notify-sounds-volume",
			slider: "dsh-notify-sounds-slider",
			volumeValue: "dsh-notify-sounds-volumeValue",
			stackControl: "dsh-notify-sounds-stackControl",
			fileInput: "dsh-notify-sounds-fileInput",
			customName: "dsh-notify-sounds-customName",
			soundHead: "dsh-notify-sounds-soundHead",
			soundIndex: "dsh-notify-sounds-soundIndex",
			soundName: "dsh-notify-sounds-soundName",
			timeInput: "dsh-notify-sounds-time",
			quietRange: "dsh-notify-sounds-quietRange",
			quietDash: "dsh-notify-sounds-quietDash",
		};

		/**
		 * Install this package's stylesheet once. The tag is keyed so a reloaded
		 * bundle in the same page reuses it instead of stacking duplicates.
		 */
		function insertStyles() {
			if (typeof document === "undefined") return;
			const existing = document.querySelector("style[data-plugin-css=" + JSON.stringify(STYLE_TAG_ID) + "]") ?? null;
			if (existing !== null) {
				// Reuse the tag, but refresh its text: a hot-reloaded bundle can
				// carry new rules under the same identity, and an early return
				// would leave the discarded version's stylesheet in charge until
				// the next full page load.
				if (existing.textContent !== CSS) existing.textContent = CSS;
				return;
			}
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-plugin-notify-sounds";
			tag.dataset.pluginCss = STYLE_TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region locales
		/** Locale namespace owned by this package's copy. */
		const NS = "notify-sounds";

		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"nav": "提示音",
			"title": "提示音",
			"intro": "当智能体需要你决策（审批、提问）或任务完成时提醒你：提示音、可选的系统通知与重复提醒。",
			"enabled.title": "启用提醒",
			"enabled.description": "关闭后停止一切提醒（提示音、系统通知与重复提醒）",
			"volume.title": "音量",
			"volume.description": "调整提示音的播放音量",
			"decision.title": "需要审批时",
			"decision.description": "智能体发起审批或计划确认时播放",
			"question.title": "收到提问时",
			"question.description": "智能体向你提问时播放",
			"completion.title": "任务完成时",
			"completion.description": "会话由运行转为空闲时播放",
			"goalFinalOnly.title": "目标模式下只在最终轮提醒",
			"goalFinalOnly.description": "目标模式会自动进行多轮；开启后中间轮结束时保持安静，只在目标结束（或暂停、受阻）时响一次。普通对话不受影响",
			"subagent.title": "子智能体的提醒",
			"subagent.description": "子智能体（后台任务）完成或需要决策时也提醒；关闭后只提醒主对话",
			"onlyWhenHidden.title": "仅在页面不可见时提示",
			"onlyWhenHidden.description": "切到其他窗口或标签页时才播放，专注当前页面时不打扰",
			"custom.title": "自定义音效",
			"custom.description": "添加自己的提示音，然后在上面的提醒里选用它。支持 mp3 / wav / ogg / m4a，最多 3 个、每个 15 秒以内。",
			"custom.add": "添加音频",
			"custom.limit": "已经满了，移除一个后才能继续添加",
			"custom.index": "音频 {index}",
			"custom.rename": "名称",
			"custom.namePlaceholder": "给这个音频起个名字",
			"custom.unused": "还没有提醒使用它",
			"custom.fallbackName": "自定义音频 {index}",
			"custom.remove": "移除",
			"custom.addFailed": "没有保存成功，请重试",
			"custom.tooLarge": "文件超过 3MB，请压缩后重试",
			"custom.tooLong": "这个音频有 {seconds} 秒，请剪到 15 秒以内",
			"custom.silent": "这个音频没有声音，或者短到听不见，请换一个",
			"custom.undecodable": "打不开这个音频：文件可能已损坏，或当前环境不支持这种格式（推荐 mp3 / wav / ogg / m4a）",
			"custom.unreadable": "读不到这个文件：它可能已被移动，或没有读取权限，请重新选择",
			"custom.missing": "音频文件找不到了（可能被删除或被杀毒软件隔离），会改用默认音。请重新添加",
			"systemNotify.title": "系统通知",
			"systemNotify.description": "页面处于后台时弹出系统通知，点击可回到窗口",
			"systemNotify.granted": "已授权系统通知",
			"systemNotify.denied": "通知权限被拒绝，请在浏览器或系统设置中允许后重试",
			"systemNotify.unsupported": "当前环境不支持系统通知",
			"titleFlash.title": "窗口标题提醒",
			"titleFlash.description": "页面处于后台时，在窗口标题前加文字标记（待处理 / 已完成），便于在任务栏察觉；回到页面后自动清除",
			"titleFlash.macUnsupported": "macOS 暂不支持，开关已禁用：标题栏隐藏、Dock 也没有窗口标题，标记无处显示（只在「窗口」菜单 / Mission Control 里可见）",
			"titleFlash.pending": "待处理",
			"titleFlash.done": "已完成",
			"renotify.title": "未处理决策重复提醒",
			"renotify.description": "有决策一直未处理时，每隔设定时间重新提醒；只要你已经看过它一眼（它出现时你正在窗口，或之后回到过窗口），就不再重复提醒，即使再切走也一样",
			"renotify.browserHint": "浏览器的后台标签页会节流计时器，重复间隔可能被拉长（1 分钟档尤其明显）",
			"renotify.interval": "重复间隔",
			"renotify.minutes": "{n} 分钟",
			"quiet.title": "静音时段",
			"quiet.description": "每天此时间段内不发出任何提醒（可跨午夜，如 22:00 至次日 08:00；起止时间相同视为未设置静音）",
			"quiet.start": "开始时间",
			"quiet.end": "结束时间",
			"preview": "试听",
			"saveFailed": "保存失败，请重试",
			"sound.none": "无声",
			"sound.bell": "双音铃",
			"sound.chime": "风铃",
			"sound.ding": "单音叮",
			"sound.drop": "水滴",
			"sound.pulse": "脉冲",
			"sound.arc": "上行琶音",
			"sound.coin": "金币",
			"sound.success": "达成",
			"sound.knock": "敲门",
			"sound.custom": "自定义",
			"notify.decision.title": "需要你的决策",
			"notify.decision.body": "智能体正在等待你的决定",
			"notify.completion.title": "任务完成",
			"notify.completion.body": "智能体已完成当前任务",
			"update.title": "更新",
			"update.description": "从 npm 检查本插件的新版本；安装请用插件管理器（本插件不再自己安装更新）",
			"update.auto": "自动检查更新",
			"update.auto.description": "每天最多静默检查一次，发现新版只在下方标记，不弹通知",
			"update.check": "检查更新",
			"update.current": "当前版本",
			"update.currentUnknown": "无法读取当前版本",
			"update.idle": "尚未检查",
			"update.checking": "检查中…",
			"update.uptodate": "已是最新",
			"update.available": "有新版",
			"update.failed": "检查失败",
			"update.failedDetail": "两个源都没有给出可用的答复：可能是网络、代理或镜像源临时不可用，稍后重试即可",
			"update.desktopGuidance": "升级走包管理器：左侧栏「插件」→ 在「已安装插件」里卸载本插件 → 点「添加插件」→ 粘贴 dsh-plugin-notify-sounds@{version} → 安装 → 重启 DSH",
			"update.versionPinned": "务必带版本号：发布不满 24 小时的版本会被 pnpm 的 minimumReleaseAge 策略挡掉，只写包名会装回上一个版本",
			"update.webGuidance": "在终端执行 dsh plugin --profile {profile} add dsh-plugin-notify-sounds@{version}",
			"update.webGuidancePlain": "在终端执行 dsh plugin add dsh-plugin-notify-sounds@{version}",
			"update.unregistered": "这个安装没有被包管理器登记（记录仍为 {recorded}），下次安装其他插件时可能被退回。请按下面的步骤重新安装一次。",
		};

		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"nav": "Sounds",
			"title": "Notification sounds",
			"intro": "Get your attention when the agent needs a decision (approvals, questions) or finishes a task: sounds, optional system notifications, and repeat reminders.",
			"enabled.title": "Enable alerts",
			"enabled.description": "Turn off to stop every alert: sounds, system notifications, and repeat reminders",
			"volume.title": "Volume",
			"volume.description": "Playback loudness of the notification sounds",
			"decision.title": "Approval needed",
			"decision.description": "Played when the agent raises an approval or plan review",
			"question.title": "Question asked",
			"question.description": "Played when the agent asks you a question",
			"completion.title": "Task finished",
			"completion.description": "Played when a session goes from running to idle",
			"subagent.title": "Sub-agent alerts",
			"subagent.description": "Also alert when a sub-agent finishes or needs a decision; off means only your own conversations",
			"onlyWhenHidden.title": "Only when the page is hidden",
			"onlyWhenHidden.description": "Play only while another window or tab is focused, so an active page stays quiet",
			"custom.title": "Custom sound",
			"custom.description": "Add your own alert sounds, then pick one in the alerts above. mp3 / wav / ogg / m4a, up to 3, 15 seconds each.",
			"custom.add": "Add audio",
			"custom.limit": "Three already added — remove one to add another",
			"custom.index": "Sound {index}",
			"custom.rename": "Name",
			"custom.namePlaceholder": "Name this sound",
			"custom.unused": "No alert uses it yet",
			"custom.fallbackName": "Custom sound {index}",
			"custom.remove": "Remove",
			"custom.addFailed": "Could not save it — try again",
			"custom.tooLarge": "File exceeds 3MB; please compress it and retry",
			"custom.tooLong": "This sound is {seconds}s long; trim it to 15 seconds or less",
			"custom.silent": "This sound is silent, or too short to hear — pick another",
			"custom.undecodable": "Could not open this audio: it may be damaged, or this environment cannot play that format (mp3 / wav / ogg / m4a work)",
			"custom.unreadable": "Could not read this file: it may have been moved, or permission was revoked — choose it again",
			"custom.missing": "The audio file is missing (deleted, or quarantined by antivirus), so the default sound plays instead. Add it again",
			"systemNotify.title": "System notifications",
			"systemNotify.description": "Show an OS notification while the page is hidden; click it to focus the window",
			"systemNotify.granted": "Notification permission granted",
			"systemNotify.denied": "Denied — allow notifications in the browser or system settings and retry",
			"systemNotify.unsupported": "System notifications are unavailable in this environment",
			"titleFlash.title": "Window title alert",
			"titleFlash.description": "While the page is hidden, mark the window title as waiting for you or finished, so the taskbar shows it; cleared when you return",
			"titleFlash.macUnsupported": "Not supported on macOS, so this switch is disabled: the title bar is hidden and the Dock shows no window title, so the mark has nowhere to appear (only the Window menu and Mission Control would show it)",
			"titleFlash.pending": "Waiting for you",
			"titleFlash.done": "Finished",
			"renotify.title": "Repeat unanswered decisions",
			"renotify.description": "Re-ping decisions that stay unanswered at a fixed interval; once you have seen one — it appeared while you were at the window, or you came back to it — it never repeats, even if you leave again",
			"renotify.browserHint": "Background browser tabs throttle timers, so the interval can stretch (most visible at the 1-minute setting)",
			"renotify.interval": "Interval",
			"renotify.minutes": "{n} min",
			"quiet.title": "Quiet hours",
			"goalFinalOnly.title": "Only alert on the final goal round",
			"goalFinalOnly.description": "A goal runs several automatic rounds; with this on, intermediate rounds stay silent and one chime marks the end of the goal (or a pause or block). Ordinary sessions are unaffected",
			"quiet.description": "No alerts during this daily time range (may wrap past midnight, e.g. 22:00 to 08:00; identical start and end means no quiet range)",
			"quiet.start": "Start time",
			"quiet.end": "End time",
			"preview": "Preview",
			"saveFailed": "Could not save. Please try again.",
			"sound.none": "None",
			"sound.bell": "Bell",
			"sound.chime": "Chime",
			"sound.ding": "Ding",
			"sound.drop": "Drop",
			"sound.pulse": "Pulse",
			"sound.arc": "Arc",
			"sound.coin": "Coin",
			"sound.success": "Success",
			"sound.knock": "Knock",
			"sound.custom": "Custom",
			"notify.decision.title": "Your decision is needed",
			"notify.decision.body": "The agent is waiting for your decision",
			"notify.completion.title": "Task finished",
			"notify.completion.body": "The agent has finished the current task",
			"update.title": "Updates",
			"update.description": "Check npm for a newer version; install it through the plugin manager (this plugin no longer installs updates itself)",
			"update.auto": "Check for updates automatically",
			"update.auto.description": "At most one quiet check a day; a newer version is only marked below, never announced",
			"update.check": "Check now",
			"update.current": "This version",
			"update.currentUnknown": "This version could not be read",
			"update.idle": "Not checked yet",
			"update.checking": "Checking…",
			"update.uptodate": "Up to date",
			"update.available": "New version available",
			"update.failed": "Check failed",
			"update.failedDetail": "Neither source returned a usable answer — the network, a proxy or a mirror may be temporarily unavailable. Try again later.",
			"update.desktopGuidance": "Update through the package manager: sidebar Plugins → uninstall this plugin under Installed plugins → Add plugin → paste dsh-plugin-notify-sounds@{version} → Install → restart DSH",
			"update.versionPinned": "Keep the version: pnpm's minimumReleaseAge policy blocks a release for its first 24 hours, so the bare name resolves to the previous version",
			"update.webGuidance": "Run dsh plugin --profile {profile} add dsh-plugin-notify-sounds@{version} in a terminal",
			"update.webGuidancePlain": "Run dsh plugin add dsh-plugin-notify-sounds@{version} in a terminal",
			"update.unregistered": "This install is not registered with the package manager (it still records {recorded}), so a later plugin install may roll it back. Reinstall it once with the steps below.",
		};
		//#endregion

		//#region sounds
		/** Sound ids in display order; must match the Host half's Config union. */
		const SOUND_IDS = ["bell", "chime", "ding", "drop", "pulse", "arc", "coin", "success", "knock", "custom1", "custom2", "custom3", "custom", "none"];

		/** The three slots the user's own sounds live in, in display order. */
		const CUSTOM_SLOTS = ["custom1", "custom2", "custom3"];

		/** How many of the user's own sounds the library holds. */
		const CUSTOM_SLOT_LIMIT = CUSTOM_SLOTS.length;

		/**
		 * Synthesized presets. Each note schedules one oscillator: `freq` in Hz,
		 * `at` the start offset in seconds, `dur` the decay length, `gain` the
		 * relative level, `type` the waveform, and an optional `glideTo` for a
		 * downward frequency ramp. Octave partials give the bell tones their
		 * body without any audio assets.
		 */
		const SOUND_PRESETS = {
			bell: { notes: [
				{ freq: 987.77, at: 0, dur: 0.55, gain: 1 },
				{ freq: 1975.53, at: 0, dur: 0.28, gain: 0.24 },
				{ freq: 1318.51, at: 0.19, dur: 0.65, gain: 0.9 },
				{ freq: 2637.02, at: 0.19, dur: 0.3, gain: 0.18 },
			] },
			chime: { notes: [
				{ freq: 659.25, at: 0, dur: 0.42, gain: 0.85 },
				{ freq: 830.61, at: 0.13, dur: 0.46, gain: 0.9 },
				{ freq: 987.77, at: 0.26, dur: 0.62, gain: 1 },
			] },
			ding: { notes: [
				{ freq: 830.61, at: 0, dur: 0.62, gain: 1 },
				{ freq: 1661.22, at: 0, dur: 0.34, gain: 0.26 },
			] },
			drop: { notes: [
				{ freq: 1046.5, at: 0, dur: 0.34, gain: 0.95, glideTo: 755 },
				{ freq: 783.99, at: 0.17, dur: 0.5, gain: 0.8 },
			] },
			pulse: { notes: [
				{ freq: 523.25, at: 0, dur: 0.16, gain: 0.8, type: "triangle" },
				{ freq: 523.25, at: 0.22, dur: 0.22, gain: 0.8, type: "triangle" },
			] },
			arc: { notes: [
				{ freq: 523.25, at: 0, dur: 0.28, gain: 0.65 },
				{ freq: 659.25, at: 0.1, dur: 0.3, gain: 0.78 },
				{ freq: 783.99, at: 0.2, dur: 0.34, gain: 0.9 },
				{ freq: 1046.5, at: 0.3, dur: 0.55, gain: 1 },
			] },
			coin: { notes: [
				{ freq: 987.77, at: 0, dur: 0.09, gain: 0.42, type: "square" },
				{ freq: 1318.51, at: 0.085, dur: 0.4, gain: 0.42, type: "square" },
			] },
			success: { notes: [
				{ freq: 587.33, at: 0, dur: 0.1, gain: 0.7, type: "triangle" },
				{ freq: 739.99, at: 0.08, dur: 0.1, gain: 0.75, type: "triangle" },
				{ freq: 880, at: 0.16, dur: 0.42, gain: 0.85, type: "triangle" },
			] },
			knock: { notes: [
				{ freq: 172, at: 0, dur: 0.11, gain: 0.95, glideTo: 148 },
				{ freq: 172, at: 0.21, dur: 0.13, gain: 0.9, glideTo: 148 },
			] },
		};

		/** One lazily created AudioContext for the page's lifetime. */
		let audioContext;

		/**
		 * Resolve the page's AudioContext, creating it on first use.
		 *
		 * @returns the context, or `undefined` when the browser (or a test
		 *   environment) offers none.
		 */
		function audioEngine() {
			if (typeof window === "undefined") return undefined;
			const Ctor = window.AudioContext ?? window.webkitAudioContext;
			if (typeof Ctor !== "function") return undefined;
			if (audioContext === undefined) audioContext = new Ctor();
			return audioContext;
		}

		/** Upload cap and length cap for a custom sound. */
		const SOUND_MAX_BYTES = 3 * 1024 * 1024;
		const SOUND_MAX_SECONDS = 15;
		/** Where the Host keeps uploaded sounds. */
		const SOUND_ROUTE = "/notify-sounds/sound";

		/** Decoded stored sounds, keyed by their content-addressed file name. */
		const soundCache = new Map();
		/** Whether the fallback warning has been logged; one line, not one per alert. */
		let customFailureLogged = false;
		/** Decoded legacy inline payload, kept apart from `soundCache` (it has no file name). */
		let legacySoundCache;

		/** Raise and lowercase a slot name for its config field, e.g. `decision` → `Decision`. */
		const slotSuffix = (slot) => slot.charAt(0).toUpperCase() + slot.slice(1);

		/** Sources currently sounding, so a new preview can silence the previous one. */
		const liveSources = new Set();
		/** Bumped when a preview starts, so a decode still in flight knows it lost. */
		let previewToken = 0;

		/** Remember one scheduled source, run its cleanup, and forget it once it ends. */
		function trackSource(source, cleanup) {
			liveSources.add(source);
			try {
				source.onended = () => {
					liveSources.delete(source);
					cleanup?.();
				};
			} catch {
				// A source that refuses the handler still plays; it just stays
				// tracked until the next stop clears the set.
			}
		}

		/**
		 * Silence the preview that is playing and invalidate any decode that has
		 * not reached the speakers yet.
		 *
		 * Without the token a second click could still overlap: the first
		 * click's file is decoded asynchronously, so stopping the sources that
		 * exist at click time misses the one that is about to be created.
		 */
		function stopPreview() {
			previewToken += 1;
			for (const source of liveSources) {
				try {
					source.stop();
				} catch {
					// Already ended — stopping twice throws, and there is nothing
					// left to silence.
				}
			}
			liveSources.clear();
		}

		/**
		 * Peak of one preset's summed voices, measured once at load.
		 *
		 * The presets were written with `note.gain * 0.25` per voice and nothing
		 * held them to each other: `coin` peaked at 0.105 while `ding` reached
		 * 0.315, a 9.5 dB spread, and every one of them sat far below a decoded
		 * clip (whose peak is normalized to 1). At 100% a preset played at
		 * -16 dBFS while the user's own file played at -4 — the same slider
		 * value was two different loudnesses.
		 *
		 * This walks each preset's envelope at 2 ms resolution and returns the
		 * loudest sum, so every voice can be scaled to one target instead.
		 *
		 * @param preset - one entry of SOUND_PRESETS.
		 * @returns the peak the summed envelopes reach, before any level.
		 */
		function presetPeak(preset) {
			const ATTACK = 0.012;
			const value = (note, t) => {
				if (t < note.at) return 0;
				const peak = note.gain * 0.25;
				const attackEnd = note.at + ATTACK;
				if (t <= attackEnd) {
					// exponentialRampToValueAtTime from 0.0001, same as playback
					return 0.0001 * Math.pow(peak / 0.0001, (t - note.at) / ATTACK);
				}
				const end = note.at + note.dur;
				if (t >= end) return 0;
				return peak * Math.pow(0.0001 / peak, (t - attackEnd) / (end - attackEnd));
			};
			let peak = 0;
			for (let t = 0; t < 2; t += 0.002) {
				let sum = 0;
				for (const note of preset.notes) sum += value(note, t);
				if (sum > peak) peak = sum;
			}
			return peak;
		}

		/**
		 * RMS-to-peak ratio of each waveform, at the frequencies these presets use.
		 *
		 * A sine peaks at √2 times its RMS; a square's RMS is its peak. So at
		 * the same peak a square carries 3 dB more energy — which is exactly why
		 * `coin` (two square notes) sounded louder than `ding` (two sines) once
		 * both were normalized to one peak. Triangle sits below the sine, but it
		 * is not scaled up: that would push its peak through the ceiling.
		 */
		const WAVEFORM_RMS = { sine: Math.SQRT1_2, triangle: Math.sqrt(1 / 3), square: 1 };

		/**
		 * One level per preset, chosen so every preset lands at the same
		 * loudness rather than the same peak.
		 *
		 * The headline number is still a peak ceiling (0.95), because that is
		 * what keeps the output from clipping; the waveform's own RMS ratio is
		 * then folded in as a crest-factor correction. Anything quieter per peak
		 * (triangle) is capped at the peak target instead of being pushed past
		 * it, so the correction only ever pulls a preset down.
		 */
		const PRESET_LEVEL = Object.fromEntries(
			Object.entries(SOUND_PRESETS).map(([id, preset]) => {
				const crest = Math.max(
					...preset.notes.map((note) => (WAVEFORM_RMS[note.type ?? "sine"] ?? Math.SQRT1_2) / Math.SQRT1_2),
				);
				return [id, 0.95 / (presetPeak(preset) * Math.max(1, crest))];
			}),
		);

		/**
		 * Build the output end of one playback.
		 *
		 * @param engine - the page's AudioContext.
		 * @param loudness - 0–1, already clamped by the caller.
		 * @param level - the preset's own leveling factor (1 for clips).
		 * @returns the node the sources connect to, and every node to release.
		 */
		function outputChain(engine, loudness, level) {
			const master = engine.createGain();
			master.gain.value = loudness * 0.6 * level;
			master.connect(engine.destination);
			return { master, nodes: [master] };
		}

		/** Play one decoded buffer at a loudness in percent, through a peak-normalized gain. */
		function playBuffer(engine, buffer, normGain, volumePercent) {
			const percent = Number.isFinite(volumePercent) ? volumePercent : DEFAULT_VOLUME;
			const loudness = Math.max(0, Math.min(100, percent)) / 100;
			if (loudness === 0) return;
			const source = engine.createBufferSource();
			const gain = engine.createGain();
			source.buffer = buffer;
			gain.gain.value = normGain;
			const { master, nodes } = outputChain(engine, loudness, 1);
			source.connect(gain);
			gain.connect(master);
			// A clip's nodes outlive its buffer unless something disconnects
			// them; the Web Audio graph keeps every connected node alive.
			trackSource(source, () => {
				for (const node of [gain, ...nodes]) {
					try {
						node.disconnect();
					} catch {}
				}
			});
			source.start(engine.currentTime + 0.02);
		}

		/**
		 * Play one trigger's own sound: the stored file when there is one, else
		 * the legacy inline payload, else the trigger's default preset.
		 *
		 * Every failure — a missing file, a Host that will not answer, a payload
		 * that will not decode — falls back to the preset. Silence is the one
		 * outcome an alert must never produce, and before 1.9.0 a damaged
		 * payload silenced all three triggers with nothing in the UI to say so.
		 *
		 * @param engine - the page's AudioContext.
		 * @param file - stored file name from the config, or empty.
		 * @param legacyBase64 - pre-1.9.0 inline payload, or empty.
		 * @param volumePercent - loudness clamped to 0–100.
		 * @param fallbackId - preset to play when the custom sound cannot be had.
		 */
		async function playCustomSound(engine, file, legacyBase64, volumePercent, fallbackId, token) {
			if (typeof engine.decodeAudioData !== "function") {
				playSound(fallbackId, volumePercent);
				return;
			}
			// A decode takes several awaits; if a newer preview started in the
			// meantime this one has already lost and must not join it.
			const stale = () => token !== undefined && token !== previewToken;
			try {
				if (typeof file === "string" && file !== "") {
					const cached = soundCache.get(file);
					if (cached !== undefined) {
						playBuffer(engine, cached.buffer, cached.normGain, volumePercent);
						return;
					}
					const response = await fetch(`${SOUND_ROUTE}?file=${encodeURIComponent(file)}`, { method: "GET" });
					if (!response.ok) throw new Error(`sound ${response.status}`);
					const buffer = await engine.decodeAudioData(await response.arrayBuffer());
					const normGain = normalizedGain(buffer);
					soundCache.set(file, { buffer, normGain });
					if (stale()) return;
					playBuffer(engine, buffer, normGain, volumePercent);
					return;
				}
				if (typeof legacyBase64 === "string" && legacyBase64 !== "") {
					if (legacySoundCache !== undefined && legacySoundCache.source === legacyBase64) {
						playBuffer(engine, legacySoundCache.buffer, legacySoundCache.normGain, volumePercent);
						return;
					}
					// `atob` throws synchronously on a malformed payload, and this
					// runs inside the session-status diff: an escaping throw would
					// abort the whole read, taking the title flash and the reminder
					// tracker with it.
					const bytes = base64ToBytes(legacyBase64);
					if (bytes === undefined) throw new Error("legacy payload");
					const buffer = await engine.decodeAudioData(bytes);
					const normGain = normalizedGain(buffer);
					legacySoundCache = { source: legacyBase64, buffer, normGain };
					if (stale()) return;
					playBuffer(engine, buffer, normGain, volumePercent);
					return;
				}
				playSound(fallbackId, volumePercent);
			} catch {
				// One line, not one per alert: a broken custom sound would
				// otherwise fill the console at every reminder.
				if (!customFailureLogged) {
					customFailureLogged = true;
					console.warn("notify-sounds: custom sound unavailable, playing the default preset instead");
				}
				playSound(fallbackId, volumePercent);
			}
		}

		/**
		 * Decode one ArrayBuffer for upload validation.
		 *
		 * @param bytes - the chosen file's bytes.
		 * @returns the decoded buffer, or undefined when it cannot be decoded.
		 */
		async function validateCustomSoundBytes(bytes) {
			const engine = audioEngine();
			if (engine === undefined || typeof engine.decodeAudioData !== "function") return undefined;
			try {
				return await engine.decodeAudioData(bytes.slice(0));
			} catch {
				return undefined;
			}
		}

		/**
		 * The loudest sample in one decoded buffer.
		 *
		 * Every sample is visited, deliberately. An earlier version stepped
		 * through the buffer taking every 8th frame and claimed the peak would
		 * be caught anyway because "neighbouring samples carry the same
		 * magnitude" — that only holds for a heavily oversampled signal. At
		 * 44.1 kHz a 10 kHz component has about 4.4 samples per period, so a
		 * stride of 8 aliases against it and can systematically miss the real
		 * peak; a tone near fs/8 is the extreme case. Under-reporting the peak
		 * means the upload check below accepts a silent file, and the gain
		 * computed from it would boost a real one too hard.
		 *
		 * The cost is not on a playback path: this runs once per uploaded file,
		 * right after `decodeAudioData` (which costs far more).
		 *
		 * @param buffer - the decoded audio.
		 * @returns the peak magnitude, or 0 when it cannot be read.
		 */
		function bufferPeak(buffer) {
			try {
				let peak = 0;
				for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
					const data = buffer.getChannelData(channel);
					for (let i = 0; i < data.length; i++) {
						const magnitude = Math.abs(data[i]);
						if (magnitude > peak) peak = magnitude;
					}
				}
				return peak;
			} catch {
				return 0;
			}
		}

		/**
		 * Peak-normalization gain for one decoded buffer: scales the loudest
		 * sample toward full scale, boosting at most 4× so near-silent files
		 * do not get blown up.
		 *
		 * @param buffer - the decoded audio.
		 * @returns the gain to multiply the mix level by.
		 */
		function normalizedGain(buffer) {
			const peak = bufferPeak(buffer);
			if (peak <= 0.0001) return 1;
			return Math.min(1 / peak, 4);
		}

		/** Decode base64 back to an ArrayBuffer, or undefined when it is malformed. */
		function base64ToBytes(base64) {
			try {
				const binary = atob(base64);
				const bytes = new Uint8Array(binary.length);
				for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
				return bytes.buffer;
			} catch {
				// `atob` throws on a payload that is not base64 — a hand-edited
				// config can carry one. Callers treat undefined as "no sound".
				return undefined;
			}
		}


		/**
		 * Run `play` on an AudioContext that is actually running.
		 *
		 * A suspended context has a FROZEN `currentTime`: scheduling sources on
		 * it parks them on the timeline and they all fire together whenever the
		 * context later resumes — the opposite of an alert. So nothing is ever
		 * scheduled while suspended. Where resuming needs a user gesture (every
		 * browser; the Electron shell needs none) this attempt is simply
		 * dropped, and the unlock effect has the context running for the next
		 * one rather than banking a stale sound for later.
		 *
		 * @param engine - the page's AudioContext.
		 * @param play - schedules the sound.
		 */
		function whenRunning(engine, play) {
			if (engine.state === "running") {
				play();
				return;
			}
			Promise.resolve(engine.resume())
				.then(() => {
					if (engine.state === "running") play();
				})
				.catch(() => {});
		}

		/**
		 * Play one preset (or the uploaded sound) at a loudness in percent.
		 *
		 * Nothing is scheduled while the AudioContext cannot play — see
		 * `whenRunning`, which defers to the first real user gesture on
		 * browsers. Peaks stay far below clipping even with every preset voice
		 * summed.
		 *
		 * @param id - preset id; `none` and unknown ids are silent no-ops.
		 * @param volumePercent - loudness clamped to 0–100; a non-finite value
		 *   (a hand-edited YAML `.nan`/`.inf`) falls back to the default rather
		 *   than reaching Web Audio, where a non-finite gain would throw.
		 */
		function playSound(id, volumePercent) {
			if (id === "none" || id === undefined) return;
			const engine = audioEngine();
			if (engine === undefined) return;
			const preset = SOUND_PRESETS[id];
			if (preset === undefined) return;
			const percent = Number.isFinite(volumePercent) ? volumePercent : DEFAULT_VOLUME;
			const loudness = Math.max(0, Math.min(100, percent)) / 100;
			if (loudness === 0) return;
			whenRunning(engine, () => {
				// Every preset is scaled to the same peak, so a slider value
				// means one loudness whichever sound is selected.
				const { master, nodes } = outputChain(engine, loudness, PRESET_LEVEL[id] ?? 1);
				const t0 = engine.currentTime + 0.02;
				let tail = 0;
				for (const note of preset.notes) {
					const osc = engine.createOscillator();
					const gain = engine.createGain();
					osc.type = note.type ?? "sine";
					const start = t0 + note.at;
					osc.frequency.setValueAtTime(note.freq, start);
					if (note.glideTo !== undefined) {
						osc.frequency.exponentialRampToValueAtTime(note.glideTo, start + note.dur * 0.85);
					}
					const peak = Math.max(0.0002, note.gain * 0.25);
					gain.gain.setValueAtTime(0.0001, start);
					gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
					gain.gain.exponentialRampToValueAtTime(0.0001, start + note.dur);
					osc.connect(gain);
					gain.connect(master);
					trackSource(osc);
					osc.start(start);
					osc.stop(start + note.dur + 0.05);
					tail = Math.max(tail, note.at + note.dur);
				}
				// Release the master gain once the tail has faded. Without
				// this, every play leaves a gain node permanently wired to
				// the destination — a slow audio-node leak on long sessions.
				const remaining = () => (t0 + tail + 0.1 - engine.currentTime) * 1000;
				const release = (rechecked) => {
					try {
						// The delay was computed when this was scheduled, and a
						// suspended context freezes `currentTime`: without this
						// second look, a timer that comes due during a freeze
						// disconnects a tail that is still playing. Re-check
						// once — not in a loop, so a clock that never advances
						// (a test's frozen mock, a context suspended for good)
						// still ends with the node released.
						if (!rechecked && remaining() > 5) {
							setTimeout(() => release(true), remaining() + 50);
							return;
						}
						for (const node of nodes) node.disconnect();
					} catch {}
				};
				const timer = setTimeout(() => release(false), Math.max(0, remaining() + 50));
				timer.unref?.();
			});
		}

		/**
		 * Release the page's audio engine. Called when this plugin's fiber
		 * tears down — most importantly when the module is hot-replaced — so
		 * each discarded bundle's context is closed instead of stranding an
		 * audio thread per reload.
		 */
		function releaseAudioEngine() {
			// Decoded buffers belong to the old context and cannot be played on
			// a new one, so they are dropped with it.
			soundCache.clear();
			legacySoundCache = undefined;
			if (audioContext === undefined) return;
			const engine = audioContext;
			audioContext = undefined;
			Promise.resolve(engine.close?.()).catch(() => {});
		}
		//#endregion

		//#region runtime helpers
		/**
		 * Whether the user is looking at the page right now.
		 *
		 * `visibilityState` is the platform's own fact for "this window is in
		 * front of the user", and every "do not disturb" decision in this
		 * package keys off it: the playback gate, the system notification, the
		 * title flash, and the repeat reminder.
		 *
		 * @returns whether the page is visible.
		 */
		function pageIsWatched() {
			return typeof document === "undefined" || document.visibilityState === "visible";
		}

		/**
		 * Text the title alert writes in front of the window title, per state.
		 *
		 * Plain words rather than a symbol: the taskbar is read by people, and a
		 * localized word says which of the two situations this is without having
		 * to learn what a mark means. The labels come from the section's own
		 * dictionary (so the English UI says "Waiting for you" / "Finished"),
		 * which is why they are passed in rather than held here — the translator
		 * is bound inside `apply`.
		 *
		 * @param t - the bound translator for this package's namespace.
		 * @returns the label per state.
		 */
		function titleAlerts(t) {
			return { pending: t("titleFlash.pending"), done: t("titleFlash.done") };
		}

		/**
		 * Take the alert prefix back off the title.
		 *
		 * The prefix in effect is REMEMBERED when it is written rather than
		 * re-derived from the labels: the labels move — a language switch
		 * replaces every word — and clearing or rewriting has to find the word
		 * that is really on the title. Deriving it from the current labels left
		 * the previous language's word glued in front of the title after a
		 * switch, and the teardown that should have cleaned it up went looking
		 * for the new word, found nothing, and left the title dirty for the
		 * life of the window.
		 */
		function stripTitleAlert() {
			const prefix = titleAlertPrefixText;
			titleAlertPrefixText = undefined;
			if (prefix === undefined || typeof document === "undefined") return;
			if (document.title.startsWith(`${prefix} `)) document.title = document.title.slice(prefix.length + 1);
		}

		/**
		 * Apply or clear the title-bar alert prefix.
		 *
		 * The prefix is purely additive, but the app is not: DSH's own title
		 * component ASSIGNS the whole string (`document.title = \`${title} —
		 * ${productTitle}\``), so a session-title change erases the prefix and
		 * nothing would put it back until the next status or visibility event.
		 * While an alert is wanted, a `MutationObserver` on `<title>` restores
		 * it; the observer is disconnected first so restoring cannot loop.
		 *
		 * @param state - `pending`, `done`, or undefined to clear it.
		 * @param alerts - the labels in effect.
		 */
		function applyTitleFlash(state, alerts) {
			if (typeof document === "undefined") return;
			titleAlertLabels = alerts;
			const wanted = state === "pending" || state === "done" ? state : undefined;
			if (wanted === undefined) {
				stopObservingTitle();
				titleAlertState = undefined;
				stripTitleAlert();
				return;
			}
			const prefix = alerts[wanted];
			// Already in place: most calls recompute unchanged facts (every
			// sessionStatus emission re-runs the flash), and each rewrite is a
			// title mutation that the app's own writer and this observer both
			// see. Nothing to do also means nothing to disturb.
			if (titleAlertState === wanted && titleAlertPrefixText === prefix && document.title.startsWith(`${prefix} `)) {
				observeTitle();
				return;
			}
			titleAlertState = wanted;
			writeTitleAlert();
			observeTitle();
		}

		/**
		 * Put the wanted prefix in front of the app's own title, replacing another.
		 */
		function writeTitleAlert() {
			if (titleAlertState === undefined || typeof document === "undefined") return;
			const prefix = titleAlertLabels?.[titleAlertState];
			if (typeof prefix !== "string" || prefix === "") return;
			stripTitleAlert();
			document.title = `${prefix} ${document.title}`;
			titleAlertPrefixText = prefix;
		}

		/**
		 * Watch the title while an alert is wanted, so the app cannot erase it.
		 */
		function observeTitle() {
			if (titleObserver !== undefined || typeof MutationObserver === "undefined") return;
			const title = document.querySelector("title");
			// A page with no <title> element yet: leave `titleObserver` unset
			// so a later call can try again once one appears. Creating the
			// observer before this check used to park it assigned but never
			// observing, and every later call then took the early return —
			// the alert could never be defended again for the life of the
			// page.
			if (title === null) return;
			titleObserver = new MutationObserver(() => {
				const prefix = titleAlertPrefixText;
				if (prefix !== undefined && document.title.startsWith(`${prefix} `)) return;
				// Disconnect before writing: the assignment below is itself a
				// title mutation, and an active observer would re-enter here.
				stopObservingTitle();
				writeTitleAlert();
				observeTitle();
			});
			titleObserver.observe(title, { childList: true, characterData: true, subtree: true });
		}

		/** Which alert the title currently wants, while one is wanted. */
		let titleAlertState;

		/** Label set in effect (`{ pending, done }`); refreshed on a language switch. */
		let titleAlertLabels;

		/** Alert prefix currently written in front of the title, or undefined when none. */
		let titleAlertPrefixText;

		/** Stop watching the title and release the observer. */
		function stopObservingTitle() {
			if (titleObserver === undefined) return;
			titleObserver.disconnect();
			titleObserver = undefined;
		}

		/** Active title observer, while a title alert is wanted. */
		let titleObserver;

		/**
		 * Parse "HH:MM" into minutes past midnight; `NaN` when malformed.
		 *
		 * Deliberately as strict as the Host's `TIME_OF_DAY` pattern: two-digit
		 * hours, two-digit minutes. A hand-edited `9:05` is refused by the
		 * Config schema, so accepting it here would mean the row claims a value
		 * is fine while the plugin itself declines to load — one field, two
		 * verdicts.
		 *
		 * @param text - the stored value.
		 * @returns minutes past midnight, or NaN.
		 */
		function timeOfDayToMinutes(text) {
			if (typeof text !== "string") return NaN;
			const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
			if (match === null) return NaN;
			return Number(match[1]) * 60 + Number(match[2]);
		}

		/**
		 * Whether `now` falls inside the configured daily quiet range. A
		 * wrap-around range ("22:00"–"08:00") spans midnight; a malformed or
		 * empty range never quiets anything.
		 *
		 * @param now - the moment to test.
		 * @param startText - range start, "HH:MM".
		 * @param endText - range end, "HH:MM".
		 * @returns whether the moment is inside the range.
		 */
		function inQuietHours(now, startText, endText) {
			const start = timeOfDayToMinutes(startText);
			const end = timeOfDayToMinutes(endText);
			if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
			const minutes = now.getHours() * 60 + now.getMinutes();
			return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
		}

		/**
		 * Every OS notification this page has shown, held strongly, oldest first.
		 *
		 * A `Notification` whose last reference is gone can be collected while
		 * its toast is still displayed, and the click handler goes with it: the
		 * toast stays up as a DEAD button, and clicking it dismisses it with no
		 * event at all — which is exactly the "clicked the notification and
		 * nothing happened" symptom.
		 *
		 * So a live-only set is not enough, on either edge:
		 *
		 *   - `tag` collapses repeats within one trigger kind, so a repeat
		 *     reminder REPLACES the previous toast and closes the generation it
		 *     superseded — a click can still arrive for that older object;
		 *   - clicking a toast once does not mean the platform dismissed it, so
		 *     the same toast can be clicked a second time.
		 *
		 * Every generation stays reachable instead, bounded at
		 * `NOTIFICATION_MEMORY`: far beyond the toasts any one session leaves
		 * behind, and every toast still on screen keeps a handler that answers.
		 */
		const shownNotifications = [];

		/** How many notification objects stay reachable for a late click. */
		const NOTIFICATION_MEMORY = 24;

		/**
		 * The notification currently on screen per collapse tag.
		 *
		 * Repeats within one trigger kind are collapsed here, by this package
		 * rather than by the platform's `tag` replacement: superseding a toast
		 * through the tag closes the generation being replaced, and a click can
		 * arrive for that older object and be dropped with it. Closing the old
		 * toast first leaves exactly one live toast per kind, always a fresh
		 * object with its own handler.
		 */
		const liveNotifications = new Map();

		/** Route the Host half serves for notification clicks; must match the Host half's FOCUS_PATH. */
		const FOCUS_PATH = "/notify-sounds/focus";

		/** Route the Host half answers the update check on; must match the Host half's UPDATE_CHECK_PATH. */
		const UPDATE_CHECK_PATH = "/notify-sounds/update/check";

		/** Route the Host half answers a session's goal phase on; must match the Host half's GOAL_PHASE_PATH. */
		const GOAL_PHASE_PATH = "/notify-sounds/goal";

		/** `v1.2.3` for display, `?` when the Host reported no version. */
		const formatVersion = (text) => (typeof text === "string" && text !== "" ? `v${text}` : "?");

		/**
		 * The version as a package specifier segment: `1.2.3`, never `v1.2.3`.
		 *
		 * The display form and the installable form are deliberately different.
		 * Every install instruction this package prints is pasted into a package
		 * manager, and `pkg@v1.2.3` only works because semver tolerates the
		 * prefix — not because anything promises it. A command that fails to
		 * parse is worse than a slightly plainer one.
		 */
		const packageVersion = (text) => (typeof text === "string" && text !== "" ? text : "");

		/**
		 * The version an install instruction should name, or undefined when
		 * there is nothing to install.
		 *
		 * Only these two states need an instruction, and both have to name a
		 * version or the command runs into `minimumReleaseAge` and quietly
		 * installs the previous release:
		 *
		 *   - a newer version exists → install that one;
		 *   - the install is not recorded by the profile's lockfile → install
		 *     the version already on disk, so the record catches up.
		 *
		 * When both hold, the newer version is the target: reinstalling it
		 * fixes the record at the same time. A plain "up to date" install
		 * yields undefined, so the row stays quiet.
		 *
		 * @param payload - the Host's answer, or undefined before one arrives.
		 * @param currentKnown - whether `payload.current` is a usable version.
		 * @returns the version string, as a package specifier segment.
		 */
		const installTargetVersion = (payload, currentKnown) => {
			if (payload?.updateAvailable === true && typeof payload.latest === "string" && payload.latest !== "") return payload.latest;
			if (payload?.unregistered === true && currentKnown && typeof payload.current === "string" && payload.current !== "") return payload.current;
			return undefined;
		};

		/** Channel name and claim key shared by every page of this origin. */
		const ALERT_CHANNEL = "dsh-notify-sounds:alerts";
		const ALERT_LEADER_KEY = "dsh-notify-sounds:leader";
		/** How often the leader re-asserts, and when a quiet claim is considered abandoned. */
		const ALERT_HEARTBEAT_MS = 5000;
		const ALERT_STALE_MS = 15000;

		/**
		 * `localStorage`, when this page has one that answers.
		 *
		 * Even reading it can throw where storage is blocked (private mode, a
		 * sandboxed frame), and a page without it simply leads itself.
		 *
		 * @returns the storage, or undefined.
		 */
		const safeAlertStorage = () => {
			try {
				if (typeof localStorage === "undefined") return undefined;
				localStorage.getItem(ALERT_LEADER_KEY);
				return localStorage;
			} catch {
				return undefined;
			}
		};

		/**
		 * Elect one page among the tabs — and windows — of this GUI to be the one
		 * that speaks.
		 *
		 * Two pages are two independent subscribers to the same session facts:
		 * left alone, one decision rings the sound twice, raises two system
		 * notifications and runs two repeat reminders (the settings even say
		 * "at most one quiet check a day" while both of them check). The election
		 * is a claim in `localStorage`, which every page of this origin shares,
		 * refreshed by a heartbeat; a claim that stops being refreshed is taken
		 * over, so a closed, crashed or frozen tab hands the role on within a few
		 * seconds. `BroadcastChannel` only makes a claim heard sooner — the
		 * correctness rests on the stored claim, because whoever wrote it last
		 * owns the role and every page re-reads it rather than trusting a message.
		 *
		 * The title mark is deliberately NOT gated by this: each window and each
		 * tab has its own title, so marking them all is right, while a sound and
		 * a toast belong to the machine.
		 *
		 * Pages that can use neither mechanism — the smoke harness, a hardened
		 * browser context — lead themselves, which is the behaviour before this
		 * existed.
		 *
		 * @returns `{ isLeader, refresh, dispose }`, where `refresh` re-runs the
		 *   election (the tests drive it instead of waiting for a heartbeat).
		 */
		function createAlertLeader() {
			const storage = safeAlertStorage();
			const Channel = typeof BroadcastChannel === "function" ? BroadcastChannel : undefined;
			if (storage === undefined || Channel === undefined) {
				return { isLeader: () => true, refresh: () => {}, dispose: () => {} };
			}
			const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
			let channel;
			try {
				channel = new Channel(ALERT_CHANNEL);
			} catch {
				return { isLeader: () => true, refresh: () => {}, dispose: () => {} };
			}
			let leader = false;
			const readClaim = () => {
				try {
					const parsed = JSON.parse(storage.getItem(ALERT_LEADER_KEY) ?? "null");
					return parsed !== null && typeof parsed?.id === "string" && Number.isFinite(parsed?.at) ? parsed : undefined;
				} catch {
					return undefined;
				}
			};
			const claim = () => {
				leader = true;
				try {
					storage.setItem(ALERT_LEADER_KEY, JSON.stringify({ id, at: Date.now() }));
				} catch {}
				try {
					channel.postMessage({ id });
				} catch {}
			};
			const refresh = () => {
				const current = readClaim();
				if (current === undefined || current.id === id) {
					claim();
					return;
				}
				// Somebody else holds a claim. While it is fresh this page stays
				// silent; once it goes stale its holder is gone and this page
				// takes over.
				if (Date.now() - current.at < ALERT_STALE_MS) {
					leader = false;
					return;
				}
				claim();
			};
			channel.onmessage = (event) => {
				if (event?.data?.id !== id) refresh();
			};
			const timer = setInterval(refresh, ALERT_HEARTBEAT_MS);
			timer.unref?.();
			refresh();
			return {
				isLeader: () => leader,
				refresh,
				dispose: () => {
					clearInterval(timer);
					try {
						if (leader && readClaim()?.id === id) storage.removeItem(ALERT_LEADER_KEY);
					} catch {}
					try {
						channel.close();
					} catch {}
				},
			};
		}

		/**
		 * Show one OS notification; every failure mode is silent.
		 *
		 * `tag` is our OWN collapse key — we close the previous notification
		 * ourselves rather than handing the tag to the platform, because a
		 * superseded toast can swallow clicks aimed at it. `silent` keeps the
		 * OS from layering its own sound on top of ours.
		 *
		 * @param title - notification title.
		 * @param body - notification body.
		 * @param tag - our internal key for closing the previous generation;
		 *   deliberately NOT passed to the platform (see the comment inside).
		 */
		function showSystemNotification(title, body, tag) {
			try {
				if (typeof Notification === "undefined") return;
				if (Notification.permission !== "granted") return;
				// Replace the previous generation OURSELVES. Relying on `tag`
				// to collapse repeats means the platform closes the toast that
				// is being superseded — and a click that arrives for that older
				// toast can be dropped with it, which is one whole class of
				// "clicked the notification and nothing happened". The tag is
				// only our own key for closing the previous generation, which
				// is why it is not passed to the constructor below either.
				const previous = liveNotifications.get(tag);
				if (previous !== undefined) {
					liveNotifications.delete(tag);
					try {
						previous.close();
					} catch {}
				}
				const notification = new Notification(title, { body, silent: true });
				// The constructor worked, so this environment can build a toast
				// after all. Clearing the flag matters: it is what disables the
				// row (see SystemNotifyRow), and one transient refusal must not
				// leave the switch dead for the life of the page.
				notificationConstructionFailed = false;
				liveNotifications.set(tag, notification);
				// Held here — and deliberately NOT released on click or close.
				// Releasing it was what left a replaced (or twice-clicked) toast
				// standing with no handler behind it.
				shownNotifications.push(notification);
				if (shownNotifications.length > NOTIFICATION_MEMORY) shownNotifications.shift();
				notification.onclick = () => {
					// The focus request is the FIRST thing the click does, and
					// it is not gated on anything that can throw:
					// `notification.close()` and `window.focus()` are cosmetic
					// here, and in a sandboxed renderer either can raise. When
					// they ran ahead of the fetch, a throw left the click a
					// silent no-op with no request ever sent.
					try {
						fetch(FOCUS_PATH, { method: "POST" }).catch(() => {});
					} catch {}
					// `window.focus()` only focuses the page, not the OS
					// window. The route above restores and focuses the real
					// window from the Host process instead.
					try {
						notification.close();
					} catch {}
					try {
						window.focus();
					} catch {}
				};
			} catch (error) {
				// `new Notification` is what can throw here, when the
				// environment refuses to construct one — nearly every mobile
				// browser does exactly that, while still reporting a
				// "granted" permission. So this is not just a log line: it is
				// recorded and shown, because the Settings row otherwise reads
				// `Notification.permission` and proudly says "granted" for a
				// switch that can never do anything.
				notificationConstructionFailed = true;
				if (!warnedNotificationFailure) {
					warnedNotificationFailure = true;
					console.warn("notify-sounds: could not show a system notification", error);
				}
			}
		}

		/** Whether the one-time notification-construction warning has been logged. */
		let warnedNotificationFailure = false;

		/**
		 * Whether this environment refused to construct a Notification.
		 *
		 * Set by the first real attempt, read by the settings row: permission
		 * being "granted" proves nothing about whether a toast can actually be
		 * built (MDN: the constructor throws in nearly all mobile browsers).
		 */
		let notificationConstructionFailed = false;

		/**
		 * Human-readable summary of one pending interaction, for notification
		 * bodies: the approval's localized reason first, then its raw reason,
		 * then the first question's text, then the requesting tool's name.
		 *
		 * The reason fields are package text: DSH writes them as either a plain
		 * string or a `{ en, zh }` map, so both go through the locale's own
		 * resolver — a map read as a string would put "[object Object]" in the
		 * notification.
		 *
		 * @param interaction - a pendingInteraction object, or nothing.
		 * @param resolve - resolves package text to the active language.
		 * @returns the best summary, or `undefined`.
		 */
		function interactionSummary(interaction, resolve) {
			if (interaction === null || typeof interaction !== "object") return undefined;
			const text = typeof resolve === "function" ? resolve : (value) => value;
			const display = typeof interaction.displayReason === "string" ? interaction.displayReason : text(interaction.displayReason);
			if (typeof display === "string" && display !== "") return display;
			const reason = typeof interaction.reason === "string" ? interaction.reason : text(interaction.reason);
			if (typeof reason === "string" && reason !== "") return reason;
			const questions = interaction.questions;
			if (Array.isArray(questions) && questions.length > 0) {
				const first = questions[0];
				if (first !== null && typeof first === "object" && typeof first.question === "string" && first.question !== "") return first.question;
			}
			if (typeof interaction.toolName === "string" && interaction.toolName !== "") return interaction.toolName;
			return undefined;
		}
		//#endregion

		//#region settings rows
		/**
		 * The Settings section: the row list, the write helper every row shares,
		 * and the "this field was refused" marker they render.
		 *
		 * @param props - the form snapshot hook, the field writer, the preview
		 *   player, and the locale seat.
		 * @returns the Settings section element tree.
		 */
		function NotifySoundsSection({ useConfig, setField, preview, previewSound, onAddSound, onRemoveSound, t }) {
			const state = useConfig((snapshot) => snapshot);
			const value = state.status === "ready" ? state.value : undefined;
			const disabled = state.writable !== true;
			const [failedField, setFailedField] = useState(null);

			/** Write one field, surfacing a refusal as that row's error; resolves once settled. */
			const write = useCallback((field, next) => {
				setFailedField(null);
				let pending;
				try {
					pending = setField(field, next);
				} catch {
					setFailedField(field);
					return Promise.resolve(false);
				}
				return Promise.resolve(pending).then((accepted) => {
					const saved = accepted === true;
					if (!saved) setFailedField(field);
					return saved;
				}, () => {
					setFailedField(field);
					return false;
				});
			}, [setField]);

			const volume = Number.isFinite(value?.volume) ? value.volume : 60;

			/** The presets a picker offers, in display order; the user's own sounds are appended. */
			const presetIds = SOUND_IDS.filter((id) => id !== "custom" && !CUSTOM_SLOTS.includes(id) && id !== "none");

			/** The user's sounds that hold a file right now, in slot order. */
			const library = CUSTOM_SLOTS
				.filter((slot) => typeof value?.[`${slot}File`] === "string" && value[`${slot}File`] !== "")
				.map((slot) => ({ id: slot, file: value[`${slot}File`], name: typeof value?.[`${slot}Name`] === "string" ? value[`${slot}Name`] : "" }));

			/**
			 * What one of the user's sounds is called: its own name, or its
			 * position in the LIST. Using the slot number would show "自定义音频 2"
			 * for the first row when slot 1 happens to be empty.
			 */
			const soundLabel = (entry) => (entry.name.trim() !== "" ? entry.name : t("custom.fallbackName", { index: library.indexOf(entry) + 1 }));

			/** Menu entries: presets, then the user's sounds, then Off. */
			const soundItems = [
				...presetIds.map((id) => ({ id, label: t("sound." + id) })),
				...library.map((entry) => ({ id: entry.id, label: soundLabel(entry) })),
				{ id: "none", label: t("sound.none") },
			];

			/**
			 * Accept a stored value the menu can show, else fall back.
			 *
			 * A slot whose sound was deleted is no longer offered, so a picker
			 * left pointing at it falls back here — the same answer playback
			 * gives, so the menu and the sound never disagree.
			 */
			const soundValue = (raw, fallback) => {
				if (typeof raw !== "string") return fallback;
				if (raw === "none" || presetIds.includes(raw)) return raw;
				if (CUSTOM_SLOTS.includes(raw)) return library.some((entry) => entry.id === raw) ? raw : fallback;
				return fallback;
			};

			const [customError, setCustomError] = useState(null);
			const [customBusy, setCustomBusy] = useState(false);
			const customInput = useRef(null);
			const customFull = library.length >= CUSTOM_SLOT_LIMIT;

			/** Read one chosen file, validate it, and add it to the library. */
			const handleAddSound = async (event) => {
				const input = event.currentTarget;
				const file = input.files?.[0];
				if (typeof input.value === "string") input.value = "";
				if (file === undefined) return;
				if (file.size > SOUND_MAX_BYTES) {
					setCustomError({ key: "custom.tooLarge" });
					return;
				}
				setCustomError(null);
				setCustomBusy(true);
				try {
					let bytes;
					try {
						bytes = await file.arrayBuffer();
					} catch {
						setCustomError({ key: "custom.unreadable" });
						return;
					}
					const decoded = await validateCustomSoundBytes(bytes);
					if (decoded === undefined) {
						setCustomError({ key: "custom.undecodable" });
						return;
					}
					if (decoded.duration > SOUND_MAX_SECONDS) {
						setCustomError({ key: "custom.tooLong", values: { seconds: Math.round(decoded.duration) } });
						return;
					}
					if (decoded.duration < 0.15 || bufferPeak(decoded) < 0.001) {
						setCustomError({ key: "custom.silent" });
						return;
					}
					try {
						await onAddSound(bytes, file.name.replace(/\.[^.]+$/u, ""));
					} catch {
						setCustomError({ key: "custom.addFailed" });
					}
				} finally {
					setCustomBusy(false);
				}
			};

			/** Remove one of the user's sounds, surfacing a refusal on its row. */
			const handleRemoveSound = async (slot) => {
				try {
					await onRemoveSound(slot);
				} catch {
					setFailedField(`${slot}Name`);
				}
			};
			// The interval in force, snapped to a value the control offers — the
			// same call the reminder timer makes, so the row cannot promise a
			// cadence the timer does not keep.
			const renotifyMinutes = renotifyInterval(value?.renotifyMinutes);
			const quietStart = Number.isNaN(timeOfDayToMinutes(value?.quietStart)) ? "22:00" : value.quietStart;
			const quietEnd = Number.isNaN(timeOfDayToMinutes(value?.quietEnd)) ? "08:00" : value.quietEnd;

			return h("div", { className: css.section }, [
				h("h2", { className: css.title, key: "title" }, t("title")),
				h("p", { className: css.intro, key: "intro" }, t("intro")),
				h("div", { className: css.rows, key: "rows" }, [
					h(SwitchRow, {
						key: "enabled",
						t,
						title: t("enabled.title"),
						description: t("enabled.description"),
						label: t("enabled.title"),
						checked: value?.enabled !== false,
						disabled,
						failed: failedField === "enabled",
						onChange: (next) => write("enabled", next),
					}),
					h(VolumeRow, {
						key: "volume",
						t,
						value: volume,
						disabled,
						failed: failedField === "volume",
						onCommit: (next) => write("volume", next),
					}),
					h(SoundRow, {
						key: "decision",
						t,
						title: t("decision.title"),
						description: t("decision.description"),
						selected: soundValue(value?.decisionSound, "bell"),
						items: soundItems,
						disabled,
						failed: failedField === "decisionSound",
						onSelect: (id) => {
							write("decisionSound", id);
							if (CUSTOM_SLOTS.includes(id)) previewSound(id, volume);
							else preview(id, volume);
						},
						onPreview: (id) => (CUSTOM_SLOTS.includes(id) ? previewSound(id, volume) : preview(id, volume)),
					}),
					h(SoundRow, {
						key: "question",
						t,
						title: t("question.title"),
						description: t("question.description"),
						selected: soundValue(value?.questionSound, "chime"),
						items: soundItems,
						disabled,
						failed: failedField === "questionSound",
						onSelect: (id) => {
							write("questionSound", id);
							if (CUSTOM_SLOTS.includes(id)) previewSound(id, volume);
							else preview(id, volume);
						},
						onPreview: (id) => (CUSTOM_SLOTS.includes(id) ? previewSound(id, volume) : preview(id, volume)),
					}),
					h(SoundRow, {
						key: "completion",
						t,
						title: t("completion.title"),
						description: t("completion.description"),
						selected: soundValue(value?.completionSound, "ding"),
						items: soundItems,
						disabled,
						failed: failedField === "completionSound",
						onSelect: (id) => {
							write("completionSound", id);
							if (CUSTOM_SLOTS.includes(id)) previewSound(id, volume);
							else preview(id, volume);
						},
						onPreview: (id) => (CUSTOM_SLOTS.includes(id) ? previewSound(id, volume) : preview(id, volume)),
					}),
					h("div", { className: css.row, key: "custom" }, [
						h("div", { key: "text" }, [
							h("div", { className: css.rowTitle, key: "title" }, t("custom.title")),
							h("div", { className: css.rowDescription, key: "description" }, t("custom.description")),
							customError !== null ? h("div", { className: css.error, role: "alert", key: "validation" }, t(customError.key, customError.values)) : null,
							customFull ? h("div", { className: css.hint, key: "limit" }, t("custom.limit")) : null,
						]),
						h("div", { className: css.stackControl, key: "control" }, [
							h("input", {
								key: "file",
								type: "file",
								accept: "audio/*",
								ref: customInput,
								className: css.fileInput,
								"aria-hidden": "true",
								tabIndex: -1,
								onChange: handleAddSound,
							}),
							h(Button, {
								key: "add",
								variant: "outline",
								size: "sm",
								disabled: disabled || customBusy || customFull,
								onClick: () => {
									setCustomError(null);
									customInput.current?.click?.();
								},
							}, t("custom.add")),
						]),
					]),
					...library.map((entry, index) => h(CustomSoundItem, {
						key: "custom-item-" + entry.id,
						t,
						index: index + 1,
						name: entry.name,
						file: entry.file,
						used: ["decision", "question", "completion"].some((kind) => value?.[`${kind}Sound`] === entry.id),
						disabled,
						failed: failedField === `${entry.id}Name`,
						onRename: (next) => write(`${entry.id}Name`, next),
						onRemove: () => handleRemoveSound(entry.id),
						onPreview: () => previewSound(entry.id, volume),
					})),
					h(SwitchRow, {
						key: "subagent",
						t,
						title: t("subagent.title"),
						description: t("subagent.description"),
						label: t("subagent.title"),
						checked: value?.subagentAlerts === true,
						disabled,
						failed: failedField === "subagentAlerts",
						onChange: (next) => write("subagentAlerts", next),
					}),
					h(SwitchRow, {
						key: "goalFinalOnly",
						t,
						title: t("goalFinalOnly.title"),
						description: t("goalFinalOnly.description"),
						label: t("goalFinalOnly.title"),
						checked: value?.goalFinalOnly === true,
						disabled,
						failed: failedField === "goalFinalOnly",
						onChange: (next) => write("goalFinalOnly", next),
					}),
					h(SystemNotifyRow, {
						key: "systemNotify",
						t,
						checked: value?.systemNotify === true,
						disabled,
						failed: failedField === "systemNotify",
						onChange: (next) => write("systemNotify", next),
					}),
					h(SwitchRow, {
						key: "titleFlash",
						t,
						title: t("titleFlash.title"),
						// macOS DESKTOP shell only: its title bar is hiddenInset
						// and the Dock shows no per-window title, so the mark
						// has nowhere to appear. A macOS BROWSER tab shows the
						// document title like any other, so this is not
						// applied there. iOS Safari's UA also contains "like
						// Mac OS X" — `isDesktopShell` keeps it out.
						description: titleFlashUnavailable() ? t("titleFlash.macUnsupported") : t("titleFlash.description"),
						label: t("titleFlash.title"),
						checked: value?.titleFlash === true,
						disabled: disabled || titleFlashUnavailable(),
						failed: failedField === "titleFlash",
						onChange: (next) => write("titleFlash", next),
					}),
					h(RenotifyRow, {
						key: "renotify",
						t,
						on: value?.renotify === true,
						minutes: renotifyMinutes,
						disabled,
						failed: failedField === "renotify" || failedField === "renotifyMinutes",
						onToggle: (next) => write("renotify", next),
						onInterval: (minutes) => write("renotifyMinutes", minutes),
					}),
					h(QuietHoursRow, {
						key: "quiet",
						t,
						on: value?.quietHours === true,
						start: quietStart,
						end: quietEnd,
						disabled,
						failed: failedField === "quietHours" || failedField === "quietStart" || failedField === "quietEnd",
						onToggle: (next) => write("quietHours", next),
						onStart: (time) => write("quietStart", time),
						onEnd: (time) => write("quietEnd", time),
					}),
					h(SwitchRow, {
						key: "onlyWhenHidden",
						t,
						title: t("onlyWhenHidden.title"),
						description: t("onlyWhenHidden.description"),
						label: t("onlyWhenHidden.title"),
						checked: value?.onlyWhenHidden === true,
						disabled,
						failed: failedField === "onlyWhenHidden",
						onChange: (next) => write("onlyWhenHidden", next),
					}),
					h(SwitchRow, {
						key: "updateAutoCheck",
						t,
						title: t("update.auto"),
						description: t("update.auto.description"),
						label: t("update.auto"),
						checked: value?.updateAutoCheck !== false,
						disabled,
						failed: failedField === "updateAutoCheck",
						onChange: (next) => write("updateAutoCheck", next),
					}),
					h(UpdateRow, {
						key: "update",
						t,
						autoCheck: value === undefined ? undefined : value.updateAutoCheck !== false,
					}),
				]),
			]);
		}

		/**
		 * One label/description row with a Switch on the right — the General
		 * section's own row geometry. The switch is disabled while a write is
		 * in flight, exactly like the General section's own toggles, so a
		 * double-tap cannot race two writes.
		 *
		 * @param props - copy, the accepted value, and the writer.
		 * @returns the row element tree.
		 */
		function SwitchRow({ t, title, description, label, checked, disabled, failed, onChange }) {
			const [busy, setBusy] = useState(false);
			return h("div", { className: css.row }, [
				h("div", { key: "text" }, [
					h("div", { className: css.rowTitle, key: "title" }, title),
					h("div", { className: css.rowDescription, key: "description" }, description),
					failed ? h("div", { className: css.error, role: "alert", key: "error" }, t("saveFailed")) : null,
				]),
				h(Switch, {
					key: "switch",
					checked,
					disabled: disabled || busy,
					label,
					onChange: (next) => {
						setBusy(true);
						return Promise.resolve(onChange(next)).finally(() => setBusy(false));
					},
				}),
			]);
		}

		/**
		 * The volume row: a DSH-styled range input that commits on release, with
		 * the live percentage beside it.
		 *
		 * The input is deliberately uncontrolled. A controlled `value` round-trips
		 * every pointer move through React state, and a commit that lands after
		 * the native thumb has moved on snaps the thumb back — the classic
		 * controlled-range stutter. Here a drag only writes one CSS custom
		 * property (`--dsh-notify-sounds-fill`, which the stylesheet's gradient
		 * reads) and the label text through refs; React re-renders exactly once,
		 * when the accepted value changes.
		 *
		 * @param props - copy, the accepted value, and the commit writer.
		 * @returns the row element tree.
		 */
		function VolumeRow({ t, value, disabled, failed, onCommit }) {
			const inputRef = useRef(null);
			const labelRef = useRef(null);
			/** The accepted value as of the last render, readable from closures. */
			const accepted = useRef(value);
			accepted.current = value;
			/** The value already committed for this gesture, so pointer-up and the blur that follows it do not double-write. */
			const committed = useRef(null);
			/** True between pointer-down and pointer-up: an in-flight drag whose thumb must never be yanked. */
			const dragging = useRef(false);

			/** Paint one position into the track fill and the percentage label. */
			const paint = (input, at) => {
				input.style.setProperty("--dsh-notify-sounds-fill", at + "%");
				if (labelRef.current !== null) labelRef.current.textContent = at + "%";
			};

			/** Put the control back on the accepted value, unless a drag owns the thumb. */
			const resync = () => {
				const input = inputRef.current;
				if (input === null || dragging.current) return;
				if (Number(input.value) !== value) input.value = String(value);
				paint(input, value);
			};

			// Mirror accepted changes that arrive from outside this control —
			// a Host write landing, or the row mounting fresh. A drag in
			// progress keeps its own position; its commit supersedes.
			useEffect(resync, [value]);

			// A refused write snaps the control back beside the error row, so
			// the display never keeps a value the profile rejected. (The drag
			// guard covers a new gesture started while the failure lands.)
			useEffect(() => {
				if (failed) resync();
			}, [failed]);

			/** Commit the gesture's final value once. */
			const commit = () => {
				dragging.current = false;
				const input = inputRef.current;
				if (input === null) return;
				const next = Number(input.value);
				if (committed.current === next) return;
				committed.current = next;
				if (next !== accepted.current) onCommit(next);
			};

			return h("div", { className: css.row }, [
				h("div", { key: "text" }, [
					h("div", { className: css.rowTitle, key: "title" }, t("volume.title")),
					h("div", { className: css.rowDescription, key: "description" }, t("volume.description")),
					failed ? h("div", { className: css.error, role: "alert", key: "error" }, t("saveFailed")) : null,
				]),
				h("div", { className: css.volume, key: "control" }, [
					h("input", {
						key: "slider",
						type: "range",
						min: 0,
						max: 100,
						step: 1,
						ref: inputRef,
						defaultValue: value,
						disabled,
						className: css.slider,
						"aria-label": t("volume.title"),
						onChange: (event) => {
							// A new gesture begins: re-arm the once-per-gesture
							// commit guard, then paint without re-rendering.
							committed.current = null;
							paint(event.currentTarget, Number(event.currentTarget.value));
						},
						onPointerDown: () => {
							dragging.current = true;
						},
						onPointerUp: commit,
						onPointerCancel: commit,
						onKeyUp: commit,
						onBlur: commit,
					}),
					h("span", { className: css.volumeValue, key: "value", ref: labelRef }, value + "%"),
				]),
			]);
		}

		/**
		 * One sound-picker row: label/description on the left, and on the
		 * right a preview button plus a dropdown built from the official
		 * Menu primitive (check-mark selection, keyboard walking, and
		 * outside-click/Escape dismissal come with it). A dropdown keeps
		 * ten-plus presets inside the panel width where a segmented control
		 * would force the settings panel to scroll sideways.
		 *
		 * @param props - copy, the accepted preset, the ids to offer (the
		 *   section adds `custom` only while an upload exists), and the
		 *   select/preview actions.
		 * @returns the row element tree.
		 */
		function SoundRow({ t, title, description, selected, items, disabled, failed, onSelect, onPreview }) {
			const [open, setOpen] = useState(false);
			// Menu entries carry their text in `label` (`text` is reserved
			// for group-heading entries typed `{ type: "label" }`). The caller
			// builds them so the user's own sounds can appear under their names.
			//
			// The closed trigger reads its text from the same list: a preset has
			// a `sound.<id>` entry in the dictionary, but one of the user's own
			// sounds has no dictionary entry at all — its label is its name, and
			// looking it up as `t("sound.custom1")` printed the raw key.
			const selectedLabel = items.find((item) => item.id === selected)?.label ?? t("sound." + selected);
			return h("div", { className: css.row }, [
				h("div", { key: "text" }, [
					h("div", { className: css.rowTitle, key: "title" }, title),
					h("div", { className: css.rowDescription, key: "description" }, description),
					failed ? h("div", { className: css.error, role: "alert", key: "error" }, t("saveFailed")) : null,
				]),
				h("div", { className: css.stackControl, key: "control" }, [
					h(Button, {
						key: "preview",
						variant: "outline",
						size: "sm",
						disabled,
						icon: h(IconPlayOutlineRegular, { size: 14 }),
						"aria-label": title + " · " + t("preview"),
						onClick: () => {
							onPreview(selected);
						},
					}, t("preview")),
					h(Menu, {
						key: "menu",
						open,
						anchor: h(Button, {
							key: "trigger",
							variant: "outline",
							size: "sm",
							disabled,
							"aria-haspopup": "menu",
							"aria-expanded": open,
							icon: h(IconChevronDownOutlineMedium, { size: 14 }),
							onClick: () => {
								setOpen(!open);
							},
						}, selectedLabel),
						items,
						selectedId: selected,
						onSelect: (id) => {
							setOpen(false);
							onSelect(id);
						},
						onClose: () => {
							setOpen(false);
						},
						align: "end",
					}),
				]),
			]);
		}

		/**
		 * The custom-sound row: a hidden file input behind a choose button,
		 * the uploaded file's name, and preview/remove actions. Validation
		 * (size cap, decode check) reports through the row's own error line;
		 * the write itself surfaces through the shared failure marker.
		 *
		 * @param props - copy, the accepted file name, and the
		 *   upload/remove/preview actions.
		 * @returns the row element tree.
		 */
		/**
		 * One of the user's own sounds, listed under the 自定义音效 row.
		 *
		 * The name is an editable field: renaming is what makes three slots
		 * usable, because "自定义 2" says nothing about the recording. The write
		 * happens on blur (or Enter), not on every keystroke.
		 *
		 * @param props - copy, the slot's position, its name, its stored file,
		 *   whether any trigger uses it, and the row's actions.
		 * @returns the row element tree.
		 */
		function CustomSoundItem({ t, index, name, file, used, disabled, failed, onRename, onRemove, onPreview }) {
			// A stored name can outlive its file (deleted by hand, quarantined by
			// antivirus, or restored from a patch backup without the store). The
			// HEAD says so on the row instead of leaving the user to wonder why
			// this one sounds like a preset.
			const [missing, setMissing] = useState(false);
			useEffect(() => {
				if (file === "") {
					setMissing(false);
					return () => {};
				}
				let cancelled = false;
				fetch(`${SOUND_ROUTE}?file=${encodeURIComponent(file)}`, { method: "HEAD" }).then((response) => {
					if (!cancelled) setMissing(!response.ok);
				}, () => {
					if (!cancelled) setMissing(true);
				});
				return () => {
					cancelled = true;
				};
			}, [file]);
			/** Commit a rename once the field is left, ignoring an empty or unchanged value. */
			const commitName = (input) => {
				const next = typeof input?.value === "string" ? input.value.trim() : "";
				if (next === "" || next === name) return;
				onRename(next);
			};
			return h("div", { className: css.row }, [
				h("div", { key: "text" }, [
					h("div", { className: css.soundHead, key: "head" }, [
						h("span", { className: css.soundIndex, key: "index" }, t("custom.index", { index })),
						h("input", {
							key: "name",
							type: "text",
							className: css.soundName,
							defaultValue: name,
							placeholder: t("custom.namePlaceholder"),
							disabled,
							"aria-label": t("custom.rename"),
							onBlur: (event) => commitName(event.currentTarget),
							onKeyDown: (event) => {
								if (event.key === "Enter") event.currentTarget.blur?.();
							},
						}),
					]),
					missing ? h("div", { className: css.error, role: "alert", key: "missing" }, t("custom.missing")) : null,
					!used && !missing ? h("div", { className: css.hint, key: "unused" }, t("custom.unused")) : null,
					failed ? h("div", { className: css.error, role: "alert", key: "error" }, t("saveFailed")) : null,
				]),
				h("div", { className: css.stackControl, key: "control" }, [
					h(Button, {
						key: "preview",
						variant: "outline",
						size: "sm",
						disabled: disabled || missing,
						icon: h(IconPlayOutlineRegular, { size: 14 }),
						onClick: onPreview,
					}, t("preview")),
					h(Button, {
						key: "remove",
						variant: "outline",
						size: "sm",
						disabled,
						// Returns the promise: the handler reports its own failures, and
						// a test can await the write instead of racing it.
						onClick: onRemove,
					}, t("custom.remove")),
				]),
			]);
		}

		/**
		 * The system-notification row: a switch that requests the browser's
		 * notification permission when turned on, plus a live permission
		 * hint under the description.
		 *
		 * @param props - copy, the accepted value, and the writer.
		 * @returns the row element tree.
		 */
		function SystemNotifyRow({ t, checked, disabled, failed, onChange }) {
			const [busy, setBusy] = useState(false);
			// `typeof Notification` alone is not enough: nearly every mobile
			// browser exposes the API and happily reports "granted", yet the
			// constructor throws every time. Once a real attempt has failed,
			// this environment is treated as unsupported and the row says so.
			const supported = typeof Notification !== "undefined" && !notificationConstructionFailed;
			const permission = supported ? Notification.permission : "unsupported";
			const hintKey = !supported ? "systemNotify.unsupported"
				: permission === "denied" ? "systemNotify.denied"
				: permission === "granted" ? "systemNotify.granted"
				: null;
			return h("div", { className: css.row }, [
				h("div", { key: "text" }, [
					h("div", { className: css.rowTitle, key: "title" }, t("systemNotify.title")),
					h("div", { className: css.rowDescription, key: "description" }, t("systemNotify.description")),
					hintKey !== null ? h("div", { className: css.hint, key: "hint" }, t(hintKey)) : null,
					failed ? h("div", { className: css.error, role: "alert", key: "error" }, t("saveFailed")) : null,
				]),
				h(Switch, {
					key: "switch",
					checked,
					disabled: disabled || busy || (!supported && !checked),
					label: t("systemNotify.title"),
					onChange: (next) => {
						if (!next || !supported) {
							return Promise.resolve(onChange(next)).finally(() => setBusy(false));
						}
						setBusy(true);
						return Promise.resolve().then(() => Notification.requestPermission()).then((result) => {
							return onChange(result === "granted");
						}, () => {
							// A refused permission request is a denial by any
							// other name: keep the switch off instead of leaving
							// an unhandled rejection behind and a toggle that
							// claims an enable nothing will honour.
							return onChange(false);
						}).finally(() => setBusy(false));
					},
				}),
			]);
		}

		/** Re-ping interval choices, in minutes. */
		const RENOTIFY_INTERVALS = [1, 5, 15, 30];

		/**
		 * The interval actually in force, snapped to a value the control offers.
		 *
		 * The schema accepts any whole minute from 1 to 60, while the control
		 * offers four; a hand-edited `7` therefore has to be reconciled
		 * somewhere. It is reconciled HERE, once, and both the row and the
		 * reminder use this function — snapping only for display made the
		 * control say "5 min" while reminders fired every seven, which is the
		 * one outcome a settings row must never produce.
		 *
		 * @param value - the stored preference, possibly absent or out of range.
		 * @returns one of `RENOTIFY_INTERVALS`.
		 */
		const renotifyInterval = (value) => {
			const raw = Number.isFinite(value) ? value : 5;
			if (RENOTIFY_INTERVALS.includes(raw)) return raw;
			return RENOTIFY_INTERVALS.reduce((best, option) => (
				Math.abs(option - raw) < Math.abs(best - raw) ? option : best
			), RENOTIFY_INTERVALS[0]);
		};

		/**
		 * The repeat-reminder row: its toggle and, beside it, the interval
		 * SegmentedControl (disabled until the toggle is on).
		 *
		 * @param props - copy, the accepted toggle and interval, and the writers.
		 * @returns the row element tree.
		 */
		function RenotifyRow({ t, on, minutes, disabled, failed, onToggle, onInterval }) {
			const options = RENOTIFY_INTERVALS.map((value) => ({ value, label: t("renotify.minutes", { n: value }) }));
			return h("div", { className: css.row }, [
				h("div", { key: "text" }, [
					h("div", { className: css.rowTitle, key: "title" }, t("renotify.title")),
					h("div", { className: css.rowDescription, key: "description" }, t("renotify.description")),
					// Only where it is true: the Desktop shell runs this timer
					// in a real window that is never throttled, so the caveat
					// would only confuse its users.
					isDesktopShell() ? null : h("div", { className: css.hint, key: "hint" }, t("renotify.browserHint")),
					failed ? h("div", { className: css.error, role: "alert", key: "error" }, t("saveFailed")) : null,
				]),
				h("div", { className: css.stackControl, key: "control" }, [
					h(Switch, { key: "switch", checked: on, disabled, label: t("renotify.title"), onChange: onToggle }),
					h(SegmentedControl, {
						key: "interval",
						id: "dsh-notify-sounds-renotify-interval",
						label: t("renotify.interval"),
						value: minutes,
						options,
						disabled: disabled || !on,
						onChange: onInterval,
					}),
				]),
			]);
		}

		/**
		 * Commit one quiet-hours time input.
		 *
		 * A cleared field is the control being emptied, not a value the schema
		 * can accept (it wants "HH:MM"): the write would be refused for certain
		 * and report a confusing "save failed" on a row the user was only
		 * half-way through editing. Snap the DOM back to the accepted value
		 * instead — the input is controlled, but with no state change no
		 * re-render is coming to do it.
		 *
		 * @param input - the DOM input to read (and restore when empty).
		 * @param accepted - the currently accepted value.
		 * @param write - the writer for a usable value.
		 */
		function commitTimeOfDay(input, accepted, write) {
			const next = input.value;
			if (next === "") {
				input.value = accepted;
				return;
			}
			write(next);
		}

		/**
		 * The quiet-hours row: label/description on the left, and on the
		 * right its toggle and the start/end time inputs (disabled until
		 * the toggle is on).
		 *
		 * @param props - copy, the accepted toggle and range, and the writers.
		 * @returns the row element tree.
		 */
		function QuietHoursRow({ t, on, start, end, disabled, failed, onToggle, onStart, onEnd }) {
			return h("div", { className: css.row }, [
				h("div", { key: "text" }, [
					h("div", { className: css.rowTitle, key: "title" }, t("quiet.title")),
					h("div", { className: css.rowDescription, key: "description" }, t("quiet.description")),
					failed ? h("div", { className: css.error, role: "alert", key: "error" }, t("saveFailed")) : null,
				]),
				h("div", { className: css.stackControl, key: "control" }, [
					h(Switch, { key: "switch", checked: on, disabled, label: t("quiet.title"), onChange: onToggle }),
					h("div", { className: css.quietRange, key: "range" }, [
						h("input", {
							key: "start",
							type: "time",
							value: start,
							disabled: disabled || !on,
							className: css.timeInput,
							"aria-label": t("quiet.start"),
							onChange: (event) => {
								commitTimeOfDay(event.currentTarget, start, onStart);
							},
						}),
						h("span", { className: css.quietDash, key: "dash" }, "–"),
						h("input", {
							key: "end",
							type: "time",
							value: end,
							disabled: disabled || !on,
							className: css.timeInput,
							"aria-label": t("quiet.end"),
							onChange: (event) => {
								commitTimeOfDay(event.currentTarget, end, onEnd);
							},
						}),
					]),
				]),
			]);
		}

		/**
		 * The update row: what this installation runs, what npm has, and one
		 * button to ask.
		 *
		 * The check is a read-only question to this plugin's own Host route.
		 * Installing is the package manager's job (since 1.8.0), so the row
		 * reports and points rather than acting; the route takes no input from
		 * here, and the Host answers from a cache, so opening the section
		 * costs no network at all.
		 *
		 * @param props - copy.
		 * @returns the row element tree.
		 */
		function UpdateRow({ t, autoCheck }) {
			const [state, setState] = useState({ phase: "idle" });
			const check = (force) => async () => {
				setState({ phase: "checking" });
				try {
					const response = await fetch(UPDATE_CHECK_PATH + (force ? "?force=1" : ""), { method: "GET" });
					const payload = await response.json();
					setState({ phase: "done", payload });
				} catch {
					setState({ phase: "failed" });
				}
			};
			// A cached answer makes this free; only a cold Host reaches out.
			// `=== true` (not `!== false`), because during the loading frame
			// `undefined` must not be treated as permission to reach out.
			useEffect(() => {
				if (autoCheck !== true) return;
				check(false)();
			}, [autoCheck]);
			const payload = state.payload;
			const latest = payload?.latest === undefined ? undefined : formatVersion(payload.latest);
			// A payload without a readable current version is NOT "up to date":
			// that would turn "I could not read it" into a claim, and hide the
			// one state where reinstalling is the actual fix.
			const currentKnown = payload !== undefined && typeof payload.current === "string" && payload.current !== "";
			// Only an answer that actually came back can report a failure. A
			// forced re-check must not keep showing the previous failure while
			// the new request is in the air.
			const failed = state.phase === "failed" || (state.phase === "done" && payload?.ok === false);
			let status;
			if (state.phase === "checking") status = t("update.checking");
			else if (failed) status = t("update.failed");
			else if (payload === undefined) status = t("update.idle");
			else if (!currentKnown) status = t("update.currentUnknown");
			else if (payload.updateAvailable === true) status = `${t("update.available")} ${latest}`;
			else status = t("update.uptodate");
			const detail = currentKnown && !failed
				? `${t("update.current")} ${formatVersion(payload.current)} · ${status}`
				: status;
			// The install belongs to the package manager now: each line below
			// spells out the one route that applies here, and every one of them
			// pins the version. A release younger than pnpm's
			// `minimumReleaseAge` window is otherwise resolved back to the
			// previous one — which is exactly what "I upgraded but the version
			// did not move" looks like from the outside.
			// Two different reasons to send someone to the package manager, and
			// both need the steps spelled out:
			//
			//   - a newer version exists (`updateAvailable`);
			//   - the install is not registered (`unregistered`) — the state a
			//     self-updated tree is in: the files say 1.8.6, the lockfile
			//     still records 1.7.0, and the next plugin operation would roll
			//     it back. This is the one prompt that makes an in-app update
			//     permanent, so it must not point at steps that are not shown.
			const installTarget = installTargetVersion(payload, currentKnown);
			const lines = [];
			if (failed) {
				// The Host's own `error` is one fixed English sentence; this
				// line says what it means, without claiming a cause it cannot
				// know (an offline machine and a mirror returning HTML look
				// identical from here).
				lines.push(h("div", { className: css.hint, key: "why" }, t("update.failedDetail")));
			}
			if (payload?.unregistered === true) {
				lines.push(h("div", { className: css.hint, key: "unregistered" }, t("update.unregistered", {
					recorded: formatVersion(payload.recorded),
				})));
			}
			if (installTarget !== undefined && installTarget !== "") {
				const version = packageVersion(installTarget);
				let guidance;
				if (isDesktopShell()) {
					guidance = t("update.desktopGuidance", { version });
				} else if (typeof payload.profile === "string" && payload.profile !== "") {
					guidance = t("update.webGuidance", { profile: payload.profile, version });
				} else {
					// No profile name is known, so the command must not invent
					// one: `--profile web` pointed at a profile that does not
					// exist and failed for a reason that had nothing to do with
					// the install.
					guidance = t("update.webGuidancePlain", { version });
				}
				lines.push(h("div", { className: css.hint, key: "howto" }, guidance));
				// Its own line: the steps above are what to do, this is why the
				// version cannot be dropped — and a parcel of text this long
				// reads as one dense block when it is glued onto the steps.
				lines.push(h("div", { className: css.hint, key: "pinned" }, t("update.versionPinned")));
			}
			return h("div", { className: css.row }, [
				h("div", { key: "text" }, [
					h("div", { className: css.rowTitle, key: "title" }, t("update.title")),
					h("div", { className: css.rowDescription, key: "description" }, t("update.description")),
					h("div", { className: css.hint, key: "status" }, detail),
					...lines,
				]),
				h("div", { className: css.stackControl, key: "control" }, [
					h(Button, {
						key: "check",
						variant: "outline",
						size: "sm",
						disabled: state.phase === "checking",
						onClick: check(true),
					}, t("update.check")),
				]),
			]);
		}
		//#endregion

		//#region settings nav icon
		/**
		 * The settings shell draws its nav glyphs from a hardcoded id → icon map
		 * (`navIcon` in ui-settings-general); every id outside that map — ours,
		 * and General's — falls back to the same settings gear. The platform
		 * offers no registration point for a third-party section's glyph, so
		 * this package swaps its own cell's gear for the alarm-clock artwork
		 * from the very same primitive family (IconAlarmClockOutlineMedium's
		 * paths, 1.3px medium stroke) once the cell is in the DOM.
		 *
		 * The swap is cosmetic DOM surgery, deliberately narrow: it matches the
		 * one nav cell whose label is this section's, copies the original SVG's
		 * class so the shell's own sizing and color rules keep applying, and
		 * re-applies after the panel re-opens. React never re-renders an
		 * unchanged cell's children, so the replacement survives section
		 * switches and locale reloads; the observers only exist to catch the
		 * panel mounting fresh.
		 */
		/** Selector for the portaled settings panel the shell mounts into the body. */
		const SETTINGS_PANEL_SELECTOR = '[data-shortcut-modal="settings"]';

		/** Marker attribute distinguishing a swapped glyph from the shipped one. */
		const NAV_ICON_MARKER = "data-notify-sounds-icon";

		/** IconAlarmClockOutlineMedium artwork: six stroked paths in a 16×16 box. */
		const NAV_ICON_PATHS = [
			"M4.09372 11.9895L3.11865 14.0387",
			"M12.1392 11.9895L13.1143 14.0387",
			"M8.11646 4.78442V8.03442L10.6165 9.53442",
			"M8.11646 13.4094C11.154 13.4094 13.6165 10.947 13.6165 7.90942C13.6165 4.87186 11.154 2.40942 8.11646 2.40942C5.07889 2.40942 2.61646 4.87186 2.61646 7.90942C2.61646 10.947 5.07889 13.4094 8.11646 13.4094Z",
			"M1.75952 4.74323C2.30657 3.65639 3.12646 2.73047 4.12926 2.05542",
			"M14.3345 4.74323C13.7874 3.65639 12.9675 2.73047 11.9647 2.05542",
		];

		/**
		 * Build the replacement glyph with the shipped icon geometry: `fill=none`
		 * on the root (paths inherit it), `stroke=currentColor` so the shell's
		 * nav color rules keep driving it, and the medium 1.3px stroke.
		 *
		 * @returns a detached SVG element.
		 */
		function makeNavIconSvg() {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("width", "16");
			svg.setAttribute("height", "16");
			// 17×17, matching the artwork's own coordinate system
			// (`IconAlarmClockOutlineArtwork`); the gear it replaces is 16×16,
			// and reusing ITS viewport here would scale the alarm paths up by
			// 17/16 and make the glyph visibly larger than its neighbours.
			svg.setAttribute("viewBox", "0 0 17 17");
			svg.setAttribute("fill", "none");
			svg.setAttribute("stroke-width", "1.3");
			svg.setAttribute("aria-hidden", "true");
			for (const d of NAV_ICON_PATHS) {
				const path = document.createElementNS(svg.namespaceURI, "path");
				path.setAttribute("d", d);
				path.setAttribute("stroke", "currentColor");
				svg.appendChild(path);
			}
			return svg;
		}

		/**
		 * Swap the gear in one nav cell for the alarm glyph.
		 *
		 * A settings nav cell is a button whose two element children are the
		 * glyph SVG and the label span; SVG tag names stay lowercase in the DOM
		 * while HTML ones are uppercased, which is what the tag checks below
		 * rely on.
		 *
		 * @param cell - a button that may be this section's nav cell.
		 * @param label - this section's current nav label.
		 * @returns whether the cell was swapped.
		 */
		function swapNavIcon(cell, label) {
			const [icon, text] = cell.children;
			if (icon === undefined || text === undefined) return false;
			if (icon.tagName !== "svg" || text.tagName !== "SPAN") return false;
			if (text.textContent !== label) return false;
			if (icon.hasAttribute(NAV_ICON_MARKER)) return false;
			const replacement = makeNavIconSvg();
			const shippedClass = icon.getAttribute("class");
			if (shippedClass !== null && shippedClass !== "") replacement.setAttribute("class", shippedClass);
			replacement.setAttribute(NAV_ICON_MARKER, "");
			// Keep the original so the disposer can restore it. `replaceChild`
			// detaches a node React still holds in its fiber tree; if React
			// ever re-renders that slot it throws NotFoundError trying to
			// remove the detached node. Restoring on dispose prevents that.
			replacement._originalIcon = icon;
			try {
				cell.replaceChild(replacement, icon);
			} catch {
				// A React re-render raced the swap; the next observer pass
				// will try again on the fresh node.
				return false;
			}
			return true;
		}

		/**
		 * Watch for the settings panel and keep this section's nav glyph swapped.
		 *
		 * A body-level childList observer (no subtree — the panel is a direct
		 * body child, so this stays quiet while conversations stream) attaches a
		 * panel-scoped observer whenever the panel mounts, and detaches it when
		 * the panel goes away. The panel observer re-runs the scan so a nav
		 * list React re-created mid-session gets its glyph back.
		 *
		 * @param t - the locale seat, for the current nav label.
		 * @returns the disposer.
		 */
		function installNavIconPatch(t) {
			if (typeof document === "undefined" || document.body === null) return () => {};
			let panelObserver = null;
			let observedPanel = null;
			const scan = (root) => {
				// One panel-level probe before the walk. This observer fires on
				// every change anywhere in the settings tree — a conversation
				// streaming next to an open panel included — and once this
				// section's cell carries the glyph there is nothing left to do;
				// the per-cell checks below would only re-establish that.
				if (root.querySelector(`[${NAV_ICON_MARKER}]`) !== null) return;
				const label = t("nav");
				for (const cell of root.querySelectorAll("button")) swapNavIcon(cell, label);
			};
			const detachPanel = () => {
				if (panelObserver !== null) panelObserver.disconnect();
				panelObserver = null;
				observedPanel = null;
			};
			const attachPanel = (panel) => {
				observedPanel = panel;
				scan(panel);
				panelObserver = new MutationObserver(() => {
					scan(panel);
				});
				panelObserver.observe(panel, { childList: true, subtree: true });
			};
			const sync = () => {
				const panel = document.querySelector(SETTINGS_PANEL_SELECTOR);
				if (panel === observedPanel) return;
				detachPanel();
				if (panel !== null) attachPanel(panel);
			};
			const bodyObserver = new MutationObserver(sync);
			bodyObserver.observe(document.body, { childList: true });
			sync();
			return () => {
				detachPanel();
				bodyObserver.disconnect();
				// Restore every swapped glyph so React never finds a detached
				// node in its fiber tree (see swapNavIcon).
				if (typeof document !== "undefined") {
					for (const el of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) {
						const original = el._originalIcon;
						if (original !== undefined && el.parentNode !== null) {
							try {
								el.parentNode.replaceChild(original, el);
							} catch {}
						}
					}
				}
			};
		}
		//#endregion

		//#region plugin
		/** Settings namespace this package's Host entry serves. */
		const SETTINGS_NAMESPACE = "notify-sounds";

		/** Default loudness when no accepted value has arrived yet. */
		const DEFAULT_VOLUME = 60;

		/** Minimum spacing between two sounds of the same trigger, in ms. */
		const RETRIGGER_COOLDOWN_MS = 2000;

		/** How often the repeat reminder checks for unanswered decisions. */
		const RENOTIFY_CHECK_MS = 15000;

		/** Required services: the status facts, the session list (for classification), the settings forms, the slot registry, and copy. */
		const inject = ["uiSession", "sessions", "configForms", "slots", "locale"];

		/**
		 * Install the dictionaries, the session-status sound triggers, and the
		 * Settings section.
		 *
		 * @param ctx - the Client root context.
		 */
		function apply(ctx) {
			insertStyles();
			// One page per browser profile speaks (see createAlertLeader): a
			// sound and a toast belong to the machine, and a second tab of the
			// same GUI must not raise them a second time.
			const alertLeader = createAlertLeader();
			ctx.effect(() => alertLeader.dispose, "notify-sounds: alert leader");
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "notify-sounds: dictionaries");
			const t = ctx.locale.bind(NS);
			// The platform's own resolver for package text, which may be a plain
			// string or a `{ en, zh }` map. Interaction reasons are package text
			// owned by other packages, so they need this rather than our `t`.
			const resolvePackageText = (value) => {
				try {
					return ctx.locale.resolveText(value);
				} catch {
					return value;
				}
			};

			// The audio engine is page-scoped state; releasing it on teardown
			// (fiber restart or a hot-replaced bundle) closes the AudioContext
			// instead of stranding one audio thread per reload.
			ctx.effect(() => releaseAudioEngine, "notify-sounds: audio engine");

			const form = ctx.configForms.get(SETTINGS_NAMESPACE);

			/** The preset a trigger falls back to when its own sound cannot be played. */
			const fallbackPreset = (kind) => (kind === "completion" ? "ding" : kind === "question" ? "chime" : "bell");

			/** The stored file behind one of the user's sounds, or empty. */
			const soundFileOf = (value, id) => {
				if (!CUSTOM_SLOTS.includes(id)) return "";
				const raw = value?.[`${id}File`];
				return typeof raw === "string" ? raw : "";
			};

			/** The display name behind one of the user's sounds, or empty. */
			const soundNameOf = (value, id) => {
				if (!CUSTOM_SLOTS.includes(id)) return "";
				const raw = value?.[`${id}Name`];
				return typeof raw === "string" ? raw : "";
			};


			/**
			 * Play one trigger's alert: the user's own sound when it picked one,
			 * otherwise a preset.
			 *
			 * A picker pointing at a slot whose sound was deleted falls back to
			 * the trigger's default preset — deleting a recording must never
			 * silence an alert.
			 *
			 * @param kind - `decision`, `question` or `completion`.
			 * @param value - the config snapshot.
			 * @param volume - loudness in percent.
			 */
			const playAlert = (kind, value, volume) => {
				const fallback = fallbackPreset(kind);
				const id = typeof value?.[`${kind}Sound`] === "string" ? value[`${kind}Sound`] : fallback;
				if (id === "custom") {
					// 1.9.0's per-trigger reference, still reachable if the
					// migration could not run. Its file lives in the old field,
					// and its payload may still be the pre-1.9.0 inline base64.
					const suffix = kind.charAt(0).toUpperCase() + kind.slice(1);
					const file = typeof value?.[`custom${suffix}File`] === "string" ? value[`custom${suffix}File`] : "";
					const legacy = typeof value?.customSound === "string" ? value.customSound : "";
					if (file === "" && legacy === "") {
						playSound(fallback, volume);
						return;
					}
					const engine = audioEngine();
					if (engine === undefined) return;
					const token = previewToken;
					whenRunning(engine, () => {
						void playCustomSound(engine, file, legacy, volume, fallback, token);
					});
					return;
				}
				if (CUSTOM_SLOTS.includes(id)) {
					const file = soundFileOf(value, id);
					if (file === "") {
						playSound(fallback, volume);
						return;
					}
					const engine = audioEngine();
					if (engine === undefined) return;
					const token = previewToken;
					whenRunning(engine, () => {
						void playCustomSound(engine, file, "", volume, fallback, token);
					});
					return;
				}
				playSound(id, volume);
			};

			/**
			 * Preview one of the user's sounds.
			 *
			 * @param id - a slot id.
			 * @param volume - loudness in percent.
			 */
			const previewSound = (id, volume) => {
				const engine = audioEngine();
				if (engine === undefined) return;
				const value = form.getSnapshot()?.value;
				stopPreview();
				const token = previewToken;
				whenRunning(engine, () => {
					void playCustomSound(engine, soundFileOf(value, id), "", volume, fallbackPreset("decision"), token);
				});
			};

			/**
			 * Write one field and refuse to pretend it worked.
			 *
			 * `form.set` resolves `false` when the Host declines a write — an
			 * unknown field, a value the schema rejects, a busy document. Every
			 * migration step below decides what to clear NEXT based on what was
			 * stored, so a silently-refused write would clear the old copy and
			 * lose the sound.
			 *
			 * @param field - the config field.
			 * @param value - the value to store.
			 */
			const persist = async (field, value) => {
				const accepted = await form.set(field, value);
				if (accepted !== true) throw new Error(`refused: ${field}`);
			};

			/** Store one uploaded sound and answer the name the config should keep. */
			const storeSound = async (bytes) => {
				const response = await fetch(SOUND_ROUTE, { method: "POST", body: bytes });
				if (!response.ok) throw new Error(`sound upload ${response.status}`);
				const payload = await response.json();
				const file = typeof payload?.file === "string" ? payload.file : "";
				if (file === "") throw new Error("sound upload returned no file");
				return file;
			};

			/**
			 * Add one of the user's sounds to the first empty slot.
			 *
			 * @param bytes - the chosen audio.
			 * @param name - the name it should be listed under.
			 * @returns the slot it landed in.
			 */
			const addSound = async (bytes, name) => {
				const value = form.getSnapshot()?.value;
				const slot = CUSTOM_SLOTS.find((candidate) => soundFileOf(value, candidate) === "");
				if (slot === undefined) throw new Error("sound library is full");
				const file = await storeSound(bytes);
				await persist(`${slot}File`, file);
				try {
					await persist(`${slot}Name`, name);
				} catch (error) {
					// One sound is one record: a half-written slot would show a
					// recording with no name and no way to remove it.
					await form.set(`${slot}File`, "").catch(() => {});
					throw error;
				}
				return slot;
			};


			/**
			 * Remove one of the user's sounds: clear its slot, move every trigger
			 * that used it back to its preset, and delete the file once nothing
			 * references it.
			 *
			 * @param slot - the slot to clear.
			 */
			const removeSound = async (slot) => {
				const value = form.getSnapshot()?.value;
				const file = soundFileOf(value, slot);
				await persist(`${slot}File`, "");
				try {
					await persist(`${slot}Name`, "");
				} catch (error) {
					await form.set(`${slot}File`, file).catch(() => {});
					throw error;
				}
				for (const kind of ["decision", "question", "completion"]) {
					if (value?.[`${kind}Sound`] === slot) await persist(`${kind}Sound`, fallbackPreset(kind));
				}
				if (file !== "") void forgetSound(file, slot);
			};

			/**
			 * Delete one stored file, unless another slot still points at it.
			 *
			 * The same audio added twice is ONE file (the name is its digest),
			 * so a naive delete on the first removal would break the second slot.
			 *
			 * @param file - the stored name.
			 * @param exceptSlot - the slot already cleared, ignored in the check.
			 */
			const forgetSound = async (file, exceptSlot) => {
				const value = form.getSnapshot()?.value;
				const stillUsed = CUSTOM_SLOTS.some((slot) => slot !== exceptSlot && soundFileOf(value, slot) === file);
				if (stillUsed) return;
				soundCache.delete(file);
				try {
					await fetch(`${SOUND_ROUTE}?file=${encodeURIComponent(file)}`, { method: "DELETE" });
				} catch {
					// A file left behind is small and invisible; a failed cleanup
					// must not surface as an error on the row.
				}
			};

			/**
			 * Bring sounds from an older release into the library.
			 *
			 * Two sources have to survive this:
			 *
			 *   - the pre-1.9.0 inline payload, which is the only copy of the
			 *     sound such an install has;
			 *   - 1.9.0's per-trigger file, written by the release this one
			 *     replaces.
			 *
			 * Both are moved only after the store accepted the bytes, and the
			 * old fields are cleared only after the new ones landed. A failure
			 * leaves everything as it was; playback keeps working from the old
			 * fields.
			 */
			const migrateSounds = async () => {
				const value = form.getSnapshot()?.value;
				if (value === undefined || value === null) return;

				// The library is authoritative once it has anything in it: a
				// later run must not duplicate what an earlier one wrote.
				const library = CUSTOM_SLOTS.map((slot) => ({ slot, file: soundFileOf(value, slot), name: soundNameOf(value, slot) }));
				const freeSlot = () => library.find((entry) => entry.file === "");

				const adopt = async (file, name) => {
					const existing = library.find((entry) => entry.file === file);
					if (existing !== undefined) return existing.slot;
					const slot = freeSlot();
					if (slot === undefined) return undefined;
					try {
						await persist(`${slot.slot}File`, file);
						await persist(`${slot.slot}Name`, name);
					} catch {
						return undefined;
					}
					slot.file = file;
					slot.name = name;
					return slot.slot;
				};

				// 1.9.0 per-trigger references. One trigger failing must not
				// abandon the other two, and must not escape as an unhandled
				// rejection: the effect that calls this is fire-and-forget.
				for (const [kind, suffix] of [["decision", "Decision"], ["question", "Question"], ["completion", "Completion"]]) {
					try {
						const file = value?.[`custom${suffix}File`];
						if (typeof file !== "string" || file === "") continue;
						const slot = await adopt(file, typeof value?.[`custom${suffix}Name`] === "string" ? value[`custom${suffix}Name`] : "");
						if (slot === undefined) continue;
						if (value?.[`${kind}Sound`] === "custom") await persist(`${kind}Sound`, slot);
						await persist(`custom${suffix}File`, "");
						await persist(`custom${suffix}Name`, "");
					} catch {
						// This trigger keeps its old reference; the next launch
						// tries again.
					}
				}

				// The pre-1.9.0 inline payload.
				const legacy = typeof value?.customSound === "string" ? value.customSound : "";
				if (legacy === "") return;
				const bytes = base64ToBytes(legacy);
				if (bytes === undefined) return;
				try {
					const file = await storeSound(bytes);
					const slot = await adopt(file, typeof value?.customSoundName === "string" ? value.customSoundName : "");
					if (slot === undefined) return;
					for (const kind of ["decision", "question", "completion"]) {
						if (value?.[`${kind}Sound`] === "custom") await persist(`${kind}Sound`, slot);
					}
					await persist("customSound", "");
					await persist("customSoundName", "");
				} catch {
					// Keep the payload; the next launch tries again.
				}
			};

			ctx.effect(() => {
				let running = false;
				const attempt = () => {
					if (running) return;
					const value = form.getSnapshot()?.value;
					if (value === undefined || value === null) return;
					const hasInline = typeof value.customSound === "string" && value.customSound !== "";
					const hasPerTrigger = ["Decision", "Question", "Completion"].some((suffix) => typeof value[`custom${suffix}File`] === "string" && value[`custom${suffix}File`] !== "");
					if (!hasInline && !hasPerTrigger) return;
					running = true;
					void migrateSounds()
						.catch(() => {})
						.finally(() => {
							running = false;
						});
				};
				const unsubscribe = form.subscribe(attempt);
				attempt();
				return unsubscribe;
			}, "notify-sounds: legacy sound migration");

			/**
			 * Last playback time per trigger and session, for the retrigger
			 * cooldown.
			 *
			 * Keyed per session as well as per kind: two conversations asking
			 * for a decision within the same two seconds are two events worth
			 * hearing, and one shared per-kind clock silenced the second one —
			 * edge-fired triggers are lost, not delayed. Bounded, because a
			 * long-lived page would otherwise keep one entry per session it
			 * has ever seen; a clear can only ever widen the window by one
			 * cooldown for a few keys.
			 */
			const cooldown = new Map();

			/**
			 * One snapshot of the session list rows, or `undefined` when this
			 * runtime exposes none.
			 *
			 * The status facts carry no classification at all — an entry is
			 * only `{ running, pendingInteraction, completionUnread }` — so
			 * "is this a conversation the agent spawned?" has to come from the
			 * session list, whose rows carry the same `origin`/`parentId` the
			 * sidebar uses to keep sub-agents out of the ordinary list.
			 *
			 * Callers read ONCE per pass and hand the result down: the previous
			 * shape called this per session inside the loops below, so a status
			 * update covering ten sessions took ten snapshots, and the pass
			 * scope was implied by "the same millisecond" rather than stated.
			 *
			 * @returns the `byId` row map, or undefined when unavailable.
			 */
			const readSessionRows = () => {
				try {
					return ctx.sessions?.list?.getSnapshot?.()?.byId
						?? ctx.uiSession?.sessions?.list?.getSnapshot?.()?.byId;
				} catch {
					return undefined;
				}
			};

			/**
			 * Whether one session is a conversation the AGENT spawned — a
			 * sub-agent, a teammate — rather than one of the user's own.
			 *
			 * @param sessionId - the session to classify.
			 * @param rows - the pass's session rows, when the runtime has them.
			 * @returns whether it is a spawned child session.
			 */
			const isSubagentSession = (sessionId, rows) => {
				const row = rows?.[sessionId];
				// Deliberately ONLY `origin`, the same test the sidebar and the
				// sub-agent UI use. `parentId` alone is not enough: a forked
				// conversation carries one too and is still the user's own.
				return row?.origin === "subagent";
			};

			/**
			 * Whether a session's events reach the user at all.
			 *
			 * With `subagentAlerts` off — the default — a spawned session is
			 * invisible to this package: no sound, no system notification, no
			 * title mark, no repeat reminder. The point of the plugin is the
			 * user's own conversation, and a background sub-agent finishing is
			 * not something they want a chime for.
			 *
			 * @param sessionId - the session to test.
			 * @param rows - the pass's session rows, when the runtime has them.
			 * @returns whether its events should alert.
			 */
			const isNotifiable = (sessionId, rows) => {
				const value = form.getSnapshot().value;
				if (value?.subagentAlerts === true) return true;
				return !isSubagentSession(sessionId, rows);
			};

			/**
			 * Fire one trigger under the live preference values: the sound,
			 * plus the optional system notification while the page is hidden.
			 *
			 * @param kind - `decision`, `question`, or `completion`.
			 * @param interaction - the pending interaction, for the
			 *   notification body.
			 * @param sessionId - the session the trigger belongs to. The
			 *   retrigger cooldown is keyed per session, so one
			 *   conversation's alert does not consume another's.
			 * @param options - `reminder` marks a repeat ping, which keeps its
			 *   own cadence and must not consume the retrigger cooldown: doing
			 *   so opened a two-second window in which a genuinely new decision
			 *   went silent (measured), for every pending decision, every
			 *   interval.
			 * @returns whether the trigger actually fired, so a suppressed
			 *   reminder is not recorded as sent.
			 */
			const notify = (kind, interaction, sessionId, options = {}) => {
				// The elected page is the only one that makes a noise or raises
				// a notification; every page still keeps its own title mark,
				// because a title belongs to its own window.
				if (!alertLeader.isLeader()) return false;
				const value = form.getSnapshot().value;
				if (value?.enabled === false) return false;
				if (value?.quietHours === true && inQuietHours(new Date(), value?.quietStart, value?.quietEnd)) return false;
				if (value?.onlyWhenHidden === true && typeof document !== "undefined" && document.visibilityState === "visible") return false;
				const reminder = options.reminder === true;
				const now = Date.now();
				// `Date.now()` is not monotonic: a clock correction backwards
				// would otherwise make this difference negative and mute every
				// trigger for the length of the jump.
				const last = cooldown.get(`${kind}:${sessionId}`) ?? 0;
				const elapsed = now - last;
				if (!reminder && elapsed >= 0 && elapsed < RETRIGGER_COOLDOWN_MS) return false;
				// A reminder keeps its own cadence and must not claim the
				// cooldown: writing it would silence a genuinely new decision
				// from the same session for the next two seconds, and because
				// triggers are edge-fired that alert is lost rather than
				// delayed.
				if (!reminder) {
					// Evict the oldest entry rather than clearing the whole
					// table: one session hitting the cap must not silence
					// every other session's cooldown.
					//
					// LRU, not FIFO: `Map.set` on a key that is already there
					// updates the value and KEEPS the original position, so
					// plain eviction would throw away whichever entry is
					// touched most often — precisely the session whose
					// two-second dedupe is doing work. Deleting first moves it
					// to the back on re-insertion.
					const key = `${kind}:${sessionId}`;
					if (cooldown.has(key)) cooldown.delete(key);
					else if (cooldown.size >= 96) cooldown.delete(cooldown.keys().next().value);
					cooldown.set(key, now);
				}
				const volume = Number.isFinite(value?.volume) ? value.volume : DEFAULT_VOLUME;
				// One entry point for "which sound": the trigger's own file,
				// the legacy inline payload, or the preset its picker names.
				playAlert(kind, value, volume);
				if (value?.systemNotify === true && typeof document !== "undefined" && document.visibilityState !== "visible") {
					if (kind === "completion") {
						showSystemNotification(t("notify.completion.title"), t("notify.completion.body"), "dsh-notify-sounds:completion");
					} else {
						const body = interactionSummary(interaction, resolvePackageText) ?? t("notify.decision.body");
						showSystemNotification(t("notify.decision.title"), body, "dsh-notify-sounds:decision");
					}
				}
				return true;
			};

			// The sound triggers: diff consecutive sessionStatus snapshots the
			// way the shipped status dots derive their facts. The first read
			// only establishes the baseline, so a page that opens over an
			// already-running session stays silent until a real transition.
			// The same read maintains the pending-decision tracker that feeds
			// the repeat reminder and the title-bar flash.
			ctx.effect(() => {
				const source = ctx.uiSession.sessionStatus;
				let previous;
				/** Unanswered decisions: sessionId → { interaction, kind, since, lastPing, seen }. */
				const pending = new Map();
				/**
				 * Whether a task finished while the page was hidden and has
				 * not been seen since.
				 *
				 * The "done" title mark is unread NEWS, not a standing
				 * "idle + hidden" fact: derived state would re-mark the title
				 * on every later switch-away for a finish the user already
				 * knows about. Like a pending decision, a finish is news only
				 * until the user has been back at the page once.
				 */
				let unreadCompletion = false;
				/** Whether the title-bar flash should show right now. */
				const titleFlashActive = () => {
					const value = form.getSnapshot().value;
					// The master switch stops every alert, and this is one: the
					// row's own copy says so, so the flash honours it too.
					return value?.enabled !== false
						&& value?.titleFlash === true
						&& !(value?.quietHours === true && inQuietHours(new Date(), value?.quietStart, value?.quietEnd))
						&& typeof document !== "undefined"
						&& document.visibilityState !== "visible";
				};
				/** Whether quiet hours are in effect at this moment. */
				const quietNow = () => {
					const value = form.getSnapshot().value;
					return value?.quietHours === true && inQuietHours(new Date(), value?.quietStart, value?.quietEnd);
				};
				/** Whether any session is currently running. */
				const anyRunning = (rows) => {
					for (const [sessionId, status] of source.getSnapshot()) {
						if (status.running === true && isNotifiable(sessionId, rows)) return true;
					}
					return false;
				};
				/** How often an active goal's phase is re-read while waiting for its end. */
				const GOAL_POLL_MS = 2000;
				/** Longest a goal may stay `active` before its watcher gives up. */
				const GOAL_SETTLE_TIMEOUT_MS = 30 * 60 * 1000;
				/** A single phase read gives up rather than parking the watcher for good. */
				const GOAL_FETCH_TIMEOUT_MS = 5000;
				/**
				 * One goal phase from the Host, or undefined when it cannot be read.
				 *
				 * The Host owns the durable projection; this page's own store only
				 * carries sessions it has opened, and a completion edge can belong to a
				 * session this page never opened. Undefined keeps the old behaviour
				 * (alert) for any runtime that does not answer the route — and for a
				 * read that timed out, which is the same "cannot know, so speak" case.
				 */
				const readGoalPhase = async (sessionId) => {
					try {
						const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
							? AbortSignal.timeout(GOAL_FETCH_TIMEOUT_MS)
							: undefined;
						const response = await fetch(GOAL_PHASE_PATH + "?session=" + encodeURIComponent(sessionId), { method: "GET", signal });
						if (!response.ok) return undefined;
						const payload = await response.json();
						return typeof payload?.phase === "string" ? payload.phase : undefined;
					} catch {
						return undefined;
					}
				};
				/** Deliver the completion alert this edge earns. */
				const alertCompletion = (sessionId) => {
					if (!pageIsWatched() && !quietNow()) unreadCompletion = true;
					notify("completion", undefined, sessionId);
					refreshFlash();
				};
				/** Sessions whose completion alert is waiting for their goal to end. */
				const goalWatchers = new Map();
				/**
				 * Resolve a running→idle edge against the goal projection.
				 *
				 * A goal drives several rounds and every round ends with this edge; with
				 * `goalFinalOnly` on, the edge is only an alert when the goal will not
				 * continue: no goal, completed, paused or blocked. A goal still `active`
				 * gets one watcher that re-reads the phase until it ends (the single
				 * chime) or the session starts running again (silent intermediate round).
				 */
				const handleCompletion = (sessionId, value) => {
					if (value?.goalFinalOnly !== true) {
						alertCompletion(sessionId);
						return;
					}
					if (goalWatchers.has(sessionId)) return;
					let settled = false;
					let pollTimer;
					let deadline;
					const finish = (chime) => {
						if (settled) return;
						settled = true;
						goalWatchers.delete(sessionId);
						clearTimeout(pollTimer);
						clearTimeout(deadline);
						// The decision to wait was taken at the edge, but the wait
						// can last half an hour — long enough for the user to turn
						// the switch OFF precisely because they did not want this
						// chime. Re-read it here: a preference that was honoured
						// when it arrived must not be ignored when it leaves.
						const stillWanted = form.getSnapshot().value?.goalFinalOnly === true;
						if (chime && stillWanted) alertCompletion(sessionId);
					};
					goalWatchers.set(sessionId, () => finish(false));
					const poll = async () => {
						if (source.getSnapshot().get(sessionId)?.running === true) {
							finish(false);
							return;
						}
						const phase = await readGoalPhase(sessionId);
						if (settled) return;
						if (phase !== "active") {
							finish(true);
							return;
						}
						pollTimer = setTimeout(poll, GOAL_POLL_MS);
					};
					deadline = setTimeout(() => finish(true), GOAL_SETTLE_TIMEOUT_MS);
					deadline?.unref?.();
					void poll();
				};
				/**
				 * Which alert the title should carry, if any.
				 *
				 * Waiting for the user outranks finished: one needs an answer,
				 * the other is news. Both only while the page is hidden — a
				 * window you are looking at needs no mark in its title. And
				 * "finished" is unread news (see `unreadCompletion`), not a
				 * standing idle fact, so it does not reappear for a finish
				 * the user has already seen.
				 */
				const wantedTitleState = () => {
					if (!titleFlashActive()) return undefined;
					for (const record of pending.values()) {
						// A decision that arrived during quiet hours is
						// forgotten, not queued: no mark shows up for it when
						// the quiet window ends.
						if (record.quiet !== true) return "pending";
					}
					if (anyRunning(readSessionRows())) return undefined;
					return unreadCompletion ? "done" : undefined;
				};
				/** Refresh the title alert from the current facts. */
				const refreshFlash = () => {
					// Resolved per call: the bound translator reads the active
					// language each time, so a locale switch is picked up.
					applyTitleFlash(wantedTitleState(), titleAlerts(t));
				};
				/** Rebuild the tracker from one snapshot, then refresh the flash. */
				const trackPending = (snapshot, rows) => {
					const next = new Map();
					for (const [sessionId, status] of snapshot) {
						// A filtered session is invisible to the whole package:
						// it gets no reminder and no title mark either.
						if (!isNotifiable(sessionId, rows)) continue;
						const interaction = status.pendingInteraction;
						if (interaction === undefined) continue;
						const record = pending.get(sessionId);
						next.set(sessionId, record !== undefined && record.interaction === interaction ? record : {
							interaction,
							kind: interaction.kind === "question" ? "question" : "decision",
							since: Date.now(),
							lastPing: 0,
							// Seen or not from the moment it appears: a decision
							// that shows up while the user is at the window has
							// already been SEEN, and a seen decision never gets
							// a repeat reminder (see the reminder timer).
							seen: pageIsWatched(),
							// Quiet hours mean the event is forgotten, not
							// queued: a decision that appears during them gets
							// no reminder and no title mark, and nothing about
							// it is delivered when the quiet window ends.
							quiet: quietNow(),
						});
					}
					pending.clear();
					for (const [key, record] of next) pending.set(key, record);
					refreshFlash();
				};
				const read = () => {
					const snapshot = source.getSnapshot();
					// One row snapshot for this whole pass, handed to every
					// check below instead of being taken per session.
					const rows = readSessionRows();
					if (previous !== undefined) {
						for (const [sessionId, status] of snapshot) {
							// Sub-agent sessions stay out of it unless asked for:
							// the user wants the main conversation's alerts.
							if (!isNotifiable(sessionId, rows)) continue;
							const before = previous.get(sessionId);
							const beforePending = before === undefined ? undefined : before.pendingInteraction;
							if (status.pendingInteraction !== undefined && status.pendingInteraction !== beforePending) {
								// Every interaction but a question takes the
								// decision trigger. Measured kinds: `question`
								// (ask_user_question) and `approval` (a tool
								// approval, carrying toolName/reason/
								// displayReason/result). Anything DSH adds later
								// lands in the same bucket rather than going
								// silent, which is the safe default for a
								// notification that exists to get attention.
								notify(status.pendingInteraction.kind === "question" ? "question" : "decision", status.pendingInteraction, sessionId);
							}
							if (before !== undefined && before.running === true && status.running === false) {
								handleCompletion(sessionId, form.getSnapshot().value);
							}
						}
					}
					previous = snapshot;
					trackPending(snapshot, rows);
				};
				// Returning to the page clears the alert even while the
				// decision stays pending — and marks every pending decision
				// SEEN: the user has now seen them, so none of them is ever
				// repeat-pinged again, not even after switching away again.
				const onVisibility = () => {
					if (pageIsWatched()) {
						for (const record of pending.values()) record.seen = true;
						// Returning also retires an unread finish: the user
						// has now seen the outcome, and the mark must not come
						// back on every later switch-away.
						unreadCompletion = false;
					}
					refreshFlash();
				};
				// The alert is the one trigger whose input is a preference as
				// well as a session fact, and this effect does not re-run when
				// the form changes: without this subscription, turning the
				// toggle on with a decision already pending would not mark the
				// title until the next session event or window switch.
				const unsubscribeForm = form.subscribe(refreshFlash);
				// A locale switch changes the words in the title, so re-apply.
				const unsubscribeLocale = ctx.locale.subscribe(refreshFlash);
				if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
				// The repeat reminder: re-ping an unanswered decision one
				// interval after it appeared, and again per interval after that.
				//
				// A decision the user has SEEN is done with. Once they have been
				// at the window with it pending — it appeared while they were
				// watching, or they came back to it — it never repeats again,
				// not even after they switch away again. Re-arming the countdown
				// on every return is what made the reminder ring a whole
				// interval after the user had already read it: a reminder only
				// exists to reach someone who has not seen the decision at all.
				// So only unseen decisions — ones that appeared while the window
				// was elsewhere and the user never came back — are pinged, on
				// their own cadence, while the page stays hidden.
				const renotifyTimer = setInterval(() => {
					// Quiet hours are time-based; refresh the title at the same
					// cadence so its alert appears or clears when the range changes.
					refreshFlash();
					const value = form.getSnapshot().value;
					if (value?.renotify !== true || pending.size === 0) return;
					const minutes = renotifyInterval(value?.renotifyMinutes);
					const intervalMs = minutes * 60000;
					const now = Date.now();
					const watching = pageIsWatched();
					for (const [sessionId, record] of pending) {
						// Seen once, done forever: leaving again does not
						// re-arm this decision for another round. A decision
						// from quiet hours is done too — it was forgotten.
						if (record.seen || record.quiet === true) continue;
						if (watching) {
							// Watched right now counts as seen as well (the
							// visibility event normally records it first), and a
							// seen decision leaves this loop for good.
							record.seen = true;
							continue;
						}
						const last = record.lastPing !== 0 ? record.lastPing : record.since;
						if (now - last >= intervalMs) {
							// A reminder that cannot fire right now is dropped,
							// not queued: quiet hours must not end with a burst
							// of everything that was missed overnight. The
							// cadence simply continues afterwards.
							notify(record.kind, record.interaction, sessionId, { reminder: true });
							record.lastPing = now;
						}
					}
				}, RENOTIFY_CHECK_MS);
				const unsubscribe = source.subscribe(() => {
					read();
				});
				read();
				return () => {
					unsubscribe();
					unsubscribeForm();
					unsubscribeLocale();
					clearInterval(renotifyTimer);
					for (const stop of [...goalWatchers.values()]) stop();
					if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
					applyTitleFlash(undefined, titleAlerts(t));
				};
			}, "notify-sounds: session status watcher");

			// Browsers gate Web Audio behind a user gesture: until one happens
			// the context starts suspended and `resume()` simply stays pending,
			// so a trigger firing in the meantime would be lost — and worse,
			// anything scheduled on the frozen timeline would all fire at once
			// whenever some later gesture unlocked it. So the FIRST real
			// gesture starts the context and keeps it running, and nothing is
			// scheduled while suspended (see `whenRunning`). The Desktop shell
			// needs none of this — Electron starts audio without a gesture,
			// which is exactly why the problem is invisible on the Desktop.
			ctx.effect(() => {
				if (typeof document === "undefined") return () => {};
				const unlock = () => {
					const engine = audioEngine();
					if (engine?.state === "suspended") engine.resume().catch(() => {});
				};
				const events = ["pointerdown", "keydown", "touchstart"];
				for (const type of events) document.addEventListener(type, unlock, { capture: true, passive: true });
				return () => {
					for (const type of events) document.removeEventListener(type, unlock, { capture: true });
				};
			}, "notify-sounds: audio unlock");

			// Quiet update check: shortly after the page settles, then at most
			// once a day, and never while the user has it turned off. It asks
			// the Host's own route — one small query, nothing downloaded — and
			// the answer is waiting in the settings row whenever the user looks.
			//
			// A self-rescheduling timeout rather than an interval: the next
			// check is scheduled after this one, so a suspended machine does not
			// come back to a queue of them. `unref` keeps a test process from
			// waiting on the next tick.
			ctx.effect(() => {
				let timer;
				const tick = () => {
					try {
						if (form.getSnapshot().value?.updateAutoCheck !== false) {
							fetch(UPDATE_CHECK_PATH, { method: "GET" }).catch(() => {});
						}
					} catch {}
					// Rescheduled unconditionally, and that is the fix rather
					// than a detail: returning early here — which is what the
					// chain used to do when the preference was off — ended the
					// self-scheduling for good. Turning the switch off once, or
					// simply loading the page with it off, meant no check ever
					// ran again until a full reload, while the row went on
					// promising "at most one check a day".
					timer = setTimeout(tick, 24 * 60 * 60 * 1000);
					timer.unref?.();
				};
				timer = setTimeout(tick, 30 * 1000);
				timer.unref?.();
				return () => {
					clearTimeout(timer);
				};
			}, "notify-sounds: update check");

			// The Settings section: registered only while the Host serves this
			// package's namespace, so a deployment without the entry shows no
			// trace of the page. The nav glyph patch shares the gate — no
			// served section, no nav cell to patch.
			ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NAMESPACE], () => {
				const disposeSection = ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: SETTINGS_NAMESPACE,
					// 5 places the page between General (0) and Models (10).
					order: 5,
					label: () => t("nav"),
					locale: NS,
					inject: () => ({
						hooks: { config: form },
						setField: (field, value) => form.set(field, value),
						preview: (id, volume) => {
							stopPreview();
							playSound(id, volume);
						},
						previewSound: (id, volume) => previewSound(id, volume),
						onAddSound: (bytes, name) => addSound(bytes, name),
						onRemoveSound: (slot) => removeSound(slot),
					}),
				}, NotifySoundsSection));
				const disposeNavIcon = installNavIconPatch(t);
				return () => {
					disposeNavIcon();
					disposeSection();
				};
			}), "notify-sounds: settings section");
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		// Shared contracts with the Host half, exported so the tests can
		// cross-check the two spellings against each other (test/host.mjs):
		// the preset id list behind the Config union, the three routes this
		// half calls, and the time parser every quiet-hours value must survive.
		exports.SOUND_IDS = SOUND_IDS;
		exports.FOCUS_PATH = FOCUS_PATH;
		exports.UPDATE_CHECK_PATH = UPDATE_CHECK_PATH;
		exports.GOAL_PHASE_PATH = GOAL_PHASE_PATH;
		exports.SOUND_PATH = SOUND_ROUTE;
		exports.SOUND_MAX_BYTES = SOUND_MAX_BYTES;
		exports.PRESET_LEVEL = PRESET_LEVEL;
		exports.SOUND_PRESETS = SOUND_PRESETS;
		// The alert election, so the tests can drive two pages against a stubbed
		// storage and channel instead of hoping two real tabs cooperate.
		exports.createAlertLeader = createAlertLeader;
		// The peak scan, so a test can build the one buffer that tells a full
		// scan apart from a strided one.
		exports.normalizedGain = normalizedGain;
		exports.timeOfDayToMinutes = timeOfDayToMinutes;
		// The interval the row shows and the timer keeps, so a test can prove
		// the two agree instead of reading the same number twice.
		exports.renotifyInterval = renotifyInterval;
		// Which version an install instruction names, so the "make this update
		// permanent" case cannot silently become a dead end again.
		exports.installTargetVersion = installTargetVersion;
		return module.exports;
	},
});
