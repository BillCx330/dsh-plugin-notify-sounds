/**
 * Host half of `dsh-plugin-notify-sounds`.
 *
 * All behavior lives in the browser entry (`./client`): the sounds themselves
 * are Web Audio synthesis, and the triggers are the Client's own
 * `uiSession.sessionStatus` facts (pending interactions and running→idle
 * transitions). This Node half owns two things the browser cannot:
 *
 *   - the volatile Config schema below is what the Host Settings document
 *     serves under the `notify-sounds` namespace, so the Settings section the
 *     Client registers reads and writes through `configForms` exactly like
 *     DSH's own preference rows (locale, developer tools, web search);
 *   - `apply` registers the `/notify-sounds/focus` route the browser posts to
 *     when a system notification is clicked — the renderer cannot raise the
 *     OS window, but this process can: on Windows it calls `user32.dll`
 *     through the Desktop's own FFI binding and finds the window by title.
 *
 * `apply` also asks the settings namespace to hold off any auto-generated
 * inventory page for this entry, because the Client contributes a dedicated
 * Settings section of its own. (Note: `autoGenerate` is not yet consumed by
 * any shipped client — the flag is correct and future-proof, but today the
 * effect is a no-op. Runtime README: "no shipped client does so yet".)
 *
 * @module dsh-plugin-notify-sounds
 */

import z from "@deepseek-ai/schemastery";
import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

/** Diagnostic name of this Host plugin. */
export const name = "notify-sounds";

/** Sound ids shared with the Client half's preset table (spelled, not imported: the browser bundle is self-contained). Exported so the tests can cross-check the two spellings. */
export const SOUND_IDS = ["bell", "chime", "ding", "drop", "pulse", "arc", "coin", "success", "knock", "custom", "none"];

/** Quiet-hours time-of-day pattern, "HH:MM". Exported for the same cross-check. */
export const TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Deep link the packaged Desktop registers (`setAsDefaultProtocolClient`); the last-resort focus path. */
const FOCUS_DEEP_LINK = "dsh://open";

/**
 * The desktop app's bundle id, for raising it by identity on macOS.
 *
 * Taken from the packaged shell's own manifest (`dshDesktopAppId`), not
 * guessed: `open -b <id>` is the only raise that needs no URL scheme to have
 * been registered.
 */
const MACOS_BUNDLE_ID = "com.deepseek.dsh";

/** Route the browser half posts to when a system notification is clicked. Exported so the tests can cross-check the Client half's spelling. */
export const FOCUS_PATH = "/notify-sounds/focus";

/** App name the Desktop shell appends to its primary window's title. */
const DESKTOP_APP_TITLE = "DeepSeek Harness";

/** `ShowWindow` command: restore a minimized or maximized window to its prior size. */
const SW_RESTORE = 9;

/** Virtual key and flag for the ALT tap that satisfies the foreground lock. */
const VK_MENU = 0x12;
const KEYEVENTF_KEYUP = 0x2;

//#region native window raise

/**
 * Locate the Desktop's own prebuilt `koffi` native module.
 *
 * The Desktop Host process already ships `koffi` as its own dependency (it is
 * what backs the PTY bindings), so borrowing it costs this plugin nothing. The
 * native binary is the one thing the app cannot pack into `app.asar`, so it
 * sits in `app.asar.unpacked` as a real filesystem path this process can load.
 *
 * The install root cannot be derived from this module's own location: the
 * plugin lives in the DSH profile (`~/.dsh/profiles/<name>/node_modules/…`),
 * which has nothing to do with where the app is installed. Two sources are
 * tried, because neither is guaranteed here:
 *
 *   - `process.resourcesPath`, which Electron injects — but this process runs
 *     as Electron's own binary in Node mode, where it is absent (measured:
 *     empty).
 *   - this process's own executable: the Host IS the Desktop binary, so
 *     `<exe dir>/resources` is the same directory. A `resources` candidate is
 *     only trusted when it actually holds the app.
 *
 * @returns the module path, or undefined when this build does not ship it.
 */
function resolveNativeModule() {
	if (process.platform !== "win32") return undefined;
	const resources = [];
	if (typeof process.resourcesPath === "string" && process.resourcesPath !== "") {
		resources.push(process.resourcesPath);
	}
	try {
		const beside = join(dirname(process.execPath), "resources");
		if (!resources.includes(beside) && existsSync(join(beside, "app.asar"))) resources.push(beside);
	} catch {
		// An unusable executable path simply leaves the other sources.
	}
	// Only the unpacked native binary is reachable: koffi's JavaScript wrapper
	// lives inside `app.asar`, while its `.node` is extracted beside it, so the
	// package directory itself never resolves from here. The unpacked location
	// has been one shape in every build examined; the second entry covers the
	// flat layout in case a build hoists it.
	const relatives = [
		["app.asar.unpacked", "dsh", "node_modules", "@deepseek-ai", "dsh-desktop-host", "node_modules", "@koromix", "koffi-win32-x64", "win32_x64", "koffi.node"],
		["app.asar.unpacked", "dsh", "node_modules", "@koromix", "koffi-win32-x64", "win32_x64", "koffi.node"],
		// A non-asar (development) install has no `app.asar.unpacked` wrapper.
		["dsh", "node_modules", "@koromix", "koffi-win32-x64", "win32_x64", "koffi.node"],
	];
	for (const base of resources) {
		for (const relative of relatives) {
			const candidate = join(base, ...relative);
			if (existsSync(candidate)) return candidate;
		}
	}
	return undefined;
}

/**
 * Load the Win32 entry points through the Desktop's own FFI binding.
 *
 * Deliberately narrow. Only `user32` window calls are bound: finding the window
 * by title means this never inspects another process, which is the behaviour
 * proactive defence exists to catch. An earlier version resolved the owning
 * executable with `OpenProcess`, and a security suite flagged the Desktop's
 * own executable on every click.
 *
 * Loaded once and cached; a failed load is remembered so it is not retried.
 *
 * @returns the bound calls, or undefined when FFI is unavailable here.
 */
function loadNativeRaise() {
	if (process.platform !== "win32") return undefined;
	if (nativeRaise !== undefined) return nativeRaise ?? undefined;
	let bound;
	try {
		const modulePath = resolveNativeModule();
		if (modulePath === undefined) throw new Error("koffi not found");
		// The `.node` is loaded directly: koffi's JavaScript wrapper sits inside
		// `app.asar` and cannot be required from here, but the binding exports
		// the whole API on its own. The base path only has to be a real
		// directory for module resolution, which the binary's own is.
		const koffi = createRequire(join(dirname(modulePath), "index.cjs"))(modulePath);
		const user32 = koffi.load("user32.dll");
		const kernel32 = koffi.load("kernel32.dll");
		const EnumWindowsProc = koffi.proto("bool __stdcall WNDENUMPROC(void *hWnd, intptr_t lParam)");
		bound = {
			koffi,
			EnumWindowsProc,
			EnumWindows: user32.func("bool __stdcall EnumWindows(void *cb, intptr_t param)"),
			IsWindowVisible: user32.func("bool __stdcall IsWindowVisible(void *h)"),
			GetWindowTextLengthW: user32.func("int __stdcall GetWindowTextLengthW(void *h)"),
			GetWindowTextW: user32.func("int __stdcall GetWindowTextW(void *h, _Out_ uint16 *buf, int max)"),
			ShowWindow: user32.func("bool __stdcall ShowWindow(void *h, int cmd)"),
			BringWindowToTop: user32.func("bool __stdcall BringWindowToTop(void *h)"),
			SetForegroundWindow: user32.func("bool __stdcall SetForegroundWindow(void *h)"),
			AllowSetForegroundWindow: user32.func("bool __stdcall AllowSetForegroundWindow(int pid)"),
			GetForegroundWindow: user32.func("void * __stdcall GetForegroundWindow()"),
			GetWindowThreadProcessId: user32.func("uint32 __stdcall GetWindowThreadProcessId(void *h, void *pid)"),
			AttachThreadInput: user32.func("bool __stdcall AttachThreadInput(uint32 attach, uint32 attachTo, bool attachFlag)"),
			keybd_event: user32.func("void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr_t extra)"),
			GetCurrentThreadId: kernel32.func("uint32 __stdcall GetCurrentThreadId()"),
		};
	} catch (error) {
		// Remember the failure so it is not retried, but say so once: a user's
		// only symptom otherwise is "clicking did nothing".
		warn(`native raise unavailable: ${error?.message ?? error}`);
		bound = null;
	}
	nativeRaise = bound;
	return bound ?? undefined;
}

