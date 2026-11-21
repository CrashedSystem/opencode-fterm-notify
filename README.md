# opencode-fterm-notify

Android notifications from [OpenCode](https://opencode.ai), delivered through the
[fterm](https://github.com/CrashedSystem/fterm) terminal.

OpenCode already notifies you when a session finishes, fails, or needs permission — but only
through desktop backends (DBus, Windows toasts, the macOS notification centre). None of those
exist on Android. A terminal emulator does, and fterm already parses the iTerm2 notification
escape into a real Android notification. This plugin writes that escape at the moments you are
not looking at the screen.

```
$ opencode            # in fterm, on the phone
   ... work happens, you switch to another app ...
   [shade] terminal · done
```

## Install

```sh
opencode plugin add opencode-fterm-notify --global
```

Or by hand, in `~/.config/opencode/opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-fterm-notify"]
}
```

Local checkout instead:

```jsonc
{
  "plugins": ["./plugins/opencode-fterm-notify"]
}
```

OpenCode reloads plugins when the config changes; no restart needed.

## Requirements

- **fterm** on the same device, with a session running OpenCode. The escape sequence is only
  understood by fterm; any other terminal receives it as ordinary bytes and prints nothing,
  which is why the plugin checks before writing.
- Detected through `TERM_PROGRAM` (which fterm exports into its shells). If you run OpenCode
  inside `tmux`, over `ssh`, or in another multiplexer that drops the variable, set
  `FTERM_NOTIFY=1` yourself:

  ```sh
  FTERM_NOTIFY=1 opencode
  ```

## What triggers a notification

| Event | Message |
| --- | --- |
| `session.execution.succeeded` | `done` |
| `session.execution.failed` | `failed: <error>` |
| `session.execution.interrupted` | `interrupted` |
| `permission.asked` | `needs permission` |

Subagent sessions are skipped for the three execution events: their work reports through the
parent, and a parent with five subagents would otherwise buzz five times. `permission.asked` is
delivered for subagents too — the prompt blocks the work and appears in the parent's UI.

## Options

```jsonc
{
  "plugins": [
    {
      "package": "opencode-fterm-notify",
      "options": {
        "prefix": "opencode",
        "skipSubagents": true,
        "maxLength": 120
      }
    }
  ]
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `prefix` | `"terminal"` | Shown before the message: `terminal · done`. `""` sends the message alone. |
| `skipSubagents` | `true` | Skip execution notifications for subagent sessions. |
| `maxLength` | `120` | Longest message, in characters. Truncated with `…`. |

## Why a TUI part and a no-op server part

The notification is an escape sequence written to the terminal, so only the TUI process can
send it — the server may be shared by several clients or have no terminal at all. The package
still exposes a server part so that one entry in `plugins` loads both.

## Safety

The message is sanitised before it is framed: C0 controls, DEL, and the C1 range are replaced
with spaces, so text taken from a file name or an error message cannot smuggle a second escape
sequence into the stream or end the OSC early. Length is capped. Both are covered by tests.

## Development

```sh
npm test        # node --test test/
```

The plugin has no dependencies. `src/notify.js` holds the pure parts — detection, sanitising,
framing, and the event-to-sentence mapping — and is testable without OpenCode. `src/tui.js` is
the wiring, tested against a stand-in for the plugin context.

The writer is injected (`options.write`) rather than patched onto `process.stdout`: the test
reporter writes to the same stream, and replacing it silenced the whole file's output.

## Licence

MIT
