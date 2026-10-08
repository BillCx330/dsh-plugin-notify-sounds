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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
assert.ok(host.isDesktopTitle('DeepSeek Harness'), 'the bare app title matches');
assert.ok(host.isDesktopTitle('某会话 — DeepSeek Harness'), 'a session title matches (em dash)');
assert.ok(host.isDesktopTitle('Some Session - DeepSeek Harness'), 'a hyphen variant matches too');
assert.ok(!host.isDesktopTitle('DeepSeek Harness — Another App'), 'a title that only starts with the name does not match');
assert.ok(!host.isDesktopTitle('Another App'), 'another app does not match');
assert.ok(!host.isDesktopTitle(''), 'an empty title does not match');

// --- Assertions: focus route -----------------------------------------------------
const configureCalls = [];
const registeredRoutes = [];
let rejectionFor = () => undefined;
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
		};
		callback(child);
	},
});

host.apply(makeCtx());
assert.deepEqual(configureCalls.map((call) => call.options), [{ auto: false }], 'the auto inventory page is suppressed');
assert.equal(registeredRoutes.length, 1, 'one route is registered');
const route = registeredRoutes[0];
assert.equal(route.kind, 'exact', 'the route is an exact match');
assert.equal(route.path, host.FOCUS_PATH, 'the route serves the shared focus path');
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

console.log('host test: all assertions passed');