/** Cached FFI binding; `null` records a failed load so it is not retried. */
let nativeRaise;

/**
 * Read a window's title, or "" when it has none.
 *
 * @param native - the bound Win32 calls.
 * @param handle - the window to read.
 * @returns the title text.
 */
export function windowTitle(native, handle) {
	try {
		const length = native.GetWindowTextLengthW(handle);
		if (length <= 0) return "";
		const buffer = new Uint16Array(length + 2);
		const copied = native.GetWindowTextW(handle, buffer, buffer.length);
		// The two calls are not atomic: between them the page can rewrite its
		// title (switching sessions is exactly when it does), and this call
		// then copies fewer characters than the first one counted. Slicing by
		// the OLD count would hand back a string with NULs on the end — which
		// no real title ever contains, and which silently stops `endsWith`
		// matching, i.e. one click that does nothing at all. Slice by what was
		// actually copied, and treat a nonsense return as "read the old count"
		// rather than trusting it.
		const written = Number.isFinite(copied) && copied >= 0 ? Math.min(copied, length) : length;
		return Buffer.from(buffer.buffer, 0, written * 2).toString("utf16le");
	} catch {
		return "";
	}
}

/**
 * Whether a window's title is the Desktop's.
 *
 * The title is whatever the page last set — the shell only overrides it for
 * its own error screens — so it is `<session or screen title> — <app name>`
 * while a session is open, and may be just the app name on a blank screen.
 * Both shapes have to match, which is why the bare title is accepted too: a
 * prefix-only rule silently stops finding the window on a screen without a
 * session.
 *
 * @param title - the window's title.
 * @returns whether it names this app.
 *
 * Exported for the Host-half tests: the one pure piece of the Win32 search.
 */
export function isDesktopTitle(title) {
	return title === DESKTOP_APP_TITLE
		|| title.endsWith(`— ${DESKTOP_APP_TITLE}`)
		|| title.endsWith(`- ${DESKTOP_APP_TITLE}`);
}

/**
 * Find the Desktop's primary window.
 *
 * Matched by the title the page composes. This deliberately inspects nothing
 * about a window beyond its title: resolving an owning process
 * (`OpenProcess` + `GetModuleBaseNameW`) finds it too, but reading another
 * process is what a security suite's behaviour engine flags — that version
 * brought a detection dialog on every click, attributed to the Desktop's own
 * executable.
 *
 * @param native - the bound Win32 calls.
 * @returns the window handle, or undefined.
 */
function findDesktopWindow(native) {
	let found;
	const visit = native.koffi.register((handle) => {
		try {
			if (!native.IsWindowVisible(handle)) return true;
			if (!isDesktopTitle(windowTitle(native, handle))) return true;
			found = handle;
			return false; // stop at the first match
		} catch {
			// A window that cannot be inspected simply does not match.
		}
		return true;
	}, native.koffi.pointer(native.EnumWindowsProc));
	try {
		native.EnumWindows(visit, 0);
	} catch {
		// Enumeration failing means no window is found.
	} finally {
		try {
			native.koffi.unregister(visit);
		} catch {}
	}
	return found;
}

/**
 * Restore and focus the Desktop window from inside this process.
 *
 * @returns whether the window actually ended up in the foreground.
 */
function raiseDesktopWindowNative() {
	const native = loadNativeRaise();
	if (native === undefined) return false;
	const handle = findDesktopWindow(native);
	if (handle === undefined) return false;
	// Restore first: `ShowWindow(SW_RESTORE)` is not a foreground request, so it
	// is granted even to a background process. Its return value is the window's
	// PREVIOUS visibility, not a success flag, so it is deliberately ignored.
	native.ShowWindow(handle, SW_RESTORE);
	native.BringWindowToTop(handle);
	// The foreground request is the part Windows polices: a background process
	// may only take the foreground under some conditions, so on its own this is
	// not reliable. When it is refused, the window is lifted in Z-order but
	// stays unfocused, which the user reads as "nothing happened".
	//
	// Two documented ways to satisfy the lock are applied first. The ALT tap
	// makes Windows treat this as user activity (ALT is not delivered to any
	// window), and the thread attach makes the request appear to come from a
	// thread already connected to the active window. Together they cover the
	// case where the foreground grant the click carried has already lapsed.
	//
	// `AllowSetForegroundWindow` is not among them: the documentation grants
	// the right to ANOTHER process, so calling it before our own request buys
	// nothing — measured, it returned false every time while the request that
	// followed still succeeded. It stays bound only for the retry below.
	//
	// The attach/detach pair is guarded so a throw from the calls between them
	// cannot leave this thread attached to the other window's input queue.
	native.keybd_event(VK_MENU, 0, 0, 0); // ALT down
	native.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0); // ALT up
	const activate = () => {
		const foreground = native.GetForegroundWindow();
		const foregroundThread = foreground === null ? 0 : native.GetWindowThreadProcessId(foreground, null);
		const ownThread = native.GetCurrentThreadId();
		let attached = false;
		try {
			attached = foregroundThread !== 0 && foregroundThread !== ownThread
				&& native.AttachThreadInput(foregroundThread, ownThread, true);
			native.SetForegroundWindow(handle);
			native.BringWindowToTop(handle);
		} finally {
			if (attached) native.AttachThreadInput(foregroundThread, ownThread, false);
		}
	};
	activate();
	if (native.GetForegroundWindow() === handle) return true;
	// Refused. Ask the system for the right and try once more before giving up;
	// the caller falls back to the deep link if this still does not take.
	native.AllowSetForegroundWindow(-1);
	activate();
	return native.GetForegroundWindow() === handle;
}

/**
 * Raise the Desktop window through the app's own deep link.
 *
 * Last resort, for a build that does not ship the FFI binding. The deep link
 * goes through Windows, and the second instance's foreground request can be
 * refused when the launch comes from a background process — which is why it is
 * the fallback and not the primary path.
 */
