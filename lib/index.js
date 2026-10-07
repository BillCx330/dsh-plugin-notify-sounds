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
 * `apply` also suppresses the auto-generated inventory page for this entry,
 * because the Client contributes a dedicated Settings section of its own.
 *
 * @module dsh-plugin-notify-sounds
 */

import z from "@deepseek-ai/schemastery";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Diagnostic name of this Host plugin. */
export const name = "notify-sounds";

/** Sound ids shared with the Client half's preset table (spelled, not imported: the browser bundle is self-contained). */
const SOUND_IDS = ["bell", "chime", "ding", "drop", "pulse", "arc", "coin", "success", "knock", "custom", "none"];

/** Quiet-hours time-of-day pattern, "HH:MM". */
const TIME_OF_DAY = /^\d{2}:\d{2}$/;

/** Deep link the packaged Desktop registers (`setAsDefaultProtocolClient`); the last-resort focus path. */
const FOCUS_DEEP_LINK = "dsh://open";

/** Route the browser half posts to when a system notification is clicked. */
const FOCUS_PATH = "/notify-sounds/focus";

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
function windowTitle(native, handle) {
	try {
		const length = native.GetWindowTextLengthW(handle);
		if (length <= 0) return "";
		const buffer = new Uint16Array(length + 2);
		native.GetWindowTextW(handle, buffer, buffer.length);
		return Buffer.from(buffer.buffer, 0, length * 2).toString("utf16le");
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
 */
function isDesktopTitle(title) {
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
 * @param command - the executable to run.
 * @param args - its arguments.
 */
function launcher(command, args) {
	try {
		const child = spawn(command, args, { windowsHide: true, stdio: "ignore" });
		child.on("error", (error) => warn(`could not launch ${command}: ${error?.message ?? error}`));
		child.unref();
	} catch (error) {
		warn(`could not launch ${command}: ${error?.message ?? error}`);
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
			if (!raiseDesktopWindowNative()) raiseDesktopWindowDeepLink();
		} else if (process.platform === "darwin") {
			launcher("open", [FOCUS_DEEP_LINK]);
		} else {
			launcher("xdg-open", [FOCUS_DEEP_LINK]);
		}
	} catch (error) {
		warn(`focus failed: ${error?.message ?? error}`);
	}
}

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
	/** Re-ping unanswered decisions at a fixed interval. */
	renotify: z.boolean().default(false).volatile(),
	/** Re-ping interval in minutes. */
	renotifyMinutes: z.number().step(1).min(1).max(60).default(5).volatile(),
	/** Suppress every sound and notification during a daily time range. */
	quietHours: z.boolean().default(false).volatile(),
	/** Quiet range start, "HH:MM" 24-hour. */
	quietStart: z.string().pattern(TIME_OF_DAY).default("22:00").volatile(),
	/** Quiet range end, "HH:MM" 24-hour. */
	quietEnd: z.string().pattern(TIME_OF_DAY).default("08:00").volatile(),
});

/**
 * Host plugin body. Registers the page policy and the focus route; the
 * sounds and the Settings section exist in the browser entry.
 *
 * @param ctx - the Host plugin context.
 */
export function apply(ctx) {
	// The Client half registers a dedicated `settings.section` page; keep the
	// plugin inventory from contributing an auto-generated form for the same
	// namespace, so the preference is editable from exactly one place.
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
				// own `dsh-app://app/` origin, and the shell STRIPS Origin
				// before forwarding to this server, so a Desktop click arrives
				// with no Origin header while a real browser always sends one.
				//
				// The two need opposite things, so the choice is derived here
				// rather than configured: a browser click needs no help, since
				// activating the notification raises the browser window itself
				// and raising the Desktop window instead would be the wrong
				// window entirely.
				const fromBrowser = req.headers?.origin !== undefined;
				res.statusCode = 204;
				res.end();
				if (!fromBrowser) {
					focusDesktopWindow();
				}
			},
		}), "notify-sounds: focus route");
	});
}
