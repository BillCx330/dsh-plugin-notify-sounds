/**
 * Smoke test for `dsh-plugin-notify-sounds`.
 *
 * Loads the Client half inside a stubbed Module Loader environment, applies it
 * against mock services and a fake DOM, and asserts the wiring: dictionaries,
 * the session-status watcher (per-session retrigger cooldown, unread-finish
 * title semantics), the Settings section registration, the nav glyph swap
 * (alarm clock instead of the shared fallback gear), the uncontrolled volume
 * slider (drag paints without re-rendering, commits once per gesture), and
 * the Web Audio scheduling (against a recording AudioContext mock).
 *
 * Run: node test/smoke.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Module Loader stub -------------------------------------------------------
let registration;
// Recording fetch mock: the notification click posts to the Host focus route.
const fetchCalls = [];
const goalPhases = new Map();
let soundMissing = false;
globalThis.fetch = (input, init) => {
	fetchCalls.push({ input: String(input), init });
	const target = String(input);
	if (target.startsWith("/notify-sounds/sound")) {
		const method = init?.method ?? "GET";
		if (method === "POST") return Promise.resolve({ ok: true, json: () => Promise.resolve({ file: "a".repeat(64) + ".mp3" }) });
		if (method === "DELETE") return Promise.resolve({ ok: true });
		if (method === "HEAD") return Promise.resolve({ ok: !soundMissing });
		// GET: the bytes the page would decode.
		return Promise.resolve({ ok: !soundMissing, arrayBuffer: () => Promise.resolve(new TextEncoder().encode("good-audio").buffer) });
	}
	if (target.startsWith("/notify-sounds/goal")) {
		const search = target.split("?")[1] ?? "";
		const sessionId = new URLSearchParams(search).get("session");
		const phase = goalPhases.get(sessionId) ?? null;
		return Promise.resolve({ ok: true, json: () => Promise.resolve({ phase }) });
	}
	return Promise.resolve({ ok: true });
};
globalThis.window = {
	__ModuleLoader__: {
		load(reg) {
			registration = reg;
		},
	},
	focus() {},
};

// Recording AudioContext mock: every scheduled oscillator is captured.
const scheduled = [];
/** Compressors the boost path asked for. */
const limiters = [];
class MockParam {
	constructor() {
		this.events = [];
	}
	setValueAtTime(value, time) {
		this.events.push({ kind: 'set', value, time });
	}
	exponentialRampToValueAtTime(value, time) {
		this.events.push({ kind: 'ramp', value, time });
	}
}
class MockNode {
	connect(node) {
		return node;
	}
	disconnect() {}
}
class MockOscillator extends MockNode {
	constructor() {
		super();
		this.type = 'sine';
		this.frequency = new MockParam();
		scheduled.push(this);
		this.stopped = false;
	}
	start() {}
	stop(...args) {
		// A preset stops itself with the time it ends; only a bare stop() is
		// an interruption, which is what a second preview does.

		this.stopCalls = [...(this.stopCalls ?? []), args.length];
		if (args.length === 0) this.stopped = true;
	}
}
class MockGain extends MockNode {
	constructor() {
		super();
		this.gain = Object.assign(new MockParam(), { value: 0 });
	}
}
/** Decoded-buffer mock: one channel with a controllable peak sample. */
function mockDecodedBuffer(peak = 0.5, duration = 1) {
	return {
		numberOfChannels: 1,
		duration,
		getChannelData: () => new Float32Array([peak, peak / 2, 0]),
	};
}
class MockBufferSource extends MockNode {
	constructor() {
		super();
		scheduled.push(this);
		this.stopped = false;
	}
	start() {}
	stop(...args) {
		// A preset stops itself with the time it ends; only a bare stop() is
		// an interruption, which is what a second preview does.

		this.stopCalls = [...(this.stopCalls ?? []), args.length];
		if (args.length === 0) this.stopped = true;
	}
}
globalThis.window.AudioContext = class {
	constructor() {
		this.state = 'running';
		this.destination = {};
		this.currentTime = 0;
		// Expose the latest instance so tests can suspend/resume it.
		globalThis.window.AudioContext._lastInstance = this;
	}
	resume() {
		this.state = 'running';
		return Promise.resolve();
	}
	createGain() {
		return new MockGain();
	}
	createOscillator() {
		return new MockOscillator();
	}
	createBufferSource() {
		return new MockBufferSource();
	}
	createDynamicsCompressor() {
		const node = new MockNode();
		node.threshold = { value: 0 };
		node.knee = { value: 0 };
		node.ratio = { value: 0 };
		node.attack = { value: 0 };
		node.release = { value: 0 };
		limiters.push(node);
		return node;
	}
	decodeAudioData(bytes) {
		// Decodes only the sentinel payload; anything else is undecodable.
		const raw = String.fromCharCode(...new Uint8Array(bytes));
		if (raw === 'good-audio') return Promise.resolve(mockDecodedBuffer(0.5));
		if (raw === 'long-audio') return Promise.resolve(mockDecodedBuffer(0.5, 20));
		if (raw === 'silent-audio') return Promise.resolve(mockDecodedBuffer(0, 1));
		return Promise.reject(new Error('decode failed'));
	}
};

// --- Fake DOM -----------------------------------------------------------------
/** Minimal element: enough surface for the stylesheet, the glyph swap, and the slider paint. */
function fakeNode(tag, text = '') {
	return {
		tagName: tag,
		textContent: text,
		children: [],
		attributes: new Map(),
		dataset: {},
		style: {
			setProperty(key, value) {
				this[key] = value;
			},
		},
		setAttribute(key, value) {
			this.attributes.set(key, String(value));
		},
		getAttribute(key) {
			return this.attributes.has(key) ? this.attributes.get(key) : null;
		},
		hasAttribute(key) {
			return this.attributes.has(key);
		},
		appendChild(child) {
			this.children.push(child);
			return child;
		},
		replaceChild(next, previous) {
			const index = this.children.indexOf(previous);
			if (index !== -1) this.children[index] = next;
		},
		querySelectorAll(selector) {
			if (selector !== 'button') return [];
			const found = [];
			const walk = (node) => {
				for (const child of node.children) {
					if (child.tagName === 'BUTTON') found.push(child);
					walk(child);
				}
			};
			walk(this);
			return found;
		},
		querySelector(selector) {
			// The nav-glyph patch probes its panel for the marker before
			// walking it; that is the only attribute selector asked of an
			// element here, so the fake serves exactly that one.
			if (selector !== '[data-notify-sounds-icon]') return null;
			const walk = (node) => {
				for (const child of node.children) {
					if (child.hasAttribute?.('data-notify-sounds-icon')) return child;
					const found = walk(child);
					if (found !== null) return found;
				}
				return null;
			};
			return walk(this);
		},
	};
}

/** One settings panel with the nav cells the shell would render. */
function makePanel() {
	const panel = fakeNode('DIV');
	const nav = fakeNode('DIV');
	panel.appendChild(nav);
	const cells = [];
	for (const [id, label] of [['general', '通用设置'], ['notify-sounds', '提示音'], ['models', '模型']]) {
		const cell = fakeNode('BUTTON');
		const icon = fakeNode('svg');
		icon.setAttribute('class', 'wCInkW_navIcon');
		const labelSpan = fakeNode('SPAN', label);
		cell.appendChild(icon);
		cell.appendChild(labelSpan);
		nav.appendChild(cell);
		cells.push({ id, cell, icon, labelSpan });
	}
	return { panel, cells };
}

const observers = [];
class FakeMutationObserver {
	constructor(callback) {
		this.callback = callback;
		this.disconnected = false;
		observers.push(this);
	}
	observe(target, options) {
		this.target = target;
		this.options = options;
	}
	disconnect() {
		this.disconnected = true;
	}
	trigger() {
		if (!this.disconnected) this.callback();
	}
}
globalThis.MutationObserver = FakeMutationObserver;

// Timer capture: the repeat reminder's checker is invoked manually.
let renotifyChecker = null;
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms) => {
	renotifyChecker = fn;
	return 1;
};
globalThis.clearInterval = () => {
	renotifyChecker = null;
};

// Timer capture, the other half: the update check reschedules itself 30 seconds
// and then a DAY out, and no test can wait for that. Delays of ten seconds or
// more are recorded instead of scheduled. The threshold sits well above
// everything else in play — the tests await with 30ms and 2100ms waits, and a
// synthesized sound's tail is under a second (the longest preset is 0.88s) — and
// below the plugin's own 30-second first check, so nothing real is ever
// swallowed and the captured first entry is always that check.
const longTimers = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => {
	if (typeof ms === 'number' && ms >= 10_000) {
		longTimers.push({ fn, ms });
		return { unref() {} };
	}
	return realSetTimeout(fn, ms, ...rest);
};

// Notification API stub with a mutable permission.
const notifications = [];
globalThis.Notification = class {
	static permission = 'granted';
	constructor(title, options) {
		this.title = title;
		this.options = options;
		notifications.push(this);
	}
	close() {
		this.closed = true;
	}
	static requestPermission() {
		return Promise.resolve(Notification.permission);
	}
};

let currentPanel = null;
const documentListeners = {};
// A real <title> element: observeTitle() finds it through querySelector, so
// the title observer is genuinely attached while an alert is wanted. (A page
// without one is the edge the observeTitle fix covers: the observer must not
// be created until the element exists.)
const titleElement = fakeNode('TITLE');
globalThis.document = {
	body: fakeNode('BODY'),
	head: fakeNode('HEAD'),
	activeElement: null,
	visibilityState: 'visible',
	title: '',
	addEventListener(type, listener) {
		(documentListeners[type] ??= []).push(listener);
	},
	removeEventListener(type, listener) {
		documentListeners[type] = (documentListeners[type] ?? []).filter((entry) => entry !== listener);
	},
	querySelector(selector) {
		if (selector === '[data-shortcut-modal="settings"]') return currentPanel;
		if (selector === 'title') return titleElement;
		return null;
	},
	querySelectorAll() {
		return [];
	},
	createElement(tag) {
		return fakeNode(tag.toUpperCase());
	},
	createElementNS(ns, tag) {
		const node = fakeNode(tag);
		node.namespaceURI = ns;
		return node;
	},
};
/** Dispatch one document event to its registered listeners. */
const dispatchDocumentEvent = (type) => {
	for (const listener of documentListeners[type] ?? []) listener();
};
/** Fire every live title observer, as a `<title>` mutation would. */
const dispatchTitleMutation = () => {
	for (const observer of observers) observer.trigger();
};

