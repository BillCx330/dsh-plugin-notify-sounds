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
 *   - the shared contracts across the two halves: the preset id list, the
 *     focus route path, and every `HH:MM` the schema can accept.
 *
 * Run: node test/host.mjs
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
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

// Where a tarball may live: https only, and only the two registries consulted.
assert.ok(host.isTrustedTarball('https://registry.npmjs.org/dsh-plugin-notify-sounds/-/dsh-plugin-notify-sounds-1.5.0.tgz'), 'the npm tarball host is trusted');
assert.ok(host.isTrustedTarball('https://registry.npmmirror.com/dsh-plugin-notify-sounds/-/dsh-plugin-notify-sounds-1.5.0.tgz'), 'the mirror tarball host is trusted');
assert.ok(host.isTrustedTarball('https://cdn.npmmirror.com/packages/dsh-plugin-notify-sounds/1.5.0/x.tgz'), 'the mirror CDN is trusted for tarballs');
assert.ok(!host.isTrustedTarball('http://registry.npmjs.org/pkg.tgz'), 'plain http is refused');
assert.ok(!host.isTrustedTarball('https://registry.npmjs.org.evil.example/pkg.tgz'), 'a lookalike host is refused');
assert.ok(!host.isTrustedTarball('https://evil.example/pkg.tgz'), 'any other host is refused');
assert.ok(!host.isTrustedTarball('https://cdn.npmmirror.com.evil.example/pkg.tgz'), 'a lookalike CDN host is refused');
assert.ok(!host.isTrustedTarball('not a url'), 'a non-URL is refused');

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
/** One plausible registry answer, with overrides for the hostile cases. */
const registrySays = (version, overrides = {}) => registryResponse({
	version,
	dist: {
		integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
		tarball: `https://registry.npmjs.org/dsh-plugin-notify-sounds/-/dsh-plugin-notify-sounds-${version}.tgz`,
		...overrides,
	},
});
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

	// An answer without a usable integrity is not believed.
	clock += 25 * 60 * 60 * 1000;
	scripts.push(registrySays('9.9.9', { integrity: 'md5-1234' }));
	scripts.push(registrySays('9.9.9', { integrity: 'md5-1234' }));
	assert.equal((await host.checkForUpdate({ force: true })).ok, false, 'an answer without a sha512 integrity is refused');

	// Neither is one whose tarball points outside the registries.
	clock += 25 * 60 * 60 * 1000;
	scripts.push(registrySays('9.9.9', { tarball: 'https://evil.example/pkg.tgz' }));
	scripts.push(registrySays('9.9.9', { tarball: 'https://evil.example/pkg.tgz' }));
	assert.equal((await host.checkForUpdate({ force: true })).ok, false, 'an answer pointing at another host is refused');

	// Neither is a malformed version.
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
	} finally {
		restoreEnv('DSH_PROFILE_DIR', previousProfileDir);
		restoreEnv('DSH_PROFILE', previousProfileName);
		rmSync(profileDir, { recursive: true, force: true });
		rmSync(installedRoot, { recursive: true, force: true });
	}
}

} finally {
	globalThis.fetch = realFetch;
	Date.now = realDateNow;
}

// --- Assertions: applying an update ----------------------------------------------
// The apply path turns bytes from the network into files on disk. Each
// assertion below is a gate in that chain: what an archive may contain, what a
// digest must prove before anything is written, and that a failure leaves the
// installation exactly as it was.

