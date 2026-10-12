# Decisions log

Short records of choices that are not obvious from the code.

## 2026-10-11: Claude Code CLI instead of the Agent SDK

The orchestrator spawns the unmodified `claude` binary in headless mode
(`-p --output-format stream-json`) rather than using the Agent SDK. Both can
use a subscription login, but Anthropic's terms steer SDK products toward API
keys, and a plain subprocess of the official binary is the clearest case of
"an end user signing in to the unmodified Claude Code binary with their own
subscription". The app never touches credentials. Anyone who forks this to
offer it to others must switch to API-key billing.

## 2026-10-11: Budget in turns and tokens, not dollars

Subscriptions have no dollar meter. The CLI result message carries a usage
estimate and an estimated USD figure, which the CFO displays, but hard caps
are enforced on turns and tokens. The real constraint is the session and
weekly rate limit, which is shared across all companies and models.

## 2026-10-11: Small core cast plus hires

Five persistent roles per company instead of thirteen. Extra roles are hire
templates spawned for one task, and some roles (CFO, receptionist) are NPCs
with no model behind them. Fewer live processes means less rate-limit burn and
a cheaper idle state: an idle agent has no process at all.

## 2026-10-11: Companies share one subscription, so the town has a pool

Companies are isolated in prompts, tools, and data, but not in compute. The
town runs a small pool of live agent slots and the focused company gets
priority. This is why "focus" is a first-class concept rather than a camera
setting.

## 2026-10-11: Tool calls are observed from the stream, not reported by the tool server

The MCP tool server validates and acknowledges calls. The orchestrator reads
every `tool_use` block from the agent's stream-json output and treats that as
the canonical event source. This keeps the tool server stateless per process
and makes replay trivial: the stream is the log.
