# AgentSitcom: Build Plan

*The Office: Agent Edition.* A low-poly 3D valley of AI companies, each staffed
by real Claude Code agents, that build your projects while you watch them walk
between desks, call meetings, and argue in speech bubbles.

Last revised: 2026-10-11.

## Vision

You are the founder of a valley. You found companies, hand each one a project
folder and a brief, and watch a cartoon office do the work. Companies never
know about each other. You step into any building to see what is happening,
read the CEO's briefing, and approve or reject work at gates.

Goals, in priority order:

1. **Real output.** Agents produce code, docs, and designs in your project
   folder. The office is a view of real work, not theater.
2. **Legible work.** Every meaningful agent action has a visible counterpart
   in the office. You can read the floor like a live log.
3. **Comedy with a spine.** Each role has a distinct personality, but
   personality never overrides the job.
4. **Runs on your Claude Code subscription.** No API keys, no pay-per-token
   billing. The orchestrator drives the unmodified `claude` binary in headless
   mode using your own `claude login`.
5. **Cost control.** Hard caps on turns and tokens per company, a small
   concurrency pool for the whole valley, and a model per agent that you pick.
6. **Runs locally.** One `pnpm dev` on your machine. No hosting in v1.
7. **Open-source template.** Nothing personal in the repo. Anyone can clone
   it, log in to Claude Code, and run their own valley.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Agent runtime | `claude -p` child processes, stream-json in and out | Uses your subscription through the official binary; the Agent SDK terms steer products toward API keys |
| Agent tools | A local MCP server owned by the orchestrator, passed via `--mcp-config` | Gives agents `create_task`, `send_message`, `handoff`, `call_meeting`, `request_approval`, `hire` as real tools |
| Permissions | `--allowedTools`, `--add-dir`, `--max-turns`, `--model` per process | Enforced by Claude Code itself, not by prompt |
| Client | Vite + Three.js + TypeScript | Fast to iterate, runs in any browser |
| Server | Node + TypeScript, `ws`, SQLite | Simple, local, replayable |
| Shared types | `zod` schemas in `packages/shared` | One event vocabulary for server, client, and tests |
| Visual style | Low-poly cartoon, primitives built in code | Cheap, funny at a distance, no asset pipeline |
| Roster | Small core cast per company, temporary hires on demand | Fewer live processes, less rate-limit burn |
| Your role | Founder of the valley, stakeholder in each company | Steer without micromanaging |
| Budget unit | Turns and tokens, with an estimated USD shown | Subscriptions have no dollar meter; estimates come from the CLI's result messages |

## The valley

The **Town** is the top level: one server, one client, one global scheduler.

A **Company** is a self-contained unit:

- its own folder under `workspaces/<company-slug>/` holding the project
  checkout on a git branch per run
- its own SQLite file under `data/<company-slug>.sqlite` (tasks, messages,
  events, spend)
- its own roster file, palette, sign, and office props
- its own agent sessions; every agent process is started with the company's
  identity baked into its system prompt and MCP server

Nothing in a company's prompts, tools, or database references another
company. Cross-talk is impossible by construction, not by politeness.

**Focus.** Your subscription is the valley's shared resource. The company you
are viewing runs at full priority. Backgrounded companies pause or get one
slot, depending on the town policy. Switching companies is a camera move to
another building plus a briefing from that CEO covering what happened since
you last looked.

## Your role: founder

**At town level**

- Found a company: pick a project folder, write a brief, choose a roster
  template and a style, set a turn budget and a priority.
- Allocate attention: choose the focused company, set the concurrency pool,
  set town policies ("Opus only in the focused company", "no work overnight").
- Walk the valley: each building glows with its status (working, blocked,
  waiting on you, done, out of budget). Click to enter.
- Read reports: a per-company briefing on entry, and a valley-wide morning
  report.

**Inside a company**

- You appear in the lobby as a visitor marker. The CEO is the only agent that
  talks to you, which is both the control model and the joke.
- You answer approval gates: after the plan, after the first working build,
  before shipping, and before merging to your real branch.