function raiseDesktopWindowDeepLink() {
	// `start ""` — the empty quoted title keeps `start` from treating the URL as
	// a window title.
	//
	// `spawn`, NOT `spawnSync`: this is the last resort, and blocking the Host's
	// event loop for up to a timeout would stall every other HTTP request —
	// including streamed output — while the user waits on a click. `detached`
	// is deliberately NOT set either: measured earlier, a detached child here
	// exits 0 without the launch taking effect. The child exits on its own once
	// `cmd /c start` has handed the URL to Windows, and holding the reference
	// keeps it alive until then.
	launcher("cmd.exe", ["/d", "/s", "/c", "start", "", FOCUS_DEEP_LINK]);
}

/**
 * Start a short-lived launcher without blocking, reporting failures once.
 *
 * The exit code matters as much as the spawn: `open` exits non-zero when no
 * application handles the request (macOS: "Unable to find application for
 * URL"), and a launch that never happened must not look exactly like one
 * that did.
 *
 * @param command - the executable to run.
 * @param args - its arguments.
 * @param done - called with whether the launcher exited cleanly; optional,
 *   so a caller can chain a fallback.
 */
function launcher(command, args, done) {
	try {
		const child = spawn(command, args, { windowsHide: true, stdio: "ignore" });
		child.on("error", (error) => {
			warn(`could not launch ${command}: ${error?.message ?? error}`);
			done?.(false);
		});
		child.on("exit", (code) => {
			const ok = code === 0;
			if (!ok) warn(`${command} exited ${code}: ${args.join(" ")}`);
			done?.(ok);
		});
		child.unref();
	} catch (error) {
		warn(`could not launch ${command}: ${error?.message ?? error}`);
		done?.(false);
	}
}

/**
 * One line in the Host log per focus click.
 *
 * Unlike `warn`, deliberately NOT deduplicated: when a click reports "nothing
 * happened", the first question is whether the click ever reached this process
 * at all, and one line per attempt is what answers it — `focus click` says the
 * request arrived, `window raised` / `fell back` says what the raise did with
 * it.
 *
 * @param message - what happened.
 */
function log(message) {
	try {
		// eslint-disable-next-line no-console -- the Host has no logger on this context
		console.log(`notify-sounds: ${message}`);
	} catch {
		// Reporting must never become the failure.
	}
}

/**
 * Report a degraded path once, without failing the click.
 *
 * The raise has several ways to fall back silently, and a user's only symptom
 * is "clicking did nothing" — which cannot be diagnosed from the UI. One line
 * per distinct problem is enough to explain it from the Host log.
 *
 * @param message - what went wrong.
 */
function warn(message) {
	try {
		if (warned.has(message)) return;
		warned.add(message);
		// eslint-disable-next-line no-console -- the Host has no logger on this context
		console.warn(`notify-sounds: ${message}`);
	} catch {
		// Reporting must never become the failure.
	}
}

/** Messages already reported, so a repeated click does not repeat the warning. */
const warned = new Set();

//#endregion

/**
 * Raise the Desktop's primary window.
 *
 * The renderer cannot do this itself: `window.focus()` only focuses the page
 * inside the window, and the sandboxed preload bridge exposes no window
 * control. On Windows this process raises the window itself over FFI, falling
 * back to the app's deep link. macOS and Linux use the platform opener.
 *
 * Every failure mode leaves the click a harmless no-op.
 */
function focusDesktopWindow() {
	try {
		if (process.platform === "win32") {
			let raised = false;
			try {
				raised = raiseDesktopWindowNative();
			} catch (error) {
				warn(`native raise failed: ${error?.message ?? error}`);
			}
			if (raised) {
				log("window raised");
			} else {
				log("native raise did not take the foreground; falling back to the deep link");
				raiseDesktopWindowDeepLink();
			}
		} else if (process.platform === "darwin") {
			// Activate the app by bundle id first: it needs no URL scheme to
			// have been registered, which a packaged .app only gets if its
			// Info.plist declares CFBundleURLTypes — something this project
			// cannot verify from source. The deep link stays as the fallback,
			// and a launch that failed is now named in the log instead of
			// looking exactly like one that succeeded.
			log("raising via open -b");
			launcher("open", ["-b", MACOS_BUNDLE_ID], (ok) => {
				if (ok) return;
				log("bundle-id activation did not take; falling back to the deep link");
				launcher("open", [FOCUS_DEEP_LINK]);
			});
		} else {
			// No desktop shell ships for other platforms today — the shell
			// itself refuses anything but win32/darwin, and a browser click
			// never reaches this function. `xdg-open` is the correct opener
			// should a Linux shell ever appear; until then this line is
			// unreachable rather than misleading.
			log("raising via xdg-open + deep link");
			launcher("xdg-open", [FOCUS_DEEP_LINK]);
		}
	} catch (error) {
		warn(`focus failed: ${error?.message ?? error}`);
	}
}

//#region update check

/** Route the browser half reads the update check through. */
export const UPDATE_CHECK_PATH = "/notify-sounds/update/check";

/** The npm package this plugin publishes as — the only name the check ever asks for. */
const UPDATE_PACKAGE = "dsh-plugin-notify-sounds";

/**
 * Registries the update check consults, in order.
 *
 * HTTPS and hardcoded on purpose: this is the one place the plugin asks the
 * outside world for something it may later act on, so nothing about it is
 * configurable. The second entry is the mainland-China mirror, matching the
 * install source DSH itself offers.
 */
const UPDATE_REGISTRIES = ["https://registry.npmjs.org", "https://registry.npmmirror.com"];

/**
 * Hosts a tarball may live on: the registries above, plus the one legitimate
 * hop between them.
 *
 * The mainland mirror answers its metadata on its own host but serves the
 * tarball from its CDN, so a download that refuses every redirect could never
 * finish when the mirror answered (measured). The CDN is therefore trusted
 * for tarballs only, and redirects are still followed one hop at a time with
 * every hop checked against this list.
 */
const UPDATE_TARBALL_HOSTS = [...UPDATE_REGISTRIES, "https://cdn.npmmirror.com"];

/** How many redirects a download may follow before giving up. */
const UPDATE_MAX_REDIRECTS = 4;

/** How long one check result is trusted before the next check may run. */
const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;

/** Minimum spacing between real requests, so a held-down button cannot hammer a registry. */
const UPDATE_CHECK_SPACING_MS = 15 * 1000;

/** Bounds on the single request a check makes. */
const UPDATE_FETCH_TIMEOUT_MS = 10 * 1000;
const UPDATE_MAX_RESPONSE_BYTES = 256 * 1024;

/** Result of the last check, when the last real request went out, and the last successful install. */
const updateCheck = { checkedAt: 0, requestedAt: 0, result: undefined, applied: undefined };

/** The check currently in flight, if any — callers join it instead of starting a second one. */
let checkInFlight;

/** The update currently in flight, if any — one download and one swap at a time. */
let applyInFlight;

/**
 * Parse `major.minor.patch` with an optional prerelease tag.
 *
 * @returns the parts, or undefined when the text is not a version.
 */
export function parseVersion(text) {
	if (typeof text !== "string") return undefined;
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(text);
	if (match === null) return undefined;
	return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ""];
}

/**
 * Compare two versions the way an npm `latest` tag is meant to be compared.
 *
 * @returns negative when `a` sorts before `b`, 0 when they are the same
 *   release, positive when `a` sorts after; `NaN` when either is not a version.
 */
export function compareVersions(a, b) {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (left === undefined || right === undefined) return NaN;
	for (let i = 0; i < 3; i++) {
		if (left[i] !== right[i]) return left[i] - right[i];
	}
	return comparePrerelease(left[3], right[3]);
}