// --- Load the Client half -----------------------------------------------------
// Node ships a `localStorage` global that warns loudly unless it was given a
// store file. This page has none, which is the case the plugin falls back for,
// so say so explicitly — it keeps the warning out of the report, and shadowing
// the accessor is the only way to ask without triggering it.
Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
eval(readFileSync(join(root, 'lib/client.js'), 'utf8'));
assert.equal(registration.id, 'dsh-plugin-notify-sounds', 'registers under its package id');

/** One-pass renderer: executes function components so row internals run. */
const renderTree = (node) => {
	if (Array.isArray(node)) return node.map(renderTree);
	if (typeof node === 'string' || node === null || node === undefined) return node;
	if (typeof node.type === 'function') {
		node.rendered = renderTree(node.type(node.props));
		return node;
	}
	node.children = renderTree(node.children);
	return node;
};
/** Depth-first element visitor over a rendered tree. */
const walkElements = (node, visit) => {
	if (Array.isArray(node)) {
		for (const child of node) walkElements(child, visit);
		return;
	}
	if (typeof node !== 'object' || node === null) return;
	if (typeof node.type === 'string') visit(node);
	walkElements(node.rendered ?? node.children, visit);
};

/** Effects queued during a render pass, flushed once refs are attached (as React does after commit). */
const pendingEffects = [];
const flushEffects = () => {
	while (pendingEffects.length > 0) {
		const effect = pendingEffects.shift();
		effect();
	}
};
const ReactStub = {
	createElement(type, props, ...children) {
		const element = { type, props: props ?? {}, children };
		const ref = props?.ref;
		if (ref) {
			// A host-node stand-in: the value the slider reads back, the style
			// channel the paint writes through, and the label's text.
			ref.current = {
				value: props.defaultValue ?? '',
				textContent: typeof children[0] === 'string' ? children[0] : '',
				style: {
					setProperty(key, value) {
						this[key] = value;
					},
				},
			};
			element.host = ref.current;
		}
		return element;
	},
	useCallback(fn) {
		return fn;
	},
	useEffect(fn) {
		pendingEffects.push(fn);
		return () => {};
	},
	useRef(value) {
		return { current: value };
	},
	useState(value) {
		return [value, () => {}];
	},
};
const SwitchCalls = [];
const primitivesStub = {
	Button: 'Button',
	IconChevronDownOutlineMedium: 'IconChevronDownOutlineMedium',
	IconPlayOutlineRegular: 'IconPlayOutlineRegular',
	SegmentedControl: 'SegmentedControl',
	Switch(props) {
		SwitchCalls.push(props);
		return { type: 'Switch', props, children: [] };
	},
	// The dropdown stub renders its items unconditionally so the wiring
	// tests can click them; the real Menu gates them on `open`. Item text
	// lives in `label` — mirroring the real primitive's entry contract.
	Menu(props) {
		return {
			type: 'div',
			props: { className: 'menu-root', 'data-menu': 'true' },
			children: [
				props.anchor,
				...props.items.map((item) => ({
					type: 'button',
					props: {
						key: item.id,
						'data-menu-item': item.id,
						onClick: () => {
							props.onSelect(item.id);
						},
					},
					children: [item.label],
				})),
			],
		};
	},
};
const exports = registration.factory((specifier) => {
	if (specifier === 'react') return ReactStub;
	if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub;
	throw new Error('unexpected require: ' + specifier);
});

assert.equal(typeof exports.apply, 'function', 'exports apply');
assert.deepEqual(exports.inject, ['uiSession', 'sessions', 'configForms', 'slots', 'locale'], 'declares its services');

// --- Mock services ------------------------------------------------------------
const localeRegistrations = [];
let localeListeners = [];
let statusListeners = [];
let statusSnapshot = new Map();
/** Session list rows, filled per test: `origin`/`parentId` classify sub-agents. */
const sessionRowsById = {};
const slotInjections = [];
const slotRegistrations = [];
const formWrites = [];
const effects = [];

/** Fresh preference object every test resets from. */
const baseValue = () => ({
	enabled: true,
	volume: 60,
	decisionSound: 'bell',
	questionSound: 'chime',
	completionSound: 'ding',
	subagentAlerts: false,
	updateAutoCheck: true,
	onlyWhenHidden: false,
	customSound: '',
	customSoundName: '',
	systemNotify: false,
	titleFlash: false,
	renotify: false,
	renotifyMinutes: 5,
	quietHours: false,
	quietStart: '22:00',
	quietEnd: '08:00',
	goalFinalOnly: false,
});

const form = {
	value: baseValue(),
	getSnapshot() {
		return { status: 'ready', value: form.value, writable: true };
	},
	subscribe() {
		return () => {};
	},
	set(field, value) {
		formWrites.push({ field, value });
		form.value = { ...form.value, [field]: value };
		return Promise.resolve(true);
	},
};

const ctx = {
	effect(fn) {
		const dispose = fn();
		effects.push(dispose);
		return typeof dispose === 'function' ? dispose : () => {};
	},
	locale: {
		register(ns, dicts) {
			localeRegistrations.push({ ns, dicts });
			return () => {};
		},
		bind(ns) {
			// Resolve from the dictionary the plugin actually registered, so a
			// test asserting on visible text is checking the real copy — and
			// interpolate `{name}` exactly the way the real resolver does
			// (`template.replace(/\{(\w+)\}/g, ...)`), so a composed message is
			// asserted in its composed form rather than as a raw template.
			return (key, params) => {
				if (key === 'nav') return '提示音';
				const registered = localeRegistrations.filter((entry) => entry.ns === ns).at(-1);
				const template = registered?.dicts?.zh?.[key] ?? key;
				if (params === undefined) return template;
				return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
			};
		},
		subscribe(listener) {
			localeListeners.push(listener);
			return () => {
				localeListeners = localeListeners.filter((entry) => entry !== listener);
			};
		},
	},
	configForms: {
		get(ns) {
			assert.equal(ns, 'notify-sounds', 'form namespace is the entry id');
			return form;
		},
		whileServed(namespaces, register) {
			assert.deepEqual(namespaces, ['notify-sounds']);
			const off = register();
			return () => {
				off?.();
			};
		},
	},
	uiSession: {
		sessionStatus: {
			getSnapshot: () => statusSnapshot,
			subscribe(listener) {
				statusListeners.push(listener);
				return () => {
					statusListeners = statusListeners.filter((entry) => entry !== listener);
				};
			},
		},
	},
	// Session list rows carry the classification the status facts lack: a
	// sub-agent child is `origin: 'subagent'` / `parentId`, exactly what the
	// sidebar uses to keep sub-agents out of the ordinary list.
	sessions: {
		list: {
			getSnapshot: () => ({ byId: sessionRowsById }),
		},
		get: (sessionId) => ({
			projections: { faceOf: (key) => (key === 'goal' ? goalFace(sessionId) : undefined) },
		}),
	},
	slots: {
		inject(key, callback) {
			slotInjections.push(key);
			const dispose = callback();
			return typeof dispose === 'function' ? dispose : () => {};
		},
		register(options, component) {
			slotRegistrations.push({ options, component });
			return () => {};
		},
	},
};

// The settings panel is open when the plugin applies, so the glyph swap runs
// during apply through the initial sync.
const openPanel = makePanel();
currentPanel = openPanel.panel;
// Migration runs as soon as the namespace is served, and it has TWO older
// shapes to fold into the library: 1.9.0-early's per-trigger file, and the
// pre-1.9.0 inline payload. This fixture carries both, so it also pins the
// part that used to leave 400KB behind: a payload is adopted even when the
// library already holds a clip.
formWrites.length = 0;
form.value = {
	...baseValue(),
	decisionSound: 'custom',
	customDecisionFile: 'b'.repeat(64) + '.mp3',
	customDecisionName: 'decision.mp3',
	completionSound: 'custom',
	customSound: btoa('good-audio'),
	customSoundName: 'old.mp3',
};
const legacyUploads = fetchCalls.length;
exports.apply(ctx);

await new Promise((resolve) => {
	setTimeout(resolve, 0);
});
assert.equal(
	fetchCalls.slice(legacyUploads).filter((call) => String(call.input).startsWith('/notify-sounds/sound') && call.init?.method === 'POST').length,
	1,
	'only the inline payload is uploaded; the per-trigger file is already stored',
);
const fieldWrites = (field) => formWrites.filter((write) => write.field === field).map((write) => write.value);
assert.deepEqual(fieldWrites('custom1File'), ['b'.repeat(64) + '.mp3'], 'the per-trigger file takes the first slot');
assert.equal(fieldWrites('custom1Name')[0], 'decision.mp3', 'under the name it had');
assert.deepEqual(fieldWrites('custom2File'), ['a'.repeat(64) + '.mp3'], 'the inline payload takes the next free slot rather than staying inline');
assert.equal(fieldWrites('custom2Name')[0], 'old.mp3', 'named after the old display name');
assert.ok(formWrites.some((write) => write.field === 'decisionSound' && write.value === 'custom1'), 'the trigger that used the per-trigger file points at its slot');
assert.ok(formWrites.some((write) => write.field === 'completionSound' && write.value === 'custom2'), 'the trigger that used the inline payload points at its slot');
assert.deepEqual(fieldWrites('customDecisionFile'), [''], 'the old per-trigger reference is cleared once its slot is written');
assert.deepEqual(fieldWrites('customSound'), [''], 'the inline payload is cleared only after the store accepted it');
form.value = baseValue();