- You can comment, reject with notes, pause, resume, fire an agent (reset its
  session), and hit the panic button that stops all spending.

**What you do not do.** You do not assign tasks, write prompts, or talk to
engineers. If a company is stuck it goes blocked and the CEO rings the lobby
bell.

## Roster: core cast plus hires

Every role is a file in `packages/agents/roles/`. Each file has a short
**style block** (the comedic trait and voice) kept separate from the **job
block** (responsibilities, tools, and outputs), so comedy never leaks into
instructions.

**Core cast** (persistent, resumable sessions, one per company by default):

| Role | Trait | Job | Default model |
| --- | --- | --- | --- |
| CEO | Speaks only in buzzwords, loves all-hands | Turns the brief into goals, calls gates, reports to you | sonnet |
| Product Manager | Schedules a meeting for everything | Specs, user stories, task board owner, hiring | sonnet |
| Engineer | Hoodie, headphones, never speaks | Writes the code | opus |
| QA Tester | Finds a bug in every sentence | Runs tests, files bugs, blocks releases | sonnet |
| Designer | Rejects every color on principle | Wireframes, design tokens, component specs | sonnet |

**Hire templates** (temporary, one task, then they leave): backend engineer,
frontend engineer, marketing lead, legal counsel, HR manager, IT support,
intern. The CEO and PM get a `hire(role, task)` tool. A new character walks in
through the lobby, takes a floating desk, and leaves when done.

**NPC roles** (zero tokens, driven purely by events): the CFO walks the floor
when the budget meter crosses a threshold, IT jogs to the server closet on a
build failure and says "restart it", the receptionist greets hires. These are
characters without a model behind them.

**Contractors.** When an agent's Claude Code session spawns its own subagent,
the event stream shows it. The office renders a helper appearing beside the
parent's desk. No extra orchestration needed.

## Models per agent

Model is a per-role setting with three layers of override:

1. **Roster template** sets a default per role (table above).
2. **Company override** in the company config, for a throwaway experiment on
   haiku or a serious build on opus everywhere.
3. **Live override** from the UI. Click an agent, change the model, it applies
   on the next turn. Hires inherit their template unless set at hire time.

Each agent also has an effort level, a max-turns-per-task, and an optional
fallback model for when a rate limit hits. Name tags show a model badge. The
CFO's report breaks spend down by model.

**Subscription reality.** Session and weekly limits are shared across models
and across all companies. Opus burns the allowance fastest. The defaults are
2 to 3 live agent processes for the whole valley, idle agents have no process
at all, and idle banter is templated client-side and never calls a model.

## System architecture

```
browser (Three.js)  <-- WebSocket events --  server (Node)
                                                |
                                                |-- Town scheduler (concurrency pool, focus, policies)
                                                |-- Company[n]: task board, message log, spend meter, SQLite
                                                |       |
                                                |       |-- Agent runner: spawn `claude -p` per turn
                                                |       |       --output-format stream-json --input-format stream-json
                                                |       |       --mcp-config <orchestrator tools> --allowedTools ...
                                                |       |       --add-dir workspaces/<company> --model <per role>
                                                |       |       --append-system-prompt <role + company + task context>
                                                |       |       --resume <session id> for persistent roles
                                                |       |
                                                |       |-- MCP tool server (stdio): create_task, send_message,
                                                |               handoff, call_meeting, request_approval, hire,
                                                |               update_task, read_board
                                                |
                                                |-- Fake event generator (Phase 1 only)
```

The browser never talks to agents. It renders events from the server. Agents
touch only their company's workspace. Events are persisted, so replay is free.

**Turn loop.** Per company: pick the next role with work (an unblocked task or
an unread message), check the town pool for a free slot, start one agent turn
with its role prompt, task context, and recent messages, stream tool calls as
events, persist results, release the slot.

**Stakeholder gates.** The CEO calls `request_approval` after the plan, after
the first working build, before shipping, and before merge. The company pauses
until you approve, reject, or comment.

**Workspace safety.** Each run works on a git branch. Engineers and hires with
code roles get Read, Edit, Write, Glob, Grep scoped to the workspace. Shell
access is limited to QA and IT and scoped to the workspace. Legal, HR, and
marketing roles get read-only file tools.