/** Build a minimal ustar archive (optionally gzipped) from `path, contents` entries. */
const buildTar = (entries, options = {}) => {
	const encoder = new TextEncoder();
	const blocks = [];
	for (const [path, content, typeflag = '0'] of entries) {
		const data = typeof content === 'string' ? encoder.encode(content) : content;
		const header = new Uint8Array(512);
		const put = (offset, length, text) => header.set(encoder.encode(text).subarray(0, length), offset);
		put(0, 100, path);
		put(124, 12, data.length.toString(8).padStart(11, '0'));
		put(148, 8, '        ');
		put(156, 1, typeflag);
		let sum = 0;
		for (const byte of header) sum += byte;
		put(148, 7, sum.toString(8).padStart(6, '0'));
		blocks.push(header);
		const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
		padded.set(data);
		blocks.push(padded);
	}
	blocks.push(new Uint8Array(1024));
	const total = blocks.reduce((size, block) => size + block.length, 0);
	const archive = new Uint8Array(total);
	let offset = 0;
	for (const block of blocks) {
		archive.set(block, offset);
		offset += block.length;
	}
	return options.gzip === false ? archive : gzipSync(archive);
};

// What an archive may carry. The manifest is payload like any other file, and
// the update checks it against the registry's answer, so a fake release has to
// look like the real package.
const manifestFor = (version) => JSON.stringify({ name: 'dsh-plugin-notify-sounds', version });
const goodFiles = [['package/package.json', manifestFor('9.9.9')], ['package/lib/client.js', 'new client']];
const unpacked = host.unpackTar(buildTar(goodFiles, { gzip: false }));
assert.equal(unpacked.size, 2, 'the files come through');
assert.equal(new TextDecoder().decode(unpacked.get('lib/client.js')), 'new client', 'contents are carried verbatim');
assert.ok(!unpacked.has('package/lib/client.js'), 'keys are package-relative, not archive paths');

// The file list is a RULE, not an inventory. A later release may add files, in
// directories the running code has never heard of, and an older installation
// must accept them: that is the property this whole change exists for. The
// previous design refused every name it did not already list, which made any
// release that added one permanently uninstallable by every older install —
// the updater that runs during an update is the one already on disk.
const grown = host.unpackTar(buildTar([
	...goodFiles,
	['package/lib/update.js', 'a module a later release added'],
	['package/assets/icon.svg', '<svg/>'],
], { gzip: false }));
assert.equal(grown.size, 4, 'a release may add files the running code has never heard of');
assert.equal(new TextDecoder().decode(grown.get('lib/update.js')), 'a module a later release added', 'the new module comes through');
assert.equal(new TextDecoder().decode(grown.get('assets/icon.svg')), '<svg/>', 'so does a new file in a new directory');

// Where an archive may not reach.
for (const path of ['package/../evil.txt', 'package/../../etc/passwd', 'evil.txt', '/package/package.json', 'package\\..\\evil.txt', 'package/lib/./client.js']) {
	assert.throws(() => host.unpackTar(buildTar([[path, 'x']], { gzip: false })), /refusing tar path/, `"${path}" is refused`);
}
// Names this updater reserves for its own work, and files a package manager
// reads as configuration: no archive may describe them, however it is spelled.
for (const path of ['package/.update-backup/package.json', 'package/lib/index.js.update-tmp', 'package/node_modules/x/index.js', 'package/.git/config', 'package/.npmrc', 'package/.pnpmfile.cjs', 'package/.update-manifest.json']) {
	assert.throws(() => host.unpackTar(buildTar([[path, 'x']], { gzip: false })), /refusing tar path/, `"${path}" is refused`);
}
// Windows and macOS filesystems are case-insensitive: these two entries would
// silently become one file, and which one wins depends on the archive's order.
assert.throws(
	() => host.unpackTar(buildTar([['package/lib/client.js', 'a'], ['package/LIB/Client.js', 'b']], { gzip: false })),
	/differ only in case/,
	'two entries that differ only by case are refused',
);
assert.throws(() => host.unpackTar(buildTar([['package/package.json', 'x', '2']], { gzip: false })), /non-file tar entry/, 'a symlink entry is refused');
assert.throws(() => host.unpackTar(new Uint8Array(1024)), /no usable files/, 'an empty archive is refused');
assert.throws(() => host.unpackTar(buildTar([['package/package.json', 'x']], { gzip: false }).subarray(0, 512)), /claims more/, 'a truncated archive is refused');
// A bounded download must not become unbounded disk usage: the declared sizes
// are summed and the entry count is capped.
const manyFiles = Array.from({ length: 300 }, (_, index) => [`package/lib/module-${index}.js`, 'x']);
assert.throws(() => host.unpackTar(buildTar(manyFiles, { gzip: false })), /more files than/, 'an archive with too many files is refused');

