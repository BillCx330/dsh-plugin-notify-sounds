/**
 * Host-half tests for `dsh-plugin-notify-sounds`.
 *
 * `test/smoke.mjs` covers the browser half against a stubbed Module Loader;
 * this file covers the Node half, which needs the real
 * `@deepseek-ai/schemastery` (a devDependency — run `npm install` once
 * first):
 *
 *   - the Config schema: defaults, and refusals for out-of-range volume,
 *     unknown preset ids, malformed `HH:MM`, and a zero reminder interval;
 *   - the window-title matcher the Win32 raise searches with;
 *   - the focus route: 405 with `allow` for non-POST, the connection fence's
 *     401/403, 204 for a browser click (no raise), and 204 plus a raise
 *     attempt for a Desktop click — observed through the Host log, with the
 *     platform mocked off Windows so no real window ever moves;
 *   - the update check: the pinned endpoints, what an answer has to contain
 *     (a parseable version, nothing else — installation is the package
 *     manager's job since 1.8.0), the cache windows for success and failure,
 *     and the lockfile comparison that reports an unregistered install;
 *   - the shared contracts across the two halves: the preset id list, the
 *     three route paths, and every `HH:MM` the schema can accept.
 *
 * Run: node test/host.mjs
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as host from '../lib/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Load the Client half for the cross-half contracts --------------------------
// A minimal version of smoke.mjs's loader stub: the factory only needs its
// two module-table requires to exist; nothing here renders.
let registration;
globalThis.window = {
	__ModuleLoader__: {
		load(reg) {
			registration = reg;
		},
	},
};
eval(readFileSync(join(root, 'lib/client.js'), 'utf8'));
const client = registration.factory((specifier) => {
	if (specifier === 'react') {
		return { createElement: () => {}, useCallback: () => {}, useEffect: () => {}, useRef: () => {}, useState: () => {} };
	}
	if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {};
	throw new Error('unexpected require: ' + specifier);
});

// --- Assertions: shared contracts ------------------------------------------------
assert.equal(host.name, 'notify-sounds', 'the Host entry id matches the Loader row');
assert.deepEqual([...client.SOUND_IDS], [...host.SOUND_IDS], 'the Client preset list matches the Host spelling');
for (const id of host.SOUND_IDS) {
	assert.equal(host.Config({ decisionSound: id }).decisionSound.get(), id, `the Config union accepts "${id}"`);
}
assert.equal(client.FOCUS_PATH, host.FOCUS_PATH, 'the focus route path matches between the halves');
assert.equal(client.UPDATE_CHECK_PATH, host.UPDATE_CHECK_PATH, 'the check route path matches between the halves');
// The goal route is the one that has already drifted once (1.8.1 added it,
// 1.8.2 changed what it reads). A silent mismatch would bring back the
// every-round chime, with nothing in the UI to explain it.
assert.equal(client.GOAL_PHASE_PATH, host.GOAL_PHASE_PATH, 'the goal route path matches between the halves');
// Every time the schema can accept, the Client parser must read correctly:
// the two spellings drift independently, and a value the Host accepts but
// the Client cannot parse would break quiet hours silently.
for (let hours = 0; hours < 24; hours += 1) {
	for (let minutes = 0; minutes < 60; minutes += 1) {
		const text = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
		assert.ok(host.TIME_OF_DAY.test(text), `the schema accepts ${text}`);
		assert.equal(client.timeOfDayToMinutes(text), hours * 60 + minutes, `the Client parser reads ${text}`);
	}
}
assert.ok(!host.TIME_OF_DAY.test('9:30'), 'single-digit hours are refused by the schema');
assert.ok(!host.TIME_OF_DAY.test('24:00'), 'hour 24 is refused by the schema');
assert.ok(!host.TIME_OF_DAY.test('12:60'), 'minute 60 is refused by the schema');

// --- Assertions: Config schema ---------------------------------------------------
// Every field is volatile, so resolved values arrive as cosmokit volatile
// cells — a `get()` reader plus a write channel, the same live-value shape
// the Host Settings document serves. Read them through `get()`.
const defaults = host.Config({});
assert.equal(defaults.enabled.get(), true, 'enabled defaults on');
assert.equal(defaults.volume.get(), 60, 'volume defaults to 60');
assert.equal(defaults.decisionSound.get(), 'bell', 'decision defaults to bell');
assert.equal(defaults.questionSound.get(), 'chime', 'question defaults to chime');
assert.equal(defaults.completionSound.get(), 'ding', 'completion defaults to ding');
assert.equal(defaults.subagentAlerts.get(), false, 'sub-agent alerts default off');
assert.equal(defaults.onlyWhenHidden.get(), false, 'only-when-hidden defaults off');
assert.equal(defaults.systemNotify.get(), false, 'system notifications default off');
assert.equal(defaults.titleFlash.get(), false, 'the title mark defaults off');
assert.equal(defaults.renotify.get(), false, 'repeat reminders default off');
assert.equal(defaults.renotifyMinutes.get(), 5, 'the repeat interval defaults to 5 minutes');
assert.equal(defaults.quietHours.get(), false, 'quiet hours default off');
assert.equal(defaults.quietStart.get(), '22:00', 'quiet start defaults to 22:00');
assert.equal(defaults.quietEnd.get(), '08:00', 'quiet end defaults to 08:00');
assert.equal(host.Config({ volume: 0, quietStart: '00:00', quietEnd: '23:59' }).volume.get(), 0, 'boundary values are accepted');
assert.throws(() => host.Config({ volume: 101 }), /<= 100/, 'volume above 100 is refused');
assert.throws(() => host.Config({ volume: 60.5 }), /multiple of/, 'fractional volume is refused');
assert.throws(() => host.Config({ decisionSound: 'bogus' }), /bogus/, 'an unknown preset id is refused');
assert.throws(() => host.Config({ quietStart: '9:30' }), /regexp/, 'a single-digit hour is refused');
assert.throws(() => host.Config({ renotifyMinutes: 0 }), />= 1/, 'a zero repeat interval is refused');

// --- Assertions: window-title matching -------------------------------------------
/** A koffi-like fake exposing the Win32 calls `findDesktopWindow` uses. */
const windowNative = (windows) => ({
	koffi: { register: (fn) => fn, unregister: () => {}, pointer: () => ({}) },
	EnumWindows: (visit) => {
		for (const window of windows) if (visit(window.handle) === false) return;
	},
	IsWindowVisible: (handle) => windows.find((window) => window.handle === handle).visible,
	GetWindowThreadProcessId: (handle, buffer) => {
		buffer[0] = windows.find((window) => window.handle === handle).pid ?? 0;
		return 0;
	},
	GetWindowTextLengthW: (handle) => windows.find((window) => window.handle === handle).title.length,
	GetWindowTextW: (handle, buffer) => {
		const title = windows.find((window) => window.handle === handle).title;
		for (let index = 0; index < title.length; index += 1) buffer[index] = title.charCodeAt(index);
		return title.length;
	},
});
assert.equal(host.findDesktopWindow(windowNative([{ handle: 7, visible: false, title: '会话 — DeepSeek Harness' }])), 7, 'a window closed to the tray is still found');
assert.equal(host.findDesktopWindow(windowNative([
	{ handle: 7, visible: false, title: '会话 — DeepSeek Harness' },
	{ handle: 9, visible: true, title: '另一个 — DeepSeek Harness' },
])), 9, 'a visible window wins over a hidden one');
assert.equal(host.findDesktopWindow(windowNative([
	{ handle: 5, visible: false, title: '会话 — DeepSeek Harness' },
	{ handle: 6, visible: true, title: '', pid: process.ppid },
])), 6, 'a visible window of the shell outranks a hidden window matched only by title');
assert.equal(host.findDesktopWindow(windowNative([{ handle: 4, visible: true, title: '', pid: process.ppid }])), 4, 'the shell window is found by its owning process when the title is empty');
assert.equal(host.findDesktopWindow(windowNative([{ handle: 4, visible: false, title: '', pid: process.ppid }])), 4, 'a hidden shell window is found by process too');
assert.equal(host.findDesktopWindow(windowNative([{ handle: 7, visible: true, title: '别的窗口' }])), undefined, 'an unrelated window is not the app');

