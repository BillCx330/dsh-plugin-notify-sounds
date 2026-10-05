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
 *     OS window, but this process can ask the Desktop to, by opening the app's
 *     own `dsh://open` deep link.
 *
 * `apply` also suppresses the auto-generated inventory page for this entry,
 * because the Client contributes a dedicated Settings section of its own.
 *
 * @module dsh-plugin-notify-sounds
 */

import z from "@deepseek-ai/schemastery";
import { spawnSync } from "node:child_process";
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

/** Upper bound on a synchronous launch, in milliseconds. */
const FOCUS_TIMEOUT_MS = 8000;

/** App name the Desktop shell appends to its primary window's title. */
const DESKTOP_APP_TITLE = "DeepSeek Harness";

//#region native window raise

/**
 * Locate the Desktop's own prebuilt `koffi` native module.
 *
 * The Desktop Host process already ships `koffi` (for `node-pty`), so borrowing
 * it costs this plugin no dependency. The native binary is the one thing the
 * app cannot pack into `app.asar`, so it sits in `app.asar.unpacked` as a real
 * filesystem path this process can load.
 *
 * The install root cannot be derived from this module's own location: the
 * plugin lives in the DSH profile (`~/.dsh/profiles/<name>/node_modules/…`),
 * which has nothing to do with where the app is installed. Two sources are
 * tried, because neither is guaranteed here:
 *
 *   - `process.resourcesPath`, which Electron injects — but this process runs
 *     as Electron's own binary in Node mode, where it may be absent.
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
	// The middle segment is a directory holding the entry, then the native
	// module may sit at either of the two shapes the Desktop ships.
	const middles = [
		["@deepseek-ai", "dsh-desktop-host", "node_modules", "koffi"],
		["@deepseek-ai", "dsh-desktop-host", "node_modules", "@koromix", "koffi-win32-x64", "win32_x64", "koffi.node"],
		["@koromix", "koffi-win32-x64", "win32_x64", "koffi.node"],
	];
	for (const base of resources) {
		for (const middle of middles) {
			const candidate = join(base, "app.asar.unpacked", "dsh", "node_modules", ...middle);
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
		const koffi = createRequire(join(dirname(modulePath), "index.cjs"))(modulePath);
		const user32 = koffi.load("user32.dll");
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
		};
	} catch {
		bound = null;
	}
	nativeRaise = bound;
	return bound ?? undefined;
}

/** Cached FFI binding; `null` records a failed load so it is not retried. */
let nativeRaise;

/** Read a window's title, or "" when it has none. */
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
 * Find the Desktop's primary window by the title the shell composes.
 *
 * @param native - the bound Win32 calls.
 * @returns the window handle, or undefined.
 */
function findDesktopWindow(native) {
	const matches = [];
	const visit = native.koffi.register((handle) => {
		try {
			if (!native.IsWindowVisible(handle)) return true;
			const title = windowTitle(native, handle);
			// The shell renders `<session or screen title> — <app name>`.
			if (title.endsWith(`— ${DESKTOP_APP_TITLE}`) || title.endsWith(`- ${DESKTOP_APP_TITLE}`)) {
				matches.push(handle);
				return false; // stop at the first match
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
	return matches[0];
}

/**
 * Restore and focus the Desktop window from inside this process.
 *
 * @returns whether a window was found and asked to come forward.
 */
function raiseDesktopWindowNative() {
	const native = loadNativeRaise();
	if (native === undefined) return false;
	const handle = findDesktopWindow(native);
	if (handle === undefined) return false;
	// Ask for the right to change the foreground first. It can be refused for a
	// background process (observed: `grant=false`), and the topmost lift still
	// takes effect, which is what the user sees — with the window already
	// restored by the click, `ShowWindow` reports false as well.
	native.AllowSetForegroundWindow(-1);
	native.ShowWindow(handle, 9); // SW_RESTORE
	native.BringWindowToTop(handle);
	native.SetForegroundWindow(handle);
	return true;
}

/**
 * Raise the Desktop window through the app's own deep link.
 *
 * Last resort, for a build that does not ship the FFI binding. The deep link
 * goes through Windows, and the second instance's foreground request can be
 * refused when the launch comes from a background process — which is why it is
 * the fallback and not the primary path.
 *
 * @returns whether the launch was attempted without an immediate error.
 */
function raiseDesktopWindowDeepLink() {
	// `start ""` — the empty quoted title keeps `start` from treating the URL as
	// a window title.
	const result = spawnSync("cmd.exe", ["/d", "/s", "/c", "start", "", FOCUS_DEEP_LINK], {
		windowsHide: true,
		stdio: "ignore",
		timeout: FOCUS_TIMEOUT_MS,
	});
	return result.error === undefined;
}

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
			if (!raiseDesktopWindowNative()) {
				raiseDesktopWindowDeepLink();
			}
		} else if (process.platform === "darwin") {
			spawnSync("open", [FOCUS_DEEP_LINK], { stdio: "ignore", timeout: FOCUS_TIMEOUT_MS });
		} else {
			spawnSync("xdg-open", [FOCUS_DEEP_LINK], { stdio: "ignore", timeout: FOCUS_TIMEOUT_MS });
		}
	} catch {
		// A failed launch leaves the notification click a no-op.
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
	/** Prefix the window title with a bell while a decision is pending and the page is hidden. */
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