// --- Assertions: registration -------------------------------------------------
assert.equal(localeRegistrations.length, 1, 'one dictionary registration');
assert.equal(localeRegistrations[0].ns, 'notify-sounds');
assert.deepEqual(Object.keys(localeRegistrations[0].dicts), ['zh', 'en']);
const zhKeys = Object.keys(localeRegistrations[0].dicts.zh).sort();
const enKeys = Object.keys(localeRegistrations[0].dicts.en).sort();
assert.deepEqual(zhKeys, enKeys, 'zh and en key sets match');

assert.deepEqual(slotInjections, ['settings.section'], 'injects the settings section');
assert.equal(slotRegistrations.length, 1, 'one section registration');
const section = slotRegistrations[0];
assert.equal(section.options.id, 'notify-sounds');
assert.equal(section.options.order, 5);
assert.equal(section.options.name, 'settings.section');
assert.equal(typeof section.options.label, 'function');
assert.equal(section.options.label(), '提示音', 'the nav label resolves through the locale seat');
assert.equal(typeof section.component, 'function');

const injected = section.options.inject();
assert.deepEqual(Object.keys(injected.hooks), ['config'], 'one hook source: config');
assert.equal(typeof injected.setField, 'function');
assert.equal(typeof injected.preview, 'function');

// The stylesheet was installed into the fake head.
assert.equal(document.head.children.length, 1, 'one style tag installed');
assert.ok(document.head.children[0].textContent.includes('gap:12px'), 'section gap present');
assert.ok(document.head.children[0].textContent.includes('--dsh-notify-sounds-fill'), 'slider fill custom property present');

// --- Assertions: nav glyph swap ------------------------------------------------
const swapped = openPanel.cells[1];
const generalCell = openPanel.cells[0];
const glyph = swapped.cell.children[0];
assert.notEqual(glyph, swapped.icon, 'the shipped gear was replaced');
assert.equal(glyph.tagName, 'svg');
assert.equal(glyph.getAttribute('class'), 'wCInkW_navIcon', 'the shell sizing class was copied');
assert.ok(glyph.hasAttribute('data-notify-sounds-icon'), 'the swap is marked');
assert.equal(glyph.getAttribute('stroke-width'), '1.3', 'medium stroke');
assert.equal(glyph.getAttribute('fill'), 'none');
assert.equal(glyph.children.length, 6, 'six alarm-clock paths');
for (const path of glyph.children) {
	assert.equal(path.tagName, 'path');
	assert.equal(path.getAttribute('stroke'), 'currentColor', 'paths follow the nav color');
}
assert.equal(generalCell.cell.children[0], generalCell.icon, 'other cells keep their shipped glyph');
assert.ok(!generalCell.icon.hasAttribute('data-notify-sounds-icon'));

// A rescan does not double-swap: the marked glyph is left alone.
const glyphIdentity = swapped.cell.children[0];
const panelObserver = observers.find((observer) => observer.target === openPanel.panel && observer.options?.subtree === true);
assert.ok(panelObserver, 'a panel-scoped observer was attached');
panelObserver.trigger();
assert.equal(swapped.cell.children[0], glyphIdentity, 'rescan is idempotent');

// React re-creating the cell's children (a fresh shipped gear) gets re-swapped.
const freshGear = fakeNode('svg');
freshGear.setAttribute('class', 'wCInkW_navIcon');
swapped.cell.replaceChild(freshGear, swapped.cell.children[0]);
panelObserver.trigger();
assert.notEqual(swapped.cell.children[0], freshGear, 'a recreated gear is swapped again');

// Closing the panel detaches the panel observer; reopening attaches a new one.
currentPanel = null;
const bodyObserver = observers.find((observer) => observer.target === document.body);
assert.ok(bodyObserver, 'a body-level observer was attached');
assert.deepEqual(bodyObserver.options, { childList: true }, 'body observer is childList-only, no subtree');
bodyObserver.trigger();
assert.ok(panelObserver.disconnected, 'closing the panel detaches the panel observer');

const reopened = makePanel();
currentPanel = reopened.panel;
bodyObserver.trigger();
const reopenedGlyph = reopened.cells[1].cell.children[0];
assert.ok(reopenedGlyph.hasAttribute('data-notify-sounds-icon'), 'a reopened panel gets its glyph swapped');
assert.ok(reopened.cells[0].cell.children[0] === reopened.cells[0].icon, 'and only its own cell');

// Disposing the whileServed registration disconnects both observers.
const servedDisposer = effects.at(-1);
servedDisposer();
assert.ok(bodyObserver.disconnected, 'the body observer is disconnected on dispose');
const activePanelObserver = observers.filter((observer) => observer.target === reopened.panel && !observer.disconnected);
assert.equal(activePanelObserver.length, 0, 'the reopened panel observer is disconnected on dispose');

// --- Assertions: section rendering ---------------------------------------------
const tree = renderTree(
	section.component({
		useConfig: (selector) => selector(form.getSnapshot()),
		setField: injected.setField,
		preview: injected.preview,
		previewSlot: injected.previewSlot,
		uploadSound: injected.uploadSound,
		removeSound: injected.removeSound,
		t: (key) => key,
	})
);
flushEffects();
assert.equal(tree.type, 'div');
assert.equal(tree.children[0].length, 3, 'title, intro, rows');
assert.equal(tree.children[0][0].type, 'h2', 'the title is a heading like the shipped sections');
assert.equal(tree.children[0][1].type, 'p', 'the intro is a paragraph');
const rows = tree.children[0][2].children[0].filter(Boolean);
assert.equal(rows.length, 16, 'sixteen rows render: volume, boost and the sound library');
assert.deepEqual(
	rows.map((row) => row.props.key),
	['enabled', 'volume', 'decision', 'question', 'completion', 'boost', 'custom', 'subagent', 'goalFinalOnly', 'systemNotify', 'titleFlash', 'renotify', 'quiet', 'onlyWhenHidden', 'updateAutoCheck', 'update'],
	'row order: master switch, volume, the three triggers, the custom-sound library row, then sub-agent scope, goal final-round scope, notification, title flash, repeat reminder, quiet hours, hidden-only, the auto-check toggle and the update row',
);

// --- Assertions: uncontrolled volume slider ------------------------------------
let inputElement;
walkElements(tree, (element) => {
	if (element.type === 'input' && element.props.type === 'range') {
		inputElement = element;
	}
});
assert.ok(inputElement, 'the volume slider rendered');
assert.equal(inputElement.props.value, undefined, 'the input is uncontrolled (no value prop)');
assert.equal(inputElement.props.defaultValue, 60, 'the accepted value is the initial DOM value');
const sliderHost = inputElement.host;
assert.equal(sliderHost.style['--dsh-notify-sounds-fill'], '60%', 'the mount effect painted the fill');

// The label span's ref host carries the percentage text.
let labelElement;
walkElements(tree, (element) => {
	if (element.type === 'span' && element.host && element.children[0] === '60%') labelElement = element;
});
assert.ok(labelElement, 'the volume label rendered with the accepted value');

// A drag paints through refs only — no React state, no re-render.
const dragInput = inputElement;
dragInput.host.value = '42';
dragInput.props.onChange({ currentTarget: dragInput.host });
assert.equal(sliderHost.style['--dsh-notify-sounds-fill'], '42%', 'dragging paints the fill directly');
assert.equal(labelElement.host.textContent, '42%', 'dragging updates the label text directly');

// Committing fires once per gesture: pointer-up, then the blur that follows.
dragInput.props.onPointerUp();
assert.deepEqual(formWrites.filter((write) => write.field === 'volume'), [{ field: 'volume', value: 42 }], 'the gesture committed once');
dragInput.props.onBlur();
assert.deepEqual(formWrites.filter((write) => write.field === 'volume'), [{ field: 'volume', value: 42 }], 'the following blur does not double-write');

// --- Assertions: switch write path ----------------------------------------------
// The master switch writes through the form; its busy guard resolves the
// write promise so the row can re-enable itself.
let enabledSwitch;
walkElements(tree, (element) => {
	if (element.type === 'Switch' && element.props.label === 'enabled.title') enabledSwitch = element;
});
assert.ok(enabledSwitch, 'the master switch rendered');
const workingFormSet = form.set;
form.set = () => {
	throw new Error('write failed synchronously');
};
let escapedWriteThrow = false;
try {
	await enabledSwitch.props.onChange(false);
} catch {
	escapedWriteThrow = true;
}
form.set = workingFormSet;
assert.equal(escapedWriteThrow, false, 'a synchronous config-write throw becomes a handled save failure');
await enabledSwitch.props.onChange(false);
assert.deepEqual(formWrites.filter((write) => write.field === 'enabled'), [{ field: 'enabled', value: false }], 'the master switch writes through the form');
// Restore the master switch so the status-trigger assertions below fire.
form.value = { ...form.value, enabled: true };

// --- Assertions: non-finite volume guard -----------------------------------------
// A hand-edited YAML `.nan`/`.inf` volume falls back to the default loudness
// instead of reaching Web Audio, where a non-finite gain would throw.
scheduled.length = 0;
injected.preview('bell', NaN);
assert.equal(scheduled.length, 4, 'a NaN volume falls back to the default loudness');
scheduled.length = 0;
injected.preview('bell', undefined);
assert.equal(scheduled.length, 4, 'a missing volume falls back to the default loudness');
scheduled.length = 0;
injected.preview('bell', 0);
assert.equal(scheduled.length, 0, 'a zero volume stays silent');

// --- Assertions: status triggers -----------------------------------------------
assert.equal(statusListeners.length, 1, 'one status subscription');
assert.ok(renotifyChecker, 'the repeat-reminder checker registered its timer');

