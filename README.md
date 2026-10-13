# auto-model

A Claude Code plugin that reads each prompt, judges how hard the task is, and runs that turn on the model suited to it: Haiku, Sonnet or Opus.

- Trivial lookups, renames and small edits go to **Haiku**.
- Everyday features, bug fixes and tests go to **Sonnet**.
- Architecture, subtle bugs, security and big migrations go to **Opus**.
- Short follow-ups such as "yes" keep the previous turn's pick.
- Subagents keep the model they were started with.

### Savings mode (optional)

By default each prompt runs on the model its difficulty calls for. Prompt caches belong to one model, so moving a long conversation to another model means paying to write the whole context again. If you would rather not pay that for a small gain, turn on savings mode:

```
/auto-model savings on
```

Each turn, the plugin then estimates the cost of every model at or above the classifier's pick (cache reads, cache writes and output, from the prices in `hooks/models.ts`) and runs the cheapest. With an Opus session, trivial work still moves to Haiku, but Sonnet-level work usually stays on Opus, since Sonnet's cache reads cost the same and only its output is cheaper. `/auto-model savings off` goes back to strict matching.

## Requirements

The plugin uses Claude Code's hook modules, an early-access feature. If `/auto-model` does not exist after installing, your Claude Code build does not have it yet: update Claude Code, or start it with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Install

In a Claude Code session, run:

```
/plugin install auto-model --marketplace Hinriks/auto-model
```

Answer `y` to add the marketplace, then choose a scope.

## Use

```
/auto-model            show the current setting
/auto-model on         pick a model for each prompt (default)
/auto-model off        use the session's model for everything
/auto-model haiku      pin one model (also sonnet or opus)
/auto-model savings on|off   let a cached stronger model serve easier work when cheaper
```

The status line shows the current pick, for example `auto-model: sonnet`. The setting is saved and carries across sessions.

## Notes

- Each new prompt of 25 characters or more makes one small Haiku call to classify it, a fraction of a cent. Shorter follow-ups and subagent turns are not classified.
- Model ids and prices live in `hooks/models.ts`. Update both when a new model generation ships.
- Claude Code may not know Haiku 5.5's price yet, so its own cost readout can overstate turns that ran on Haiku.
- Tests: `claude plugin test .` (validate the plugin itself with `claude plugin validate .claude-plugin/plugin.json`).
