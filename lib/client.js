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
 *   - a notification-sound engine over the Web Audio API: six synthesized
 *     presets (no audio assets, nothing to download) plus `none`;
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
			".dsh-notify-sounds-customName{color:var(--dsw-alias-label-secondary);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px}",
			".dsh-notify-sounds-time{color:var(--dsw-alias-label-primary);background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;font-size:12px;line-height:18px;height:28px;padding:0 8px;font-variant-numeric:tabular-nums;outline:none;cursor:pointer}",
			".dsh-notify-sounds-time:focus-visible{border-color:var(--dsw-alias-brand-primary)}",
			".dsh-notify-sounds-time:disabled{cursor:default;opacity:.5}",
			".dsh-notify-sounds-quietRange{align-items:center;gap:8px;display:flex}",
			".dsh-notify-sounds-quietDash{color:var(--dsw-alias-label-tertiary)}",
			".dsh-notify-sounds-hint{color:var(--dsw-alias-label-tertiary);margin-top:4px;font-size:12px;line-height:18px}",
		].join("");
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
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(STYLE_TAG_ID) + "]") !== null) return;
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
			"enabled.title": "启用提示音",
			"enabled.description": "关闭后所有提示音静音",
			"volume.title": "音量",
			"volume.description": "调整提示音的播放音量",
			"decision.title": "需要审批时",
			"decision.description": "智能体发起审批或计划确认时播放",
			"question.title": "收到提问时",
			"question.description": "智能体向你提问时播放",
			"completion.title": "任务完成时",
			"completion.description": "会话由运行转为空闲时播放",
			"onlyWhenHidden.title": "仅在页面不可见时提示",
			"onlyWhenHidden.description": "切到其他窗口或标签页时才播放，专注当前页面时不打扰",
			"custom.title": "自定义音效",
			"custom.description": "上传一段音频（不超过 512KB），即可在上方音效中选择「自定义」",
			"custom.choose": "选择文件",
			"custom.remove": "移除",
			"custom.tooLarge": "文件超过 512KB，请压缩后重试",
			"custom.undecodable": "无法解码该音频文件",
			"systemNotify.title": "系统通知",
			"systemNotify.description": "页面处于后台时弹出系统通知，点击可回到窗口",
			"systemNotify.granted": "已授权系统通知",
			"systemNotify.denied": "通知权限被拒绝，请在浏览器或系统设置中允许后重试",
			"systemNotify.unsupported": "当前环境不支持系统通知",
			"titleFlash.title": "窗口标题提醒",
			"titleFlash.description": "页面处于后台且有等待处理的决策时，在窗口标题前加铃铛标记，便于在任务栏察觉；回到页面后自动清除",
			"renotify.title": "未处理决策重复提醒",
			"renotify.description": "有决策一直未处理时，每隔设定时间重新提醒，直到处理完成",
			"renotify.interval": "重复间隔",
			"renotify.minutes": "{n} 分钟",
			"quiet.title": "静音时段",
			"quiet.description": "每天此时间段内不发出任何提醒（可跨午夜，如 22:00 至次日 08:00）",
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
		};

		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"nav": "Sounds",
			"title": "Notification sounds",
			"intro": "Get your attention when the agent needs a decision (approvals, questions) or finishes a task: sounds, optional system notifications, and repeat reminders.",
			"enabled.title": "Enable sounds",
			"enabled.description": "Turn off to mute every notification sound",
			"volume.title": "Volume",
			"volume.description": "Playback loudness of the notification sounds",
			"decision.title": "Approval needed",
			"decision.description": "Played when the agent raises an approval or plan review",
			"question.title": "Question asked",
			"question.description": "Played when the agent asks you a question",
			"completion.title": "Task finished",
			"completion.description": "Played when a session goes from running to idle",
			"onlyWhenHidden.title": "Only when the page is hidden",
			"onlyWhenHidden.description": "Play only while another window or tab is focused, so an active page stays quiet",
			"custom.title": "Custom sound",
			"custom.description": "Upload an audio file (up to 512KB) to pick it as the \"Custom\" option above",
			"custom.choose": "Choose file",
			"custom.remove": "Remove",
			"custom.tooLarge": "File exceeds 512KB; please compress it and retry",
			"custom.undecodable": "Could not decode this audio file",
			"systemNotify.title": "System notifications",
			"systemNotify.description": "Show an OS notification while the page is hidden; click it to focus the window",
			"systemNotify.granted": "Notification permission granted",
			"systemNotify.denied": "Denied — allow notifications in the browser or system settings and retry",
			"systemNotify.unsupported": "System notifications are unavailable in this environment",
			"titleFlash.title": "Window title alert",
			"titleFlash.description": "While the page is hidden and a decision is pending, mark the window title with a bell so the taskbar shows it; cleared when you return",
			"renotify.title": "Repeat unanswered decisions",
			"renotify.description": "Re-ping decisions that stay unanswered at a fixed interval, until handled",
			"renotify.interval": "Interval",
			"renotify.minutes": "{n} min",
			"quiet.title": "Quiet hours",
			"quiet.description": "No alerts during this daily time range (may wrap past midnight, e.g. 22:00 to 08:00)",
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
		};
		//#endregion

		//#region sounds
		/** Sound ids in display order; must match the Host half's Config union. */
		const SOUND_IDS = ["bell", "chime", "ding", "drop", "pulse", "arc", "coin", "success", "knock", "custom", "none"];

		/** Largest accepted custom-sound upload, in bytes. */
		const CUSTOM_SOUND_MAX_BYTES = 512 * 1024;

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

		/** Decoded custom-sound cache: `{ source, buffer, normGain }` keyed by the base64 payload. */
		let customSoundCache;

		/**
		 * Decode one uploaded sound and cache it, then play it at a loudness in
		 * percent. The first play of a new upload is asynchronous (decode);
		 * later plays reuse the cache. Every failure mode is silent.
		 *
		 * @param engine - the page's AudioContext.
		 * @param base64 - the uploaded audio as base64, or empty.
		 * @param volumePercent - loudness clamped to 0–100.
		 */
		function playCustomSound(engine, base64, volumePercent) {
			if (typeof base64 !== "string" || base64 === "") return;
			const percent = Number.isFinite(volumePercent) ? volumePercent : DEFAULT_VOLUME;
			const loudness = Math.max(0, Math.min(100, percent)) / 100;
			if (loudness === 0) return;
			if (typeof engine.decodeAudioData !== "function") return;
			const play = (buffer, normGain) => {
				const source = engine.createBufferSource();
				const gain = engine.createGain();
				source.buffer = buffer;
				gain.gain.value = normGain * loudness * 0.6;
				source.connect(gain);
				gain.connect(engine.destination);
				source.start(engine.currentTime + 0.02);
			};
			if (customSoundCache !== undefined && customSoundCache.source === base64) {
				play(customSoundCache.buffer, customSoundCache.normGain);
				return;
			}
			const decode = engine.decodeAudioData(base64ToBytes(base64));
			Promise.resolve(decode).then((buffer) => {
				const normGain = normalizedGain(buffer);
				customSoundCache = { source: base64, buffer, normGain };
				play(buffer, normGain);
			}).catch(() => {});
		}

		/** Decode one ArrayBuffer for upload validation; `undefined` when it cannot be decoded. */
		async function validateCustomSoundBytes(bytes) {
			const engine = audioEngine();
			if (engine === undefined || typeof engine.decodeAudioData !== "function") return null;
			try {
				return await engine.decodeAudioData(bytes.slice(0));
			} catch {
				return undefined;
			}
		}

		/**
		 * Peak-normalization gain for one decoded buffer: scales the loudest
		 * sample toward full scale, boosting at most 4× so near-silent files
		 * do not get blown up.
		 */
		function normalizedGain(buffer) {
			try {
				let peak = 0;
				for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
					const data = buffer.getChannelData(channel);
					for (let i = 0; i < data.length; i++) {
						const magnitude = Math.abs(data[i]);
						if (magnitude > peak) peak = magnitude;
					}
				}
				if (peak <= 0.0001) return 1;
				return Math.min(1 / peak, 4);
			} catch {
				return 1;
			}
		}

		/** Decode base64 back to an ArrayBuffer. */
		function base64ToBytes(base64) {
			const binary = atob(base64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
			return bytes.buffer;
		}

		/** Encode an ArrayBuffer as base64, chunked to dodge argument limits. */
		function bytesToBase64(buffer) {
			const bytes = new Uint8Array(buffer);
			let binary = "";
			const chunk = 0x8000;
			for (let i = 0; i < bytes.length; i += chunk) {
				binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
			}
			return btoa(binary);
		}

		/**
		 * Play one preset at a loudness in percent.
		 *
		 * The context is resumed when the browser suspended it; a page that has
		 * not yet seen a user gesture stays silent (the browser's autoplay
		 * policy, not an error). Peaks stay far below clipping even with every
		 * preset voice summed.
		 *
		 * @param id - preset id; `none`, unknown ids, and `custom` without an
		 *   upload are silent no-ops (the caller falls back first).
		 * @param volumePercent - loudness clamped to 0–100; a non-finite value
		 *   (a hand-edited YAML `.nan`/`.inf`) falls back to the default rather
		 *   than reaching Web Audio, where a non-finite gain would throw.
		 * @param customBase64 - the uploaded audio for the `custom` preset.
		 */
		function playSound(id, volumePercent, customBase64) {
			if (id === "none" || id === undefined) return;
			if (id === "custom") {
				const engine = audioEngine();
				if (engine === undefined) return;
				if (engine.state === "suspended") engine.resume().catch(() => {});
				playCustomSound(engine, customBase64, volumePercent);
				return;
			}
			const preset = SOUND_PRESETS[id];
			if (preset === undefined) return;
			const engine = audioEngine();
			if (engine === undefined) return;
			if (engine.state === "suspended") engine.resume().catch(() => {});
			const percent = Number.isFinite(volumePercent) ? volumePercent : DEFAULT_VOLUME;
			const loudness = Math.max(0, Math.min(100, percent)) / 100;
			if (loudness === 0) return;
			const master = engine.createGain();
			master.gain.value = loudness * 0.6;
			master.connect(engine.destination);
			const t0 = engine.currentTime + 0.02;
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
				osc.start(start);
				osc.stop(start + note.dur + 0.05);
			}
		}

		/**
		 * Release the page's audio engine. Called when this plugin's fiber
		 * tears down — most importantly when the module is hot-replaced — so
		 * each discarded bundle's context is closed instead of stranding an
		 * audio thread per reload.
		 */
		function releaseAudioEngine() {
			customSoundCache = undefined;
			if (audioContext === undefined) return;
			const engine = audioContext;
			audioContext = undefined;
			Promise.resolve(engine.close?.()).catch(() => {});
		}
		//#endregion

		//#region runtime helpers
		/** Prefix the title-bar alert writes in front of the window title. */
		const TITLE_PREFIX = "🔔 ";

		/**
		 * Apply or clear the title-bar bell prefix. The prefix is purely
		 * additive on top of whatever title the app itself maintains, and the
		 * clear only strips the prefix, so the two writers never clobber
		 * each other.
		 *
		 * @param active - whether the bell should show.
		 */
		function applyTitleFlash(active) {
			if (typeof document === "undefined") return;
			if (active) {
				if (!document.title.startsWith(TITLE_PREFIX)) document.title = TITLE_PREFIX + document.title;
			} else if (document.title.startsWith(TITLE_PREFIX)) {
				document.title = document.title.slice(TITLE_PREFIX.length);
			}
		}

		/** Parse "HH:MM" into minutes past midnight; `NaN` when malformed. */
		function timeOfDayToMinutes(text) {
			if (typeof text !== "string") return NaN;
			const match = /^(\d{1,2}):(\d{2})$/.exec(text);
			if (match === null) return NaN;
			const hours = Number(match[1]);
			const minutes = Number(match[2]);
			if (hours > 23 || minutes > 59) return NaN;
			return hours * 60 + minutes;
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
		 * The OS notification currently on screen, held strongly.
		 *
		 * A `Notification` whose last reference is gone can be collected while
		 * its toast is still displayed, and the click handler goes with it —
		 * the toast then dismisses with no event at all. One slot is enough:
		 * `tag` collapses repeats per trigger kind anyway.
		 */
		let liveNotification;

		/**
		 * Show one OS notification; every failure mode is silent. The tag
		 * collapses repeats per trigger kind, and `silent` keeps the OS from
		 * layering its own sound on top of ours.
		 *
		 * @param title - notification title.
		 * @param body - notification body.
		 * @param tag - collapse tag.
		 */
		function showSystemNotification(title, body, tag) {
			try {
				if (typeof Notification === "undefined") return;
				if (Notification.permission !== "granted") return;
				const notification = new Notification(title, { body, tag, silent: true });
				liveNotification = notification;
				notification.onclick = () => {
					// The focus request is the FIRST thing the click does, and
					// it is not gated on anything that can throw:
					// `notification.close()` and `window.focus()` are cosmetic
					// here, and in a sandboxed renderer either can raise. When
					// they ran ahead of the fetch, a throw left the click a
					// silent no-op with no request ever sent.
					try {
						fetch("/notify-sounds/focus", { method: "POST" }).catch(() => {});
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
				notification.onclose = () => {
					if (liveNotification === notification) liveNotification = undefined;
				};
			} catch {}
		}

		/**
		 * Human-readable summary of one pending interaction, for notification
		 * bodies: the approval's localized reason first, then its raw reason,
		 * then the first question's text, then the requesting tool's name.
		 *
		 * @param interaction - a pendingInteraction object, or nothing.
		 * @returns the best summary, or `undefined`.
		 */
		function interactionSummary(interaction) {
			if (interaction === null || typeof interaction !== "object") return undefined;
			if (typeof interaction.displayReason === "string" && interaction.displayReason !== "") return interaction.displayReason;
			if (typeof interaction.reason === "string" && interaction.reason !== "") return interaction.reason;
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
		 * The transient write-failure marker shared by the rows: `null` when the
		 * last write settled, otherwise the field whose write was refused.
		 *
		 * @param props - the form snapshot hook, the field writer, the preview
		 *   player, and the locale seat.
		 * @returns the Settings section element tree.
		 */
		function NotifySoundsSection({ useConfig, setField, preview, t }) {
			const state = useConfig((snapshot) => snapshot);
			const value = state.status === "ready" ? state.value : undefined;
			const disabled = state.writable !== true;
			const [failedField, setFailedField] = useState(null);

			/** Write one field, surfacing a refusal as that row's error; resolves once settled. */
			const write = useCallback((field, next) => {
				setFailedField(null);
				return Promise.resolve(setField(field, next)).then((accepted) => {
					if (accepted !== true) setFailedField(field);
				}, () => {
					setFailedField(field);
				});
			}, [setField]);

			const volume = Number.isFinite(value?.volume) ? value.volume : 60;
			const hasCustom = typeof value?.customSound === "string" && value.customSound !== "";
			// `custom` is offered only while an upload exists; a picker left
			// pointing at a removed upload falls back at play time.
			const pickerIds = hasCustom ? SOUND_IDS : SOUND_IDS.filter((id) => id !== "custom");
			/** Accept a stored preset the menu actually offers, else fall back. */
			const soundValue = (raw, fallback) => (typeof raw === "string" && pickerIds.includes(raw) ? raw : fallback);
			const renotifyMinutes = Number.isFinite(value?.renotifyMinutes) ? Math.max(1, Math.min(60, value.renotifyMinutes)) : 5;
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
						ids: pickerIds,
						disabled,
						failed: failedField === "decisionSound",
						onSelect: (id) => {
							write("decisionSound", id);
							preview(id, volume);
						},
						onPreview: (id) => preview(id, volume),
					}),
					h(SoundRow, {
						key: "question",
						t,
						title: t("question.title"),
						description: t("question.description"),
						selected: soundValue(value?.questionSound, "chime"),
						ids: pickerIds,
						disabled,
						failed: failedField === "questionSound",
						onSelect: (id) => {
							write("questionSound", id);
							preview(id, volume);
						},
						onPreview: (id) => preview(id, volume),
					}),
					h(SoundRow, {
						key: "completion",
						t,
						title: t("completion.title"),
						description: t("completion.description"),
						selected: soundValue(value?.completionSound, "ding"),
						ids: pickerIds,
						disabled,
						failed: failedField === "completionSound",
						onSelect: (id) => {
							write("completionSound", id);
							preview(id, volume);
						},
						onPreview: (id) => preview(id, volume),
					}),
					h(CustomSoundRow, {
						key: "custom",
						t,
						name: typeof value?.customSoundName === "string" ? value.customSoundName : "",
						disabled,
						failed: failedField === "customSound",
						onUpload: async (base64, name) => {
							await write("customSound", base64);
							await write("customSoundName", name);
						},
						onRemove: () => {
							write("customSound", "");
							write("customSoundName", "");
							if (value?.decisionSound === "custom") write("decisionSound", "bell");
							if (value?.questionSound === "custom") write("questionSound", "chime");
							if (value?.completionSound === "custom") write("completionSound", "ding");
						},
						onPreview: () => preview("custom", volume),
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
						description: t("titleFlash.description"),
						label: t("titleFlash.title"),
						checked: value?.titleFlash === true,
						disabled,
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
		function SoundRow({ t, title, description, selected, ids, disabled, failed, onSelect, onPreview }) {
			const [open, setOpen] = useState(false);
			// Menu entries carry their text in `label` (`text` is reserved
			// for group-heading entries typed `{ type: "label" }`).
			const items = ids.map((id) => ({ id, label: t("sound." + id) }));
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
						}, t("sound." + selected)),
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
		function CustomSoundRow({ t, name, disabled, failed, onUpload, onRemove, onPreview }) {
			const fileRef = useRef(null);
			const [error, setError] = useState(null);
			const [busy, setBusy] = useState(false);
			/** Read one chosen file, validate it, and hand it to the writer. */
			const handleFile = async (event) => {
				const input = event.currentTarget;
				const file = input.files?.[0];
				if (typeof input.value === "string") input.value = "";
				if (file === undefined) return;
				if (file.size > CUSTOM_SOUND_MAX_BYTES) {
					setError("custom.tooLarge");
					return;
				}
				setError(null);
				setBusy(true);
				try {
					const bytes = await file.arrayBuffer();
					const decoded = await validateCustomSoundBytes(bytes);
					if (decoded === undefined) {
						setError("custom.undecodable");
						return;
					}
					await onUpload(bytesToBase64(bytes), file.name);
				} finally {
					setBusy(false);
				}
			};
			return h("div", { className: css.row }, [
				h("div", { key: "text" }, [
					h("div", { className: css.rowTitle, key: "title" }, t("custom.title")),
					h("div", { className: css.rowDescription, key: "description" }, t("custom.description")),
					error !== null ? h("div", { className: css.error, role: "alert", key: "validation" }, t(error)) : null,
					failed ? h("div", { className: css.error, role: "alert", key: "error" }, t("saveFailed")) : null,
				]),
				h("div", { className: css.stackControl, key: "control" }, [
					h("input", {
						key: "file",
						type: "file",
						accept: "audio/*",
						ref: fileRef,
						className: css.fileInput,
						"aria-hidden": "true",
						tabIndex: -1,
						onChange: handleFile,
					}),
					name !== "" ? h("span", { className: css.customName, key: "name", title: name }, name) : null,
					h(Button, {
						key: "choose",
						variant: "outline",
						size: "sm",
						disabled: disabled || busy,
						onClick: () => {
							setError(null);
							fileRef.current?.click?.();
						},
					}, t("custom.choose")),
					name !== "" ? h(Button, {
						key: "preview",
						variant: "outline",
						size: "sm",
						disabled: disabled || busy,
						icon: h(IconPlayOutlineRegular, { size: 14 }),
						onClick: onPreview,
					}, t("preview")) : null,
					name !== "" ? h(Button, {
						key: "remove",
						variant: "outline",
						size: "sm",
						disabled: disabled || busy,
						onClick: () => {
							setError(null);
							onRemove();
						},
					}, t("custom.remove")) : null,
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
			const supported = typeof Notification !== "undefined";
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
						return Promise.resolve(Notification.requestPermission()).then((result) => {
							return onChange(result === "granted");
						}).finally(() => setBusy(false));
					},
				}),
			]);
		}

		/** Re-ping interval choices, in minutes. */
		const RENOTIFY_INTERVALS = [1, 5, 15, 30];

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
								onStart(event.currentTarget.value);
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
								onEnd(event.currentTarget.value);
							},
						}),
					]),
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
			svg.setAttribute("viewBox", "0 0 16 16");
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
			cell.replaceChild(replacement, icon);
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

		/** Required services: the status facts, the settings forms, the slot registry, and copy. */
		const inject = ["uiSession", "configForms", "slots", "locale"];

		/**
		 * Install the dictionaries, the session-status sound triggers, and the
		 * Settings section.
		 *
		 * @param ctx - the Client root context.
		 */
		function apply(ctx) {
			insertStyles();
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "notify-sounds: dictionaries");
			const t = ctx.locale.bind(NS);

			// The audio engine is page-scoped state; releasing it on teardown
			// (fiber restart or a hot-replaced bundle) closes the AudioContext
			// instead of stranding one audio thread per reload.
			ctx.effect(() => releaseAudioEngine, "notify-sounds: audio engine");

			const form = ctx.configForms.get(SETTINGS_NAMESPACE);
			/** Last playback time per trigger, for the retrigger cooldown. */
			const cooldown = { decision: 0, question: 0, completion: 0 };

			/**
			 * Fire one trigger under the live preference values: the sound,
			 * plus the optional system notification while the page is hidden.
			 *
			 * @param kind - `decision`, `question`, or `completion`.
			 * @param interaction - the pending interaction, for the
			 *   notification body.
			 */
			const notify = (kind, interaction) => {
				const value = form.getSnapshot().value;
				if (value?.enabled === false) return;
				if (value?.quietHours === true && inQuietHours(new Date(), value?.quietStart, value?.quietEnd)) return;
				if (value?.onlyWhenHidden === true && typeof document !== "undefined" && document.visibilityState === "visible") return;
				const now = Date.now();
				if (now - cooldown[kind] < RETRIGGER_COOLDOWN_MS) return;
				cooldown[kind] = now;
				const fallback = kind === "completion" ? "ding" : kind === "question" ? "chime" : "bell";
				let id = typeof value?.[kind + "Sound"] === "string" ? value[kind + "Sound"] : fallback;
				// A picker left on `custom` with no upload falls back, so a
				// removed file never silences the trigger.
				if (id === "custom" && (typeof value?.customSound !== "string" || value.customSound === "")) id = fallback;
				const volume = Number.isFinite(value?.volume) ? value.volume : DEFAULT_VOLUME;
				playSound(id, volume, value?.customSound);
				if (value?.systemNotify === true && typeof document !== "undefined" && document.visibilityState !== "visible") {
					if (kind === "completion") {
						showSystemNotification(t("notify.completion.title"), t("notify.completion.body"), "dsh-notify-sounds:completion");
					} else {
						const body = interactionSummary(interaction) ?? t("notify.decision.body");
						showSystemNotification(t("notify.decision.title"), body, "dsh-notify-sounds:decision");
					}
				}
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
				/** Unanswered decisions: sessionId → { interaction, kind, since, lastPing }. */
				const pending = new Map();
				/** Whether the title-bar flash should show right now. */
				const titleFlashActive = () => {
					const value = form.getSnapshot().value;
					return value?.titleFlash === true && typeof document !== "undefined" && document.visibilityState !== "visible";
				};
				/** Rebuild the tracker from one snapshot, then refresh the flash. */
				const trackPending = (snapshot) => {
					const next = new Map();
					for (const [sessionId, status] of snapshot) {
						const interaction = status.pendingInteraction;
						if (interaction === undefined) continue;
						const record = pending.get(sessionId);
						next.set(sessionId, record !== undefined && record.interaction === interaction ? record : {
							interaction,
							kind: interaction.kind === "question" ? "question" : "decision",
							since: Date.now(),
							lastPing: 0,
						});
					}
					pending.clear();
					for (const [key, record] of next) pending.set(key, record);
					applyTitleFlash(pending.size > 0 && titleFlashActive());
				};
				const read = () => {
					const snapshot = source.getSnapshot();
					if (previous !== undefined) {
						for (const [sessionId, status] of snapshot) {
							const before = previous.get(sessionId);
							const beforePending = before === undefined ? undefined : before.pendingInteraction;
							if (status.pendingInteraction !== undefined && status.pendingInteraction !== beforePending) {
								// Questions are their own trigger; approvals and
								// plan reviews share the decision sound.
								notify(status.pendingInteraction.kind === "question" ? "question" : "decision", status.pendingInteraction);
							}
							if (before !== undefined && before.running === true && status.running === false) {
								notify("completion");
							}
						}
					}
					previous = snapshot;
					trackPending(snapshot);
				};
				// Returning to the page clears the flash even while the
				// decision stays pending.
				const onVisibility = () => {
					applyTitleFlash(pending.size > 0 && titleFlashActive());
				};
				document.addEventListener?.("visibilitychange", onVisibility);
				// The repeat reminder: re-ping each unanswered decision one
				// interval after it appeared (and again per interval after
				// that), through the same gated notify path.
				const renotifyTimer = setInterval(() => {
					const value = form.getSnapshot().value;
					if (value?.renotify !== true || pending.size === 0) return;
					const minutes = Number.isFinite(value?.renotifyMinutes) ? Math.max(1, value.renotifyMinutes) : 5;
					const intervalMs = minutes * 60000;
					const now = Date.now();
					for (const record of pending.values()) {
						const last = record.lastPing !== 0 ? record.lastPing : record.since;
						if (now - last >= intervalMs) {
							record.lastPing = now;
							notify(record.kind, record.interaction);
						}
					}
				}, RENOTIFY_CHECK_MS);
				const unsubscribe = source.subscribe(() => {
					read();
				});
				read();
				return () => {
					unsubscribe();
					clearInterval(renotifyTimer);
					document.removeEventListener?.("visibilitychange", onVisibility);
					applyTitleFlash(false);
				};
			}, "notify-sounds: session status watcher");

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
							playSound(id, volume, form.getSnapshot().value?.customSound);
						},
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
		return module.exports;
	},
});
