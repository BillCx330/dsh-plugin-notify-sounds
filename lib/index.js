/**
 * Host half of `dsh-plugin-notify-sounds`.
 *
 * All behavior lives in the browser entry (`./client`): the sounds themselves
 * are Web Audio synthesis, and the triggers are the Client's own
 * `uiSession.sessionStatus` facts (pending interactions and running→idle
 * transitions). This Node half exists to own the durable preference surface:
 *
 *   - the volatile Config schema below is what the Host Settings document
 *     serves under the `notify-sounds` namespace, so the Settings section the
 *     Client registers reads and writes through `configForms` exactly like
 *     DSH's own preference rows (locale, developer tools, web search);
 *   - `apply` suppresses the auto-generated inventory page for this entry,
 *     because the Client contributes a dedicated Settings section of its own.
 *
 * @module dsh-plugin-notify-sounds
 */

import z from "@deepseek-ai/schemastery";

/** Diagnostic name of this Host plugin. */
export const name = "notify-sounds";

/** Sound ids shared with the Client half's preset table (spelled, not imported: the browser bundle is self-contained). */
const SOUND_IDS = ["bell", "chime", "ding", "drop", "pulse", "arc", "none"];

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
	/** Preset played when a Session gains a pending approval or question. */
	decisionSound: z.union(SOUND_IDS).default("bell").volatile(),
	/** Preset played when a Session's agent finishes (running → idle). */
	completionSound: z.union(SOUND_IDS).default("ding").volatile(),
	/** Play only while the page is not visible (background tab or window). */
	onlyWhenHidden: z.boolean().default(false).volatile(),
});

/**
 * Host plugin body. Registers the page policy only; the sounds and the
 * Settings section exist in the browser entry.
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
}
