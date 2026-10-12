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
budget_turns: 100
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
companies stay private. The status of each company is written back to
`status.md` next to its `company.md` so you can read it without the UI.