assert.ok(host.isDesktopTitle('DeepSeek Harness'), 'the bare app title matches');
assert.ok(host.isDesktopTitle('某会话 — DeepSeek Harness'), 'a session title matches (em dash)');
assert.ok(host.isDesktopTitle('Some Session - DeepSeek Harness'), 'a hyphen variant matches too');
assert.ok(!host.isDesktopTitle('DeepSeek Harness — Another App'), 'a title that only starts with the name does not match');
assert.ok(!host.isDesktopTitle('Another App'), 'another app does not match');
assert.ok(!host.isDesktopTitle(''), 'an empty title does not match');

// Reading the title takes two Win32 calls, and the page can rewrite its title
// between them — switching sessions is exactly when it does. The second call
// then copies fewer characters than the first one counted, so the result has to
// be sliced by what actually came back. Slicing by the older count leaves NUL
// characters on the end, `endsWith('— DeepSeek Harness')` stops matching, and
// the click silently does nothing (it heals on the next click, which is what
// made it look random).
const titleNative = (declared, actual) => ({
	GetWindowTextLengthW: () => declared,
	GetWindowTextW: (handle, buffer) => {
		for (let index = 0; index < actual.length; index++) buffer[index] = actual.charCodeAt(index);
		return actual.length;
	},
});
const shrunken = host.windowTitle(titleNative(24, 'Ti'), 1);
assert.equal(shrunken, 'Ti', 'a title that shrank between the two calls is sliced by what was copied');
assert.ok(!shrunken.includes('\0'), 'and the result carries no NUL padding');
assert.equal(host.windowTitle(titleNative(3, 'abc'), 1), 'abc', 'an unchanged title reads back whole');
assert.equal(host.windowTitle(titleNative(24, '会话 — DeepSeek Harness'), 1), '会话 — DeepSeek Harness', 'a title that grew is not truncated either');
assert.equal(host.windowTitle({ GetWindowTextLengthW: () => 0, GetWindowTextW: () => 0 }, 1), '', 'a window without a title reads as empty');