/**
 * Compare two prerelease fields the way semver defines it, not as strings.
 *
 * Plain string order gets the common case wrong: `rc.10` sorts BEFORE `rc.9`
 * ("1" < "9"), so a registry whose `latest` points at a later release candidate
 * would look older than the one already installed and the update would never be
 * offered. The rules are: identifiers are compared field by field; a numeric
 * field compares numerically and ranks below an alphanumeric one; an
 * alphanumeric field compares in ASCII order; and when every shared field is
 * equal, the one with MORE fields wins (`1.0.0-rc.1` < `1.0.0-rc.1.1`).
 *
 * @param left - the prerelease field of the first version, "" for a release.
 * @param right - the prerelease field of the second version.
 * @returns negative, 0, or positive.
 */
function comparePrerelease(left, right) {
	if (left === right) return 0;
	// A release outranks any of its own prereleases (1.5.0 > 1.5.0-rc.1).
	if (left === "") return 1;
	if (right === "") return -1;
	const a = left.split(".");
	const b = right.split(".");
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i];
		const y = b[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		const numericX = /^\d+$/.test(x);
		const numericY = /^\d+$/.test(y);
		if (numericX && numericY) {
			const dx = Number(x);
			const dy = Number(y);
			if (dx !== dy) return dx < dy ? -1 : 1;
			continue;
		}
		// A numeric identifier always ranks below an alphanumeric one.
		if (numericX !== numericY) return numericX ? -1 : 1;
		if (x !== y) return x < y ? -1 : 1;
	}
	return 0;
}

/**
 * The version this installation ships, read from the package's own manifest.
 *
 * @returns the version, or undefined when the manifest is unreadable.
 */
function readOwnVersion(root) {
	try {
		const manifest = root === undefined
			? new URL("../package.json", import.meta.url)
			: join(root, "package.json");
		const parsed = JSON.parse(readFileSync(manifest, "utf8"));
		return typeof parsed.version === "string" ? parsed.version : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Whether a tarball URL is somewhere this plugin is willing to download from.
 *
 * The URL arrives inside a registry response, so it is untrusted input: https
 * only, and the host must be one of `UPDATE_TARBALL_HOSTS`. A registry pointing
 * anywhere else is refused rather than followed. The download stage re-checks
 * every redirect against this same list, so a hostile answer — or a hostile
 * redirect — is rejected at the door instead of at the moment it is about to
 * be used.
 */
export function isTrustedTarball(url) {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" && UPDATE_TARBALL_HOSTS.some((host) => parsed.origin === host);
	} catch {
		return false;
	}
}

/**
 * Read a response body under a hard size cap.
 *
 * The check asks for one small JSON document; anything longer is either not
 * that document or is trying to be more than one, and neither is worth
 * buffering. Chunks are counted as they arrive and the read is abandoned at
 * the cap.
 */
async function readCappedBytes(response, cap) {
	const declared = Number(response.headers.get("content-length") ?? 0);
	if (Number.isFinite(declared) && declared > cap) throw new Error("response too large");
	const reader = response.body?.getReader?.();
	if (reader === undefined) throw new Error("response has no body");
	const chunks = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > cap) {
			try {
				await reader.cancel();
			} catch {}
			throw new Error("response too large");
		}
		chunks.push(value);
	}
	const merged = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return merged;
}

/**
 * Ask the registries for the newest published version of this plugin.
 *
 * Every failure mode — offline, refused, oversized, malformed, a tarball URL
 * pointing somewhere else — becomes a result the UI can show, never a throw.
 * This stage only reads: nothing is written to disk and nothing is executed.
 *
 * @param options - `force` asks again inside the freshness window (the
 *   button); otherwise a recent result is returned as-is.
 * @returns `{ ok, current, latest, updateAvailable, checkedAt }`, or
 *   `{ ok: false, current, error }` when no registry answered.
 */
/**
 * How the running package relates to what the profile's package manager
 * recorded for it.
 *
 * This plugin no longer installs its own releases (as of 1.8.0): a release
 * reaches a profile through the package manager, which also owns the
 * lockfile. A tree that arrived by any other route looks identical on disk
 * while the lockfile still pins an older version — and the next
 * `pnpm install` in that profile silently restores the old one. Reading the
 * version the lockfile would restore lets the Settings row say so instead of
 * leaving the user to discover it after the next plugin operation.
 *
 * Every part is optional: no profile directory, no lockfile or an unreadable
 * one simply reports nothing, and the row keeps its normal wording.
 *
 * @param current - the version actually on disk.
 * @returns the fields the check payload mirrors to the row.
 */
function installationProvenance(current) {
	try {
		const profileDir = process.env.DSH_PROFILE_DIR;
		if (profileDir === undefined) return {};
		const lock = readFileSync(join(profileDir, "pnpm-lock.yaml"), "utf8");
		const recorded = new RegExp(`${UPDATE_PACKAGE}@([0-9][^:\\s"']*)`).exec(lock)?.[1];
		return {
			recorded,
			unregistered: current !== undefined && recorded !== undefined && recorded !== current,
			profile: process.env.DSH_PROFILE,
		};
	} catch {
		return {};
	}
}
export { installationProvenance };

export async function checkForUpdate(options = {}) {
	const now = Date.now();
	if (options.force !== true && updateCheck.result !== undefined && now - updateCheck.checkedAt < UPDATE_CHECK_TTL_MS) {
		return updateCheck.result;
	}
	// Spacing applies to real requests of every kind: a forced check may
	// refresh, it may not become a load generator.
	if (now - updateCheck.requestedAt < UPDATE_CHECK_SPACING_MS && updateCheck.result !== undefined) {
		return updateCheck.result;
	}
	// Two callers arriving together — the settings row and the notice above
	// it, or an automatic check landing on a user's click — must not become
	// two requests. The spacing rule above cannot cover that: it only sees a
	// finished result, and while the first request is still in the air there
	// is none. So a second caller joins the first instead.
	if (checkInFlight !== undefined) return checkInFlight;
	updateCheck.requestedAt = now;
	checkInFlight = (async () => {
		const current = readOwnVersion(options.root);
		const answer = await fetchRegistryAnswer();
		if (answer === undefined) {
			const result = { ok: false, current, error: "no registry answered", applied: updateCheck.applied, ...installationProvenance(current) };
			updateCheck.checkedAt = now;
			updateCheck.result = result;
			return result;
		}
		const ordering = current === undefined ? NaN : compareVersions(current, answer.version);
		const result = {
			ok: true,
			current,
			latest: answer.version,
			updateAvailable: Number.isFinite(ordering) && ordering < 0,
			checkedAt: now,
			applied: updateCheck.applied,
			...installationProvenance(current),
		};
		updateCheck.checkedAt = now;
		updateCheck.result = result;
		return result;
	})();
	try {
		return await checkInFlight;
	} finally {
		checkInFlight = undefined;
	}
}

/**
 * Ask the registries for this plugin's newest release and believe only a
 * well-formed answer.
 *
 * The response is untrusted input: the version must parse, the integrity must
 * be a sha512 digest, and the tarball must live on one of the two registries.
 * Anything else is skipped, so a hostile or broken answer is never the one a
 * later download acts on. Both the check and the download go through here —
 * the download never takes a URL from anywhere else.
 *
 * @returns `{ registry, version, tarball, integrity }`, or undefined when no
 *   registry produced an answer worth believing.
 */
