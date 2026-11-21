/**
 * fterm-notify, server half.
 *
 * <p>It does nothing, deliberately. The notification is an escape sequence written to the
 * terminal, and only the TUI process has one - the server may be shared by several clients or
 * running with no terminal at all. The package still needs a server part so that adding it to
 * `plugins` loads the TUI half too.
 */
export default {
  id: "fterm-notify.server",
  setup() {},
};
