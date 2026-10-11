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
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
assert.equal(registeredRoutes.length, 3, 'three routes are registered: focus, update check, update apply');
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

// What an archive may carry.
const goodFiles = [['package/package.json', '{"version":"9.9.9"}'], ['package/lib/client.js', 'new client']];
const unpacked = host.unpackTar(buildTar(goodFiles, { gzip: false }));
assert.equal(unpacked.size, 2, 'the whitelisted files come through');
assert.equal(new TextDecoder().decode(unpacked.get('lib/client.js')), 'new client', 'contents are carried verbatim');
assert.ok(!unpacked.has('package/lib/client.js'), 'keys are package-relative, not archive paths');

// Where an archive may not reach.
for (const path of ['package/../evil.txt', 'package/../../etc/passwd', 'evil.txt', 'package/extra.txt', '/package/package.json', 'package\\..\\evil.txt']) {
	assert.throws(() => host.unpackTar(buildTar([[path, 'x']], { gzip: false })), /refusing tar path/, `"${path}" is refused`);
}
assert.throws(() => host.unpackTar(buildTar([['package/package.json', 'x', '2']], { gzip: false })), /non-file tar entry/, 'a symlink entry is refused');
assert.throws(() => host.unpackTar(new Uint8Array(1024)), /no usable files/, 'an empty archive is refused');
assert.throws(() => host.unpackTar(buildTar([['package/package.json', 'x']], { gzip: false }).subarray(0, 512)), /claims more/, 'a truncated archive is refused');

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
Date.now = () => 2_000_000_000_000;
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
	assert.ok(readFileSync(join(root, '.update-backup', 'package.json'), 'utf8').includes('1.0.0'), 'the replaced files are kept aside');
	assert.equal(applyRequests.length, 2, 'one registry answer and one download');
	assert.ok(applyRequests[1].endsWith('.tgz'), 'the download comes from the tarball the registry named');

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

	// The apply route is fenced and serves nothing but POST.
	const applyRoute = registeredRoutes.find((entry) => entry.path === host.UPDATE_APPLY_PATH);
	assert.ok(applyRoute, 'the update apply route is registered');
	assert.equal(applyRoute.kind, 'exact', 'the apply route is an exact match');
	assert.equal(client.UPDATE_APPLY_PATH, host.UPDATE_APPLY_PATH, 'the apply route path matches between the halves');
	const callApply = async (req) => {
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
		await applyRoute.handler(req, res);
		return res;
	};
	rejectionFor = () => 403;
	assert.equal((await callApply({ method: 'POST', url: '/notify-sounds/update/apply' })).statusCode, 403, 'a fenced apply is refused with 403');
	rejectionFor = () => undefined;
	const wrongApplyMethod = await callApply({ method: 'GET', url: '/notify-sounds/update/apply' });
	assert.equal(wrongApplyMethod.statusCode, 405, 'a non-POST apply is refused with 405');
	assert.equal(wrongApplyMethod.headers.allow, 'POST', 'the 405 advertises POST');

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