async function fetchRegistryAnswer() {
	for (const registry of UPDATE_REGISTRIES) {
		try {
			log(`update check: asking ${registry}`);
			const response = await fetch(`${registry}/${UPDATE_PACKAGE}/latest`, {
				signal: AbortSignal.timeout(UPDATE_FETCH_TIMEOUT_MS),
				redirect: "error",
				headers: { accept: "application/json" },
			});
			if (!response.ok) continue;
			const payload = JSON.parse(new TextDecoder().decode(await readCappedBytes(response, UPDATE_MAX_RESPONSE_BYTES)));
			const version = payload?.version;
			if (typeof version !== "string" || parseVersion(version) === undefined) continue;
			const integrity = payload?.dist?.integrity;
			const tarball = payload?.dist?.tarball;
			if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) continue;
			if (typeof tarball !== "string" || !isTrustedTarball(tarball)) continue;
			return { registry, version, tarball, integrity };
		} catch {
			// One registry failing is the ordinary case for the next one to
			// answer; running out of registries is the failure worth reporting.
		}
	}
	return undefined;
}

//#endregion

//#region update apply — UNREACHABLE since 1.8.0: no route calls it any more.
// The Settings row sends the user to the plugin manager / package manager
// instead, so this plugin never writes its own files. The code below stays
// only until its tests retire with a later release; nothing in apply() can
// reach it.

/** Route the browser half asks for an update to be applied through. */
export const UPDATE_APPLY_PATH = "/notify-sounds/update/apply";

/** Largest update tarball accepted: this plugin is small, and anything larger is not one. */
const UPDATE_MAX_TARBALL_BYTES = 8 * 1024 * 1024;

/**
 * Largest expansion accepted after gunzip.
 *
 * The download cap alone does not bound memory: a few-hundred-KB gzip stream
 * can expand to gigabytes, and that allocation happens inside this process.
 * `gunzipSync` is given this as `maxOutputLength` so the limit is enforced
 * while inflating rather than after.
 */
const UPDATE_MAX_UNPACKED_BYTES = UPDATE_MAX_TARBALL_BYTES * 8;

/** Most files one release of this package may carry. It is a handful of text files. */
const UPDATE_MAX_FILES = 256;

/**
 * Path segments an update may never contain, however an archive spells them.
 *
 * `.update-backup` is this updater's own working directory: an archive that
 * carried a file with that name could leave the previous version's bytes
 * exactly where a rollback looks for them. `node_modules` and `.git` are never
 * published in a tarball, so an archive containing them describes a different
 * tree than the one this installation came from.
 */
const UPDATE_RESERVED_SEGMENTS = new Set(["node_modules", ".git", ".update-backup"]);

/**
 * Records which files this updater installed, so the next update can prune.
 *
 * It lives in the installed package directory and is written by the updater at
 * runtime — it is NEVER part of the published tarball, which is why adding it
 * cannot break an older installation's update (those check the archive's file
 * names, not what the directory happens to contain).
 */
const UPDATE_MANIFEST = ".update-manifest.json";

/** Package-root names a package manager reads as configuration, and the updater's own bookkeeping; never delivered by an update. */
const UPDATE_RESERVED_ROOT_FILES = new Set([".npmrc", ".pnpmfile.cjs", UPDATE_MANIFEST]);

/** Where this package is installed: the only tree an update may write to. */
function packageRoot() {
	return fileURLToPath(new URL("..", import.meta.url));
}

/** Read a NUL-terminated string field from a tar header. */
function readTarString(header, offset, length) {
	const field = header.subarray(offset, offset + length);
	let end = field.indexOf(0);
	if (end === -1) end = field.length;
	return new TextDecoder().decode(field.subarray(0, end)).trim();
}

/** Read an octal size field from a tar header; NaN when it is not one. */
function readTarOctal(header, offset, length) {
	const text = readTarString(header, offset, length);
	if (text === "") return 0;
	const value = parseInt(text, 8);
	return Number.isFinite(value) ? value : NaN;
}

/**
 * Map an archive path to the package-relative file it may write.
 *
 * Everything about a tar path is hostile until shown otherwise: only the
 * `package/` prefix the registry publishes under, never a path that climbs,
 * escapes, or arrives by another separator, never a reserved name, and never
 * one that an NTFS alternate data stream could hide behind.
 *
 * What is deliberately NOT checked is the file's NAME. An exact list of seven
 * names was the previous design and it was a trap: the updater that runs during
 * an update is the one already installed, so its list decides what the NEXT
 * release may contain. A release that added a file became uninstallable by
 * every older installation — permanently, and with no way to fix it after the
 * fact, because the old code is already on those machines. The rules below are
 * the ones that never need to change (path safety, not a file inventory), so
 * they can remain the whole gate while the file set moves forward.
 */
export function archivePathToRelative(path) {
	const normalized = path.replaceAll("\\", "/");
	const segments = normalized.split("/");
	if (normalized.startsWith("/") || segments.includes("..")) throw new Error(`refusing tar path: ${path}`);
	const prefix = "package/";
	if (!normalized.startsWith(prefix)) throw new Error(`refusing tar path: ${path}`);
	const relative = normalized.slice(prefix.length);
	if (relative === "" || relative.endsWith("/")) throw new Error(`refusing tar path: ${path}`);
	for (const segment of relative.split("/")) {
		// A `.` segment would let one file be named twice in one archive, and it
		// slips past the case check below, which compares names rather than
		// resolved paths.
		if (segment === "" || segment === "." || segment.includes(":")) throw new Error(`refusing tar path: ${path}`);
		if (UPDATE_RESERVED_SEGMENTS.has(segment) || segment.endsWith(".update-tmp")) throw new Error(`refusing tar path: ${path}`);
	}
	if (UPDATE_RESERVED_ROOT_FILES.has(relative)) throw new Error(`refusing tar path: ${path}`);
	return relative;
}

/**
 * Read a tar archive into the files an update may write.
 *
 * The archive arrived from the network and is treated accordingly:
 *
 *   - regular files only — a symlink in an update could point the next write
 *     anywhere, so any other entry type is refused outright;
 *   - pax/gnu extension headers are skipped, not interpreted;
 *   - every name must survive `archivePathToRelative`, so nothing outside
 *     this package is ever named and nothing reserved is ever written;
 *   - two entries may not differ only in case: on Windows and macOS the second
 *     would silently overwrite the first;
 *   - a header claiming more than the archive holds is an error, not a read;
 *   - the total size and the file count are capped, so an archive cannot turn
 *     a bounded download into unbounded disk usage.
 *
 * @returns a Map of package-relative path → contents.
 */
export function unpackTar(bytes) {
	const files = new Map();
	const seen = new Map();
	let total = 0;
	let offset = 0;
	while (offset + 512 <= bytes.length) {
		const header = bytes.subarray(offset, offset + 512);
		const name = readTarString(header, 0, 100);
		if (name === "") break;
		const size = readTarOctal(header, 124, 12);
		if (!Number.isFinite(size) || size < 0) throw new Error("tar entry has no readable size");
		const contentStart = offset + 512;
		if (contentStart + size > bytes.length) throw new Error("tar entry claims more than the archive holds");
		const typeflag = readTarString(header, 156, 1);
		const prefix = readTarString(header, 345, 155);
		const content = bytes.slice(contentStart, contentStart + size);
		offset = contentStart + Math.ceil(size / 512) * 512;
		if (typeflag === "x" || typeflag === "g" || typeflag === "L") continue;
		if (typeflag !== "0" && typeflag !== "") throw new Error(`refusing non-file tar entry (${typeflag})`);
		const relative = archivePathToRelative(prefix === "" ? name : `${prefix}/${name}`);
		const folded = relative.toLowerCase();
		const collidesWith = seen.get(folded);
		if (collidesWith !== undefined && collidesWith !== relative) {
			throw new Error(`refusing two entries that differ only in case: ${collidesWith} / ${relative}`);
		}
		seen.set(folded, relative);
		total += content.length;
		if (total > UPDATE_MAX_UNPACKED_BYTES) throw new Error("the archive expands beyond its limit");
		if (files.size >= UPDATE_MAX_FILES) throw new Error("the archive carries more files than this package can have");
		files.set(relative, content);
	}
	if (files.size === 0) throw new Error("the archive carried no usable files");
	return files;
}

