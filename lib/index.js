/**
 * Host half of `dsh-plugin-notify-sounds`.
 *
 * All behavior lives in the browser entry (`./client`): the sounds themselves
 * are Web Audio synthesis, and the triggers are the Client's own
 * `uiSession.sessionStatus` facts (pending interactions and running→idle
 * transitions). This Node half owns the five things the browser cannot:
 *
 *   - the volatile Config schema below is what the Host Settings document
 *     serves under the `notify-sounds` namespace, so the Settings section the
 *     Client registers reads and writes through `configForms` exactly like
 *     DSH's own preference rows (locale, developer tools, web search);
 *   - `apply` registers the `/notify-sounds/focus` route the browser posts to
 *     when a system notification is clicked — the renderer cannot raise the
 *     OS window, but this process can: on Windows it calls `user32.dll`
 *     through the Desktop's own FFI binding and finds the window by title;
 *   - `/notify-sounds/update/check` asks npm for this package's newest
 *     release. It only reads: since 1.8.0 installation belongs to the package
 *     manager, so the row reports and points, and never writes a file;
 *   - `/notify-sounds/goal` answers one session's goal phase from the Host's
 *     authoritative projection. The browser only carries sessions it has
 *     opened, and a goal-mode completion edge can belong to one it has not;
 *   - `/notify-sounds/sound` is the uploaded-sound store: the page reads a
 *     stored clip by content hash, posts a new one, or deletes a clip nothing
 *     references. It is the only place this plugin writes a file, and it only
 *     ever touches its own directory under the profile.
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
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Diagnostic name of this Host plugin. */
export const name = "notify-sounds";

/** Sound ids shared with the Client half's preset table (spelled, not imported: the browser bundle is self-contained). Exported so the tests can cross-check the two spellings. */
export const SOUND_IDS = ["bell", "chime", "ding", "drop", "pulse", "arc", "coin", "success", "knock", "custom1", "custom2", "custom3", "custom", "none"];

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
/** `ShowWindow` command: show a window without asking for the foreground. */
const SW_SHOW = 5;

/** Virtual key and flag for the ALT tap that satisfies the foreground lock. */
const VK_MENU = 0x12;

