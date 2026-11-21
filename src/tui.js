/**
 * fterm-notify: Android notifications from OpenCode.
 *
 * <p>OpenCode's own attention system reaches desktop backends - DBus, Windows toasts, the
 * macOS notification centre - and none of those exist on Android. A terminal emulator is the
 * one thing that does, and fterm already parses {@code ESC ] 9 ; message BEL} into a real
 * notification, so this plugin's whole job is to write that sequence at the moments a person
 * away from the screen needs to know about.
 *
 * <p>This is the TUI half. The server half exists so the package loads as a plugin; it does
 * nothing, because the escape has to be written by the process that owns the terminal.
 */
import { describe, frame, ftermAttached, sessionOf } from "./notify.js";

const DEFAULTS = {
  /**
   * Where the escape goes. Injectable so a test does not have to replace
   * `process.stdout.write`, which is the same stream the test reporter writes to - doing that
   * swallowed every line of output and turned a failing assertion into a silent exit code.
   */
  write: (chunk) => process.stdout.write(chunk),
  /** Shown before the message. Empty means the message alone. */
  prefix: "terminal",
  /** Suppress the notification for subagent sessions; their work reports through the parent. */
  skipSubagents: true,
  /** Longest payload to send, in characters. */
  maxLength: 120,
};

export default {
  id: "fterm-notify.tui",

  async setup(context) {
    // The data bus only exists in the TUI process. The server's setup() gets a different
    // context shape, and touching context.data there throws.
    if (!context || typeof context.data?.on !== "function") return;

    const options = { ...DEFAULTS, ...(context.options || {}) };

    // A marker on disk, so "did the TUI half load?" is answerable without a debugger. The
    // other local plugins here do the same, and the alternative - inferring it from the
    // absence of a notification - cannot tell "not loaded" from "nothing happened".
    if (options.logLoaded !== false) {
      try {
        const dir = process.env.HOME + "/.local/share/opencode/plugin-logs";
        const fs = await import("node:fs");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(dir + "/fterm-notify.loaded", String(Date.now()));
      } catch {
        // A read-only home is not a reason to fail the plugin.
      }
    }

    // Detection is per write, not once: `tmux new` inside fterm inherits the variable, but a
    // user can also start OpenCode before attaching the terminal, and a cached answer would
    // then be wrong for the whole session.
    const notify = (body) => {
      if (!ftermAttached()) return;
      const payload = frame(body, options);
      if (!payload) return;
      try {
        options.write(payload);
      } catch {
        // A closed stdout is the process exiting; nothing to recover.
      }
    };

    const short = (sessionID) => String(sessionID).slice(0, 8);

    let sessions = null;
    try {
      sessions = context.data.session;
    } catch {
      sessions = null;
    }

    /** Whether this session is a subagent's, whose result the parent already reports. */
    const isSubagent = (sessionID) => {
      try {
        return sessions?.get(sessionID)?.parentID !== undefined;
      } catch {
        return false;
      }
    };

    const subscribe = (event, kind, { skipSubagents = options.skipSubagents } = {}) => {
      const stop = context.data.on(event, (payload) => {
        // A throwing listener takes the event bus down with it, and this plugin is never the
        // reason a session should fail.
        try {
          const sessionID = sessionOf(payload?.data);
          if (!sessionID) return;
          if (skipSubagents && isSubagent(sessionID)) return;
          const body = describe(kind, payload?.data?.error);
          notify(body || short(sessionID));
        } catch {
          // Ignored on purpose; see above.
        }
      });
      return stop;
    };

    const stops = [
      subscribe("session.execution.succeeded", "succeeded"),
      subscribe("session.execution.interrupted", "interrupted"),
      subscribe("session.execution.failed", "failed"),
      // A permission prompt blocks the work until it is answered, and the subagent case is
      // worth showing too: the prompt appears in the parent's UI either way.
      subscribe("permission.asked", "permission", { skipSubagents: false }),
    ];

    // The documented contract: return a cleanup function for what the plugin owns.
    return () => {
      for (const stop of stops) {
        try {
          stop();
        } catch {
          // Already disposed.
        }
      }
    };
  },
};
