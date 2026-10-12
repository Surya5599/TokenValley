# TokenValley

*The Office: Agent Edition.*

A low-poly 3D valley of AI companies. Each company is staffed by real Claude
Code agents that build your project in a folder on your machine, while a
cartoon office shows them walking between desks, calling meetings, and arguing
in speech bubbles. You are the founder: you found companies, hand each one a
brief, watch, and approve or reject at gates.

Runs on your own Claude Code subscription. No API keys.

## Status

Early. See [docs/PLAN.md](docs/PLAN.md) for the full plan and phase gates.

| Phase | State |
| --- | --- |
| 0 Spike: headless `claude` + orchestrator tool server | Done |
| 1 Valley: 3D office, characters, pathfinding, fake events | In progress |
| 2 First real agents (CEO, PM) | Not started |
| 3 Full cast, hires, workspace on a branch | Not started |
| 4 Founder controls, gates, budgets | Not started |
| 5 Polish, replay, reports | Not started |

## Requirements

- Node 20 or newer, pnpm 10
- [Claude Code](https://code.claude.com) installed and logged in (`claude login`)
  with a Pro or Max plan

## Run it

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. The server runs at ws://localhost:8787 with a fake
event generator until Phase 2 lands. Add `?demo=1` to the client URL to run it
without a server.

To prove the agent runtime chain on your machine (uses your subscription,
capped at 3 turns on haiku):

```bash
pnpm spike
```

## How it works

- `apps/server` spawns the unmodified `claude` binary in headless mode, one
  process per agent turn, with a restricted tool list, a model per role, and a
  local MCP server that gives agents company tools (`send_message`,
  `create_task`, `handoff`, `call_meeting`, `request_approval`, `hire`).
- Every agent action becomes a typed event. `apps/client` renders only those
  events, so the office is a faithful view of real work.
- `packages/agents` holds the cast as plain files: a short style block for
  comedy and a job block for the actual responsibility, kept apart.
- Companies never share prompts, tools, or state. Your subscription is the
  shared resource, so the valley runs a small pool of live agents and you
  choose which company is in focus.

## Subscription and terms

This tool runs the official Claude Code binary with your own login, for your
own use. It never reads, stores, or proxies credentials. If you fork it to
offer to other people, Anthropic's terms require API-key billing instead. See
the "Risks" section of the plan.

## License

MIT.
