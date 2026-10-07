# hud

A heads-up display for Claude Code, drawn as a band above the prompt. It is a rebuild of [claude-hud](https://github.com/jarrodwatts/claude-hud) as a Claude Code mod: it reads session data from the engine directly, so there is no statusLine script and no transcript parsing.

```
[Opus 5.5] │ my-app git:(main*)
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h) │ Weekly ████░░░░░░ 40% (3d 4h / 7d)
◐ explore [haiku]: Finding auth code (2m 15s)
▸ Fix authentication bug (2/5)
```

- **Session line:** the model, the project folder, and the git branch (with `*` when the working tree has changes).
- **Usage line:** a context bar (green, then yellow from 70%, then red from 85%), plus the 5-hour and weekly rate limits with the time until each resets.
- **Agents line:** the running subagents, with their type, model, description and elapsed time. It shows only while subagents run.
- **Todos line:** the todo in progress and the overall progress. It shows only when there are todos.

To collapse the band, press `ctrl+x ctrl+a` or select `[-]`.

## Install

In a Claude Code terminal session, run:

```
/plugin install hud --marketplace mboisvertdupras/hud
```

Answer `y` to add the marketplace, then choose a scope.

If you use claude-hud, disable it and remove its `statusLine` entry from `~/.claude/settings.json`. Otherwise both HUDs show.

## Develop

```
claude --plugin-dir /path/to/hud
claude plugin validate /path/to/hud
claude plugin test /path/to/hud
```

## Credits

The layout, symbols and color thresholds follow [claude-hud](https://github.com/jarrodwatts/claude-hud) by Jarrod Watts (MIT).

## License

MIT