// --- Assertions: focus route -----------------------------------------------------
const configureCalls = [];
const registeredRoutes = [];
let rejectionFor = () => undefined;
/** Sessions the goal-phase route reads, keyed by id. */
const sessionById = new Map();

const makeCtx = () => ({
	fiber: {},
	inject(names, callback) {
		const child = {
			effect(fn) {
				const dispose = fn();
				return typeof dispose === 'function' ? dispose : () => {};
			},
			settings: {
				configure(options, fiber) {
					configureCalls.push({ options, fiber });
					return () => {};
				},
			},
			webServer: {
				register(route) {
					registeredRoutes.push(route);
					return () => {};
				},
			},
			connection: {
				requestRejection(req) {
					return rejectionFor(req);
				},
			},
			sessions: { get: (sessionId) => sessionById.get(sessionId) },
			sessionProjections: { stateOf: (session, key) => session.projections?.[key] },
		};
		callback(child);
	},
});

host.apply(makeCtx());
assert.deepEqual(configureCalls.map((call) => call.options), [{ auto: false }], 'the auto inventory page is suppressed');
assert.equal(registeredRoutes.length, 3, 'three routes are registered: focus, update check and the goal phase read');
const goalRoute = registeredRoutes.find((entry) => entry.path === host.GOAL_PHASE_PATH);
assert.ok(goalRoute, 'the goal phase route is registered');
assert.equal(goalRoute.kind, 'exact', 'the goal phase route is an exact match');
const callGoal = async (req) => {
	const res = {
		statusCode: undefined,
		headers: {},
		body: undefined,
		setHeader(name, value) {
			this.headers[name] = value;
		},
		end(body) {
			this.body = body;
		},
	};
	await goalRoute.handler(req, res);
	return res;
};
sessionById.set('goal-active', { id: 'goal-active', projections: { goal: { failure: null, current: { goal: { phase: 'active' } } } } });
sessionById.set('goal-done', { id: 'goal-done', projections: { goal: { failure: null, current: { goal: { phase: 'complete' } } } } });
rejectionFor = () => undefined;
assert.equal(JSON.parse((await callGoal({ method: 'GET', url: '/notify-sounds/goal?session=goal-active' })).body).phase, 'active', 'an active goal is reported');
assert.equal(JSON.parse((await callGoal({ method: 'GET', url: '/notify-sounds/goal?session=goal-done' })).body).phase, 'complete', 'a finished goal is reported');
assert.equal(JSON.parse((await callGoal({ method: 'GET', url: '/notify-sounds/goal?session=missing' })).body).phase, null, 'an unknown session reports no goal');
assert.equal((await callGoal({ method: 'POST', url: '/notify-sounds/goal?session=goal-active' })).statusCode, 405, 'a non-GET goal read is refused');
rejectionFor = () => 401;
assert.equal((await callGoal({ method: 'GET', url: '/notify-sounds/goal?session=goal-active' })).statusCode, 401, 'the goal route carries the connection fence');
rejectionFor = () => undefined;
const route = registeredRoutes.find((entry) => entry.path === host.FOCUS_PATH);
assert.ok(route, 'the focus route is registered');
assert.equal(route.kind, 'exact', 'the route is an exact match');
assert.equal(typeof route.handler, 'function', 'the route carries a handler');