// The manifest check. With the inventory gone this is what still ties the bytes
// to a package and a version — and the next check trusts whatever manifest this
// update leaves on disk, so a wrong one would make "an update landed" a lie the
// check cannot see through.
host.verifyManifest(new Map([['package.json', new TextEncoder().encode(manifestFor('9.9.9'))]]), '9.9.9');
assert.throws(() => host.verifyManifest(new Map(), '9.9.9'), /no package.json/, 'an archive without a manifest is refused');
assert.throws(() => host.verifyManifest(new Map([['package.json', new TextEncoder().encode('{')]]), '9.9.9'), /not readable JSON/, 'an unreadable manifest is refused');
assert.throws(
	() => host.verifyManifest(new Map([['package.json', new TextEncoder().encode(JSON.stringify({ name: 'something-else', version: '9.9.9' }))]]), '9.9.9'),
	/is not dsh-plugin-notify-sounds/,
	'an archive for another package is refused',
);
assert.throws(
	() => host.verifyManifest(new Map([['package.json', new TextEncoder().encode(manifestFor('9.9.8'))]]), '9.9.9'),
	/where the registry said/,
	'a manifest that disagrees with the registry is refused',
);
// A path that differs from an entry point the manifest itself declares only by
// case would replace `lib/client.js` on Windows and macOS and sit there dead on
// Linux — one archive, two installations. The set is read from the archive's own
// manifest, never from a list held in the code.
assert.throws(
	() => host.verifyManifest(new Map([
		['package.json', new TextEncoder().encode(JSON.stringify({ name: 'dsh-plugin-notify-sounds', version: '9.9.9', main: 'lib/index.js', exports: { './client': './lib/client.js' } }))],
		['LIB/Client.js', new TextEncoder().encode('clobber')],
	]), '9.9.9'),
	/differs only in case/,
	'a case variant of a declared entry point is refused',
);
host.verifyManifest(new Map([
	['package.json', new TextEncoder().encode(JSON.stringify({ name: 'dsh-plugin-notify-sounds', version: '9.9.9', main: 'lib/index.js' }))],
	['lib/index.js', new TextEncoder().encode('ok')],
	['assets/icon.svg', new TextEncoder().encode('<svg/>')],
]), '9.9.9');

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

// The write side keeps its own guard. `unpackTar` already refuses a climbing
// path, so this is the second lock on the same door — and it is the one that
// still holds if a caller ever hands `installUpdate` a map from somewhere else.
const guardedRoot = mkdtempSync(join(tmpdir(), 'notify-sounds-guard-'));
assert.throws(
	() => host.installUpdate(guardedRoot, new Map([['../escaped.txt', new TextEncoder().encode('x')]])),
	/refusing to write outside the package/,
	'installUpdate refuses a path that leaves the package directory',
);
assert.equal(existsSync(join(guardedRoot, '..', 'escaped.txt')), false, 'and nothing was written there');
rmSync(guardedRoot, { recursive: true, force: true });

// What a digest must prove before a byte is written.
const sampleBytes = new TextEncoder().encode('tarball bytes');
const sampleDigest = `sha512-${createHash('sha512').update(sampleBytes).digest('base64')}`;
host.verifyIntegrity(sampleBytes, sampleDigest);
assert.throws(() => host.verifyIntegrity(new TextEncoder().encode('tampered bytes'), sampleDigest), /sha512/, 'tampered bytes fail the digest');
assert.throws(() => host.verifyIntegrity(sampleBytes, 'sha512-'), /sha512/, 'an empty digest fails');
assert.throws(() => host.verifyIntegrity(sampleBytes, 'md5-abc'), /sha512/, 'a non-sha512 digest fails');

