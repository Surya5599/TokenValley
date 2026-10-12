# @tokenvalley/agents

Plain files that define who works in a TokenValley company.

- `roles/<role>.md`: one file per role. Two sections, kept apart on purpose:
  - **Style** is the comedic trait and voice. Short. It shapes tone and idle
    behaviour, never the work.
  - **Job** is the real responsibility, the tools the role may use, and what
    it produces.
  The front matter carries defaults: `model`, `effort`, `kind`
  (`core`, `hire`, `npc`), `tools` (Claude Code tool allow-list), and `home`
  (a spot id from `@tokenvalley/shared`).
- `rosters/<template>.json`: which roles a company starts with, which roles it
  may hire, and per-company model overrides.

Forks can add roles and rosters without touching code. A role that is `npc`
has no model behind it; the office animates it from events only.
