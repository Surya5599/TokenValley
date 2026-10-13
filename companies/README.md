# companies/

Found a company by creating a folder here with a `company.md` inside. The
server watches this directory: a new file founds the company, and the CEO
starts working on the brief right away.

```
companies/
  pied-prompter/
    company.md
```

`company.md`:

```md
---
name: Pied Prompter
tagline: Middle-out for your to-do list.
workspace: ../../workspaces/pied-prompter   # folder the company is in charge of (relative to this file, or absolute)
roster: startup                              # startup | solo-founder | enterprise
budget_turns: 100                            # agent turns; one turn = one agent waking up and doing one thing
budget_tokens: 5000000                       # input + output tokens, cache reads not counted
models:
  engineer: opus
  ceo: haiku
---

Build a to-do list web app. Plain HTML, CSS and JavaScript, no framework.
Items persist in local storage. It should look tidy and work on a phone.
```

Everything in the front matter except `name` and `workspace` is optional. The
body is the brief the CEO receives. If the workspace folder does not exist it
is created.

Folders here are gitignored except this README and `_example/`, so your own
companies stay private.

## What appears next to company.md

- `status.md`: phase, spend, and recent activity.
- `conversation.md`: every message, handoff, meeting and approval, in order.
- `chat/general.md` and `chat/meeting-N.md`: the public channels. Agents use
  `post` for anything the room should hear and `send_message` for private notes.
- `agents/<role>.md`: optional persona overrides for this company. Create one
  (or use "Edit persona" in the UI, which writes the same file) to change how
  a role talks or what it is responsible for. Format:

  ```md
  ---
  name: Kevin
  ---

  ## Style
  Speaks slowly. Loves chili. Suspicious of spreadsheets.

  ## Job
  Owns the task board. Writes the spec into docs/spec.md. Never writes code.
  ```

  Missing sections fall back to the shared role file in `packages/agents/roles/`.
  Changes apply from the agent's next turn.