// End to end, against throwaway installations.
const realFetchForApply = globalThis.fetch;
const realClockForApply = Date.now;
let applyClock = 2_000_000_000_000;
Date.now = () => applyClock;
const applyRequests = [];
/** Answer the registry, then serve the tarball it names. */
const serve = (version, archive, integrityOverride) => {
	const digest = integrityOverride ?? `sha512-${createHash('sha512').update(archive).digest('base64')}`;
	globalThis.fetch = async (url) => {
		const target = String(url);
		applyRequests.push(target);
		if (target.endsWith('/latest')) {
			return registryResponse({
				version,
				dist: {
					integrity: digest,
					tarball: `https://registry.npmjs.org/dsh-plugin-notify-sounds/-/dsh-plugin-notify-sounds-${version}.tgz`,
				},
			});
		}
		return registryResponse(archive);
	};
};
/** A throwaway installation whose manifest claims the given version. */
const makeInstall = (version) => {
	const root = mkdtempSync(join(tmpdir(), 'notify-sounds-update-'));
	mkdirSync(join(root, 'lib'), { recursive: true });
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-plugin-notify-sounds', version }));
	writeFileSync(join(root, 'lib', 'client.js'), 'old client');
	writeFileSync(join(root, 'lib', 'index.js'), 'old index');
	writeFileSync(join(root, 'LICENSE'), 'old license');
	return root;
};