/**
 * Check that the archive really is this package, at the version the registry named.
 *
 * With the file inventory gone, this is what still ties the bytes to an
 * identity. The registry answer was validated before anything was downloaded,
 * and the digest binds the bytes to that answer's `dist` — but the archive's
 * own manifest is the only thing that says WHICH package and version those
 * bytes are, and the next check trusts the manifest this update leaves on
 * disk. A manifest that is missing, unreadable, or about something else would
 * otherwise be installed silently and make "an update landed" a lie the check
 * cannot see through.
 *
 * @param files - the unpacked archive, package-relative path → contents.
 * @param version - the version the registry announced.
 * @returns the parsed manifest.
 */
export function verifyManifest(files, version) {
	const manifest = files.get("package.json");
	if (manifest === undefined) throw new Error("the archive carries no package.json");
	let parsed;
	try {
		parsed = JSON.parse(new TextDecoder().decode(manifest));
	} catch {
		throw new Error("the archive's package.json is not readable JSON");
	}
	if (parsed?.name !== UPDATE_PACKAGE) throw new Error(`the archive is not ${UPDATE_PACKAGE}`);
	if (parsed?.version !== version) {
		throw new Error(`the archive says version ${String(parsed?.version)} where the registry said ${version}`);
	}
	// A file whose name differs from a path this manifest declares only by case
	// would replace that file on Windows and macOS and be a dead file on Linux:
	// one archive, two different installations. The set is derived from the
	// archive's OWN manifest (`package.json` itself, `main`, and every `exports`
	// target) — never from a list held here — so a release stays free to move
	// or rename its own files, which is the whole point of this design.
	const declared = new Map([["package.json", "package.json"]]);
	const declare = (value) => {
		if (typeof value !== "string" || value === "") return;
		const relative = value.startsWith("./") ? value.slice(2) : value;
		declared.set(relative.toLowerCase(), relative);
	};
	const declareAll = (value) => {
		if (typeof value === "string") declare(value);
		else if (Array.isArray(value)) value.forEach(declareAll);
		else if (value !== null && typeof value === "object") Object.values(value).forEach(declareAll);
	};
	declare(parsed.main);
	declareAll(parsed.exports);
	for (const relative of files.keys()) {
		const target = declared.get(relative.toLowerCase());
		if (target !== undefined && target !== relative) {
			throw new Error(`refusing a file that differs only in case from ${target}: ${relative}`);
		}
	}
	return parsed;
}

/**
 * Check downloaded bytes against the digest the registry published.
 *
 * A mismatch is the one failure that must stop everything: whatever arrived is
 * not the package the registry described, and not one byte of it is written.
 */
export function verifyIntegrity(bytes, integrity) {
	const expected = Buffer.from(String(integrity).slice("sha512-".length), "base64");
	const actual = createHash("sha512").update(bytes).digest();
	if (expected.length === 0 || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
		throw new Error("the tarball failed its sha512 check");
	}
}

/**
 * Download the tarball a validated registry answer named.
 *
 * Redirects are followed by hand rather than by the fetch layer: every hop's
 * URL must itself be on `UPDATE_TARBALL_HOSTS`, so a redirect can never walk
 * off the list — the mirror's CDN hop is the one legitimate case, and anything
 * else is refused by name. The response is capped and time-limited like every
 * other request; the sha512 check afterwards is what actually vouches for the
 * bytes, whatever host they came from.
 *
 * @returns the tarball bytes.
 */
async function downloadTarball(url) {
	let current = url;
	for (let hop = 0; hop <= UPDATE_MAX_REDIRECTS; hop++) {
		if (!isTrustedTarball(current)) throw new Error(`download refused: ${current}`);
		log(`update: downloading ${current}`);
		let response;
		try {
			response = await fetch(current, {
				signal: AbortSignal.timeout(60 * 1000),
				redirect: "manual",
				headers: { accept: "application/octet-stream" },
			});
		} catch (error) {
			throw new Error(`download failed: ${error?.message ?? error}`);
		}
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location");
			if (typeof location !== "string" || location === "") {
				throw new Error(`download failed: HTTP ${response.status} without a redirect target`);
			}
			current = new URL(location, current).toString();
			continue;
		}
		if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
		return readCappedBytes(response, UPDATE_MAX_TARBALL_BYTES);
	}
	throw new Error(`download refused: more than ${UPDATE_MAX_REDIRECTS} redirects`);
}

/**
 * The file list a previous update recorded, as a Set.
 *
 * A missing, unreadable, or malformed manifest reads as "nothing recorded",
 * which prunes nothing: the failure mode of a damaged manifest has to be
 * "leaves a file behind", never "deletes something".
 *
 * @param root - the package directory.
 * @returns the recorded package-relative paths.
 */
function readUpdateManifest(root) {
	try {
		const parsed = JSON.parse(readFileSync(join(root, UPDATE_MANIFEST), "utf8"));
		if (!Array.isArray(parsed?.files)) return new Set();
		return new Set(parsed.files.filter((name) => typeof name === "string"));
	} catch {
		return new Set();
	}
}

/**
 * Which recorded files this release no longer carries.
 *
 * Only paths the PREVIOUS update wrote are candidates, so a file the user put
 * in the package directory themselves is never named here and never removed.
 * This is what makes an update add and remove files while the file-list rule
 * stays out of the way — the alternative, shipping deletions inside the
 * archive, is not something a tar can express.
 *
 * @param previous - paths recorded by the last update.
 * @param files - the incoming archive's package-relative paths.
 * @returns the paths to delete, sorted.
 */
export function filesToPrune(previous, files) {
	const gone = [];
	for (const relative of previous) {
		if (relative === UPDATE_MANIFEST) continue;
		if (!files.has(relative)) gone.push(relative);
	}
	return gone.sort();
}

/**
 * Swap the package's files for the update's, keeping the previous ones.
 *
 * Each file is written to a temporary name and renamed into place, so a
 * failure cannot leave a half-written file under a real name. Everything the
 * update is about to replace is copied aside first, and any failure puts it
 * all back: a failed update is not a half-updated plugin.
 *
 * The files are whatever the archive carried, not a list held here. An earlier
 * design iterated a fixed set of seven names, which meant a release could only
 * ever touch those seven; that list is gone on purpose (see
 * `archivePathToRelative`), and this function is the second half of the same
 * decision — unpacking a new file and then never writing it would look exactly
 * like a successful update that quietly did nothing.
 */
