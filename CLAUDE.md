# AgentSitcom

pnpm monorepo. Read `docs/PLAN.md` before changing architecture; it is the
source of truth for phases, gates, and the event vocabulary.

## Layout

- `packages/shared`: zod schemas for events, tasks, companies, the WebSocket
  protocol, and the office layout constants. Change types here first.
- `packages/agents`: role files (`roles/*.md`, style block + job block) and
  roster templates (`rosters/*.json`). Plain files, no code.
- `apps/server`: Node + TypeScript. `town.ts` state, `fake/` the Phase 1 event
  generator, `agent/claude-runner.ts` the only place that spawns `claude`,
  `mcp/server.ts` the tool server agents attach to, `spike/` the Phase 0 proof.
- `apps/client`: Vite + Three.js. Renders events only; never talks to agents.

## Commands

- `pnpm dev` runs server and client. `pnpm typecheck` across all packages.
- `pnpm spike` runs one real headless agent turn on your subscription (haiku,
  3 turns). Needs `claude login` first.

## Rules

- The client renders only what events say. Add an event type to
  `packages/shared` before adding a visual.
- Every record carries a `companyId`. Nothing may reference another company.
- Agents run only through `claude-runner.ts`. Never read or store credentials.
- No personal paths, emails, or tokens in committed files. `workspaces/` and
  `data/` are gitignored runtime state.
- Comedy lives in the style block of a role file, never in job instructions.
- Do not add dependencies without saying so in the PR or commit message.
- Do not start a phase before the previous gate in `docs/PLAN.md` passes.
