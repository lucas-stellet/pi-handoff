# pi-handoff

A simple Pi extension for handing off work to a fresh session before the current context gets too large.

## Install

From GitHub:

```bash
pi install https://github.com/lucas-stellet/pi-handoff
```

To try without installing:

```bash
pi -e https://github.com/lucas-stellet/pi-handoff
```

## Command

```text
/handoff [next-session focus]
```

The command:

1. Reads the current session's user and assistant text.
2. Generates a concise Markdown handoff.
3. Saves it under `.handoff/<session-name-or-id>.md` in the current project.
4. Starts a new Pi session with `parentSession` set to the previous session and keeps the current model and thinking level selected.
5. Inserts a short continuation prompt that references the saved handoff file instead of pasting the whole handoff into the editor.

If arguments are provided, they are treated as the focus for the next session.

## Continuation prompt

The new session editor is populated with:

```text
This session continues from a previous Pi session. Read `<handoff_file>`, continue from where the last agent stopped, and ask the user if anything is unclear.
```

## Development

```bash
npm test
```