export function installUpdate(root, files) {
	const rootPrefix = resolve(root);
	const backup = join(root, ".update-backup");
	const tempName = (relative) => `${resolve(root, relative)}.update-tmp`;
	rmSync(backup, { recursive: true, force: true });
	// The manifest goes last, and that order is load-bearing. If this process
	// dies mid-swap — a power cut or a kill, not a thrown error, which rolls
	// back — the installation is left with the OLD version number over part of
	// the new code, so the next check still reports an update and the user can
	// retry. The opposite order would leave a NEW version number over the old
	// code: the check would call that "up to date" and there would be nothing
	// left to prompt anyone with.
	const relatives = [...files.keys()].sort((a, b) => (a === "package.json" ? 1 : 0) - (b === "package.json" ? 1 : 0));
	/** Directories this update creates, outermost first, so a rollback can take them back. */
	const created = [];
	const written = [];
	/** Files this update deletes, kept aside first so a rollback can bring them back. */
	const pruned = [];
	/** The previous update's record, read before anything is written over it. */
	const previous = readUpdateManifest(root);
	const manifestPath = join(root, UPDATE_MANIFEST);
	/** Copy the current bytes aside before they are replaced or removed. */
	const backUp = (relative, target) => {
		const aside = join(backup, relative);
		mkdirSync(dirname(aside), { recursive: true });
		writeFileSync(aside, readFileSync(target));
	};
	try {
		for (const relative of relatives) {
			const source = files.get(relative);
			if (source === undefined) continue;
			const target = resolve(root, relative);
			if (target !== rootPrefix && !target.startsWith(rootPrefix)) throw new Error(`refusing to write outside the package: ${relative}`);
			let parent = rootPrefix;
			for (const segment of relative.split("/").slice(0, -1)) {
				parent = join(parent, segment);
				if (!existsSync(parent)) created.push(parent);
			}
			mkdirSync(dirname(target), { recursive: true });
			if (existsSync(target)) backUp(relative, target);
			const temp = tempName(relative);
			writeFileSync(temp, source);
			renameSync(temp, target);
			written.push(relative);
		}
		// A release can also DROP a file, and an archive cannot say so: it is a
		// list of what exists, not of what should be deleted. The previous
		// update's record is what makes the difference computable, and it is
		// deliberately limited to files an update wrote — anything else in this
		// directory (a user's own notes, a tool's leftovers) is never named in
		// the record and therefore never deleted.
		for (const relative of filesToPrune(previous, files)) {
			const target = resolve(root, relative);
			if (target !== rootPrefix && !target.startsWith(rootPrefix)) continue;
			// Files only. A path that is now a directory is left alone rather
			// than failing the whole update, and never removed recursively.
			try {
				if (!statSync(target).isFile()) continue;
			} catch {
				continue;
			}
			backUp(relative, target);
			rmSync(target, { force: true });
			pruned.push(relative);
		}
		// The record is written LAST, through the same temporary-name swap as
		// everything else, and it describes the state this update leaves behind:
		// the incoming files plus itself, minus nothing.
		if (existsSync(manifestPath)) backUp(UPDATE_MANIFEST, manifestPath);
		const record = new TextEncoder().encode(JSON.stringify({ version: 1, files: [...files.keys(), UPDATE_MANIFEST].sort() }));
		writeFileSync(`${manifestPath}.update-tmp`, record);
		renameSync(`${manifestPath}.update-tmp`, manifestPath);
		written.push(UPDATE_MANIFEST);
	} catch (error) {
		// Put everything back — including files the update ADDED, which have
		// no backup to restore from and must simply go away again, the files it
		// DELETED, which come back from their copies, and the directories it
		// created. A failed update has to leave nothing behind: no half-replaced
		// file, no leftover temp, no file that was not there before, and no
		// empty directory either.
		for (const relative of written) {
			const aside = join(backup, relative);
			const target = resolve(root, relative);
			if (existsSync(aside)) writeFileSync(target, readFileSync(aside));
			else rmSync(target, { force: true });
		}
		for (const relative of pruned) {
			const aside = join(backup, relative);
			if (existsSync(aside)) writeFileSync(resolve(root, relative), readFileSync(aside));
		}
		for (const relative of relatives) rmSync(tempName(relative), { force: true });
		// Guarded: a cleanup step must never replace the failure it is cleaning
		// up after (this path can hold a directory, and `rmSync` refuses one
		// without `recursive`).
		try {
			rmSync(`${manifestPath}.update-tmp`, { force: true });
		} catch {}
		// Deepest first, so a chain collapses one level at a time. `rmdirSync`
		// refuses a directory that still holds something, which is the point:
		// a failure here must never delete real content. (Not `rmSync` — that
		// one needs `recursive` even for an empty directory on Windows and
		// throws EISDIR, which would have left every created directory behind.)
		for (const directory of created.reverse()) {
			try {
				rmdirSync(directory);
			} catch {}
		}
		// The restore above is done, so the copies have no further use. If a
		// restore threw, this is never reached and the backup stays on disk —
		// which is the one case where keeping it is the safer outcome.
		try {
			rmSync(backup, { recursive: true, force: true });
		} catch {}
		throw error;
	}
	// The swap succeeded, so the backup has done its job. Leaving it would
	// park the previous version's files — a hundred-odd KB including the
	// client half — inside the profile until some later update clears it.
	rmSync(backup, { recursive: true, force: true });
}

/**
 * Replace this installation with the newest published version.
 *
 * The stages are deliberate, and each one is a gate for the next: ask a
 * registry (the answer is validated as strictly as for a check); download the
 * tarball from the URL that answer named and nowhere else; verify its sha512
 * against the digest the registry published — a mismatch stops here, before a
 * byte is written; unpack it in memory, accepting only regular files that stay
 * inside the package, and confirm its manifest is this package at the version
 * the registry announced; then back up what is there and swap the files,
 * restoring on failure.
 *
 * Nothing downloaded is ever executed here. The new code runs when DSH
 * restarts, which is the same trust model as the user updating by hand.
 *
 * @param options - `root` overrides the package directory (for tests).
 * @returns `{ ok: true, from, to, requiresRestart }`, `{ ok: true,
 *   upToDate: true, current }`, or `{ ok: false, stage, error }`.
 */
export async function applyUpdate(options = {}) {
	// One download and one swap at a time. Two callers — a second tab, or a
	// user clicking again because the first attempt looks stuck — would share
	// the fixed temp names and the single backup directory, and the slower
	// one's cleanup would pull the floor out from under the other.
	if (applyInFlight !== undefined) return applyInFlight;
	applyInFlight = runUpdate(options);
	try {
		return await applyInFlight;
	} finally {
		applyInFlight = undefined;
	}
}