// The row and the timer must agree on the interval. Snapping only for DISPLAY
// is what made the control read "5 min" while reminders fired every seven: the
// stored value is any whole minute 1-60, the control offers four.
assert.equal(exports.renotifyInterval(5), 5, 'an offered interval is kept as-is');
assert.equal(exports.renotifyInterval(1), 1, 'so is the shortest one');
assert.equal(exports.renotifyInterval(30), 30, 'and the longest one');
assert.equal(exports.renotifyInterval(7), 5, 'a hand-edited 7 snaps to the nearest offered interval, which the timer also uses');
assert.equal(exports.renotifyInterval(28), 30, 'rounding goes to the nearer neighbour');
assert.equal(exports.renotifyInterval(undefined), 5, 'a missing value falls back to five minutes');
assert.equal(exports.renotifyInterval(Number.NaN), 5, 'and so does a non-numeric one');

/** Publish one status snapshot and run the watcher. */
const publish = (rows) => {
	statusSnapshot = new Map(rows);
	for (const listener of statusListeners) listener();
};

// Decision trigger: a pending approval appears on a session.
scheduled.length = 0;
publish([['s1', { running: true, pendingInteraction: { kind: 'approval' }, completionUnread: false }]]);
assert.equal(scheduled.length, 4, 'bell preset schedules four voices (two notes + partials)');

// Cooldown: a second decision within the window stays silent.
scheduled.length = 0;
publish([['s1', { running: true, pendingInteraction: { kind: 'approval', key: 'approval:2' }, completionUnread: false }]]);
assert.equal(scheduled.length, 0, 'retrigger cooldown suppresses the second decision sound');
// The cooldown is per session: another conversation asking within the same
// window is a second event, not an echo — it fires too. (s1 stays in the
// snapshot so its own running → idle edge below still registers.)
scheduled.length = 0;
publish([
	['s1', { running: true, pendingInteraction: { kind: 'approval', key: 'approval:2' }, completionUnread: false }],
	['s2', { running: true, pendingInteraction: { kind: 'approval' }, completionUnread: false }],
]);
assert.equal(scheduled.length, 4, 'a decision from another session within the window still fires');

// Completion trigger: running -> idle (after the cooldown window).
await new Promise((resolve) => {
	setTimeout(resolve, 30);
});
form.value = { ...baseValue(), completionSound: 'arc' };
scheduled.length = 0;
publish([['s1', { running: false, pendingInteraction: undefined, completionUnread: true }]]);
assert.equal(scheduled.length, 4, 'arc preset schedules four voices');

// Muted master switch suppresses playback.
await new Promise((resolve) => {
	setTimeout(resolve, 30);
});
form.value = { ...baseValue(), enabled: false };
scheduled.length = 0;
publish([['s2', { running: true, pendingInteraction: undefined, completionUnread: false }]]);
publish([['s2', { running: false, pendingInteraction: undefined, completionUnread: true }]]);
assert.equal(scheduled.length, 0, 'disabled preference mutes the completion sound');
// --- Goal mode: intermediate rounds stay silent, the goal end chimes once ---
form.value = { ...baseValue(), goalFinalOnly: true, completionSound: 'arc' };
sessionRowsById.s7 = { origin: 'main' };
goalPhases.set('s7', 'active');
scheduled.length = 0;
publish([['s7', { running: true, pendingInteraction: undefined, completionUnread: false }]]);
publish([['s7', { running: false, pendingInteraction: undefined, completionUnread: true }]]);
await new Promise((resolve) => { setTimeout(resolve, 60); });
assert.equal(scheduled.length, 0, 'an intermediate goal round stays silent');
goalPhases.set('s7', 'complete');
await new Promise((resolve) => { setTimeout(resolve, 2200); });
assert.equal(scheduled.length, 4, 'the end of the goal chimes once');
scheduled.length = 0;
sessionRowsById.s8 = { origin: 'main' };
goalPhases.set('s8', 'complete');
publish([['s8', { running: true, pendingInteraction: undefined, completionUnread: false }]]);
publish([['s8', { running: false, pendingInteraction: undefined, completionUnread: true }]]);
await new Promise((resolve) => { setTimeout(resolve, 80); });
assert.equal(scheduled.length, 4, 'a finished goal chimes on its completion edge');
scheduled.length = 0;
sessionRowsById.s9 = { origin: 'main' };
publish([['s9', { running: true, pendingInteraction: undefined, completionUnread: false }]]);
publish([['s9', { running: false, pendingInteraction: undefined, completionUnread: true }]]);
await new Promise((resolve) => { setTimeout(resolve, 80); });
assert.equal(scheduled.length, 4, 'a session without a goal chimes as before');
scheduled.length = 0;
sessionRowsById.s10 = { origin: 'main' };
form.value = { ...baseValue(), goalFinalOnly: true, completionSound: 'arc' };
goalPhases.set('s10', 'active');
publish([['s10', { running: true, pendingInteraction: undefined, completionUnread: false }]]);
publish([['s10', { running: false, pendingInteraction: undefined, completionUnread: true }]]);
await new Promise((resolve) => { setTimeout(resolve, 60); });
// The user turns the switch OFF while the watcher waits. That is the whole
// reason they turned it off: they do not want the chime it is holding. The
// wait was commissioned by the preference, so withdrawing the preference
// withdraws the commission — the next completion edge, with the switch off,
// alerts normally.
form.value = { ...baseValue(), goalFinalOnly: false, completionSound: 'arc' };
goalPhases.set('s10', 'complete');
await new Promise((resolve) => { setTimeout(resolve, 2200); });
assert.equal(scheduled.length, 0, 'switching goal-only off mid-wait cancels the chime it was waiting to make');
form.value = baseValue();
goalPhases.clear();

// --- Assertions: question routing, custom sound, quiet hours --------------------
// Let every per-kind cooldown lapse so the later triggers fire on merit.
await new Promise((resolve) => {
	setTimeout(resolve, 2100);
});

// A pending question routes to the question preset, not the decision one.
form.value = { ...baseValue(), questionSound: 'chime' };
scheduled.length = 0;
publish([['s3', { running: true, pendingInteraction: { kind: 'question', questions: [{ question: '继续吗？' }] } }]]);
assert.equal(scheduled.length, 3, 'a pending question plays the chime preset (three voices)');

// The custom preset decodes the uploaded payload and plays it through a buffer source.
form.value = { ...baseValue(), customSound: btoa('good-audio'), decisionSound: 'custom' };
scheduled.length = 0;
publish([['s3b', { running: true, pendingInteraction: { kind: 'approval', displayReason: '允许执行命令' } }]]);
await new Promise((resolve) => {
	setTimeout(resolve, 10);
});
assert.ok(scheduled.length >= 1, 'the custom preset scheduled playback');
assert.ok(scheduled.at(-1).buffer !== undefined, 'the custom preset plays through a buffer source');
assert.ok(scheduled.at(-1).buffer.getChannelData !== undefined, 'the decoded buffer is cached and playable');

// A picker left on `custom` with no upload falls back to the decision preset.
form.value = { ...baseValue(), decisionSound: 'custom', customSound: '' };
scheduled.length = 0;
publish([['s4', { running: true, pendingInteraction: { kind: 'approval', displayReason: '允许执行命令' } }]]);
assert.equal(scheduled.filter((node) => node.buffer === undefined).length, 4, 'custom without an upload falls back to the bell preset');
assert.equal(scheduled.filter((node) => node.buffer !== undefined).length, 0, 'no buffer source was scheduled');

// A malformed `customSound` (a hand-edited config can carry one) must not
// escape as an exception: this path runs inside the session-status diff and the
// repeat-reminder interval, so an escaping throw aborts the whole read and
// takes the title flash and the reminder tracker down with it.
form.value = { ...baseValue(), decisionSound: 'custom', customSound: '!!!not base64!!!' };
scheduled.length = 0;
let threwFromPreview = false;
try {
	injected.previewSound('custom1', 60);
} catch {
	threwFromPreview = true;
}
assert.equal(threwFromPreview, false, 'a malformed custom payload does not throw when previewed');
let threwFromTrigger = false;
try {
	publish([['s5', { running: true, pendingInteraction: { kind: 'approval', displayReason: '允许执行命令' } }]]);
} catch {
	threwFromTrigger = true;
}
assert.equal(threwFromTrigger, false, 'a malformed custom payload does not throw from the status trigger');
// The tracker must still be alive: a later decision still fires. The wait
// clears the 2s retrigger cooldown the previous publish started.
await new Promise((resolve) => {
	setTimeout(resolve, 2100);
});
form.value = { ...baseValue(), decisionSound: 'bell' };
scheduled.length = 0;
publish([['s6', { running: true, pendingInteraction: { kind: 'approval', displayReason: '允许执行命令' } }]]);
assert.ok(scheduled.length > 0, 'the trigger pipeline keeps working after a malformed payload');

// Quiet hours covering now suppress the completion sound entirely.
const pad = (value) => String(value).padStart(2, '0');
const hhmm = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const now = new Date();
form.value = { ...baseValue(), quietHours: true, quietStart: hhmm(now), quietEnd: hhmm(new Date(now.getTime() - 60000)) };
scheduled.length = 0;
publish([['s5', { running: true, pendingInteraction: undefined, completionUnread: false }]]);
publish([['s5', { running: false, pendingInteraction: undefined, completionUnread: true }]]);
assert.equal(scheduled.length, 0, 'quiet hours covering the current minute suppress the sound');

// --- Assertions: title alert and system notification ----------------------------
// The title alert tracks pending decisions while the page is hidden, and says so
// in words rather than a symbol.
form.value = { ...baseValue(), titleFlash: true };
document.visibilityState = 'hidden';
scheduled.length = 0;
publish([['s6', { running: true, pendingInteraction: { kind: 'approval' } }]]);
assert.ok(document.title.startsWith('待处理 '), 'a hidden page with a pending decision is marked 待处理');
// The app assigns the whole title when the session title changes; the mark is
// restored rather than left erased.
document.title = '某会话 — DeepSeek Harness';
dispatchTitleMutation();
assert.ok(document.title.startsWith('待处理 '), 'the mark is restored after the app rewrites the title');
document.visibilityState = 'visible';
dispatchDocumentEvent('visibilitychange');
assert.ok(!document.title.startsWith('待处理 '), 'returning to the page clears the title mark');
form.value = { ...baseValue() };