/** Invoke the handler with a mock request and response. */
const call = async (req) => {
	const res = {
		statusCode: undefined,
		headers: {},
		ended: false,
		setHeader(name, value) {
			this.headers[name] = value;
		},
		end() {
			this.ended = true;
		},
	};
	await route.handler(req, res);
	return res;
};
/** Run a body with console.log/warn captured, so route decisions are observable. */
const captureConsole = async (body) => {
	const lines = [];
	const realLog = console.log;
	const realWarn = console.warn;
	console.log = (message) => lines.push(String(message));
	console.warn = (message) => lines.push(String(message));
	try {
		await body();
	} finally {
		console.log = realLog;
		console.warn = realWarn;
	}
	return lines;
};

// The connection fence: a rejected request never reaches the raise.
rejectionFor = () => 403;
assert.equal((await call({ method: 'POST', headers: {} })).statusCode, 403, 'a fenced request is refused with 403');
rejectionFor = () => 401;
assert.equal((await call({ method: 'POST', headers: {} })).statusCode, 401, 'an unauthorized request is refused with 401');

// Method gate: only POST is served.
rejectionFor = () => undefined;
const methodRes = await call({ method: 'GET', headers: {} });
assert.equal(methodRes.statusCode, 405, 'a GET is refused with 405');
assert.equal(methodRes.headers.allow, 'POST', 'the 405 advertises POST');
assert.ok(methodRes.ended, 'the 405 response is ended');

// A browser click (Origin present) is answered and never raises the window.
let browserRes;
const browserLines = await captureConsole(async () => {
	browserRes = await call({ method: 'POST', headers: { origin: 'https://example.com' } });
});
assert.equal(browserRes.statusCode, 204, 'a browser click is answered 204');
assert.ok(browserRes.ended, 'the 204 response is ended');
assert.ok(browserLines.some((line) => line.includes('focus click (fromBrowser=true)')), 'the browser click is logged');
assert.ok(!browserLines.some((line) => line.includes('raising')), 'a browser click never raises the Desktop window');

// A Desktop click (no Origin — the shell strips it) raises the window. The
// platform is mocked off Windows so the raise takes the launcher branch with
// a command this machine does not have: the attempt is observable in the log
// without any real window moving. `process.platform` is not writable, but it
// is configurable, so defineProperty is the one way through.
const realPlatform = process.platform;
let desktopRes;
let desktopLines;
try {
	Object.defineProperty(process, 'platform', { value: 'linux' });
	desktopLines = await captureConsole(async () => {
		desktopRes = await call({ method: 'POST', headers: {} });
		// Let the failed launcher report while the console is still captured.
		await new Promise((resolve) => {
			setTimeout(resolve, 50);
		});
	});
} finally {
	Object.defineProperty(process, 'platform', { value: realPlatform });
}
assert.equal(desktopRes.statusCode, 204, 'a Desktop click is answered 204 before the raise');
assert.ok(desktopRes.ended, 'the 204 response is ended');
assert.ok(desktopLines.some((line) => line.includes('focus click (fromBrowser=false)')), 'the Desktop click is logged');
assert.ok(desktopLines.some((line) => line.includes('raising via xdg-open')), 'a Desktop click attempts the raise');
assert.equal(process.platform, realPlatform, 'the platform mock is restored');

// --- Assertions: update check ----------------------------------------------------
// The check is the one place the plugin asks the outside world for something it
// may later act on, so these assertions pin that conversation down: which hosts
// may be asked, what an answer must contain before it is believed, and that
// this stage is a query and nothing more.
assert.ok(Number.isNaN(host.compareVersions('1.0.0', 'not a version')), 'a non-version compares as unknown');
assert.ok(host.compareVersions('1.4.9', '1.5.0') < 0, '1.4.9 sorts before 1.5.0');
assert.ok(host.compareVersions('1.10.0', '1.9.9') > 0, '1.10.0 sorts after 1.9.9');
assert.equal(host.compareVersions('1.5.0', '1.5.0'), 0, 'equal versions compare equal');
assert.ok(host.compareVersions('1.5.0-rc.1', '1.5.0') < 0, 'a prerelease sorts before its release');
assert.ok(host.compareVersions('1.5.0', '1.5.0-rc.1') > 0, 'a release sorts after its prerelease');
assert.ok(host.compareVersions('2.0.0', '1.99.99') > 0, 'the major part decides first');

