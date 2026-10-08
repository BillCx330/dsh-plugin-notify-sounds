/**
 * Smoke test for `dsh-plugin-notify-sounds`.
 *
 * Loads the Client half inside a stubbed Module Loader environment, applies it
 * against mock services and a fake DOM, and asserts the wiring: dictionaries,
 * the session-status watcher, the Settings section registration, the nav
 * glyph swap (alarm clock instead of the shared fallback gear), the
 * uncontrolled volume slider (drag paints without re-rendering, commits once
 * per gesture), and the Web Audio scheduling (against a recording
 * AudioContext mock).
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
globalThis.fetch = (input, init) => {
	fetchCalls.push({ input: String(input), init });
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
	}
	start() {}
	stop() {}
}
class MockGain extends MockNode {
	constructor() {
		super();
		this.gain = Object.assign(new MockParam(), { value: 0 });
	}
}
/** Decoded-buffer mock: one channel with a controllable peak sample. */
function mockDecodedBuffer(peak = 0.5) {
	return {
		numberOfChannels: 1,
		getChannelData: () => new Float32Array([peak, peak / 2, 0]),
	};
}
class MockBufferSource extends MockNode {
	constructor() {
		super();
		scheduled.push(this);
	}
	start() {}
	stop() {}
}
globalThis.window.AudioContext = class {
	constructor() {
		this.state = 'running';
		this.destination = {};
		this.currentTime = 0;
	}
	resume() {
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
	decodeAudioData(bytes) {
		// Decodes only the sentinel payload; anything else is undecodable.
		const raw = String.fromCharCode(...new Uint8Array(bytes));
		if (raw === 'good-audio') return Promise.resolve(mockDecodedBuffer(0.5));
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
		return null;
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
			// test asserting on visible text is checking the real copy.
			return (key) => {
				if (key === 'nav') return '提示音';
				const registered = localeRegistrations.filter((entry) => entry.ns === ns).at(-1);
				return registered?.dicts?.zh?.[key] ?? key;
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
exports.apply(ctx);

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
		t: (key) => key,
	})
);
flushEffects();
assert.equal(tree.type, 'div');
assert.equal(tree.children[0].length, 3, 'title, intro, rows');
assert.equal(tree.children[0][0].type, 'h2', 'the title is a heading like the shipped sections');
assert.equal(tree.children[0][1].type, 'p', 'the intro is a paragraph');
assert.equal(tree.children[0][2].children[0].length, 12, 'twelve rows render: switch, volume, three pickers, sub-agent scope, custom, notification, flash, renotify, quiet, hidden');

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
injected.preview('custom', 60);
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
	injected.preview('custom', 60);
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

// With nothing pending and nothing running, a hidden page is marked as finished.
form.value = { ...baseValue(), titleFlash: true };
document.visibilityState = 'hidden';
publish([['s6', { running: false }]]);
assert.ok(document.title.startsWith('已完成 '), 'an idle hidden page is marked 已完成');
// A running session is work in progress, not news, so no mark.
publish([['s6', { running: true }]]);
assert.ok(!document.title.startsWith('已完成 '), 'a running session is not marked');
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
assert.equal(menuItems.length, 30, 'three pickers render one menu item per offered preset');
assert.ok(!menuItems.some((element) => element.props['data-menu-item'] === 'custom'), 'no picker offers Custom without an upload');
assert.ok(menuItems.every((element) => typeof element.children[0] === 'string' && element.children[0] !== ''), 'every menu entry carries a non-empty label');
// Clicking a menu item writes the field and previews the sound.
scheduled.length = 0;
const coinItem = menuItems.find((element) => element.props['data-menu-item'] === 'coin');
coinItem.props.onClick();
assert.deepEqual(formWrites.at(-1), { field: 'decisionSound', value: 'coin' }, 'picking a menu item writes the field');
assert.equal(scheduled.length, 2, 'picking a menu item previews the sound');

// --- Assertions: custom sound upload row ----------------------------------------
let fileInput;
walkElements(tree, (element) => {
	if (element.type === 'input' && element.props.type === 'file') fileInput = element;
});
assert.ok(fileInput, 'the upload row rendered its file input');
const goodFile = {
	name: 'ring.mp3',
	size: 10,
	arrayBuffer: async () => new TextEncoder().encode('good-audio').buffer,
};
await fileInput.props.onChange({ currentTarget: { files: [goodFile], value: 'x' } });
assert.deepEqual(
	formWrites.filter((write) => write.field === 'customSound' || write.field === 'customSoundName'),
	[
		{ field: 'customSound', value: btoa('good-audio') },
		{ field: 'customSoundName', value: 'ring.mp3' },
	],
	'a decodable file under the cap is stored as base64 with its name',
);
// An oversized file is rejected before any write.
const writesBefore = formWrites.length;
const bigFile = { name: 'big.mp3', size: 600000, arrayBuffer: async () => new ArrayBuffer(8) };
await fileInput.props.onChange({ currentTarget: { files: [bigFile], value: 'x' } });
assert.equal(formWrites.length, writesBefore, 'an oversized file is rejected without writes');
// Without audio decoding the environment can never play a custom sound, so
// accepting the upload would store a ringtone that stays silent forever. The
// decoder is removed from the mock engine's prototype for this one check.
const realDecode = globalThis.window.AudioContext.prototype.decodeAudioData;
delete globalThis.window.AudioContext.prototype.decodeAudioData;
const writesBeforeNoDecoder = formWrites.length;
await fileInput.props.onChange({
	currentTarget: {
		files: [{ name: 'fine.mp3', size: 10, arrayBuffer: async () => new TextEncoder().encode('good-audio').buffer }],
		value: 'x',
	},
});
assert.equal(formWrites.length, writesBeforeNoDecoder, 'an environment without audio decoding refuses the upload');
globalThis.window.AudioContext.prototype.decodeAudioData = realDecode;

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

console.log('smoke test: all assertions passed');
