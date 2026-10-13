# auto-model

A Claude Code plugin that reads each prompt, decides whether it is trivial, everyday or hard work, and runs that turn on Haiku, Sonnet or Opus.

- Trivial lookups, renames and small edits go to **Haiku**.
- Everyday features, bug fixes and tests go to **Sonnet**.
- Architecture, subtle bugs, security and big migrations go to **Opus**.
- Short follow-ups such as "yes" keep the previous turn's model.
- Subagents keep the model they were started with.

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

- Each new prompt makes one small Haiku call to classify it.
- Model names are pinned in `hooks/classify.ts` (`MODEL_IDS`). Update them when a new model generation ships.
- Tests: `claude plugin test .`