// Prerelease identifiers compare by semver's rules, not as strings. The string
// order gets the common case backwards — "rc.10" < "rc.9" letter by letter —
// so a registry answering with a later release candidate would look OLDER than
// what is installed and the update would never be offered.
assert.ok(host.compareVersions('1.5.0-rc.9', '1.5.0-rc.10') < 0, 'rc.9 sorts before rc.10 (numeric identifiers compare as numbers)');
assert.ok(host.compareVersions('1.5.0-rc.10', '1.5.0-rc.9') > 0, 'and rc.10 sorts after rc.9');
assert.ok(host.compareVersions('1.5.0-alpha', '1.5.0-beta') < 0, 'alphanumeric identifiers compare in ASCII order');
assert.ok(host.compareVersions('1.5.0-1', '1.5.0-alpha') < 0, 'a numeric identifier ranks below an alphanumeric one');
assert.ok(host.compareVersions('1.5.0-alpha', '1.5.0-alpha.1') < 0, 'more fields win when every shared field is equal');
assert.ok(host.compareVersions('1.5.0-rc.1', '1.5.0') < 0, 'a prerelease still sorts before its own release');
assert.equal(host.compareVersions('1.5.0-rc.1', '1.5.0-rc.1'), 0, 'identical prereleases compare equal');

// A version string has to be a version string, start to finish. The answer
// arrives over the network, and a loose prefix match would read `1.8.5foo` or
// `1.8.5.9` as `1.8.5` — a number that then drives the whole row.
assert.equal(host.parseVersion('1.8.5')[3], '', 'a plain release parses');
assert.equal(host.parseVersion('1.8.5-rc.1')[3], 'rc.1', 'a prerelease parses');
assert.ok(host.parseVersion('1.8.5+build.7'), 'build metadata is accepted');
assert.equal(host.parseVersion('1.8.5foo'), undefined, 'trailing junk is not a version');
assert.equal(host.parseVersion('1.8.5.9'), undefined, 'a fourth component is not a version');
assert.equal(host.parseVersion('v1.8.5'), undefined, 'a display prefix is not a version');
assert.equal(host.parseVersion('not a version'), undefined, 'prose is not a version');

// The check itself, against a scripted registry and a travelling clock.
const fetchLog = [];
const scripts = [];
const realFetch = globalThis.fetch;
const realDateNow = Date.now;
let clock = 1_000_000_000_000;
Date.now = () => clock;
globalThis.fetch = async (url, options) => {
	fetchLog.push({ url: String(url), options });
	const script = scripts.shift();
	if (script === undefined) throw new Error('no scripted response left');
	if (script instanceof Error) throw script;
	return script;
};
/** A fetch response stub carrying exactly the pieces the check reads. */
const registryResponse = (payload, status = 200) => {
	const bytes = payload instanceof Uint8Array ? payload : new TextEncoder().encode(JSON.stringify(payload));
	let sent = false;
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: (name) => (name === 'content-length' ? String(bytes.byteLength) : null) },
		body: {
			getReader: () => ({
				read: async () => {
					if (sent) return { done: true };
					sent = true;
					return { done: false, value: bytes };
				},
				cancel: async () => {},
			}),
		},
	};
};
/** One plausible registry answer. This check reads the version and nothing else. */
const registrySays = (version) => registryResponse({ version });
const updateRoute = registeredRoutes.find((entry) => entry.path === host.UPDATE_CHECK_PATH);
assert.ok(updateRoute, 'the update check route is registered');
assert.equal(updateRoute.kind, 'exact', 'the update check route is an exact match');
assert.equal(client.UPDATE_CHECK_PATH, host.UPDATE_CHECK_PATH, 'the check route path matches between the halves');
const callUpdate = async (req) => {
	const res = {
		statusCode: undefined,
		headers: {},
		ended: false,
		setHeader(name, value) {
			this.headers[name] = value;
		},
		end() {
			this.ended = true;
		},
	};
	await updateRoute.handler(req, res);
	return res;
};

