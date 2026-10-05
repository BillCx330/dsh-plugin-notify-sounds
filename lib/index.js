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

/** Diagnostic name of this Host plugin. */
export const name = "notify-sounds";

/** Sound ids shared with the Client half's preset table (spelled, not imported: the browser bundle is self-contained). */
const SOUND_IDS = ["bell", "chime", "ding", "drop", "pulse", "arc", "coin", "success", "knock", "custom", "none"];

/** Quiet-hours time-of-day pattern, "HH:MM". */
const TIME_OF_DAY = /^\d{2}:\d{2}$/;

/** Deep link the packaged Desktop registers (`setAsDefaultProtocolClient`); opening it focuses the primary window. */
const FOCUS_DEEP_LINK = "dsh://open";

/** Route the browser half posts to when a system notification is clicked. */
const FOCUS_PATH = "/notify-sounds/focus";

/** Upper bound on the deep-link launch, in milliseconds. */
const FOCUS_TIMEOUT_MS = 8000;

/**
 * Raise the Desktop's primary window by opening the app's own deep link.
 *
 * The renderer cannot do this itself: `window.focus()` only focuses the page
 * inside the window, and the sandboxed preload bridge exposes no window
 * control. The deep link instead goes through Windows: the packaged app owns
 * `dsh://`, so the OS starts a second instance, its single-instance lock hands
 * off to the running one, and that owner's handler restores and focuses the
 * primary window — the same path a taskbar re-launch takes.
 *
 * `spawnSync`, deliberately. A `spawn(..., { detached: true })` child exits 0
 * here without the deep link ever taking effect: measured, the same command
 * raises the window synchronously and does nothing when detached. The call
 * blocks this process for the tens of milliseconds the launch needs, which is
 * safe because the HTTP request is already answered.
 *
 * Raising the window directly was tried and rejected. Both a PowerShell helper
 * that compiles a `DllImport` shim at run time and a native FFI call that
 * inspected the owning process are shapes a security suite's behaviour engine
 * flags: the user saw a detection dialog on every click, attributed to the
 * Desktop's own executable. This route touches no other process and needs no
 * script host.
 *
 * Every failure mode leaves the click a harmless no-op.
 */
function focusDesktopWindow() {
	try {
		if (process.platform === "win32") {
			// `start ""` — the empty quoted title keeps `start` from treating
			// the URL as a window title.
			spawnSync("cmd.exe", ["/d", "/s", "/c", "start", "", FOCUS_DEEP_LINK], {
				windowsHide: true,
				stdio: "ignore",
				timeout: FOCUS_TIMEOUT_MS,
			});
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
				if (!fromBrowser) focusDesktopWindow();
			},
		}), "notify-sounds: focus route");
	});
}