/** The shell owns the window: this Host is its child process. */
const SHELL_PID = process.ppid;
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
			GetForegroundWindow: user32.func("void * __stdcall GetForegroundWindow()"),
			// Bound once, with the out-parameter shape callers actually use:
			// both sites pass a Uint32Array. An earlier build also bound the
			// same export a second time under a `void *` signature and passed
			// `null` there — two names for one API, one of them relying on the
			// binding layer to tolerate a null out-parameter.
			GetWindowThreadProcessId: user32.func("uint32 __stdcall GetWindowThreadProcessId(void *h, _Out_ uint32 *pid)"),
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
export function findDesktopWindow(native) {
	let byTitleVisible;
	let byTitleHidden;
	let byPidVisible;
	let byPidHidden;
	const pidBuffer = new Uint32Array(1);
	const visit = native.koffi.register((handle) => {
		try {
			const visible = native.IsWindowVisible(handle);
			const title = windowTitle(native, handle);
			if (isDesktopTitle(title)) {
				if (visible) {
					byTitleVisible = handle;
					return false; // stop at the first visible title match
				}
				if (byTitleHidden === undefined) byTitleHidden = handle;
				return true;
			}
			// A hidden or repainting window can transiently answer with no
			// title; the shell process owns the window, so match that too.
			if (SHELL_PID === undefined || SHELL_PID === 0) return true;
			pidBuffer[0] = 0;
			native.GetWindowThreadProcessId(handle, pidBuffer);
			if (pidBuffer[0] !== SHELL_PID) return true;
			if (visible) {
				if (byPidVisible === undefined) byPidVisible = handle;
			} else if (byPidHidden === undefined) {
				byPidHidden = handle;
			}
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
	// Which match wins when several windows qualify. A VISIBLE window owned
	// by the shell outranks a hidden one matched only by its title: the
	// hidden-title case exists for a window parked in the tray (1.8.3), and a
	// stale hidden instance left over from an earlier run must not be the one
	// brought forward while the live window is right there on screen.
	return byTitleVisible ?? byPidVisible ?? byTitleHidden ?? byPidHidden;
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
	// SW_SHOW is not a foreground request, so a background process is granted
	// it; it is what makes a tray-hidden window visible again.
	if (!native.IsWindowVisible(handle)) native.ShowWindow(handle, SW_SHOW);
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
	// `AllowSetForegroundWindow` is deliberately absent: the documentation
	// grants the right to ANOTHER process, so calling it before our own request
	// buys nothing (measured: it returned false every time, while the request
	// that followed still succeeded). The retry that does help is one level up,
	// in the focus route, where the whole raise is repeated after a real pause.
	//
	// The attach/detach pair is guarded so a throw from the calls between them
	// cannot leave this thread attached to the other window's input queue.
	native.keybd_event(VK_MENU, 0, 0, 0); // ALT down
	native.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0); // ALT up
	const threadId = new Uint32Array(1);
	const activate = () => {
		const foreground = native.GetForegroundWindow();
		threadId[0] = 0;
		const foregroundThread = foreground === null ? 0 : native.GetWindowThreadProcessId(foreground, threadId);
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
	// One attempt per call. The retry that matters lives one level up, in the
	// focus route: it calls this whole raise up to three times with a real
	// pause between attempts, which is what gives the ALT tap time to land.
	// Repeating `activate()` back to back here bought nothing measurable.
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
 * One line in the Host log.
 *
 * Unlike `warn`, deliberately NOT deduplicated: routine events are the point.
 * For a click that reports "nothing happened", one line per attempt answers
 * whether the request ever reached this process — `focus click` says it
 * arrived. The update check uses the same channel for its one-per-day
 * `asking <registry>` line, which is what a "why is the version stale?"
 * report needs.
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
function tryRaiseNative() {
	try {
		if (process.platform !== "win32") return false;
		return raiseDesktopWindowNative();
	} catch (error) {
		warn(`native raise failed: ${error?.message ?? error}`);
		return false;
	}
}

/** Raise the window through the app's own deep link; last resort. */
function focusDesktopWindowDeepLink() {
	try {
		if (process.platform === "win32") {
			raiseDesktopWindowDeepLink();
		} else if (process.platform === "darwin") {
			log("raising via open -b");
			launcher("open", ["-b", MACOS_BUNDLE_ID], (ok) => {
				if (!ok) launcher("open", [FOCUS_DEEP_LINK]);
			});
		} else {
			log("raising via xdg-open + deep link");
			launcher("xdg-open", [FOCUS_DEEP_LINK]);
		}
	} catch (error) {
		warn(`focus fallback failed: ${error?.message ?? error}`);
	}
}

//#region update check

/** Route the browser half reads the update check through. */
export const UPDATE_CHECK_PATH = "/notify-sounds/update/check";

/** Route the browser half reads a session's goal phase through. */
export const GOAL_PHASE_PATH = "/notify-sounds/goal";

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
 * How long one successful check result is trusted before the next check runs.
 *
 * A FAILURE is not trusted this long — see `UPDATE_FAILURE_TTL_MS`.
 */
const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a failed check is cached.
 *
 * Deliberately short. A failure is usually a transient network or proxy
 * problem, and caching it for the full day meant one blip left the Settings
 * row reading "check failed" until tomorrow — the row looked broken long
 * after the cause was gone. A minute is long enough to collapse the pair of
 * callers a page load produces (the row's own mount plus a user click), and
 * short enough that the next look is a fresh answer.
 */
const UPDATE_FAILURE_TTL_MS = 60 * 1000;

/** Minimum spacing between real requests, so a held-down button cannot hammer a registry. */
const UPDATE_CHECK_SPACING_MS = 15 * 1000;

/** Bounds on the single request a check makes. */
const UPDATE_FETCH_TIMEOUT_MS = 10 * 1000;
const UPDATE_MAX_RESPONSE_BYTES = 256 * 1024;

/** Result of the last check, and when the last real request went out. */
const updateCheck = { checkedAt: 0, requestedAt: 0, result: undefined };

/** The check currently in flight, if any — callers join it instead of starting a second one. */
let checkInFlight;

/**
 * Parse `major.minor.patch` with an optional prerelease tag.
 *
 * Anchored at both ends on purpose: this validates an answer that arrived
 * over the network, and `1.8.5-junk-here` or `1.8.5.9` must be rejected
 * rather than read as `1.8.5`. Build metadata (`+sha`) is accepted and
 * ignored, as semver says it must be for ordering.
 *
 * @returns the parts, or undefined when the text is not a version.
 */
export function parseVersion(text) {
	if (typeof text !== "string") return undefined;
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text);
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
 * Route the page uses to read and write uploaded sounds. Exported so the
 * tests can cross-check the Client half's spelling.
 */
export const SOUND_PATH = "/notify-sounds/sound";

/** Largest uploaded sound accepted, in bytes. */
export const SOUND_MAX_BYTES = 3 * 1024 * 1024;

/**
 * The only file names the sound directory may contain: a lowercase sha256 and
 * a short extension. Anything else is refused outright rather than cleaned, so
 * a hand-edited configuration cannot walk out of the directory.
 */
const SOUND_FILE_PATTERN = /^[a-f0-9]{64}\.(?:mp3|wav|ogg|m4a|flac)$/;

/** Directory under the profile that holds uploaded sounds. */
const SOUND_DIRECTORY = "notify-sounds";

/** Container formats this store accepts, identified by magic bytes. */
const SOUND_FORMATS = [
	{ extension: "flac", mime: "audio/flac", matches: (b) => b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43 },
	{ extension: "ogg", mime: "audio/ogg", matches: (b) => b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53 },
	{
		extension: "wav",
		mime: "audio/wav",
		matches: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45,
	},
	{ extension: "m4a", mime: "audio/mp4", matches: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
	{
		extension: "mp3",
		mime: "audio/mpeg",
		matches: (b) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
	},
];

/**
 * The uploaded-sound directory for this installation, or undefined when there
 * is no profile (a development checkout): then nothing is stored and the page
 * keeps using the legacy inline payload.
 *
 * @returns the absolute directory, or undefined.
 */
function soundsDirectory() {
	const profile = profileDirectory();
	return profile === undefined ? undefined : join(profile, SOUND_DIRECTORY, "sounds");
}

/**
 * Resolve one stored sound by name, refusing anything that is not a plain
 * digest-plus-extension inside the directory.
 *
 * @param fileName - the name the page asked for.
 * @returns the absolute path, or undefined when the name is not one of ours.
 */
export function soundFilePath(fileName) {
	if (typeof fileName !== "string" || !SOUND_FILE_PATTERN.test(fileName)) return undefined;
	const directory = soundsDirectory();
	return directory === undefined ? undefined : join(directory, fileName);
}

/**
 * Write one uploaded sound and return the name it was stored under.
 *
 * The name is the sha256 of the bytes, so the same audio uploaded twice — or
 * migrated twice — lands on the same file and nothing has to be reconciled.
 * A partially written file is never visible: the bytes go to `<name>.tmp` and
 * are renamed into place, and an existing target is left untouched because its
 * content is by definition already identical.
 *
 * @param bytes - the uploaded audio.
 * @returns the stored name, or undefined when the bytes are not audio this
 *   store accepts (or there is no profile to store them in).
 */
export function writeSoundFile(bytes) {
	try {
		const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
		if (buffer.length === 0 || buffer.length > SOUND_MAX_BYTES) return undefined;
		const format = SOUND_FORMATS.find((candidate) => candidate.matches(buffer));
		if (format === undefined) return undefined;
		const directory = soundsDirectory();
		if (directory === undefined) return undefined;
		const fileName = `${createHash("sha256").update(buffer).digest("hex")}.${format.extension}`;
		const target = join(directory, fileName);
		if (existsSync(target)) return fileName;
		mkdirSync(directory, { recursive: true });
		const temporary = `${target}.tmp`;
		writeFileSync(temporary, buffer);
		renameSync(temporary, target);
		return fileName;
	} catch (error) {
		// A read-only profile or a full disk must not take the route down: the
		// caller reports "not stored" and the page keeps whatever it had.
		warn(`sound write failed: ${error?.message ?? error}`);
		return undefined;
	}
}

/**
 * Delete one stored sound, ignoring a name that is not ours and a file that is
 * already gone.
 *
 * @param fileName - the name to remove.
 */
export function deleteSoundFile(fileName) {
	const path = soundFilePath(fileName);
	if (path === undefined) return;
	try {
		rmSync(path, { force: true });
	} catch (error) {
		warn(`sound delete failed: ${error?.message ?? error}`);
	}
}


/**
 * The MIME type for a stored name.
 *
 * @param fileName - a name already accepted by `soundFilePath`.
 * @returns the content type to serve it with.
 */
export function soundMimeType(fileName) {
	const extension = fileName.slice(fileName.lastIndexOf(".") + 1);
	return SOUND_FORMATS.find((format) => format.extension === extension)?.mime ?? "application/octet-stream";
}

/**
 * Read a request body no larger than `limit`.
 *
 * The stream is abandoned the moment the cap is crossed rather than read to
 * the end: an oversized upload is a mistake or an attack, and neither deserves
 * the bandwidth.
 *
 * @param req - the incoming request.
 * @param limit - the largest body accepted.
 * @returns the body, or undefined when it is too large.
 */
async function readRequestBytes(req, limit) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		total += chunk.length;
		if (total > limit) return undefined;
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

/**
 * The profile directory that owns this installation, when there is one.
 *
 * Two sources, in this order, and the order matters:
 *
 *   - `DSH_PROFILE_DIR`, when it is set. In 0.2.1-rc.2 the only code that
 *     produces that variable is `@deepseek-ai/dsh-shell-env`, and it injects
 *     it into the MODEL's shell calls — nothing in the application puts it in
 *     this process. So for the Host this is a bonus, not the mechanism.
 *   - the filesystem. A profile-installed plugin is
 *     `<profile>/node_modules/<name>` (a real directory in DSH's own
 *     installer, and `.pnpm/<name>@<version>/node_modules/<name>` under a
 *     plain pnpm install), so the nearest ancestor holding `pnpm-lock.yaml`
 *     IS the profile. Walking up finds both layouts without knowing which
 *     one this is, and finds nothing for a dev checkout or a bundle shipped
 *     inside the app — which is exactly right, since neither has a lockfile
 *     that could roll this install back.
 *
 * @param moduleUrl - this module's URL; the test passes a fixture's.
 * @returns the profile directory, or undefined.
 */
export function profileDirectory(moduleUrl = import.meta.url) {
	const fromEnv = process.env.DSH_PROFILE_DIR;
	if (typeof fromEnv === "string" && fromEnv !== "") return fromEnv;
	try {
		let dir = fileURLToPath(new URL("..", moduleUrl));
		for (let level = 0; level < 6; level += 1) {
			const parent = dirname(dir);
			if (parent === dir) break;
			if (existsSync(join(parent, "pnpm-lock.yaml"))) return parent;
			dir = parent;
		}
	} catch {
		// A URL that cannot be resolved simply reports no profile.
	}
	return undefined;
}

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
 * This is the prompt that turns a self-update into a permanent one: a
 * 1.7.0 install that updated itself to 1.8.6 has the new files but the old
 * record, and the row is where it says so.
 *
 * Every part is optional: no profile directory, no lockfile or an unreadable
 * one simply reports nothing, and the row keeps its normal wording.
 *
 * @param current - the version actually on disk.
 * @returns the fields the check payload mirrors to the row.
 */
export function installationProvenance(current) {
	try {
		const profileDir = profileDirectory();
		if (profileDir === undefined) return {};
		const lock = readFileSync(join(profileDir, "pnpm-lock.yaml"), "utf8");
		// Only the version segment, deliberately. Dependency keys in a pnpm
		// lockfile can carry a peer suffix — `name@1.8.4(@scope/peer@3.18.4)`
		// — and a looser `[^:\s]*` swallowed that whole parenthetical. The
		// comparison below then saw a "recorded" version that never existed
		// and told the user to reinstall a perfectly good installation.
		const recorded = new RegExp(`^\\s*${UPDATE_PACKAGE}@(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)`, "m").exec(lock)?.[1];
		return {
			recorded,
			unregistered: current !== undefined && recorded !== undefined && recorded !== current,
			// A profile is `$DSH_HOME/profiles/<name>`, so the directory's own
			// name is the profile name when the variable is absent — which,
			// on the Host, it is. The row only uses this to spell out
			// `dsh plugin --profile <name>`; without it the command simply
			// omits the flag.
			profile: typeof process.env.DSH_PROFILE === "string" && process.env.DSH_PROFILE !== ""
				? process.env.DSH_PROFILE
				: basename(profileDir),
		};
	} catch {
		return {};
	}
}

/**
 * Ask the registries for the newest published version of this plugin.
 *
 * Every failure mode — offline, refused, oversized, malformed — becomes a
 * result the UI can show, never a throw. This stage only reads: nothing is
 * written to disk and nothing is executed. Since 1.8.0 installation belongs
 * to the package manager, so the answer is a version number and nothing else:
 * no tarball URL is needed, and one is not asked for.
 *
 * A successful answer is cached for a day; a failure for one minute (see
 * `UPDATE_FAILURE_TTL_MS`) — a blip must not blank the row until tomorrow.
 *
 * @param options - `force` asks again inside the freshness window (the
 *   button); otherwise a recent result is returned as-is.
 * @returns `{ ok, current, latest, updateAvailable, checkedAt }`, or
 *   `{ ok: false, current, error }` when no registry answered.
 */
export async function checkForUpdate(options = {}) {
	const now = Date.now();
	const ttl = updateCheck.result?.ok === false ? UPDATE_FAILURE_TTL_MS : UPDATE_CHECK_TTL_MS;
	if (options.force !== true && updateCheck.result !== undefined && now - updateCheck.checkedAt < ttl) {
		return updateCheck.result;
	}
	// Spacing applies to real requests of every kind: a forced check may
	// refresh, it may not become a load generator.
	if (now - updateCheck.requestedAt < UPDATE_CHECK_SPACING_MS && updateCheck.result !== undefined) {
		return updateCheck.result;
	}
	// Two callers arriving together — a forced check landing on an automatic
	// one — must not become two requests. The spacing rule above cannot cover
	// that: it only sees a finished result, and while the first request is
	// still in the air there is none. So a second caller joins the first.
	if (checkInFlight !== undefined) return checkInFlight;
	updateCheck.requestedAt = now;
	checkInFlight = (async () => {
		const current = readOwnVersion(options.root);
		const answer = await fetchRegistryAnswer();
		if (answer === undefined) {
			const result = { ok: false, current, error: "no registry answered", ...installationProvenance(current) };
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
 * The response is untrusted input, so the version has to parse as a version
 * (`parseVersion` is anchored). Anything else is skipped, so a hostile or
 * broken answer is never the one the row reports.
 *
 * @returns `{ registry, version }`, or undefined when no registry produced an
 *   answer worth believing.
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
			return { registry, version };
		} catch {
			// One registry failing is the ordinary case for the next one to
			// answer; running out of registries is the failure worth reporting.
		}
	}
	return undefined;
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
	/**
	 * The user's own sounds: up to three, each a stored file plus the name it
	 * is shown under. A trigger picks one by slot id (`custom1`…`custom3`).
	 *
	 * Slots are FIXED, not compacted: deleting the second sound leaves slot 2
	 * empty rather than shifting slot 3 into it, so a trigger pointing at
	 * `custom3` keeps meaning the same recording.
	 */
	custom1File: z.string().default("").volatile(),
	custom1Name: z.string().default("").volatile(),
	custom2File: z.string().default("").volatile(),
	custom2Name: z.string().default("").volatile(),
	custom3File: z.string().default("").volatile(),
	custom3Name: z.string().default("").volatile(),
	/**
	 * Legacy inline audio (up to 1.8.6), base64; empty when none.
	 *
	 * Kept readable so an install that updated itself from an older release
	 * keeps its sound: the browser migrates it into slot 1 on first run and
	 * only then clears it. Nothing writes this field any more.
	 */
	customSound: z.string().default("").volatile(),
	/** Legacy display name that belonged to `customSound`. */
	customSoundName: z.string().default("").volatile(),
	/** Legacy per-trigger reference from 1.9.0, migrated into the list then cleared. */
	customDecisionFile: z.string().default("").volatile(),
	/** Legacy display name that belonged to `customDecisionFile`. */
	customDecisionName: z.string().default("").volatile(),
	/** Legacy per-trigger reference from 1.9.0. */
	customQuestionFile: z.string().default("").volatile(),
	/** Legacy display name that belonged to `customQuestionFile`. */
	customQuestionName: z.string().default("").volatile(),
	/** Legacy per-trigger reference from 1.9.0. */
	customCompletionFile: z.string().default("").volatile(),
	/** Legacy display name that belonged to `customCompletionFile`. */
	customCompletionName: z.string().default("").volatile(),
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
					// Foreground requests can be refused while another app owns
					// the input queue; retry before paying for a deep-link launch.
					let raised = false;
					for (let attempt = 0; attempt < 3 && !raised; attempt += 1) {
						raised = tryRaiseNative();
						if (!raised) await new Promise((resolve) => setTimeout(resolve, 180));
					}
					if (!raised) focusDesktopWindowDeepLink();
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
	// The goal phase route (1.8.1): the browser cannot rely on its own
	// session projections for a session it never opened, so goal mode asks
	// the Host, whose projection store is authoritative. Read-only, one
	// session id, fenced like every other route here.
	ctx.inject(["webServer", "connection", "sessions", "sessionProjections"], (child) => {
		/** The goal phase for one session, or undefined when there is none. */
		const phaseOf = (sessionId) => {
			try {
				const session = child.sessions.get(sessionId);
				if (session === undefined) return undefined;
				const projection = child.sessionProjections.stateOf(session, "goal");
				if (projection === undefined || projection.failure != null) return undefined;
				const phase = projection.current?.goal?.phase ?? projection.current?.phase;
				return typeof phase === "string" ? phase : undefined;
			} catch (error) {
				// The projection API is internal, and it has already changed
				// shape once (1.8.2). A throw here would otherwise be invisible:
				// the browser reads "no phase" as "no goal" and goal mode goes
				// back to chiming on every round, with nothing to explain it.
				// One deduplicated line in the Host log is the difference
				// between "a DSH update broke this" and "the plugin is buggy".
				warn(`goal projection unreadable: ${error?.message ?? error}`);
				return undefined;
			}
		};
		child.effect(() => child.webServer.register({
			kind: "exact",
			path: GOAL_PHASE_PATH,
			handler: (req, res) => {
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
				const sessionId = new URL(req.url ?? "/", "http://localhost").searchParams.get("session") ?? "";
				const phase = sessionId === "" ? undefined : phaseOf(sessionId);
				res.statusCode = 200;
				res.setHeader("content-type", "application/json");
				res.end(JSON.stringify({ phase: phase ?? null }));
			},
		}), "notify-sounds: goal phase route");
	});

	// Uploaded sounds (1.9.0): the bytes live as files beside the profile, not
	// inside the configuration, and the page asks for them by content hash.
	//
	// This is deliberately STATELESS: the Host does not read its own config
	// here. Volatile config values are live cells rather than plain strings,
	// so a Host-side read would have to unwrap them — and the browser already
	// holds the authoritative snapshot. The page therefore names the file it
	// wants (`?file=<sha>.<ext>`), and the Host only ever touches the one
	// directory it owns, after checking the name against a hash pattern.
	ctx.inject(["webServer", "connection"], (child) => {
		child.effect(() => child.webServer.register({
			kind: "exact",
			path: SOUND_PATH,
			handler: async (req, res) => {
				const rejection = child.connection.requestRejection(req);
				if (rejection !== undefined) {
					res.statusCode = rejection;
					res.end();
					return;
				}
				const url = new URL(req.url ?? "/", "http://localhost");
				try {
					if (req.method === "GET" || req.method === "HEAD") {
						const name = url.searchParams.get("file") ?? "";
						const file = soundFilePath(name);
						// Read, do not stat: one call closes the window between
						// "the file exists" and "here are its bytes".
						let bytes;
						try {
							bytes = file === undefined ? undefined : readFileSync(file);
						} catch {
							bytes = undefined;
						}
						if (bytes === undefined) {
							res.statusCode = 404;
							res.end();
							return;
						}
						res.statusCode = 200;
						// Content-addressed: the name IS the digest, so the bytes
						// behind it can never change.
						res.setHeader("cache-control", "public, max-age=31536000, immutable");
						res.setHeader("content-type", soundMimeType(name));
						res.setHeader("content-length", String(bytes.length));
						res.end(req.method === "HEAD" ? undefined : bytes);
						return;
					}
					if (req.method === "POST") {
							const bytes = await readRequestBytes(req, SOUND_MAX_BYTES);
						if (bytes === undefined) {
							res.statusCode = 413;
							res.end();
							return;
						}
						const name = writeSoundFile(bytes);
						if (name === undefined) {
							res.statusCode = 415;
							res.end();
							return;
						}
						res.statusCode = 200;
						res.setHeader("content-type", "application/json");
						res.end(JSON.stringify({ file: name }));
						return;
					}
					if (req.method === "DELETE") {
						const name = url.searchParams.get("file") ?? "";
						deleteSoundFile(name);
						res.statusCode = 204;
						res.end();
						return;
					}
					res.statusCode = 405;
					res.setHeader("allow", "GET, POST, DELETE");
					res.end();
				} catch (error) {
					warn(`sound store failed: ${error?.message ?? error}`);
					res.statusCode = 500;
					res.end();
				}
			},
		}), "notify-sounds: sound store route");
	});
}