try {
	// A good answer from the first registry.
	scripts.push(registrySays('9.9.9'));
	fetchLog.length = 0;
	const fresh = await host.checkForUpdate({ force: true });
	assert.equal(fresh.ok, true, 'a good answer is accepted');
	assert.equal(fresh.latest, '9.9.9', 'the reported version is surfaced');
	assert.equal(fresh.updateAvailable, true, 'a newer version marks updateAvailable');
	assert.equal(fetchLog.length, 1, 'one request was made');
	assert.equal(fetchLog[0].url, 'https://registry.npmjs.org/dsh-plugin-notify-sounds/latest', 'the request goes to the pinned npm endpoint');
	assert.equal(fetchLog[0].options.redirect, 'error', 'redirects are refused rather than followed');

	// A fresh result is answered from memory.
	fetchLog.length = 0;
	assert.equal(await host.checkForUpdate(), fresh, 'the cached result is returned as-is');
	assert.equal(fetchLog.length, 0, 'a cached answer costs no request');

	// Spacing: even a forced check may not hammer inside the spacing window.
	fetchLog.length = 0;
	assert.equal(await host.checkForUpdate({ force: true }), fresh, 'a forced check inside the spacing window answers from cache');
	assert.equal(fetchLog.length, 0, 'and makes no request');

	// Past the freshness window, a forced check asks again.
	clock += 25 * 60 * 60 * 1000;
	scripts.push(registrySays('9.9.9'));
	fetchLog.length = 0;
	await host.checkForUpdate({ force: true });
	assert.equal(fetchLog.length, 1, 'a forced check after the window asks again');

	// A failing registry falls through to the mirror.
	clock += 25 * 60 * 60 * 1000;
	scripts.push(new Error('network down'));
	scripts.push(registrySays('9.9.9'));
	fetchLog.length = 0;
	const mirrored = await host.checkForUpdate({ force: true });
	assert.equal(mirrored.ok, true, 'the mirror answers when the first registry fails');
	assert.equal(fetchLog.length, 2, 'both registries were tried');
	assert.equal(fetchLog[1].url, 'https://registry.npmmirror.com/dsh-plugin-notify-sounds/latest', 'the second request goes to the pinned mirror');

	// An answer whose version does not parse is not believed. The check reads
	// the version and nothing else — there is no archive to vet any more.
	clock += 25 * 60 * 60 * 1000;
	scripts.push(registrySays('not-a-version'));
	scripts.push(registrySays('not-a-version'));
	assert.equal((await host.checkForUpdate({ force: true })).ok, false, 'an answer with a malformed version is refused');

	// Offline: every failure becomes a result, never a throw.
	clock += 25 * 60 * 60 * 1000;
	scripts.push(new Error('offline'));
	scripts.push(new Error('offline'));
	const offline = await host.checkForUpdate({ force: true });
	assert.equal(offline.ok, false, 'a completely offline check reports failure');
	assert.equal(typeof offline.error, 'string', 'and explains itself');

	// A failure is cached for a MINUTE, not for the day. One blip used to
	// leave the row reading "check failed" until tomorrow, long after the
	// cause was gone.
	fetchLog.length = 0;
	assert.equal(await host.checkForUpdate(), offline, 'a failure is answered from cache right away');
	assert.equal(fetchLog.length, 0, 'and costs no request');
	clock += 61 * 1000;
	scripts.push(new Error('still offline'));
	scripts.push(new Error('still offline'));
	assert.equal((await host.checkForUpdate()).ok, false, 'a failure is re-asked after a minute');
	assert.equal(fetchLog.length, 2, 'and the retry really goes out');

	// The route: fence, method gate, and one JSON answer.
	rejectionFor = () => 401;
	assert.equal((await callUpdate({ method: 'GET', url: '/notify-sounds/update/check' })).statusCode, 401, 'a fenced check is refused with 401');
	rejectionFor = () => undefined;
	const wrongMethod = await callUpdate({ method: 'POST', url: '/notify-sounds/update/check' });
	assert.equal(wrongMethod.statusCode, 405, 'a non-GET is refused with 405');
	assert.equal(wrongMethod.headers.allow, 'GET', 'the 405 advertises GET');
	clock += 25 * 60 * 60 * 1000;
	scripts.push(registrySays('9.9.9'));
	fetchLog.length = 0;
	const forced = await callUpdate({ method: 'GET', url: '/notify-sounds/update/check?force=1' });
	assert.equal(forced.statusCode, 200, 'a check is answered 200');
	assert.equal(forced.headers['content-type'], 'application/json', 'the answer is JSON');
	assert.equal(fetchLog.length, 1, 'a forced check reaches the registry');
	assert.ok(fetchLog[0].url.startsWith('https://registry.npmjs.org/'), 'and only ever talks to a pinned registry');
// --- Assertions: installation provenance (1.8.0) ---------------------------------
// A tree installed by the plugin's own pre-1.8.0 updater looks right on disk
// while the profile's lockfile still pins the old version. The check reports
// that mismatch so the Settings row can tell the user to install it through
// the package manager instead of discovering the rollback later.
{
	const profileDir = mkdtempSync(join(tmpdir(), 'notify-sounds-profile-'));
	const installedRoot = mkdtempSync(join(tmpdir(), 'notify-sounds-installed-'));
	const previousProfileDir = process.env.DSH_PROFILE_DIR;
	const previousProfileName = process.env.DSH_PROFILE;
	const restoreEnv = (key, value) => {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	};
	process.env.DSH_PROFILE_DIR = profileDir;
	process.env.DSH_PROFILE = 'desktop';
	try {
		writeFileSync(join(profileDir, 'pnpm-lock.yaml'), [
			'dependencies:',
			'  dsh-plugin-notify-sounds:',
			'    specifier: ^1.0.0',
			'    version: 1.0.0',
			'snapshots:',
			'  dsh-plugin-notify-sounds@1.0.0: {}',
			'',
		].join('\n'));
		writeFileSync(join(installedRoot, 'package.json'), JSON.stringify({ version: '1.5.0' }));
		clock += 25 * 60 * 60 * 1000;
		scripts.push(registrySays('9.9.9'));
		const provenance = await host.checkForUpdate({ force: true, root: installedRoot });
		assert.equal(provenance.current, '1.5.0', 'the running tree reports its version');
		assert.equal(provenance.recorded, '1.0.0', 'the version the lockfile would restore is reported');
		assert.equal(provenance.unregistered, true, 'a tree the lockfile does not match is marked unregistered');
		assert.equal(provenance.profile, 'desktop', 'the profile name is mirrored to the row');
		// The helper is symmetric, and a matching tree is not flagged.
		assert.equal(host.installationProvenance('1.5.0').unregistered, true, 'the helper flags a mismatch');
		assert.equal(host.installationProvenance('1.0.0').unregistered, false, 'and clears a matching tree');

		// A dependency key can carry a peer suffix once pnpm resolves the
		// declared peer. Reading `1.0.0(@deepseek-ai/schemastery@3.18.4)` as
		// the version made a perfectly good install look unregistered, and the
		// row then told the user to reinstall it.
		writeFileSync(join(profileDir, 'pnpm-lock.yaml'), [
			'snapshots:',
			'  dsh-plugin-notify-sounds@1.5.0(@deepseek-ai/schemastery@3.18.4): {}',
			'',
		].join('\n'));
		const suffixed = host.installationProvenance('1.5.0');
		assert.equal(suffixed.recorded, '1.5.0', 'a peer suffix is not part of the version');
		assert.equal(suffixed.unregistered, false, 'and a matching tree stays unflagged');

		// The importer's `version:` line is not a package key either — the
		// match has to start at a line, not anywhere in the file.
		writeFileSync(join(profileDir, 'pnpm-lock.yaml'), [
			'importers:',
			'  .:',
			'    dependencies:',
			'      dsh-plugin-notify-sounds:',
			'        specifier: 1.2.0',
			'        version: 1.2.0',
			'',
		].join('\n'));
		assert.equal(host.installationProvenance('1.5.0').recorded, undefined, 'an unkeyed importer line is not read as an installed version');
	} finally {
		restoreEnv('DSH_PROFILE_DIR', previousProfileDir);
		restoreEnv('DSH_PROFILE', previousProfileName);
		rmSync(profileDir, { recursive: true, force: true });
		rmSync(installedRoot, { recursive: true, force: true });
	}
}

// The Host does not run with DSH_PROFILE_DIR — that variable is injected into
// the model's shell calls, not into this process (measured on 0.2.1-rc.2). So
// the profile has to be found on disk, or the "this install is not registered"
// prompt — the one that turns a self-update into a permanent one — never
// appears at all.
{
	const root = mkdtempSync(join(tmpdir(), 'notify-sounds-layout-'));
	const profile = join(root, 'profiles', 'desktop');
	const installed = join(profile, 'node_modules', 'dsh-plugin-notify-sounds');
	mkdirSync(join(installed, 'lib'), { recursive: true });
	writeFileSync(join(installed, 'lib', 'index.js'), '');
	writeFileSync(join(profile, 'pnpm-lock.yaml'), 'snapshots:\n  dsh-plugin-notify-sounds@1.0.0: {}\n');
	const elsewhere = join(root, 'profiles', 'bundle', 'node_modules', 'other', 'lib');
	mkdirSync(elsewhere, { recursive: true });
	writeFileSync(join(elsewhere, 'index.js'), '');
	const previousProfileDir = process.env.DSH_PROFILE_DIR;
	const previousProfileName = process.env.DSH_PROFILE;
	delete process.env.DSH_PROFILE_DIR;
	delete process.env.DSH_PROFILE;
	try {
		assert.equal(
			host.profileDirectory(pathToFileURL(join(installed, 'lib', 'index.js')).href),
			profile,
			'the profile is found by walking up to the nearest pnpm-lock.yaml',
		);
		assert.equal(
			host.profileDirectory(pathToFileURL(join(elsewhere, 'index.js')).href),
			undefined,
			'a tree with no lockfile above it reports no profile',
		);
		process.env.DSH_PROFILE_DIR = profile;
		assert.equal(host.profileDirectory(pathToFileURL(join(elsewhere, 'index.js')).href), profile, 'the environment wins when it is set');
		assert.equal(host.installationProvenance('1.0.0').profile, 'desktop', 'the profile name falls back to the directory name');
	} finally {
		if (previousProfileDir === undefined) delete process.env.DSH_PROFILE_DIR;
		else process.env.DSH_PROFILE_DIR = previousProfileDir;
		if (previousProfileName === undefined) delete process.env.DSH_PROFILE;
		else process.env.DSH_PROFILE = previousProfileName;
		rmSync(root, { recursive: true, force: true });
	}
}

} finally {
	globalThis.fetch = realFetch;
	Date.now = realDateNow;
}