// The "finished" mark is unread news, not a standing idle fact.
form.value = { ...baseValue(), titleFlash: true };
// A finish the user watches happen is not news: the edge fires while the page
// is visible, so hiding afterwards must not mark it.
publish([['s6', { running: false }]]);
document.visibilityState = 'hidden';
dispatchDocumentEvent('visibilitychange');
assert.ok(!document.title.startsWith('已完成 '), 'a finish watched while visible does not mark after hiding');
// Hiding over an OLD finish is not news either: no new edge, no mark.
publish([['s6', { running: false }]]);
assert.ok(!document.title.startsWith('已完成 '), 'an idle hidden page with no unread finish is not marked');
// A finish that happens while the page is hidden IS news.
publish([['s6', { running: true }]]);
publish([['s6', { running: false }]]);
assert.ok(document.title.startsWith('已完成 '), 'a finish while the page is hidden is marked 已完成');
// A running session is work in progress, not news, so no mark.
publish([['s6', { running: true }]]);
assert.ok(!document.title.startsWith('已完成 '), 'a running session is not marked');
// Quiet hours suppress the title alert as well as sounds and notifications.
form.value = {
	...baseValue(),
	titleFlash: true,
	quietHours: true,
	quietStart: hhmm(new Date()),
	quietEnd: hhmm(new Date(Date.now() - 60000)),
};
publish([['s6', { running: false }]]);
assert.ok(!document.title.startsWith('已完成 '), 'quiet hours suppress the title alert');
// Returning to the page retires the mark — and it does NOT come back on the
// next switch-away: the finish has been seen.
document.visibilityState = 'visible';
dispatchDocumentEvent('visibilitychange');
assert.ok(!document.title.startsWith('已完成 '), 'returning clears the mark');
form.value = { ...baseValue(), titleFlash: true };
document.visibilityState = 'hidden';
dispatchDocumentEvent('visibilitychange');
assert.ok(!document.title.startsWith('已完成 '), 'a seen finish does not re-mark on the next switch-away');
document.visibilityState = 'visible';
dispatchDocumentEvent('visibilitychange');
form.value = { ...baseValue() };

// The system notification carries the interaction's own summary text.
// (Another cooldown lapse: the question trigger fired moments ago.)
await new Promise((resolve) => {
	setTimeout(resolve, 2100);
});
form.value = { ...baseValue(), systemNotify: true };
document.visibilityState = 'hidden';
notifications.length = 0;
scheduled.length = 0;
publish([['s7', { running: true, pendingInteraction: { kind: 'question', questions: [{ question: '继续吗？' }] } }]]);
assert.equal(notifications.length, 1, 'a hidden page shows one system notification');
assert.equal(notifications[0].options.body, '继续吗？', 'the notification body uses the question text');
assert.equal(notifications[0].options.tag, undefined, 'the platform tag is not used — tag replacement can drop the click');
assert.equal(scheduled.length, 3, 'the sound still plays alongside the notification');
// Clicking the notification asks the Host focus route to raise the window.
fetchCalls.length = 0;
notifications[0].onclick();
assert.equal(fetchCalls.length, 1, 'the notification click posts to the focus route');
assert.equal(fetchCalls[0].input, '/notify-sounds/focus', 'the focus route path matches the Host half');
assert.equal(fetchCalls[0].init.method, 'POST', 'the focus request is a POST');
// The click posts to the Host focus route and says nothing about it: the
// window coming back IS the feedback.
assert.equal(notifications.length, 1, 'a click raises no follow-up notification');
assert.equal(notifications[0].options.requireInteraction, undefined, 'toasts auto-dismiss');
document.visibilityState = 'visible';
form.value = { ...baseValue() };

// --- Assertions: repeat reminder ------------------------------------------------
// The reminder exists only to reach someone who has NOT seen the decision.
// Seen once — it appeared while the user was at the window, or they came back
// to it — it never repeats again, not even after they switch away. Only a
// decision that appeared while the window was elsewhere is re-pinged, on its
// own cadence, until it is handled or seen.
form.value = { ...baseValue(), renotify: true, renotifyMinutes: 1 };
const realDateNow = Date.now;
/** Run the reminder checker at a moment offset from the real clock. */
const checkAt = (offsetMs) => {
	Date.now = () => realDateNow() + offsetMs;
	try {
		renotifyChecker();
	} finally {
		Date.now = realDateNow;
	}
};

// Case 1: it appeared while the page was visible, so the user has already seen
// it. Switching away afterwards must NOT re-arm it for another round — that
// re-arm is what used to ring a full interval after the user had read it.
document.visibilityState = 'visible';
publish([['s7', { running: true, pendingInteraction: { kind: 'question', questions: [{ question: '继续吗？' }] } }]]);
document.visibilityState = 'hidden';
scheduled.length = 0;
checkAt(120000);
assert.equal(scheduled.length, 0, 'a decision seen at the window is never re-pinged, even after switching away');

// Case 2: it appeared while the window was elsewhere and was never seen, so it
// re-pings on the interval — and the cadence advances from the ping, not from
// the moment the decision appeared.
document.visibilityState = 'hidden';
form.value = { ...baseValue(), renotify: true, renotifyMinutes: 1, systemNotify: true };
notifications.length = 0;
publish([['s8', { running: true, pendingInteraction: { kind: 'approval' } }]]);
assert.equal(notifications.length, 1, 'the decision notifies while the page is hidden');
scheduled.length = 0;
checkAt(30000);
assert.equal(scheduled.length, 0, 'an unseen decision is not re-pinged before the interval elapses');
scheduled.length = 0;
checkAt(130000);
assert.equal(scheduled.length, 4, 'an unseen decision re-pings through the decision preset after the interval');
assert.equal(notifications.length, 2, 'the repeat reminder re-notifies');
assert.equal(notifications[0].closed, true, 'the superseded toast is closed by us rather than left to tag replacement');
assert.equal(notifications[1].options.tag, undefined, 'the reminder is collapsed by us rather than by a platform tag');
scheduled.length = 0;
checkAt(180000);
assert.equal(scheduled.length, 0, 'the next re-ping waits a full interval after the previous one');

// The toggle gates the reminder, on a decision that is still unseen.
form.value = { ...baseValue(), renotify: false };
scheduled.length = 0;
checkAt(250000);
assert.equal(scheduled.length, 0, 'the repeat reminder is silent while disabled');

// Case 3: coming back to the window SEES the decision, so it leaves the
// reminder for good — switching away again does not revive it.
form.value = { ...baseValue(), renotify: true, renotifyMinutes: 1 };
document.visibilityState = 'visible';
dispatchDocumentEvent('visibilitychange');
document.visibilityState = 'hidden';
scheduled.length = 0;
checkAt(300000);
assert.equal(scheduled.length, 0, 'returning to the window ends the repeats for good');

// A page being watched right now is never pinged, even past the interval and
// even before its visibility event has been delivered.
document.visibilityState = 'hidden';
publish([['s9', { running: true, pendingInteraction: { kind: 'approval' } }]]);
document.visibilityState = 'visible';
scheduled.length = 0;
checkAt(400000);
assert.equal(scheduled.length, 0, 'a watched page is not re-pinged even past the interval');
document.visibilityState = 'visible';

// --- Assertions: new presets ----------------------------------------------------
scheduled.length = 0;
injected.preview('coin', 60);
assert.equal(scheduled.length, 2, 'coin preset schedules two voices');
scheduled.length = 0;
injected.preview('success', 60);
assert.equal(scheduled.length, 3, 'success preset schedules three voices');
scheduled.length = 0;
injected.preview('knock', 60);
assert.equal(scheduled.length, 2, 'knock preset schedules two voices');

// --- Assertions: picker dropdown wiring -----------------------------------------
// The pickers offer every preset except `custom` while no upload exists,
// and every entry carries a non-empty label (the real Menu renders
// `entry.label`; a wrong field name would show blank rows).
const menuItems = [];
walkElements(tree, (element) => {
	if (element.props['data-menu-item'] !== undefined) menuItems.push(element);
});
assert.equal(menuItems.length, 30, 'three pickers render nine presets and Off while the library is empty');
assert.ok(!menuItems.some((element) => element.props['data-menu-item'].startsWith('custom')), 'no picker offers a custom entry while the library is empty');
assert.ok(menuItems.every((element) => typeof element.children[0] === 'string' && element.children[0] !== ''), 'every menu entry carries a non-empty label');
// Clicking a menu item writes the field and previews the sound.
scheduled.length = 0;
const coinItem = menuItems.find((element) => element.props['data-menu-item'] === 'coin');
coinItem.props.onClick();
assert.deepEqual(formWrites.at(-1), { field: 'decisionSound', value: 'coin' }, 'picking a menu item writes the field');
assert.equal(scheduled.length, 2, 'picking a menu item previews the sound');

// --- Assertions: the custom-sound library --------------------------------------
// One row adds a clip; each clip then appears under it and in all three
// pickers, so a trigger picks a recording by name rather than by position.
const renderSection = () => renderTree(section.component({
	useConfig: (selector) => selector(form.getSnapshot()),
	setField: injected.setField,
	preview: injected.preview,
	previewSound: injected.previewSound,
	onAddSound: injected.onAddSound,
	onRemoveSound: injected.onRemoveSound,
	t: (key) => key,
}));
const menuItemsOf = (treeNode) => {
	const found = [];
	walkElements(treeNode, (element) => {
		if (element.props?.['data-menu-item'] !== undefined) found.push(element);
	});
	return found;
};

form.value = { ...baseValue() };
const baseTree = renderSection();
const addInputs = [];
walkElements(baseTree, (element) => {
	if (element.type === 'input' && element.props.type === 'file') addInputs.push(element);
});
assert.equal(addInputs.length, 1, 'the library row owns the only file input');
assert.equal(menuItemsOf(baseTree).length, 30, 'nine presets and Off, in three pickers, while the library is empty');

const makeFile = (name, bytes, size = bytes.byteLength) => ({
	name,
	size,
	arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});