try {
	// A newer release is downloaded, verified, unpacked and swapped in.
	const root = makeInstall('1.0.0');
	serve('9.9.9', buildTar(goodFiles));
	applyRequests.length = 0;
	const updated = await host.applyUpdate({ root });
	assert.equal(updated.ok, true, 'a newer release is applied');
	assert.equal(updated.from, '1.0.0', 'the previous version is reported');
	assert.equal(updated.to, '9.9.9', 'the installed version is reported');
	assert.equal(updated.requiresRestart, true, 'the new code needs a restart');
	assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, '9.9.9', 'the manifest is swapped');
	assert.equal(readFileSync(join(root, 'lib', 'client.js'), 'utf8'), 'new client', 'the code is swapped');
	assert.equal(readFileSync(join(root, 'lib', 'index.js'), 'utf8'), 'old index', 'a file the archive did not carry is left alone');
	assert.equal(existsSync(join(root, '.update-backup')), false, 'the backup is cleaned up once the swap succeeds');
	assert.equal(applyRequests.length, 2, 'one registry answer and one download');
	assert.ok(applyRequests[1].endsWith('.tgz'), 'the download comes from the tarball the registry named');

	// A release that ADDS files installs them, including into a directory that
	// did not exist yet. This is the end-to-end form of the property the rule
	// change exists for: an installation running this version must be able to
	// take a later release that carries files it has never seen.
	const growing = makeInstall('1.0.0');
	serve('9.9.9', buildTar([...goodFiles, ['package/lib/update.js', 'new module'], ['package/assets/icon.svg', '<svg/>']]));
	const grew = await host.applyUpdate({ root: growing });
	assert.equal(grew.ok, true, 'a release carrying new files is applied');
	assert.equal(grew.stage, undefined, 'and it reports no failure stage');
	assert.equal(readFileSync(join(growing, 'lib', 'update.js'), 'utf8'), 'new module', 'the new module is written');
	assert.equal(readFileSync(join(growing, 'assets', 'icon.svg'), 'utf8'), '<svg/>', 'and so is a file in a directory that did not exist');
	assert.equal(JSON.parse(readFileSync(join(growing, 'package.json'), 'utf8')).version, '9.9.9', 'the manifest is swapped last, but it is swapped');
	assert.equal(existsSync(join(growing, '.update-backup')), false, 'and the backup is cleaned up');
	rmSync(growing, { recursive: true, force: true });

	// The cached "update available" answer is a lie now. A check after the
	// install must re-read the manifest it just wrote — and it repeats the
	// install it just made, so the row can keep saying so even after the page
	// reloads (an update swaps the client half's own file).
	applyRequests.length = 0;
	const afterApply = await host.checkForUpdate({ root });
	assert.equal(afterApply.applied?.from, '1.0.0', 'the check repeats what the install replaced');
	assert.equal(afterApply.applied?.to, '9.9.9', 'and what it installed');
	assert.equal(afterApply.updateAvailable, false, 'and the fresh answer knows there is nothing left to do');
	assert.equal(applyRequests.length, 1, 'a check after the install re-queries instead of trusting the stale cache');
	rmSync(root, { recursive: true, force: true });

	// Nothing to do at the current version — and nothing is downloaded.
	const current = makeInstall('9.9.9');
	serve('9.9.9', buildTar(goodFiles));
	applyRequests.length = 0;
	const upToDate = await host.applyUpdate({ root: current });
	assert.equal(upToDate.ok, true, 'an up-to-date install reports success');
	assert.equal(upToDate.upToDate, true, 'and says there was nothing to do');
	assert.equal(applyRequests.length, 1, 'the tarball is not downloaded');
	rmSync(current, { recursive: true, force: true });

	// A tarball that fails its digest is not written anywhere.
	const tampered = makeInstall('1.0.0');
	const archive = buildTar(goodFiles);
	serve('9.9.9', archive, `sha512-${createHash('sha512').update('something else').digest('base64')}`);
	const rejected = await host.applyUpdate({ root: tampered });
	assert.equal(rejected.ok, false, 'a tarball that fails its digest is refused');
	assert.equal(rejected.stage, 'verify', 'the failure names the stage');
	assert.ok(readFileSync(join(tampered, 'package.json'), 'utf8').includes('1.0.0'), 'nothing was written');
	rmSync(tampered, { recursive: true, force: true });

	// A hostile archive is refused before anything is written.
	const hostile = makeInstall('1.0.0');
	serve('9.9.9', buildTar([['package/../evil.txt', 'gotcha']]));
	const blocked = await host.applyUpdate({ root: hostile });
	assert.equal(blocked.ok, false, 'an archive that climbs out of the package is refused');
	assert.equal(blocked.stage, 'unpack', 'the failure names the stage');
	assert.ok(readFileSync(join(hostile, 'package.json'), 'utf8').includes('1.0.0'), 'nothing was written');
	rmSync(hostile, { recursive: true, force: true });

	// A write that fails mid-way restores what was there.
	const broken = makeInstall('1.0.0');
	rmSync(join(broken, 'lib'), { recursive: true, force: true });
	writeFileSync(join(broken, 'lib'), 'not a directory');
	serve('9.9.9', buildTar(goodFiles));
	const rolled = await host.applyUpdate({ root: broken });
	assert.equal(rolled.ok, false, 'a replace failure is reported');
	assert.equal(rolled.stage, 'replace', 'the failure names the stage');
	assert.ok(readFileSync(join(broken, 'package.json'), 'utf8').includes('1.0.0'), 'the manifest is restored');
	assert.equal(readFileSync(join(broken, 'LICENSE'), 'utf8'), 'old license', 'and the other files are untouched');
	rmSync(broken, { recursive: true, force: true });

	// A failed update leaves NOTHING behind: a file the update ADDED must go away
	// again (there is no backup to restore it from), no temp file may survive,
	// and neither may a directory the update created. The archive order is chosen
	// so the added file is written BEFORE the write that fails — the manifest is
	// written last now, so a failure lands on the entry before it in this list.
	const added = makeInstall('1.0.0');
	rmSync(join(added, 'lib'), { recursive: true, force: true });
	writeFileSync(join(added, 'lib'), 'not a directory');
	serve('9.9.9', buildTar([['package/README.md', 'new readme'], ...goodFiles]));
	const rolledBack = await host.applyUpdate({ root: added });
	assert.equal(rolledBack.ok, false, 'the failure is reported as before');
	assert.equal(rolledBack.stage, 'replace', 'and it happened while replacing files');
	assert.equal(existsSync(join(added, 'README.md')), false, 'a file the update added is removed again on rollback');
	assert.ok(readFileSync(join(added, 'package.json'), 'utf8').includes('1.0.0'), 'the manifest is restored');
	assert.equal(existsSync(join(added, 'package.json.update-tmp')), false, 'no temp file survives a failed update');
	assert.equal(existsSync(join(added, 'lib', 'client.js.update-tmp')), false, 'and none survives at any depth');
	assert.equal(existsSync(join(added, '.update-backup')), false, 'and the backup directory is gone too');
	rmSync(added, { recursive: true, force: true });

	// A directory the update created goes away with the file it held.
	const nested = makeInstall('1.0.0');
	rmSync(join(nested, 'lib'), { recursive: true, force: true });
	writeFileSync(join(nested, 'lib'), 'not a directory');
	serve('9.9.9', buildTar([['package/assets/icons/new.svg', '<svg/>'], ...goodFiles]));
	const nestedRolled = await host.applyUpdate({ root: nested });
	assert.equal(nestedRolled.ok, false, 'the write into the new directory is attempted first, then the failing one');
	assert.equal(existsSync(join(nested, 'assets')), false, 'the directory the update created is removed again');
	rmSync(nested, { recursive: true, force: true });

	// A gzip stream must not be able to expand past the cap: the tarball size is
	// bounded on the wire, and the decompressed size has to be bounded too or a
	// small download becomes gigabytes of memory. The oversized content rides in
	// a pax extension header, which `unpackTar` skips WITHOUT counting its size —
	// so if the decompressor's own limit were removed this archive would sail
	// through the per-file accounting and install, and this test would fail
	// loudly instead of passing for the wrong reason.
	const UNPACKED_CAP = 8 * 1024 * 1024 * 8;
	const bomb = makeInstall('1.0.0');
	serve('9.9.9', buildTar([['package/pax-header', Buffer.alloc(UNPACKED_CAP + 1024, 0x78), 'x'], ...goodFiles]));
	const exploded = await host.applyUpdate({ root: bomb });
	assert.equal(exploded.ok, false, 'an archive that expands past the cap is refused');
	assert.equal(exploded.stage, 'unpack', 'and the failure is the unpack stage');
	assert.ok(!String(exploded.error).includes('expands beyond'), 'the decompressor stopped it before the archive was ever materialized');
	assert.ok(readFileSync(join(bomb, 'package.json'), 'utf8').includes('1.0.0'), 'nothing is written');
	rmSync(bomb, { recursive: true, force: true });

	// A manifest that is not this package at this version is refused before
	// anything is written, whatever the archive's digest says.
	const impostor = makeInstall('1.0.0');
	serve('9.9.9', buildTar([['package/package.json', manifestFor('1.2.3')], ['package/lib/client.js', 'new client']]));
	const mismatched = await host.applyUpdate({ root: impostor });
	assert.equal(mismatched.ok, false, 'a manifest disagreeing with the registry is refused');
	assert.equal(mismatched.stage, 'manifest', 'the failure names the manifest stage');
	assert.equal(mismatched.to, '9.9.9', 'and the failure carries the version that was being installed');
	assert.ok(readFileSync(join(impostor, 'package.json'), 'utf8').includes('1.0.0'), 'nothing was written');
	rmSync(impostor, { recursive: true, force: true });

	// A release can also DROP a file, and an archive cannot express that: it
	// lists what exists, never what should go. The difference is computed
	// against the record the previous update left behind — and only files that
	// record names are ever deleted, so anything else in the directory stays.
	const archiveOf = (version, extra = []) => buildTar([
		['package/package.json', manifestFor(version)],
		['package/lib/client.js', `client ${version}`],
		...extra,
	]);
	const dropping = makeInstall('1.0.0');
	serve('9.9.9', archiveOf('9.9.9', [['package/lib/legacy.js', 'old helper']]));
	const installed = await host.applyUpdate({ root: dropping });
	assert.equal(installed.ok, true, 'the first update installs');
	assert.equal(readFileSync(join(dropping, 'lib', 'legacy.js'), 'utf8'), 'old helper', 'including a file it added');
	assert.deepEqual(
		JSON.parse(readFileSync(join(dropping, '.update-manifest.json'), 'utf8')).files,
		['.update-manifest.json', 'lib/client.js', 'lib/legacy.js', 'package.json'],
		'the record lists what this update installed, itself included',
	);
	writeFileSync(join(dropping, 'my-notes.txt'), 'mine');
	serve('9.9.10', archiveOf('9.9.10'));
	const droppingAgain = await host.applyUpdate({ root: dropping });
	assert.equal(droppingAgain.ok, true, 'the next release installs');
	assert.equal(existsSync(join(dropping, 'lib', 'legacy.js')), false, 'the file the new release dropped is deleted');
	assert.equal(readFileSync(join(dropping, 'my-notes.txt'), 'utf8'), 'mine', 'a file no update ever wrote is left alone');
	assert.deepEqual(
		JSON.parse(readFileSync(join(dropping, '.update-manifest.json'), 'utf8')).files,
		['.update-manifest.json', 'lib/client.js', 'package.json'],
		'and the record moves on with the new file set',
	);
	rmSync(dropping, { recursive: true, force: true });

	// An installation that predates the record — every ≤1.6.9 install, and the
	// first update after it — prunes nothing: with no evidence of what an update
	// wrote, guessing is the one thing that could delete a user's own file.
	const unrecorded = makeInstall('1.0.0');
	writeFileSync(join(unrecorded, 'lib', 'was-already-here.js'), 'before the record existed');
	serve('9.9.9', archiveOf('9.9.9'));
	const firstFromOld = await host.applyUpdate({ root: unrecorded });
	assert.equal(firstFromOld.ok, true, 'an installation with no record still updates');
	assert.equal(existsSync(join(unrecorded, 'lib', 'was-already-here.js')), true, 'and nothing is guessed away');
	assert.equal(existsSync(join(unrecorded, '.update-manifest.json')), true, 'the record starts here, so the next update can prune');
	rmSync(unrecorded, { recursive: true, force: true });

	// A failure AFTER the prune puts the deleted file back. The record is the
	// last thing written, so blocking its temporary name is what lands a failure
	// behind the deletion.
	const restoring = makeInstall('1.0.0');
	writeFileSync(join(restoring, 'lib', 'legacy.js'), 'still needed');
	writeFileSync(join(restoring, '.update-manifest.json'), JSON.stringify({ version: 1, files: ['.update-manifest.json', 'lib/client.js', 'lib/legacy.js', 'package.json'] }));
	mkdirSync(join(restoring, '.update-manifest.json.update-tmp'), { recursive: true });
	serve('9.9.9', archiveOf('9.9.9'));
	const restoredAgain = await host.applyUpdate({ root: restoring });
	assert.equal(restoredAgain.ok, false, 'a failure while writing the record is reported');
	assert.equal(restoredAgain.stage, 'replace', 'and it is a replace-stage failure');
	assert.equal(readFileSync(join(restoring, 'lib', 'legacy.js'), 'utf8'), 'still needed', 'the file this update deleted is back');
	assert.ok(readFileSync(join(restoring, 'package.json'), 'utf8').includes('1.0.0'), 'and the files it replaced are back');
	assert.equal(existsSync(join(restoring, '.update-backup')), false, 'the backup is gone again');
	rmSync(restoring, { recursive: true, force: true });

	// Two callers at once share one download and one swap: they would
	// otherwise fight over the fixed temp names and the single backup
	// directory, and the slower one's cleanup would undo the faster one's
	// work.
	const shared = makeInstall('1.0.0');
	serve('9.9.9', buildTar(goodFiles));
	applyRequests.length = 0;
	const [first, second] = await Promise.all([host.applyUpdate({ root: shared }), host.applyUpdate({ root: shared })]);
	assert.equal(first.ok, true, 'the first caller gets the update');
	assert.equal(second, first, 'the second caller joins the same run');
	assert.equal(applyRequests.length, 2, 'and the registry sees one answer and one download');
	rmSync(shared, { recursive: true, force: true });

	// The same guard covers a check: the settings row and the notice above it
	// mount together, and neither the TTL nor the spacing rule can see a
	// request that is still in flight.
	applyClock += 25 * 60 * 60 * 1000;
	applyRequests.length = 0;
	const [one, two] = await Promise.all([host.checkForUpdate({ force: true }), host.checkForUpdate({ force: true })]);
	assert.equal(two, one, 'concurrent checks share one request');
	assert.equal(applyRequests.length, 1, 'and only one request goes out');


	// Redirects: followed one hop at a time, and only to trusted hosts. The
	// mainland mirror serves its tarballs from its CDN — the one legitimate
	// hop. Measured: a downloader that refused every redirect could never
	// finish whenever the mirror answered the check.
	const redirectResponse = (location, status = 302) => ({
		ok: false,
		status,
		headers: { get: (name) => (name.toLowerCase() === 'location' ? location : null) },
		body: { getReader: () => ({ read: async () => ({ done: true }), cancel: async () => {} }) },
	});
	const mirrorArchive = buildTar(goodFiles);
	const mirrorDigest = `sha512-${createHash('sha512').update(mirrorArchive).digest('base64')}`;
	const mirrorAnswer = () => registryResponse({
		version: '9.9.9',
		dist: {
			integrity: mirrorDigest,
			tarball: 'https://registry.npmmirror.com/dsh-plugin-notify-sounds/-/dsh-plugin-notify-sounds-9.9.9.tgz',
		},
	});

	const followedRoot = makeInstall('1.0.0');
	globalThis.fetch = async (url) => {
		const target = String(url);
		applyRequests.push(target);
		if (target.endsWith('/latest')) return mirrorAnswer();
		if (target.startsWith('https://registry.npmmirror.com/')) {
			return redirectResponse('https://cdn.npmmirror.com/packages/dsh-plugin-notify-sounds/9.9.9/dsh-plugin-notify-sounds-9.9.9.tgz');
		}
		return registryResponse(mirrorArchive);
	};
	applyRequests.length = 0;
	const followed = await host.applyUpdate({ root: followedRoot });
	assert.equal(followed.ok, true, 'a redirect to the mirror CDN is followed');
	assert.equal(followed.to, '9.9.9', 'and the update lands');
	assert.equal(applyRequests.length, 3, 'metadata, redirect, then the CDN download');
	assert.ok(applyRequests[2].startsWith('https://cdn.npmmirror.com/'), 'the bytes come from the mirror CDN');
	rmSync(followedRoot, { recursive: true, force: true });

	const evilRoot = makeInstall('1.0.0');
	globalThis.fetch = async (url) => (String(url).endsWith('/latest') ? mirrorAnswer() : redirectResponse('https://evil.example/pkg.tgz'));
	const evilRedirect = await host.applyUpdate({ root: evilRoot });
	assert.equal(evilRedirect.ok, false, 'a redirect to an untrusted host is refused');
	assert.equal(evilRedirect.stage, 'download', 'and the failure names the stage');
	assert.ok(String(evilRedirect.error).includes('evil.example'), 'and names the host it refused');
	assert.ok(readFileSync(join(evilRoot, 'package.json'), 'utf8').includes('1.0.0'), 'nothing was written');
	rmSync(evilRoot, { recursive: true, force: true });

	const loopRoot = makeInstall('1.0.0');
	globalThis.fetch = async (url) => (String(url).endsWith('/latest') ? mirrorAnswer() : redirectResponse(`${String(url)}/again`));
	const looped = await host.applyUpdate({ root: loopRoot });
	assert.equal(looped.ok, false, 'a redirect loop is refused');
	assert.ok(String(looped.error).includes('redirects'), 'and says so');
	rmSync(loopRoot, { recursive: true, force: true });
} finally {
	globalThis.fetch = realFetchForApply;
	Date.now = realClockForApply;
}

console.log('host test: all assertions passed');
