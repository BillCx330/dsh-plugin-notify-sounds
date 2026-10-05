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

		const { Button, IconPlayOutlineRegular, SegmentedControl, Switch } = primitives;
		const { createElement: h, useCallback, useEffect, useRef, useState } = React;

		//#region styles
		/** Stylesheet identity, keyed so a reloaded bundle reuses its tag. */
		const STYLE_TAG_ID = "dsh-plugin-notify-sounds/NotifySoundsSection.module.css";
		const CSS = [
			".dsh-notify-sounds-section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}",
			".dsh-notify-sounds-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}",
			".dsh-notify-sounds-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}",
			".dsh-notify-sounds-rows{flex-direction:column;margin:12px 0 0;display:flex}",
			".dsh-notify-sounds-row{border-bottom:.5px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:24px;padding:16px 0;display:flex}",
			".dsh-notify-sounds-stack{border-bottom:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:12px;padding:16px 0;display:flex}",
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
			".dsh-notify-sounds-stackControl{align-items:center;gap:12px;flex-wrap:wrap;display:flex}",
		].join("");
		/** Stylesheet class names, one projection the components read. */
		const css = {
			section: "dsh-notify-sounds-section",
			title: "dsh-notify-sounds-title",
			intro: "dsh-notify-sounds-intro",
			rows: "dsh-notify-sounds-rows",
			row: "dsh-notify-sounds-row",
			stack: "dsh-notify-sounds-stack",
			rowTitle: "dsh-notify-sounds-rowTitle",
			rowDescription: "dsh-notify-sounds-rowDescription",
			error: "dsh-notify-sounds-error",
			volume: "dsh-notify-sounds-volume",
			slider: "dsh-notify-sounds-slider",
			volumeValue: "dsh-notify-sounds-volumeValue",
			stackControl: "dsh-notify-sounds-stackControl",
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
			"intro": "当智能体需要你决策（审批、提问）或任务完成时播放提示音。",
			"enabled.title": "启用提示音",
			"enabled.description": "关闭后所有提示音静音",
			"volume.title": "音量",
			"volume.description": "调整提示音的播放音量",
			"decision.title": "需要决策时",
			"decision.description": "智能体发起审批或提问时播放",
			"completion.title": "任务完成时",
			"completion.description": "会话由运行转为空闲时播放",
			"onlyWhenHidden.title": "仅在页面不可见时提示",
			"onlyWhenHidden.description": "仅当浏览器标签页处于后台时播放提示音",
			"preview": "试听",
			"saveFailed": "保存失败，请重试",
			"sound.none": "无声",
			"sound.bell": "双音铃",
			"sound.chime": "风铃",
			"sound.ding": "单音叮",
			"sound.drop": "水滴",
			"sound.pulse": "脉冲",
			"sound.arc": "上行琶音",
		};

		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"nav": "Sounds",
			"title": "Notification sounds",
			"intro": "Play a sound when the agent needs your decision (approvals, questions) or finishes a task.",
			"enabled.title": "Enable sounds",
			"enabled.description": "Turn off to mute every notification sound",
			"volume.title": "Volume",
			"volume.description": "Playback loudness of the notification sounds",
			"decision.title": "Decision needed",
			"decision.description": "Played when the agent raises an approval or a question",
			"completion.title": "Task finished",
			"completion.description": "Played when a session goes from running to idle",
			"onlyWhenHidden.title": "Only when the page is hidden",
			"onlyWhenHidden.description": "Play only while the browser tab is in the background",
			"preview": "Preview",
			"saveFailed": "Could not save. Please try again.",
			"sound.none": "None",
			"sound.bell": "Bell",
			"sound.chime": "Chime",
			"sound.ding": "Ding",
			"sound.drop": "Drop",
			"sound.pulse": "Pulse",
			"sound.arc": "Arc",
		};
		//#endregion

		//#region sounds
		/** Sound ids in display order; must match the Host half's Config union. */
		const SOUND_IDS = ["bell", "chime", "ding", "drop", "pulse", "arc", "none"];

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

		/**
		 * Play one preset at a loudness in percent.
		 *
		 * The context is resumed when the browser suspended it; a page that has
		 * not yet seen a user gesture stays silent (the browser's autoplay
		 * policy, not an error). Peaks stay far below clipping even with every
		 * preset voice summed.
		 *
		 * @param id - preset id; `none` and unknown ids are silent no-ops.
		 * @param volumePercent - loudness clamped to 0–100; a non-finite value
		 *   (a hand-edited YAML `.nan`/`.inf`) falls back to the default rather
		 *   than reaching Web Audio, where a non-finite gain would throw.
		 */
		function playSound(id, volumePercent) {
			if (id === "none" || id === undefined) return;
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
			if (audioContext === undefined) return;
			const engine = audioContext;
			audioContext = undefined;
			Promise.resolve(engine.close?.()).catch(() => {});
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
						controlId: "dsh-notify-sounds-decision",
						title: t("decision.title"),
						description: t("decision.description"),
						selected: typeof value?.decisionSound === "string" ? value.decisionSound : "bell",
						disabled,
						failed: failedField === "decisionSound",
						onSelect: (id) => {
							write("decisionSound", id);
							preview(id, volume);
						},
						onPreview: (id) => preview(id, volume),
					}),
					h(SoundRow, {
						key: "completion",
						t,
						controlId: "dsh-notify-sounds-completion",
						title: t("completion.title"),
						description: t("completion.description"),
						selected: typeof value?.completionSound === "string" ? value.completionSound : "ding",
						disabled,
						failed: failedField === "completionSound",
						onSelect: (id) => {
							write("completionSound", id);
							preview(id, volume);
						},
						onPreview: (id) => preview(id, volume),
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
		 * One sound-picker row: label/description above, the preset
		 * SegmentedControl and its preview button below.
		 *
		 * @param props - copy, the accepted preset, and the select/preview
		 *   actions.
		 * @returns the row element tree.
		 */
		function SoundRow({ t, controlId, title, description, selected, disabled, failed, onSelect, onPreview }) {
			const options = SOUND_IDS.map((id) => ({ value: id, label: t("sound." + id) }));
			return h("div", { className: css.stack }, [
				h("div", { key: "text" }, [
					h("div", { className: css.rowTitle, key: "title" }, title),
					h("div", { className: css.rowDescription, key: "description" }, description),
					failed ? h("div", { className: css.error, role: "alert", key: "error" }, t("saveFailed")) : null,
				]),
				h("div", { className: css.stackControl, key: "control" }, [
					h(SegmentedControl, {
						key: "segments",
						id: controlId,
						label: title,
						value: selected,
						options,
						disabled,
						onChange: onSelect,
					}),
					h(Button, {
						key: "preview",
						variant: "outline",
						size: "sm",
						disabled,
						icon: h(IconPlayOutlineRegular, { size: 14 }),
						onClick: () => {
							onPreview(selected);
						},
					}, t("preview")),
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
			const cooldown = { decision: 0, completion: 0 };

			/**
			 * Play one trigger's preset under the live preference values.
			 *
			 * @param kind - `decision` or `completion`.
			 */
			const notify = (kind) => {
				const value = form.getSnapshot().value;
				if (value?.enabled === false) return;
				if (value?.onlyWhenHidden === true && typeof document !== "undefined" && document.visibilityState === "visible") return;
				const now = Date.now();
				if (now - cooldown[kind] < RETRIGGER_COOLDOWN_MS) return;
				cooldown[kind] = now;
				const fallback = kind === "decision" ? "bell" : "ding";
				const id = typeof value?.[kind + "Sound"] === "string" ? value[kind + "Sound"] : fallback;
				const volume = Number.isFinite(value?.volume) ? value.volume : DEFAULT_VOLUME;
				playSound(id, volume);
			};

			// The sound triggers: diff consecutive sessionStatus snapshots the
			// way the shipped status dots derive their facts. The first read
			// only establishes the baseline, so a page that opens over an
			// already-running session stays silent until a real transition.
			ctx.effect(() => {
				const source = ctx.uiSession.sessionStatus;
				let previous;
				const read = () => {
					const snapshot = source.getSnapshot();
					if (previous !== undefined) {
						for (const [sessionId, status] of snapshot) {
							const before = previous.get(sessionId);
							const beforePending = before === undefined ? undefined : before.pendingInteraction;
							if (status.pendingInteraction !== undefined && status.pendingInteraction !== beforePending) {
								notify("decision");
							}
							if (before !== undefined && before.running === true && status.running === false) {
								notify("completion");
							}
						}
					}
					previous = snapshot;
				};
				const unsubscribe = source.subscribe(() => {
					read();
				});
				read();
				return unsubscribe;
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
						preview: (id, volume) => playSound(id, volume),
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