## Events to visuals

One event type maps to one visible behavior.

| Event | What you see |
| --- | --- |
| `company_founded` | A new building rises on the valley map |
| `agent_spawned` | Character walks in through the lobby (core cast or hire) |
| `agent_retired` | Character walks out through the lobby |
| `task_started` | Agent walks to its desk and sits, typing animation starts |
| `tool_read_file` | Agent glances at a monitor; file name floats up |
| `tool_write_file` | Typing speeds up; paper stack grows on the desk |
| `tool_shell` | Terminal glow on the monitor; IT nods from the closet |
| `send_message` | Speech bubble over sender; if recipient is far, sender walks over |
| `handoff` | Agent carries a folder icon to the next owner's desk |
| `call_meeting` | Attendees walk to the meeting room; bubbles show the topic |
| `meeting_ended` | Attendees return to desks |
| `task_blocked` | Red exclamation; agent heads to the blocking role's desk |
| `task_done` | Short celebrate animation; whiteboard card turns green |
| `build_failed` | Alarm light in the server closet; incident sign resets; IT jogs over |
| `budget_warning` | CFO stands up and walks the floor with a calculator |
| `budget_exhausted` | Lights dim; everyone goes to the break room; building glows red |
| `request_approval` | CEO walks to the lobby and rings a bell; the valley map flags the building |
| `approval_resolved` | CEO walks back; bubble shows your verdict |
| `subagent_spawned` | Helper appears beside the parent's desk |
| `idle_timeout` | Agent drifts to the break room for coffee or gossip |
| `agent_model_changed` | Name tag badge flips |

## Stakeholder UI

A 2D overlay on the 3D canvas.

- **Valley map.** Buildings with status glow and company names. Click to
  enter. A notification tray lists every company waiting on you.
- **Found a company.** Folder, brief, roster template, style, turn budget,
  priority, and per-role model picks.
- **Company panel.** Phase, kanban board, spend versus cap, each agent's live
  status line and model badge.
- **Activity feed.** Chronological log of messages, handoffs, and file
  changes. Click an entry to jump the camera to the agent.
- **Approval modal.** Summary, diff of changed files, approve, reject, comment.
- **Controls.** Pause, resume, animation speed, change an agent's model, fire
  an agent, panic button.
- **Reports.** CEO briefing on entry; final report with what was built, how to
  run it, open bugs, and spend.

## 3D world

**Valley map.** A grid of plots. Each company is a building with a sign in its
palette. Camera orbits the valley; clicking a building zooms into its floor.

**Office floor.** One open-plan floor per company on a tile grid (40 by 30),
cut-away walls, adjustable isometric camera. Same floor plan for every company
in v1, differentiated by palette, sign, and props.

| Zone | Contents | Used for |
| --- | --- | --- |
| Lobby | Reception desk, plant, the founder's visitor marker, bell | Intake, approvals, hires arriving |
| Executive wing | CEO corner office, PM desk by the whiteboard | Strategy, planning |
| Dev pods | Desks, monitors, energy drinks | Coding |
| Design corner | Whiteboards, sticky notes | Design |
| Meeting room | Long table, projector, chairs | `call_meeting` |
| Break room | Coffee machine, vending machine, couch | Idle, gossip |
| Server closet | Blinking racks, one sad fan | Builds, IT |
| QA bench | Device wall, bug jar | Testing |
| Floating desks | Spare desks near the lobby | Hires |

**Characters.** Capsule-bodied figures from box, sphere, and cylinder
primitives, differentiated by color, accessory, name tag, and model badge.

**Animation states.** `idle`, `walk`, `sit_typing`, `talk`, `meeting`,
`blocked`, `celebrate`, `coffee`, `arrive`, `leave`. A small state machine per
character, driven only by events.

**Movement.** A* on the tile grid with furniture and walls as obstacles,
fixed walk speed, queueing at doors.

**Camera modes.** Valley, office overview, follow-agent, meeting cut-in.

**Props.** "Days without an incident" sign that resets on real build failures,
a whiteboard that fills with real task titles, a printer that jams on a timer,
one motivational poster per role.

