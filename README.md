# auto-model

A Claude Code plugin that reads each prompt, decides whether it is trivial, everyday or hard work, and runs that turn on Haiku, Sonnet or Opus.

- Trivial lookups, renames and small edits go to **Haiku**.
- Everyday features, bug fixes and tests go to **Sonnet**.
- Architecture, subtle bugs, security and big migrations go to **Opus**.
- Short follow-ups such as "yes" keep the previous turn's pick.
- Subagents keep the model they were started with.

### It only switches when switching is cheaper

The classifier's pick is a quality floor, not an order. Prompt caches belong to one model, so moving a long conversation to a model with a cold cache means paying to write the whole context again. For each turn the plugin estimates the cost of every model at or above the pick (cache reads, cache writes and output, from the prices in `hooks/models.ts`) and runs the cheapest.

In practice, with an Opus session:

- Trivial work moves to Haiku: even a cold Haiku cache costs about the same as reading Opus's warm one, and its output is far cheaper.
- Sonnet-level work usually stays on Opus. Sonnet's cache reads cost the same as Opus's, so once the Opus cache is warm, rewriting the context for Sonnet costs more than Sonnet saves on output.

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
```

The status line shows the current pick, for example `auto-model: sonnet`. The setting is saved and carries across sessions.

## Notes

- Each new prompt of 25 characters or more makes one small Haiku call to classify it, a fraction of a cent. Shorter follow-ups and subagent turns are not classified.
- Model ids and prices live in `hooks/models.ts`. Update both when a new model generation ships.
- Claude Code may not know Haiku 5.5's price yet, so its own cost readout can overstate turns that ran on Haiku.
- Tests: `claude plugin test .` (validate the plugin itself with `claude plugin validate .claude-plugin/plugin.json`).