/** `applyUpdate` without the single-flight guard. */
async function runUpdate(options = {}) {
	const root = options.root ?? packageRoot();
	const current = readOwnVersion(root);
	let stage = "check";
	/** The version the registry announced, once there is one, for the failure report. */
	let announced;
	try {
		const answer = await fetchRegistryAnswer();
		if (answer === undefined) return { ok: false, stage, error: "no registry answered" };
		const ordering = current === undefined ? NaN : compareVersions(current, answer.version);
		if (Number.isFinite(ordering) && ordering >= 0) return { ok: true, upToDate: true, current };
		announced = answer.version;
		stage = "download";
		const bytes = await downloadTarball(answer.tarball);
		stage = "verify";
		verifyIntegrity(bytes, answer.integrity);
		stage = "unpack";
		// A gzip stream can expand far beyond the bytes it arrived in, so the
		// decompressor is told where to stop instead of being trusted to be
		// reasonable; the tarball cap above bounds the input, not the output.
		const files = unpackTar(gunzipSync(bytes, { maxOutputLength: UPDATE_MAX_UNPACKED_BYTES }));
		stage = "manifest";
		verifyManifest(files, answer.version);
		stage = "replace";
		installUpdate(root, files);
		// The answer that said "update available" is now a lie about this
		// installation: drop the cached check so the next one re-reads the
		// manifest this install just wrote. The outcome is remembered too —
		// the very files that were just swapped include the client half, so
		// the page may reload and lose its own state, and the news that an
		// update landed must survive that. It is kept until DSH restarts,
		// which is exactly as long as "restart to load it" is true.
		updateCheck.checkedAt = 0;
		updateCheck.result = undefined;
		updateCheck.applied = { from: current, to: answer.version, at: Date.now() };
		log(`update applied: ${current ?? "?"} -> ${answer.version}`);
		return { ok: true, from: current, to: answer.version, requiresRestart: true };
	} catch (error) {
		warn(`update failed at ${stage}: ${error?.message ?? error}`);
		return { ok: false, stage, to: announced, error: error?.message ?? String(error) };
	}
}

//#endregion

/**
 * Live preferences projected to the browser. Every field is volatile: the
 * Settings document serves them, form edits reach them without restarting
 * this entry, and the Client mirrors them through `configForms`.
 */
export const Config = z.object({
	/** Master switch; `false` mutes every notification sound. */
	enabled: z.boolean().default(true).volatile(),
	/** Playback loudness in percent. */
	volume: z.number().step(1).min(0).max(100).default(60).volatile(),
	/** Preset played when a Session gains a pending approval or plan review. */
	decisionSound: z.union(SOUND_IDS).default("bell").volatile(),
	/** Preset played when a Session gains a pending question. */
	questionSound: z.union(SOUND_IDS).default("chime").volatile(),
	/** Preset played when a Session's agent finishes (running → idle). */
	completionSound: z.union(SOUND_IDS).default("ding").volatile(),
	/** Also alert about sessions the agent spawned (sub-agents); off = only the user's own conversations. */
	subagentAlerts: z.boolean().default(false).volatile(),
	/** Check npm for a new version on its own (at most one real check a day); off = only when the user asks. */
	updateAutoCheck: z.boolean().default(true).volatile(),
	/** Play only while the page is not visible (background tab or window). */
	onlyWhenHidden: z.boolean().default(false).volatile(),
	/** Uploaded audio for the `custom` preset, as base64; empty when none. */
	customSound: z.string().default("").volatile(),
	/** Original file name of the uploaded custom sound, for display. */
	customSoundName: z.string().default("").volatile(),
	/** Show an OS notification (when the page is hidden) in addition to the sound. */
	systemNotify: z.boolean().default(false).volatile(),
	/** Prefix the window title with a word (待处理 / 已完成) while the page is hidden. */
	titleFlash: z.boolean().default(false).volatile(),
	/** Re-ping unanswered decisions at a fixed interval, until one is handled or seen. */
	renotify: z.boolean().default(false).volatile(),
	/** Re-ping interval in minutes. */
	renotifyMinutes: z.number().step(1).min(1).max(60).default(5).volatile(),
	/** Suppress every sound and notification during a daily time range. */
	quietHours: z.boolean().default(false).volatile(),
	/** Quiet range start, "HH:MM" 24-hour. */
	quietStart: z.string().pattern(TIME_OF_DAY).default("22:00").volatile(),
	/** Quiet range end, "HH:MM" 24-hour. */
	quietEnd: z.string().pattern(TIME_OF_DAY).default("08:00").volatile(),
	/** In goal mode, stay silent on intermediate rounds and chime once when the goal ends. */
	goalFinalOnly: z.boolean().default(false).volatile(),
});

/**
 * Host plugin body. Registers the page policy and the focus route; the
 * sounds and the Settings section exist in the browser entry.
 *
 * @param ctx - the Host plugin context.
 */
export function apply(ctx) {
	// The Client half registers a dedicated `settings.section` page; this asks
	// the plugin inventory to hold off an auto-generated form for the same
	// namespace so the preference is editable from exactly one place. Note:
	// `autoGenerate` is not yet consumed by any shipped client (runtime README
	// confirms), so this is a forward-compatible declaration rather than an
	// effect that is already in force.
	ctx.inject(["settings"], (child) => {
		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
	});

	// The focus route: the browser half posts here when a system notification
	// is clicked. It carries the composition's connection fence — the same
	// Host/Origin checks plus login-token cookie the open-in-app routes rely
	// on — so only the authenticated GUI can trip it, and it answers before
	// raising so the click never waits.
	ctx.inject(["webServer", "connection"], (child) => {
		child.effect(() => child.webServer.register({
			kind: "exact",
			path: FOCUS_PATH,
			handler: async (req, res) => {
				const rejection = child.connection.requestRejection(req);
				if (rejection !== undefined) {
					res.statusCode = rejection;
					res.end();
					return;
				}
				if (req.method !== "POST") {
					res.statusCode = 405;
					res.setHeader("allow", "POST");
					res.end();
					return;
				}
				// Which client asked? The Desktop's renderer fetches from its
				// own `dsh-app://app/` origin, and the shell STRIPS Origin and
				// Sec-Fetch-Site before forwarding to this server (the shell's
				// `forwardWebRequest` in `lib/main.js`), so a Desktop click
				// arrives with neither header while a real browser always sends
				// at least one. Checking BOTH keeps this working if the shell
				// ever stops stripping only one of them: the day it strips
				// neither, a Desktop click would silently start looking like a
				// browser one and clicks would stop raising the window — with no
				// other symptom to explain it.
				//
				// The two need opposite things, so the choice is derived here
				// rather than configured: a browser click needs no help, since
				// activating the notification raises the browser window itself
				// and raising the Desktop window instead would be the wrong
				// window entirely.
				const headers = req.headers ?? {};
				const fromBrowser = headers.origin !== undefined || headers["sec-fetch-site"] !== undefined;
				res.statusCode = 204;
				res.end();
				log(`focus click (fromBrowser=${fromBrowser})`);
				if (!fromBrowser) {
					focusDesktopWindow();
				}
			},
		}), "notify-sounds: focus route");

		// The update check route: a fixed, read-only question about this
		// plugin's own npm package. Same fence as the focus route. It takes no
		// URL, package name or version from the caller — there is nothing here
		// to aim anywhere else.
		child.effect(() => child.webServer.register({
			kind: "exact",
			path: UPDATE_CHECK_PATH,
			handler: async (req, res) => {
				const rejection = child.connection.requestRejection(req);
				if (rejection !== undefined) {
					res.statusCode = rejection;
					res.end();
					return;
				}
				if (req.method !== "GET") {
					res.statusCode = 405;
					res.setHeader("allow", "GET");
					res.end();
					return;
				}
				try {
					const force = new URL(req.url ?? "/", "http://localhost").searchParams.get("force") === "1";
					const result = await checkForUpdate({ force });
					res.statusCode = 200;
					res.setHeader("content-type", "application/json");
					res.end(JSON.stringify(result));
				} catch (error) {
					warn(`update check failed: ${error?.message ?? error}`);
					res.statusCode = 502;
					res.end();
				}
			},
		}), "notify-sounds: update check route");

	});
}