// --- The ≤1.6.9 migration invariant ---------------------------------------------
// Versions up to 1.6.9 carry a fixed list of seven filenames and refuse an
// archive containing anything else, so a release that ADDS a name cannot be
// installed by them. Keeping that path open is what lets those installs reach
// 1.7.0 at all, and it is a property of the PUBLISHED FILE SET rather than of
// any code here — so it is asserted here. When support for ≤1.6.9 is dropped on
// purpose, delete this check and say so in the README: it must never be
// discovered by a user whose update failed.
const V169_WHITELIST = ['package.json', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE', 'lib/client.js', 'lib/index.js'];
const ownManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// `files` is what npm packs, plus the names it always includes (the manifest,
// the readme, the license) — the same seven `npm pack --dry-run` reports.
for (const name of [...ownManifest.files, 'package.json', 'README.md', 'LICENSE']) {
	assert.ok(V169_WHITELIST.includes(name), `"${name}" must stay inside the 1.6.9 whitelist, or installs older than 1.7.0 cannot update to this release`);
}

// --- Release hygiene: the version in the README is the version being shipped ---
// Every install instruction in the READMEs is copy-pasted by a human, and a
// stale one does not look wrong — it installs last week's release. Two of them
// are the first thing a new user reads. Bumping `package.json` and forgetting
// these is the single easiest mistake to make at release time, so the test
// suite refuses it instead of a checklist reminding anyone.
const readmeVersion = (filename) => {
	const text = readFileSync(join(root, filename), 'utf8');
	// The quick-install code block, then the release-archive example.
	const pinned = /dsh-plugin-notify-sounds@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(text);
	const archive = new RegExp(`dsh-plugin-notify-sounds-(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)\\.tgz`).exec(text);
	return { pinned: pinned?.[1], archive: archive?.[1] };
};
for (const filename of ['README.md', 'README.zh.md']) {
	const found = readmeVersion(filename);
	assert.equal(found.pinned, ownManifest.version, `${filename}: the quick-install command must name ${ownManifest.version}`);
	assert.equal(found.archive, ownManifest.version, `${filename}: the release-archive example must name ${ownManifest.version}`);
}

console.log('host test: all assertions passed');