const addTo = async (input, file) => {
	const before = fetchCalls.length;
	await input.props.onChange({ currentTarget: { files: [file], value: 'x' } });
	return fetchCalls.slice(before);
};

// Adding one clip: the bytes go to the store, the slot keeps the name.
formWrites.length = 0;
const added = await addTo(addInputs[0], makeFile('ring.mp3', new TextEncoder().encode('good-audio')));
assert.equal(
	added.filter((call) => String(call.input).startsWith('/notify-sounds/sound') && call.init?.method === 'POST').length,
	1,
	'the bytes are POSTed to the sound store',
);
assert.deepEqual(
	formWrites.filter((write) => write.field.startsWith('custom1')),
	[
		{ field: 'custom1File', value: 'a'.repeat(64) + '.mp3' },
		{ field: 'custom1Name', value: 'ring' },
	],
	'the clip lands in the first slot, named after the file without its extension',
);

// It shows up in every picker under that name.
const filledTree = renderSection();
const filledItems = menuItemsOf(filledTree);
assert.equal(filledItems.length, 33, 'the clip adds one entry to each picker');
const customEntry = filledItems.find((element) => element.props['data-menu-item'] === 'custom1');
assert.ok(customEntry, 'the clip is offered by slot id');
assert.equal(customEntry.children[0], 'ring', 'and labelled with the name the user can change');

// The closed trigger reads its text from the same list. A clip has no
// `sound.<id>` dictionary entry, so looking it up by id printed the raw key.
const triggerLabels = (treeNode) => {
	const labels = [];
	walkElements(treeNode, (element) => {
		if (element.type === 'Button' && element.props?.['aria-haspopup'] === 'menu') labels.push(element.children[0]);
	});
	return labels;
};
assert.ok(!triggerLabels(filledTree).some((label) => /^sound\.custom[123]$/.test(label)), 'no trigger prints a raw key for a clip slot');
form.value = { ...form.value, decisionSound: 'custom1' };
const chosenTree = renderSection();
assert.equal(triggerLabels(chosenTree)[0], 'ring', 'a trigger on a clip shows the clip name, not its id');

// A second 试听 silences the first instead of stacking on top of it.
form.value = { ...baseValue(), decisionSound: 'bell' };
scheduled.length = 0;
injected.preview('bell', 60);
const firstPreview = [...scheduled];
injected.preview('bell', 60);
assert.ok(firstPreview.length > 0, 'the first preview scheduled something');
assert.ok(firstPreview.every((node) => node.stopped === true), 'a second preview stops the first');
assert.equal(scheduled.filter((node) => node.stopped !== true).length, scheduled.length - firstPreview.length, 'and only the new batch is left sounding');

// The clip path goes through a decode, so a click that arrives before the
// first decode finishes must be dropped rather than join it.
form.value = { ...baseValue(), custom1File: 'a'.repeat(64) + '.mp3', custom1Name: 'ring' };
scheduled.length = 0;
injected.previewSound('custom1', 60);
injected.previewSound('custom1', 60);
await new Promise((resolve) => {
	setTimeout(resolve, 10);
});
assert.equal(scheduled.filter((node) => node.stopped !== true && node.buffer !== undefined).length, 1, 'two quick clicks on a clip leave one sound playing');

// Every preset is scaled to one peak, so a slider value means a single
// loudness whichever sound is selected. The peak is recomputed here
// independently of the client's own measurement.
const envelopeAt = (note, t) => {
	if (t < note.at) return 0;
	const peak = note.gain * 0.25;
	const attackEnd = note.at + 0.012;
	if (t <= attackEnd) return 0.0001 * Math.pow(peak / 0.0001, (t - note.at) / 0.012);
	const end = note.at + note.dur;
	if (t >= end) return 0;
	return peak * Math.pow(0.0001 / peak, (t - attackEnd) / (end - attackEnd));
};
const levelled = Object.entries(exports.SOUND_PRESETS).map(([id, preset]) => {
	let top = 0;
	for (let t = 0; t < 2; t += 0.002) {
		let sum = 0;
		for (const note of preset.notes) sum += envelopeAt(note, t);
		if (sum > top) top = sum;
	}
	return top * exports.PRESET_LEVEL[id];
});
assert.ok(Math.max(...levelled) - Math.min(...levelled) < 0.02, 'all nine presets land on the same peak');
assert.ok(Math.abs(levelled[0] - 0.95) < 0.02, 'and that peak is the intended level');

// The boost switch doubles the master gain and puts a limiter in the path;
// unboosted playback stays on the direct path, where nothing colours it.
form.value = { ...form.value, boost: true };
limiters.length = 0;
injected.preview('bell', 100);
assert.equal(limiters.length, 1, 'boost routes playback through a limiter');
form.value = { ...form.value, boost: false };
limiters.length = 0;
injected.preview('bell', 100);
assert.equal(limiters.length, 0, 'unboosted playback stays direct');

// A trigger choosing it plays the stored file.
form.value = { ...form.value, decisionSound: 'custom1' };
scheduled.length = 0;
publish([['lib1', { running: true, pendingInteraction: { kind: 'approval', displayReason: '允许执行命令' } }]]);
await new Promise((resolve) => {
	setTimeout(resolve, 10);
});
assert.ok(scheduled.some((node) => node.buffer !== undefined), 'a trigger on a library clip plays through a buffer source');

// Renaming commits on blur, and only when it actually changed.
formWrites.length = 0;
const namedTree = renderSection();
let nameField;
walkElements(namedTree, (element) => {
	if (element.type === 'input' && element.props.type === 'text' && element.props['aria-label'] === 'custom.rename') nameField = element;
});
assert.ok(nameField, 'each clip exposes an editable name');
assert.equal(nameField.props.defaultValue, 'ring', 'prefilled with the current name');
nameField.props.onBlur({ currentTarget: { value: '  门铃声  ' } });
assert.deepEqual(formWrites.filter((write) => write.field === 'custom1Name'), [{ field: 'custom1Name', value: '门铃声' }], 'a blurred name commits, trimmed');
formWrites.length = 0;
nameField.props.onBlur({ currentTarget: { value: '   ' } });
assert.equal(formWrites.length, 0, 'an empty name is ignored rather than written');

// The four refusals happen before anything is sent or written.
for (const [file, label] of [
	[makeFile('big.mp3', new Uint8Array(8), 4 * 1024 * 1024), 'oversized'],
	[makeFile('bad.mp3', new TextEncoder().encode('not-audio')), 'undecodable'],
	[makeFile('long.mp3', new TextEncoder().encode('long-audio')), 'over-long'],
	[makeFile('silent.mp3', new TextEncoder().encode('silent-audio')), 'silent'],
]) {
	const writesBefore = formWrites.length;
	const callsBefore = fetchCalls.length;
	await addTo(addInputs[0], file);
	assert.equal(formWrites.length, writesBefore, `an ${label} file writes nothing`);
	assert.equal(fetchCalls.length, callsBefore, `an ${label} file never reaches the store`);
}

// Three clips fill the library; the add button is disabled and the row says why.
form.value = {
	...baseValue(),
	custom1File: 'a'.repeat(64) + '.mp3',
	custom1Name: '一',
	custom2File: 'b'.repeat(64) + '.mp3',
	custom2Name: '二',
	custom3File: 'c'.repeat(64) + '.mp3',
	custom3Name: '三',
};
const fullTree = renderSection();
let addButton;
walkElements(fullTree, (element) => {
	if (element.type === 'Button' && element.children?.[0] === 'custom.add') addButton = element;
});
assert.ok(addButton, 'the add button is there');
assert.equal(addButton.props.disabled, true, 'and disabled once three clips exist');
let limitShown = false;
walkElements(fullTree, (element) => {
	if (element.children?.[0] === 'custom.limit') limitShown = true;
});
assert.ok(limitShown, 'the row explains the limit');

// Removing a clip clears its slot, moves the trigger off it, and deletes the
// file once nothing references it.
form.value = {
	...baseValue(),
	custom1File: 'a'.repeat(64) + '.mp3',
	custom1Name: 'ring',
	decisionSound: 'custom1',
	custom2File: 'a'.repeat(64) + '.mp3',
	custom2Name: 'same file',
};
const removeTree = renderSection();
let removeButton;
walkElements(removeTree, (element) => {
	if (element.type === 'Button' && element.children?.[0] === 'custom.remove') {
		removeButton = removeButton ?? element;
	}
});
assert.ok(removeButton, 'each clip has a remove action');
formWrites.length = 0;
const callsBeforeRemove = fetchCalls.length;
await removeButton.props.onClick();
assert.deepEqual(
	formWrites.filter((write) => write.field.startsWith('custom1')),
	[
		{ field: 'custom1File', value: '' },
		{ field: 'custom1Name', value: '' },
	],
	'removing clears the slot',
);
assert.ok(formWrites.some((write) => write.field === 'decisionSound' && write.value === 'bell'), 'and moves the trigger back to its preset');
assert.equal(
	fetchCalls.slice(callsBeforeRemove).filter((call) => call.init?.method === 'DELETE').length,
	0,
	'a file the other slot still uses is not deleted',
);

form.value = {
	...baseValue(),
	custom1File: 'a'.repeat(64) + '.mp3',
	custom1Name: 'ring',
	decisionSound: 'custom1',
};
const lastTree = renderSection();
let lastRemove;
walkElements(lastTree, (element) => {
	if (element.type === 'Button' && element.children?.[0] === 'custom.remove') lastRemove = lastRemove ?? element;
});
const callsBeforeDelete = fetchCalls.length;
await lastRemove.props.onClick();
assert.equal(
	fetchCalls.slice(callsBeforeDelete).filter((call) => call.init?.method === 'DELETE').length,
	1,
	'the last reference deletes the stored file',
);

// A clip no trigger uses says so, so an added-but-forgotten recording is visible.
form.value = { ...baseValue(), custom1File: 'a'.repeat(64) + '.mp3', custom1Name: 'ring' };
const unusedTree = renderSection();
let unusedShown = false;
walkElements(unusedTree, (element) => {
	if (element.children?.[0] === 'custom.unused') unusedShown = true;
});
assert.ok(unusedShown, 'an unused clip is marked as such');

