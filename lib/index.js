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
 *     OS window, but this process can reach the window handle through Win32
 *     and restore plus focus it.
 *
 * `apply` also suppresses the auto-generated inventory page for this entry,
 * because the Client contributes a dedicated Settings section of its own.
 *
 * @module dsh-plugin-notify-sounds
 */

import z from "@deepseek-ai/schemastery";
import { spawn, spawnSync } from "node:child_process";

/** Diagnostic name of this Host plugin. */
export const name = "notify-sounds";

/** Sound ids shared with the Client half's preset table (spelled, not imported: the browser bundle is self-contained). */
const SOUND_IDS = ["bell", "chime", "ding", "drop", "pulse", "arc", "coin", "success", "knock", "custom", "none"];

/** Quiet-hours time-of-day pattern, "HH:MM". */
const TIME_OF_DAY = /^\d{2}:\d{2}$/;

/** Deep link the packaged Desktop registers (`setAsDefaultProtocolClient`); the macOS/Linux fallback. */
const FOCUS_DEEP_LINK = "dsh://open";

/** Route the browser half posts to when a system notification is clicked. */
const FOCUS_PATH = "/notify-sounds/focus";

/**
 * Upper bound on the blocking Win32 raise, in milliseconds. The call normally
 * returns in tens of milliseconds; this only bounds a hung PowerShell.
 */
const FOCUS_TIMEOUT_MS = 8000;

/**
 * Raise the Desktop's primary window.
 *
 * The renderer cannot do this itself: `window.focus()` only focuses the page
 * inside the window, and the sandboxed preload bridge exposes no window
 * control. On Windows this process therefore runs a short PowerShell command
 * that restores and focuses the window through Win32
 * (`ShowWindow`/`SetForegroundWindow`). macOS and Linux keep the app's own
 * deep link, which their shells route into a window focus.
 *
 * Every failure mode leaves the click a harmless no-op.
 */
function focusDesktopWindow() {
	try {
		if (process.platform === "win32") {
			// Raise the primary window through Win32.
			//
			// Launch shapes measured on Windows 11, with what each did:
			//   - `cmd start "" dsh://open`: Windows refuses foreground
			//     activation for an unpackaged app, so the click reached the
			//     page and the route answered 204, but the window never rose.
			//   - `spawn("powershell.exe", …, { detached: true })`: the child
			//     exited 0 WITHOUT running the script — detached PowerShell is
			//     silently inert here. Both `-Command` and `-EncodedCommand`
			//     behaved this way, so it is the launch flag, not quoting.
			//   - `spawnSync("powershell.exe", …)`: ran, and restored plus
			//     focused the window. This is the shape below.
			//
			// `spawnSync` blocks this process for the tens of milliseconds
			// PowerShell needs. That is deliberate: the alternative either
			// never runs (detached) or dies with this process. The caller
			// answers the HTTP request before calling this, so the click never
			// waits on it, and the timeout bounds the worst case.
			//
			// The Win32 entries are reached as static members of a generated
			// type; the type name is unique to avoid colliding with
			// PowerShell's own ShowWindow/BringWindowToTop cmdlets. The script
			// travels as `-EncodedCommand` (base64 UTF-16LE) so the C#
			// DllImport double quotes never pass through Windows argument
			// quoting.
			const signature = [
				"[DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int c);",
				"[DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h);",
				"[DllImport(\"user32.dll\")] public static extern bool BringWindowToTop(IntPtr h);",
				"[DllImport(\"user32.dll\", SetLastError=true)] public static extern bool AllowSetForegroundWindow(int p);",
			].join("");
			const script = [
				`Add-Type -MemberDefinition '${signature}' -Namespace DshNotifySounds -Name Raise`,
				"$w = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
				"if ($null -eq $w) { exit 1 }",
				"$h = $w.MainWindowHandle",
				"[void][DshNotifySounds.Raise]::AllowSetForegroundWindow(-1)",
				"[void][DshNotifySounds.Raise]::ShowWindow($h, 9)",
				"[void][DshNotifySounds.Raise]::BringWindowToTop($h)",
				"[void][DshNotifySounds.Raise]::SetForegroundWindow($h)",
			].join("; ");
			const encoded = Buffer.from(script, "utf16le").toString("base64");
			spawnSync("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand", encoded], {
				windowsHide: true,
				stdio: "ignore",
				timeout: FOCUS_TIMEOUT_MS,
			});
		} else if (process.platform === "darwin") {
			spawn("open", [FOCUS_DEEP_LINK], { detached: true, stdio: "ignore" }).unref();
		} else {
			spawn("xdg-open", [FOCUS_DEEP_LINK], { detached: true, stdio: "ignore" }).unref();
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
				if (!fromBrowser) focusDesktopWindow();
			},
		}), "notify-sounds: focus route");
	});
}
