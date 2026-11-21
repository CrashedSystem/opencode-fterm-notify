import assert from "node:assert/strict";
import test from "node:test";

import {
  describe,
  firstString,
  frame,
  ftermAttached,
  sanitize,
  sessionOf,
} from "../src/notify.js";

const BEL = "\u0007";

test("detection follows TERM_PROGRAM, not the app name", () => {
  assert.equal(ftermAttached({ TERM_PROGRAM: "fterm" }), true);
  assert.equal(ftermAttached({ TERM_PROGRAM: "FTERM" }), true);
  assert.equal(ftermAttached({ TERM_PROGRAM: "fterm-tmux" }), true);
  assert.equal(ftermAttached({ TERM_PROGRAM: "Apple_Terminal" }), false);
  assert.equal(ftermAttached({}), false);
});

test("FTERM_NOTIFY opts in where the variable does not survive", () => {
  // tmux, ssh, or a multiplexer that drops TERM_PROGRAM.
  assert.equal(ftermAttached({ TERM_PROGRAM: "tmux", FTERM_NOTIFY: "1" }), true);
  assert.equal(ftermAttached({ FTERM_NOTIFY: "0" }), false);
});

test("sanitising removes what would break the escape", () => {
  // BEL ends the OSC early; ESC could start another sequence.
  assert.equal(sanitize("a\u0007b"), "a b");
  assert.equal(sanitize("a\u001bb"), "a b");
  // ST as a single C1 code point is the other early terminator.
  assert.equal(sanitize("a\u009cb"), "a b");
  assert.equal(sanitize("line\nbreak"), "line break");
  assert.equal(sanitize("  padded  "), "padded");
});

test("sanitising truncates with an ellipsis instead of cutting mid-word", () => {
  const long = "x".repeat(500);
  const out = sanitize(long, 10);
  assert.equal(out.length, 10);
  assert.ok(out.endsWith("\u2026"));
});

test("a message with nothing in it produces no frame", () => {
  assert.equal(frame(""), null);
  assert.equal(frame("   "), null);
  assert.equal(frame("\u0007"), null);
  assert.equal(frame(null), null);
});

test("the frame is exactly the iTerm2 OSC 9 form fterm parses", () => {
  assert.equal(frame("done", { prefix: "" }), "\u001b]9;done" + BEL);
  assert.equal(frame("done", { prefix: "terminal" }), "\u001b]9;terminal \u00b7 done" + BEL);
});

test("the prefix is sanitised too, so a configured value cannot inject", () => {
  assert.equal(frame("x", { prefix: "a\u0007b" }), "\u001b]9;a b \u00b7 x" + BEL);
});

test("the length limit applies to the body, not to the escape", () => {
  const out = frame("y".repeat(400), { prefix: "", maxLength: 20 });
  assert.ok(out.startsWith("\u001b]9;"));
  assert.ok(out.endsWith(BEL));
  assert.equal(out.length, "\u001b]9;".length + 20 + BEL.length);
});

test("each outcome has one sentence", () => {
  assert.equal(describe("succeeded"), "done");
  assert.equal(describe("interrupted"), "interrupted");
  assert.equal(describe("permission"), "needs permission");
  assert.equal(describe("failed"), "failed");
  assert.equal(describe("failed", { message: "rate limited" }), "failed: rate limited");
  assert.equal(describe("failed", { name: "AbortError" }), "failed: AbortError");
  assert.equal(describe("unknown"), "");
});

test("a failed event's error is read from any of the shapes the API uses", () => {
  assert.equal(firstString({ message: "m" }, ["message", "name"]), "m");
  assert.equal(firstString({ name: "n" }, ["message", "name"]), "n");
  assert.equal(firstString({ message: "" }, ["message"]), "");
  assert.equal(firstString({ message: 42 }, ["message"]), "");
  assert.equal(firstString(null, ["message"]), "");
});

test("the session id is found in either position", () => {
  assert.equal(sessionOf({ sessionID: "abc" }), "abc");
  assert.equal(sessionOf({ sessionId: "abc" }), "abc");
  assert.equal(sessionOf({ session_id: "abc" }), "abc");
  assert.equal(sessionOf({ info: { sessionID: "abc" } }), "abc");
  assert.equal(sessionOf({}), "");
  assert.equal(sessionOf(undefined), "");
});