// A clip whose file is gone is checked with a HEAD and reported.
soundMissing = true;
const missingTree = renderSection();
flushEffects();
await new Promise((resolve) => {
	setTimeout(resolve, 0);
});
assert.ok(fetchCalls.some((call) => call.init?.method === 'HEAD'), 'the check is a HEAD, not a download');
assert.ok(localeRegistrations[0].dicts.zh['custom.missing'] && localeRegistrations[0].dicts.en['custom.missing'], 'and the row has copy to show when it 404s');
soundMissing = false;

// A write through the section's setField reaches the form.
await injected.setField('volume', 42);
assert.deepEqual(formWrites.at(-1), { field: 'volume', value: 42 });

// --- Assertions: quiet-hours inputs and a refused permission --------------------
// A cleared time field is the control being emptied, not a value the schema can
// accept (it wants "HH:MM"): it snaps back to the accepted value instead of
// committing a write that is certain to be refused — which would report a
// baffling "save failed" on a row the user was only half-way through editing.
const timeInputs = [];
walkElements(tree, (element) => {
	if (element.type === 'input' && element.props.type === 'time') timeInputs.push(element);
});
assert.equal(timeInputs.length, 2, 'the quiet-hours row renders its two time inputs');
const writesBeforeClear = formWrites.length;
const clearedInput = { value: '' };
timeInputs[0].props.onChange({ currentTarget: clearedInput });
assert.equal(clearedInput.value, '22:00', 'a cleared time input snaps back to the accepted value');
assert.equal(formWrites.length, writesBeforeClear, 'a cleared time input writes nothing');
timeInputs[0].props.onChange({ currentTarget: { value: '23:30' } });
assert.deepEqual(formWrites.at(-1), { field: 'quietStart', value: '23:30' }, 'a usable time is committed');

// A rejected permission request is a denial by any other name: the switch must
// settle on `false` rather than leave an unhandled rejection behind and a
// toggle that claims an enable nothing will honour.
let systemNotifySwitch;
walkElements(tree, (element) => {
	if (element.type === 'Switch' && element.props.label === 'systemNotify.title') systemNotifySwitch = element;
});
assert.ok(systemNotifySwitch, 'the system-notification switch rendered');
const realRequestPermission = Notification.requestPermission;
Notification.requestPermission = () => Promise.reject(new Error('denied'));
form.value = { ...baseValue() };
const writesBeforePermission = formWrites.length;
await systemNotifySwitch.props.onChange(true);
Notification.requestPermission = realRequestPermission;
assert.deepEqual(
	formWrites.slice(writesBeforePermission),
	[{ field: 'systemNotify', value: false }],
	'a refused permission request leaves the switch off instead of throwing',
);
// The same verdict when requestPermission throws SYNCHRONOUSLY: the throw has
// to land in the rejection path instead of escaping the handler untouched.
Notification.requestPermission = () => {
	throw new Error('denied synchronously');
};
const writesBeforeThrow = formWrites.length;
let threwFromPermission = false;
try {
	await systemNotifySwitch.props.onChange(true);
} catch {
	threwFromPermission = true;
}
Notification.requestPermission = realRequestPermission;
assert.equal(threwFromPermission, false, 'a synchronous throw from requestPermission does not escape');
assert.deepEqual(
	formWrites.slice(writesBeforeThrow),
	[{ field: 'systemNotify', value: false }],
	'and the switch still settles on off',
);

// --- Assertions: sub-agent alerts ----------------------------------------------
// Sub-agent sessions are invisible to the plugin unless asked for: the point
// is the user's own conversation, and a background sub-agent finishing is not
// something they want a chime for.
sessionRowsById.sub1 = { id: 'sub1', origin: 'subagent', parentId: 's1' };
form.value = { ...baseValue() };
await new Promise((resolve) => {
	setTimeout(resolve, 2100);
});
scheduled.length = 0;
publish([['sub1', { running: true, pendingInteraction: undefined }]]);
publish([['sub1', { running: false, pendingInteraction: undefined, completionUnread: true }]]);
assert.equal(scheduled.length, 0, 'a sub-agent finishing stays silent by default');
scheduled.length = 0;
publish([['sub1', { running: true, pendingInteraction: { kind: 'approval' } }]]);
assert.equal(scheduled.length, 0, 'and so does a sub-agent decision');
// A forked conversation carries a `parentId` too and is still the user's own:
// only `origin` marks a sub-agent, exactly as DSH's own sidebar decides it.
sessionRowsById.fork1 = { id: 'fork1', parentId: 's1' };
scheduled.length = 0;
publish([['fork1', { running: false, pendingInteraction: undefined }]]);
publish([['fork1', { running: true, pendingInteraction: undefined }]]);
publish([['fork1', { running: false, pendingInteraction: undefined, completionUnread: true }]]);
assert.ok(scheduled.length > 0, 'a forked conversation still alerts — it is the user’s own');
// Asked for, the same transitions alert like any other session.
form.value = { ...baseValue(), subagentAlerts: true };
await new Promise((resolve) => {
	setTimeout(resolve, 2100);
});
scheduled.length = 0;
publish([['sub1', { running: true, pendingInteraction: undefined }]]);
publish([['sub1', { running: false, pendingInteraction: undefined, completionUnread: true }]]);
assert.ok(scheduled.length > 0, 'with sub-agent alerts on, a sub-agent finishing alerts normally');

// --- Assertions: update check row ------------------------------------------------
// The row asks the Host's fixed check route — a read-only query, nothing
// downloaded — and the button asks again with force. The URL is asserted
// because it is the one place this page reaches for the outside world.
const updateButtons = [];
walkElements(tree, (element) => {
	if (element.type === 'Button' && Array.isArray(element.children) && element.children[0] === 'update.check') updateButtons.push(element);
});
assert.equal(updateButtons.length, 1, 'the update row renders one check button');
let idleStatus = false;
walkElements(tree, (element) => {
	if (element.type === 'div' && Array.isArray(element.children) && element.children[0] === 'update.idle') idleStatus = true;
});
assert.ok(idleStatus, 'the update row starts at "not checked yet"');
fetchCalls.length = 0;
updateButtons[0].props.onClick();
assert.equal(fetchCalls.length, 1, 'checking asks the Host exactly once');
assert.equal(fetchCalls[0].input, '/notify-sounds/update/check?force=1', 'the check goes to the fixed route with force');
assert.equal(fetchCalls[0].init.method, 'GET', 'the check is a GET');

// --- Assertions: BUG-1 regression — suspended AudioContext -------------------
// A suspended context has a frozen currentTime; scheduling on it parks
// sources that all fire at once when resumed (the "phantom burst" bug).
// whenRunning() avoids this by not scheduling until the context can play.
{
	// Clean form state so the trigger is not suppressed by an earlier test.
	form.value = { ...baseValue() };
	const engine = globalThis.window.AudioContext._lastInstance;
	assert.ok(engine, 'the audio engine exists from earlier tests');

	// ① Suspend the context — as a browser would before any user gesture.
	engine.state = 'suspended';
	scheduled.length = 0;
	publish([['sus1', { pendingInteraction: { kind: 'question', question: 'Q?' } }]]);
	assert.equal(scheduled.length, 0, 'nothing is scheduled while the context is suspended');

	// ② resume() flips to running; the deferred play() runs on the next microtask.
	await new Promise((r) => setTimeout(r, 10));
	assert.ok(scheduled.length > 0, 'the deferred sound plays once resume() flips the context to running');

	// ③ The unlock effect calls resume() on first pointerdown, and its
	//    listeners are cleaned up when the effect is disposed.
	engine.state = 'suspended';
	let resumeCalls = 0;
	const origResume = engine.resume.bind(engine);
	engine.resume = () => {
		resumeCalls++;
		engine.state = 'running';
		return Promise.resolve();
	};
	// Dispatch a synthetic pointerdown through the fake DOM's listener map.
	for (const fn of documentListeners['pointerdown'] ?? []) fn();
	assert.ok(resumeCalls > 0, 'the unlock effect calls resume() on pointerdown');
	engine.resume = origResume;

	// ③ Cleanup: dispose the plugin's effects (fiber teardown), then verify
	//    the unlock listener is gone — pointerdown should no longer call resume.
	const beforeDispose = resumeCalls;
	for (const dispose of effects) dispose();
	for (const fn of documentListeners['pointerdown'] ?? []) fn();
	assert.equal(resumeCalls, beforeDispose, 'the unlock listener is removed after the effect is disposed');
}

