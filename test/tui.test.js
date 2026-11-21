import assert from "node:assert/strict";
import test from "node:test";

import plugin from "../src/tui.js";
import server from "../src/server.js";

const BEL = "\u0007";

/**
 * A stand-in for the TUI context: an event bus, a session table, and a captured stdout.
 *
 * Only the three things the plugin touches are modelled. A test that needed more of the
 * context would be testing OpenCode rather than the plugin.
 */
function harness({ env = { TERM_PROGRAM: "fterm" }, subagents = [], options } = {}) {
  const listeners = new Map();
  const written = [];
  const originalEnv = { ...process.env };

  for (const key of Object.keys(process.env)) {
    if (key === "TERM_PROGRAM" || key === "FTERM_NOTIFY") delete process.env[key];
  }
  Object.assign(process.env, env);

  const context = {
    // The writer is injected rather than patched onto process.stdout: the test reporter
    // writes to the same stream, so replacing it silenced the whole file's output.
    options: { write: (chunk) => written.push(String(chunk)), ...(options || {}) },
    data: {
      on(event, handler) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(handler);
        return () => listeners.get(event)?.delete(handler);
      },
      session: {
        get(id) {
          return subagents.includes(id) ? { parentID: "root" } : { id };
        },
      },
    },
  };

  return {
    context,
    written,
    emit(event, data) {
      for (const handler of listeners.get(event) ?? []) handler({ type: event, data });
    },
    listenerCount(event) {
      return listeners.get(event)?.size ?? 0;
    },
    restore() {
      for (const key of Object.keys(process.env)) {
        if (!(key in originalEnv)) delete process.env[key];
      }
      Object.assign(process.env, originalEnv);
    },
  };
}

test("the plugin loads and exposes an id", () => {
  assert.equal(typeof plugin.id, "string");
  assert.ok(plugin.id.length > 0);
  assert.equal(typeof plugin.setup, "function");
});

test("the server half is a no-op but present, so the package loads", async () => {
  assert.equal(typeof server.setup, "function");
  assert.equal(await server.setup(), undefined);
});

test("setup returns a cleanup function that unsubscribes", async () => {
  const h = harness();
  try {
    const stop = await plugin.setup(h.context);
    assert.equal(typeof stop, "function");
    assert.equal(h.listenerCount("session.execution.succeeded"), 1);
    stop();
    assert.equal(h.listenerCount("session.execution.succeeded"), 0);
  } finally {
    h.restore();
  }
});

test("a finished session writes one OSC 9 frame", async () => {
  const h = harness();
  try {
    await plugin.setup(h.context);
    h.emit("session.execution.succeeded", { sessionID: "ses_abc123" });
    assert.deepEqual(h.written, ["\u001b]9;terminal \u00b7 done" + BEL]);
  } finally {
    h.restore();
  }
});

test("a failure carries the error message", async () => {
  const h = harness();
  try {
    await plugin.setup(h.context);
    h.emit("session.execution.failed", {
      sessionID: "ses_abc",
      error: { message: "rate limited" },
    });
    assert.deepEqual(h.written, ["\u001b]9;terminal \u00b7 failed: rate limited" + BEL]);
  } finally {
    h.restore();
  }
});

test("a permission prompt is reported even for a subagent", async () => {
  const h = harness({ subagents: ["ses_sub"] });
  try {
    await plugin.setup(h.context);
    h.emit("permission.asked", { sessionID: "ses_sub" });
    assert.deepEqual(h.written, ["\u001b]9;terminal \u00b7 needs permission" + BEL]);
  } finally {
    h.restore();
  }
});

test("a subagent's success does not notify: the parent already reports it", async () => {
  const h = harness({ subagents: ["ses_sub"] });
  try {
    await plugin.setup(h.context);
    h.emit("session.execution.succeeded", { sessionID: "ses_sub" });
    h.emit("session.execution.succeeded", { sessionID: "ses_root" });
    assert.deepEqual(h.written, ["\u001b]9;terminal \u00b7 done" + BEL]);
  } finally {
    h.restore();
  }
});

test("outside fterm nothing is written, so no escape lands in scrollback", async () => {
  const h = harness({ env: { TERM_PROGRAM: "Apple_Terminal" } });
  try {
    await plugin.setup(h.context);
    h.emit("session.execution.succeeded", { sessionID: "ses_abc" });
    assert.deepEqual(h.written, []);
  } finally {
    h.restore();
  }
});

test("the prefix and the subagent rule are configurable", async () => {
  const h = harness({ options: { prefix: "\ud130\ubbf8\ub110", skipSubagents: false } });
  const sub = harness({ subagents: ["ses_sub"], options: { prefix: "", skipSubagents: false } });
  try {
    await plugin.setup(h.context);
    h.emit("session.execution.succeeded", { sessionID: "ses_abc" });
    assert.deepEqual(h.written, ["\u001b]9;\ud130\ubbf8\ub110 \u00b7 done" + BEL]);

    await plugin.setup(sub.context);
    sub.emit("session.execution.succeeded", { sessionID: "ses_sub" });
    assert.deepEqual(sub.written, ["\u001b]9;done" + BEL]);
  } finally {
    h.restore();
    sub.restore();
  }
});

test("an event with no session id is ignored rather than sending a blank notice", async () => {
  const h = harness();
  try {
    await plugin.setup(h.context);
    h.emit("session.execution.succeeded", {});
    assert.deepEqual(h.written, []);
  } finally {
    h.restore();
  }
});

test("a throwing listener does not escape into the event bus", async () => {
  const h = harness();
  try {
    await plugin.setup(h.context);
    // `session` resolving to something without get() would throw inside isSubagent; the
    // plugin must swallow it and carry on rather than fail the session.
    h.context.data.session = null;
    assert.doesNotThrow(() => h.emit("session.execution.succeeded", { sessionID: "ses_a" }));
  } finally {
    h.restore();
  }
});

test("setup is safe in the server process, where there is no data bus", async () => {
  await assert.doesNotReject(() => plugin.setup({}));
  await assert.doesNotReject(() => plugin.setup(undefined));
  assert.equal(await plugin.setup({}), undefined);
});
