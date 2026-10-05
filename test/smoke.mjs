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
globalThis.window = {
	__ModuleLoader__: {
		load(reg) {
			registration = reg;
		},
	},
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

let currentPanel = null;
globalThis.document = {
	body: fakeNode('BODY'),
	head: fakeNode('HEAD'),
	activeElement: null,
	visibilityState: 'visible',
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
	IconPlayOutlineRegular: 'IconPlayOutlineRegular',
	SegmentedControl: 'SegmentedControl',
	Switch(props) {
		SwitchCalls.push(props);
		return { type: 'Switch', props, children: [] };
	},
};
const exports = registration.factory((specifier) => {
	if (specifier === 'react') return ReactStub;
	if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub;
	throw new Error('unexpected require: ' + specifier);
});

assert.equal(typeof exports.apply, 'function', 'exports apply');
assert.deepEqual(exports.inject, ['uiSession', 'configForms', 'slots', 'locale'], 'declares its services');

// --- Mock services ------------------------------------------------------------
const localeRegistrations = [];
let statusListeners = [];
let statusSnapshot = new Map();
const slotInjections = [];
const slotRegistrations = [];
const formWrites = [];
const effects = [];

const form = {
	value: { enabled: true, volume: 60, decisionSound: 'bell', completionSound: 'ding', onlyWhenHidden: false },
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
		bind() {
			return (key) => (key === 'nav' ? '提示音' : key);
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

// Decision trigger: a pending interaction appears on a session.
scheduled.length = 0;
statusSnapshot = new Map([['s1', { running: true, pendingInteraction: { kind: 'approval' }, completionUnread: false }]]);
for (const listener of statusListeners) listener();
assert.equal(scheduled.length, 4, 'bell preset schedules four voices (two notes + partials)');

// Cooldown: the same trigger again within the window stays silent.
scheduled.length = 0;
statusSnapshot = new Map([['s1', { running: true, pendingInteraction: { kind: 'question' }, completionUnread: false }]]);
for (const listener of statusListeners) listener();
assert.equal(scheduled.length, 0, 'retrigger cooldown suppresses the second decision sound');

// Completion trigger: running -> idle (after the cooldown window).
await new Promise((resolve) => {
	setTimeout(resolve, 30);
});
form.value = { ...form.value, completionSound: 'arc' };
scheduled.length = 0;
statusSnapshot = new Map([['s1', { running: false, pendingInteraction: undefined, completionUnread: true }]]);
for (const listener of statusListeners) listener();
assert.equal(scheduled.length, 4, 'arc preset schedules four voices');

// Muted master switch suppresses playback.
await new Promise((resolve) => {
	setTimeout(resolve, 30);
});
form.value = { ...form.value, enabled: false };
scheduled.length = 0;
statusSnapshot = new Map([['s2', { running: true, pendingInteraction: undefined, completionUnread: false }]]);
statusSnapshot = new Map([['s2', { running: false, pendingInteraction: undefined, completionUnread: true }]]);
for (const listener of statusListeners) listener();
assert.equal(scheduled.length, 0, 'disabled preference mutes the completion sound');

// A write through the section's setField reaches the form.
await injected.setField('volume', 42);
assert.deepEqual(formWrites.at(-1), { field: 'volume', value: 42 });

console.log('smoke test: all assertions passed');