// --- The update copy: one command shape, one destination -----------------------
// A user's only contact with the updater is this row, and every install
// instruction in it gets pasted into a package manager. These assertions pin
// the two things that were already wrong once: the destination (the desktop
// plugin manager is a SIDEBAR panel, not a Settings page) and the version pin
// (a release younger than pnpm's `minimumReleaseAge` window resolves back to
// the previous one when the command names only the package).
{
	const dict = localeRegistrations[0].dicts;
	const fullWidthStop = /[：，。；！？（）]/;
	for (const [key, value] of Object.entries(dict.en)) {
		assert.ok(!fullWidthStop.test(String(value)), `the English copy for "${key}" carries no full-width punctuation`);
	}
	// Both locales, every route, one pinned specifier.
	for (const locale of ['zh', 'en']) {
		for (const key of ['update.desktopGuidance', 'update.webGuidance', 'update.webGuidancePlain']) {
			assert.ok(dict[locale][key].includes('dsh-plugin-notify-sounds@{version}'), `${locale} ${key} pins the version`);
		}
	}
	// The desktop destination is the sidebar panel titled 插件. There is no
	// "Settings → Plugins" page: the plugin manager registers a
	// `sidebar.panellist` entry, and Settings only hosts the built-in list.
	for (const locale of ['zh', 'en']) {
		assert.ok(!dict[locale]['update.desktopGuidance'].includes('设置 → 插件'), `${locale} does not send desktop users to a Settings page`);
		assert.ok(!dict[locale]['update.desktopGuidance'].includes('Settings → Plugins'), `${locale} does not send desktop users to a Settings page`);
	}
	assert.ok(dict.zh['update.desktopGuidance'].includes('左侧栏「插件」'), 'the Chinese guidance names the sidebar panel');
	assert.ok(dict.zh['update.desktopGuidance'].includes('添加插件'), 'and the button to press once there');
	assert.ok(dict.zh['update.versionPinned'].includes('24 小时'), 'a separate line explains why the version has to be pinned');
	assert.ok(dict.en['update.versionPinned'].includes('24 hours'), 'in English too');

	// The self-installer's copy is gone, not merely unreferenced. A dead key is
	// how the last round of dead UI stayed alive: nothing failed, so nothing
	// was deleted.
	const dead = ['update.apply', 'update.updating', 'update.doneDetail', 'update.applyFailed', 'update.retry', 'update.reinstall'];
	for (const key of dead) {
		assert.equal(dict.zh[key], undefined, `"${key}" no longer exists in zh`);
		assert.equal(dict.en[key], undefined, `"${key}" no longer exists in en`);
	}
	assert.ok(!Object.keys(dict.zh).some((key) => key.startsWith('update.stage.')), 'no stage words survive the installer that described them');

	// The failures the row can actually describe now.
	for (const key of ['update.failedDetail', 'update.currentUnknown', 'update.webGuidancePlain', 'custom.unreadable']) {
		assert.ok(typeof dict.zh[key] === 'string' && typeof dict.en[key] === 'string', `"${key}" exists in both dictionaries`);
	}

	// What the user reads, substituted exactly the way the row substitutes it.
	const t = ctx.locale.bind('notify-sounds');
	const filled = t('update.desktopGuidance', { version: '1.8.6' });
	assert.ok(filled.includes('dsh-plugin-notify-sounds@1.8.6'), 'the rendered command carries a bare version');
	assert.ok(!filled.includes('@v1.8.6'), 'and never the display prefix');
	assert.ok(filled.includes('重启 DSH'), 'and still ends with the restart step');

	// The install instruction has exactly two triggers. The second one is the
	// whole point of the "unregistered" prompt: a tree that updated itself in
	// place has the new files and the old lockfile record, so the row has to
	// tell it what to reinstall — pointing at steps it never renders was the
	// bug this pins down.
	assert.equal(exports.installTargetVersion({ updateAvailable: true, latest: '9.9.9', current: '1.8.6' }, true), '9.9.9', 'a newer version is the install target');
	assert.equal(exports.installTargetVersion({ updateAvailable: false, unregistered: true, current: '1.8.6' }, true), '1.8.6', 'an unregistered install re-installs the version already on disk');
	assert.equal(exports.installTargetVersion({ updateAvailable: true, latest: '9.9.9', unregistered: true, current: '1.8.6' }, true), '9.9.9', 'and the newer version wins when both apply');
	assert.equal(exports.installTargetVersion({ updateAvailable: false, unregistered: false, current: '1.8.6' }, true), undefined, 'a plain up-to-date install shows no install steps');
	assert.equal(exports.installTargetVersion({ ok: false, current: undefined }, false), undefined, 'a failed check with no current version has nothing to name');
	assert.equal(exports.installTargetVersion({ unregistered: true, current: undefined }, false), undefined, 'and neither does an unregistered install with no readable version');
	assert.equal(exports.installTargetVersion(undefined, false), undefined, 'nothing is named before an answer arrives');
}

// --- A3 regression: the peak scan visits every sample --------------------------
// A strided scan aliases against content near fs/8: with a stride of 8, a peak
// that lands off every 8th index is never seen, the gain comes out too large and
// the custom sound plays hot. One off-grid sample is enough to tell the two
// scans apart.
{
	const samples = new Float32Array(64).fill(0.01);
	samples[13] = 0.9;
	const gain = exports.normalizedGain({ numberOfChannels: 1, getChannelData: () => samples });
	// `Math.fround`: the buffer holds the Float32 rounding of 0.9, and the gain
	// is derived from what was actually stored.
	assert.equal(gain, Math.min(1 / Math.fround(0.9), 4), 'the peak is found off the stride grid');
	const quiet = new Float32Array(16).fill(0.00001);
	assert.equal(exports.normalizedGain({ numberOfChannels: 1, getChannelData: () => quiet }), 1, 'a near-silent file is not boosted at all');
	const loud = new Float32Array(16).fill(2);
	assert.equal(exports.normalizedGain({ numberOfChannels: 1, getChannelData: () => loud }), 0.5, 'and a loud one is brought down toward full scale');
}

// --- BUG-1 regression: the daily check chain -----------------------------------
// The tick returned early when the preference was off, and that return skipped
// the reschedule after it: turning the switch off once — or merely loading the
// page with it off — ended the chain for good, while the row went on promising
// "at most one quiet check a day". Firing the captured first tick is the only
// way to observe a chain that reschedules itself.
{
	form.value.updateAutoCheck = false;
	const scheduled = longTimers.length;
	const fetchesBefore = fetchCalls.length;
	longTimers[0].fn();
	const asked = fetchCalls.slice(fetchesBefore).filter((call) => call.input.includes('/update/check'));
	assert.equal(asked.length, 0, 'a tick with the preference off reaches no registry');
	assert.equal(longTimers.length, scheduled + 1, 'and the next check is still scheduled');
	assert.equal(longTimers.at(-1).ms, 24 * 60 * 60 * 1000, 'a day out, not a minute');
	form.value.updateAutoCheck = true;
}

// --- BUG-2 regression: one page speaks, the others stay silent ------------------
// Two tabs (or two windows) of the same GUI are two subscribers to the same
// session facts: without an election, one decision rings twice, raises two
// system notifications and reminds twice. The election rests on a shared claim,
// so a stubbed storage is enough to run two real "pages" against each other.
{
	const store = new Map();
	const peers = new Set();
	globalThis.localStorage = {
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => void store.set(key, String(value)),
		removeItem: (key) => void store.delete(key),
	};
	globalThis.BroadcastChannel = class {
		constructor() {
			this.onmessage = null;
			peers.add(this);
		}
		postMessage(data) {
			for (const peer of peers) if (peer !== this) peer.onmessage?.({ data });
		}
		close() {
			peers.delete(this);
		}
	};
	const first = exports.createAlertLeader();
	const second = exports.createAlertLeader();
	assert.equal(first.isLeader(), true, 'the first page takes the role');
	assert.equal(second.isLeader(), false, 'a second page of the same GUI stays silent');
	second.refresh();
	assert.equal(second.isLeader(), false, 'refreshing while the claim is fresh does not steal it');
	first.dispose();
	assert.equal(store.has('dsh-notify-sounds:leader'), false, 'a leaving leader releases the claim immediately');
	assert.equal(second.isLeader(), false, 'the survivor does not claim the role before it looks');
	second.refresh();
	assert.equal(second.isLeader(), true, 'and then takes it over');
	second.dispose();
	// A holder that died — closed, crashed, frozen — leaves a claim nobody
	// refreshes, and that is what the next page takes over.
	store.set('dsh-notify-sounds:leader', JSON.stringify({ id: 'gone', at: Date.now() - 60_000 }));
	const third = exports.createAlertLeader();
	assert.equal(third.isLeader(), true, 'a stale claim is taken over rather than silencing every page forever');
	store.set('dsh-notify-sounds:leader', JSON.stringify({ id: 'someone-else', at: Date.now() }));
	third.refresh();
	assert.equal(third.isLeader(), false, 'while a fresh claim by another page is respected');
	third.dispose();
	// Without storage — this harness, a hardened browser context — a page leads
	// itself, which is exactly the behaviour before the election existed.
	globalThis.localStorage = undefined;
	globalThis.BroadcastChannel = undefined;
	assert.equal(exports.createAlertLeader().isLeader(), true, 'a page that cannot coordinate leads itself');
	store.clear();
	peers.clear();
}

// --- BUG-2 end to end: the page that lost the election makes no sound -----------
// The election above is only half the fix: the other half is that a page which is
// not the leader stays quiet. The first instance's effects were disposed with the
// audio checks, so re-applying here puts exactly one page in play — the follower.
{
	const store = new Map([['dsh-notify-sounds:leader', JSON.stringify({ id: 'another-page', at: Date.now() })]]);
	const peers = new Set();
	globalThis.localStorage = {
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => void store.set(key, String(value)),
		removeItem: (key) => void store.delete(key),
	};
	globalThis.BroadcastChannel = class {
		constructor() {
			this.onmessage = null;
			peers.add(this);
		}
		postMessage(data) {
			for (const peer of peers) if (peer !== this) peer.onmessage?.({ data });
		}
		close() {
			peers.delete(this);
		}
	};
	const disposers = [];
	exports.apply({
		...ctx,
		effect(fn) {
			const dispose = fn();
			disposers.push(dispose);
			return typeof dispose === 'function' ? dispose : () => {};
		},
	});
	form.value = { ...baseValue(), systemNotify: true, decisionSound: 'bell' };
	document.visibilityState = 'hidden';
	scheduled.length = 0;
	notifications.length = 0;
	publish([['f1', { running: true, pendingInteraction: undefined, completionUnread: false }]]);
	publish([['f1', { running: true, pendingInteraction: { kind: 'approval', toolName: 'Bash', reason: 'run it' } }]]);
	assert.equal(scheduled.length, 0, 'the page that lost the election plays no sound');
	assert.equal(notifications.length, 0, 'and raises no system notification');
	// Leaving releases nothing here: this page never held the role.
	for (const dispose of disposers) dispose();
	assert.equal(store.get('dsh-notify-sounds:leader').includes('another-page'), true, 'and it does not release a claim it never owned');
	document.visibilityState = 'visible';
	globalThis.localStorage = undefined;
	globalThis.BroadcastChannel = undefined;
	store.clear();
	peers.clear();
}

console.log('smoke test: all assertions passed');
