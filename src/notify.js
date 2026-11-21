/**
 * The parts that do not need OpenCode: detection, sanitising, and the escape itself.
 *
 * Kept apart from the plugin so they can be tested with plain `node --test` on any machine.
 * A notification plugin that only runs on a phone is one that cannot be tested at all, and
 * this one writes raw control sequences to stdout - the kind of code that needs a test.
 */

/** ESC ] 9 ; <message> BEL - the iTerm2 form, which is what fterm parses. */
const OSC = "\u001b]9;";
const BEL = "\u0007";

/**
 * Whether the terminal at the other end of stdout is fterm.
 *
 * <p>Two signals, because there are two situations. fterm exports {@code TERM_PROGRAM} into
 * the shells it starts, so an ordinary session answers without setup. {@code FTERM_NOTIFY=1}
 * covers the rest: a tmux session, an ssh hop, or a user who runs OpenCode inside some other
 * multiplexer that does not forward the original environment.
 *
 * <p>The check is a substring rather than equality so a future `fterm-tmux` or a path-like
 * value still matches; the cost of a false positive is a stray escape sequence in
 * scrollback, and the cost of a false negative is no notification at all.
 */
export function ftermAttached(env = process.env) {
  const program = String(env.TERM_PROGRAM || "").toLowerCase();
  if (program.includes("fterm")) return true;
  return env.FTERM_NOTIFY === "1";
}

/**
 * Make a string safe to sit inside an OSC payload.
 *
 * <p>Three separate dangers. C0 controls and DEL would let a message smuggle a second escape
 * sequence into the stream - a title taken from a file name is untrusted input. BEL and ST
 * would end the OSC early, so the rest of the message would be interpreted as screen output.
 * And an unbroken run of thousands of characters is a display nobody can read, so it is cut.
 */
export function sanitize(input, maxLength = 120) {
  if (input === null || input === undefined) return "";
  const flattened = String(input)
    // C0 (including BEL, ESC), DEL, and the C1 range that also contains ST.
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flattened.length <= maxLength) return flattened;
  return flattened.slice(0, Math.max(0, maxLength - 1)) + "\u2026";
}

/**
 * The bytes to write for one notification, or null when there is nothing worth sending.
 *
 * <p>Separated from the writing so a test can assert the exact frame. {@code fterm} splits
 * the payload on its first {@code " · "} if the plugin sends one, but a title is optional
 * there (OSC 9 carries only a message), so the title and the body are joined here and the
 * terminal's own app name is what the shade shows.
 */
export function frame(body, { prefix = "", maxLength = 120 } = {}) {
  const text = sanitize(body, maxLength);
  if (!text) return null;
  const lead = sanitize(prefix, 32);
  return OSC + (lead ? lead + " \u00b7 " + text : text) + BEL;
}

/**
 * One line describing what happened, from an event payload.
 *
 * <p>The three outcomes worth telling a person who is not looking at the screen: it finished,
 * it stopped, it needs an answer. Everything else is noise while the work is still running.
 */
export function describe(kind, error) {
  switch (kind) {
    case "succeeded":
      return "done";
    case "interrupted":
      return "interrupted";
    case "failed": {
      const message = firstString(error, ["message", "name", "type"]);
      return message ? "failed: " + message : "failed";
    }
    case "permission":
      return "needs permission";
    default:
      return "";
  }
}

/** The first non-empty string among the named fields of an object, or "". */
export function firstString(object, keys) {
  if (typeof object !== "object" || object === null) return "";
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return "";
}

/** The session id from an event payload, across the spellings the API has used. */
export function sessionOf(data) {
  return (
    firstString(data, ["sessionID", "sessionId", "session_id"]) ||
    firstString(data && data.info, ["sessionID", "sessionId", "session_id"])
  );
}