## Repo structure

```
agentsitcom/
  apps/
    client/          Vite + Three.js + TypeScript (valley, office, overlay)
    server/          Node + TypeScript (town, companies, agent runner, MCP tools, WebSocket)
  packages/
    shared/          zod schemas: events, tasks, messages, company, roster
    agents/          roles/*.md (style + job blocks), rosters/*.json (templates)
  workspaces/        One folder per company (gitignored)
  data/              One SQLite file per company (gitignored)
  docs/              This plan, decisions log, role prompt guide
```

### Data model

| Model | Key fields |
| --- | --- |
| Town | id, policies, pool_size, focused_company_id |
| Company | id, slug, name, brief, workspace_path, roster_template, palette, budget (turns, tokens), spent, priority, phase |
| Agent | id, company_id, role, kind (core, hire, npc), model, effort, status, current_task_id, location, session_id |
| Task | id, company_id, title, owner_role, status, depends_on[], files[], created_by |
| Message | id, company_id, from, to, text, task_id, timestamp |
| Event | id, company_id, type, agent_id, payload, timestamp |
| Approval | id, company_id, summary, status, founder_comment |

Every record carries a company id from day one.

## Build phases and gates

Do not start a phase until the previous gate passes.

| Phase | Build | Gate |
| --- | --- | --- |
| 0 Spike (done) | One script spawns one headless `claude` process with the orchestrator MCP server, a restricted tool list, and a cheap model; it calls a custom tool and streams events to the console | You see a `send_message` tool call arrive from a real agent, usage numbers in the result, and the process exits at `--max-turns` |
| 1 Valley (done) | pnpm monorepo, shared schemas, valley map with buildings, office floor, primitive characters, A*, animation state machine, overlay with company switcher and feed, fake event generator over WebSocket for two or more fake companies | Switching companies works; every event in the table above triggers its animation; no agent walks through walls; camera modes switch cleanly |
| 2 First agents (done) | Companies founded from `companies/<slug>/company.md`, JSON record per company, task board, turn scheduler with a pool, CEO kickoff, inboxes, real board reads through the MCP tool | You drop a file, the CEO creates tasks, the PM assigns them, the board and office agree, the run stops at its turn cap |
| 3 Full cast (mostly done) | Core cast and hire templates, handoffs, meetings, contractors from subagents, workspace on a git branch, per-role models and overrides | A toy app is built, tested by QA, and runs locally (done: a to-do app with spec, design tokens and a QA bug loop); a read-only role is stopped from writing code; a hire arrives, works, and leaves (not yet exercised) |
| 4 Founder (in progress) | Approval gates, founder inbox and replies, spend meter, hard caps, budget top-up from the file, NPC CFO and IT, focus and pool, pause and panic, `status.md` and `conversation.md` next to each company | Two companies run; the run halts at the cap (done); each gate pauses all agents until you act; rejecting with a comment triggers rework; focus switch changes which company gets slots |
| 5 Polish | Props, idle banter templates, event replay, reports, optional sound | Replaying a finished run matches the original; your real project completes with a final report |

## Risks

| Risk | Mitigation |
| --- | --- |
| Rate limits exhausted by fan-out | Small pool, idle agents have no process, cheap models for chatter, templated banter, Opus limited by policy |
| Agents loop or talk in circles | Max turns per task, PM-enforced handoff rules, loop detection on repeated messages |
| Agents damage the project folder | Git branch per run, scoped file permissions, approval before merge |
| 3D and agent work drift | Single typed event stream; the client renders only what events say |
| Comedy undermines output | Style block kept separate and short |
| Terms of use | Personal use of your own login through the unmodified binary only; the app never reads, stores, or proxies credentials; anyone who forks it logs in themselves |

## Open-source hygiene

- No personal paths, emails, or tokens in the repo. Workspaces, databases,
  logs, and local config are gitignored.
- The app never touches credentials. Users run `claude login` once; the
  orchestrator just spawns the binary.
- Roles and rosters are plain files so forks can add their own cast.
- Commits use a GitHub no-reply address.
