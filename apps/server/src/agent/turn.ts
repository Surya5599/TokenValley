import { join } from "node:path";
import { ROLE_LABEL, type Agent, type Company, type Event, type RoleId, type Spend, type Task } from "@agentsitcom/shared";
import type { Town } from "../town.js";
import { loadPersona, loadRole, REPO_ROOT } from "../roles.js";
import { ClaudeRunner } from "./claude-runner.js";
import type { CompanyRecord, CompanyRegistry } from "../company/registry.js";

/**
 * One real agent turn. Builds the prompt from the role file and company
 * context, spawns the Claude Code binary scoped to the company workspace, and
 * translates every tool_use in the stream into office events.
 */

const MCP_ENTRY = join(REPO_ROOT, "apps", "server", "src", "mcp", "server.ts");
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

export type TurnOptions = {
  town: Town;
  registry: CompanyRegistry;
  record: CompanyRecord;
  agent: Agent;
  prompt: string;
  maxTurns?: number;
};

function ev(town: Town, companyId: string) {
  return { id: town.nextId("ev"), companyId, timestamp: Date.now() };
}

function agentByRole(record: CompanyRecord, role: string): Agent | undefined {
  return record.agents.find((a) => a.role === role && a.status !== "retired");
}

function systemPrompt(company: Company, agent: Agent, record: CompanyRecord): string {
  const def = loadPersona(company.slug, agent.role);
  const colleagues = record.agents
    .filter((a) => a.id !== agent.id && a.kind !== "npc" && a.status !== "retired")
    .map((a) => `- ${a.role}: ${a.name}`)
    .join("\n");
  const board = record.tasks.length
    ? record.tasks.map((t) => `- [${t.status}] ${t.id} ${t.title} (owner: ${t.ownerRole ?? "none"})`).join("\n")
    : "- (empty)";
  return [
    `You are the ${ROLE_LABEL[agent.role]} at ${company.name}, a company in AgentSitcom.`,
    `Your name is ${agent.name}. The company is in charge of the project folder at: ${company.workspacePath}`,
    ``,
    `## Company brief`,
    company.brief,
    ``,
    `## Style`,
    def.style,
    ``,
    `## Job`,
    def.job,
    ``,
    `## Colleagues (address them by role)`,
    colleagues || "- (none yet)",
    `- founder: the person who founded the company. Only the CEO may message the founder.`,
    ``,
    `## Task board`,
    board,
    ``,
    `## Channels`,
    `- #general: the whole company reads it. Post there for announcements, questions for the room, and banter.`,
    ...record.channels.filter((c) => c.memberIds.includes(agent.id) && c.open).map((c) => `- #${c.channel}: ${c.title} (${c.memberIds.length} people). Post there to take part.`),
    ``,
    `## Rules`,
    `- Use the agentsitcom tools to talk to colleagues and manage tasks. Keep messages short.`,
    `- send_message is private, post is public. Prefer post when more than one person should hear it. Stay in character; disagree out loud when you disagree.`,
    `- Stay inside the project folder. Never reference other companies; there are none you know of.`,
    `- Budget: ${company.spend.turns}/${company.budget.maxTurns} turns used. Be economical.`,
  ].join("\n");
}

/** Maps a tool_use block to zero or more events and state changes. */
function translate(opts: TurnOptions, name: string, input: Record<string, unknown>): void {
  const { town, record, agent } = opts;
  const cid = record.company.id;
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");

  if (name.startsWith("mcp__agentsitcom__")) {
    const tool = name.slice("mcp__agentsitcom__".length);
    switch (tool) {
      case "send_message": {
        const toRole = str("to").toLowerCase();
        const toAgent = toRole === "founder" ? null : agentByRole(record, toRole);
        const toId = toRole === "founder" ? "founder" : toAgent?.id ?? toRole;
        town.emit({
          ...ev(town, cid), type: "send_message", agentId: agent.id, toAgentId: toId,
          message: { id: town.nextId("msg"), companyId: cid, from: agent.id, to: toId, text: str("text"), taskId: agent.currentTaskId, timestamp: Date.now() },
        });
        break;
      }
      case "post": {
        const channel = str("channel").replace(/^#/, "").trim().toLowerCase() || "general";
        const known = channel === "general" || record.channels.some((c) => c.channel === channel && c.memberIds.includes(agent.id));
        if (!known) break;
        town.emit({
          ...ev(town, cid), type: "post_message", agentId: agent.id,
          post: { id: town.nextId("post"), companyId: cid, channel, from: agent.id, text: str("text"), timestamp: Date.now() },
        });
        break;
      }
      case "create_task": {
        const ownerRole = str("owner_role").toLowerCase();
        const owner = ownerRole ? agentByRole(record, ownerRole) : undefined;
        const task: Task = {
          id: town.nextId("task"), companyId: cid, title: str("title"),
          ownerRole: (owner?.role ?? (ownerRole as RoleId)) || null, ownerAgentId: owner?.id ?? null,
          status: "backlog", dependsOn: Array.isArray(input.depends_on) ? (input.depends_on as string[]) : [], files: [], createdBy: agent.id,
        };
        record.tasks.push(task);
        town.emit({ ...ev(town, cid), type: "task_created", task });
        if (record.company.phase === "shipped") town.emit({ ...ev(town, cid), type: "company_phase", phase: "building" });
        break;
      }
      case "update_task": {
        const t = record.tasks.find((x) => x.id === str("task_id"));
        if (!t) break;
        if (typeof input.status === "string") t.status = input.status as Task["status"];
        if (Array.isArray(input.files)) t.files = [...new Set([...t.files, ...(input.files as string[])])];
        if (t.status === "done") town.emit({ ...ev(town, cid), type: "task_done", agentId: agent.id, taskId: t.id });
        else town.emit({ ...ev(town, cid), type: "task_updated", task: t });
        break;
      }
      case "handoff": {
        const to = agentByRole(record, str("to_role").toLowerCase());
        const t = record.tasks.find((x) => x.id === str("task_id"));
        if (!to) break;
        town.emit({ ...ev(town, cid), type: "handoff", agentId: agent.id, taskId: str("task_id"), toAgentId: to.id, note: str("note") });
        if (t) {
          t.ownerAgentId = to.id; t.ownerRole = to.role;
          town.emit({ ...ev(town, cid), type: "task_updated", task: t });
        }
        break;
      }
      case "call_meeting": {
        const roles = Array.isArray(input.attendees) ? (input.attendees as string[]) : [];
        const ids = roles.map((r) => agentByRole(record, r.toLowerCase())?.id).filter((x): x is string => !!x);
        const meetingId = town.nextId("mt");
        const memberIds = [...new Set([agent.id, ...ids])];
        const channel = `meeting-${record.channels.length + 1}`;
        record.channels.push({ channel, title: str("topic"), memberIds, open: true });
        town.emit({ ...ev(town, cid), type: "channel_opened", channel, title: str("topic"), memberIds });
        town.emit({ ...ev(town, cid), type: "call_meeting", agentId: agent.id, meetingId, attendeeIds: memberIds, topic: str("topic") });
        // The room stays open for the thread; the characters leave the table after a while.
        setTimeout(() => town.emit({ ...ev(town, cid), type: "meeting_ended", meetingId }), 90_000);
        break;
      }
      case "request_approval": {
        town.emit({
          ...ev(town, cid), type: "request_approval", agentId: agent.id,
          approval: { id: town.nextId("ap"), companyId: cid, kind: (["plan", "build", "ship"].includes(str("kind")) ? str("kind") : "plan") as "plan" | "build" | "ship", summary: str("summary"), status: "pending", founderComment: null },
        });
        break;
      }
      case "hire": {
        // Phase 3 spawns a real hire. For now the hire is recorded as an idle agent so the office shows them arriving.
        const role = str("role") as RoleId;
        const def = loadRole(role);
        const hire: Agent = {
          id: town.nextId("ag"), companyId: cid, role, kind: "hire", name: `New hire (${ROLE_LABEL[role]})`,
          model: (input.model as Agent["model"]) ?? def.model, effort: def.effort, status: "idle", currentTaskId: null, home: def.home, parentAgentId: null,
          style: def.style, job: def.job,
        };
        record.agents.push(hire);
        town.emit({ ...ev(town, cid), type: "agent_spawned", agentId: hire.id, agent: hire });
        const task: Task = {
          id: town.nextId("task"), companyId: cid, title: str("task").slice(0, 120), ownerRole: role, ownerAgentId: hire.id,
          status: "backlog", dependsOn: [], files: [], createdBy: agent.id,
        };
        record.tasks.push(task);
        town.emit({ ...ev(town, cid), type: "task_created", task });
        break;
      }
      default:
        break;
    }
    return;
  }

  switch (name) {
    case "Read": case "Glob": case "Grep":
      town.emit({ ...ev(town, cid), type: "tool_read_file", agentId: agent.id, path: str("file_path") || str("pattern") || str("path") });
      break;
    case "Edit": case "Write": case "MultiEdit": case "NotebookEdit":
      town.emit({ ...ev(town, cid), type: "tool_write_file", agentId: agent.id, path: str("file_path") || str("notebook_path") });
      break;
    case "Bash":
      town.emit({ ...ev(town, cid), type: "tool_shell", agentId: agent.id, command: str("command").slice(0, 120) });
      break;
    case "Task": case "Agent": {
      const contractor: Agent = {
        id: town.nextId("ctr"), companyId: cid, role: "intern", kind: "contractor", name: "Subagent", model: null, effort: "low",
        status: "working", currentTaskId: agent.currentTaskId, home: agent.home, parentAgentId: agent.id, style: "", job: "",
      };
      town.emit({ ...ev(town, cid), type: "subagent_spawned", agentId: agent.id, contractor });
      break;
    }
    default:
      break;
  }
}

export async function runAgentTurn(opts: TurnOptions): Promise<void> {
  const { town, registry, record, agent } = opts;
  const company = record.company;
  const cid = company.id;
  if (!agent.model) throw new Error(`${agent.role} is an NPC and has no model`);
  if (company.spend.turns >= company.budget.maxTurns) {
    town.emit({ ...ev(town, cid), type: "budget_exhausted", spend: company.spend, budget: company.budget });
    return;
  }

  const def = loadRole(agent.role);
  const runner = new ClaudeRunner();
  const dataDir = join(REPO_ROOT, "data");

  town.emit({ ...ev(town, cid), type: "agent_status", agentId: agent.id, status: "working", line: "thinking" });
  registry.save(record); // so read_board sees the latest board
  runner.on("tool_use", (t) => translate(opts, t.name, t.input));
  runner.on("stderr", (s) => process.stderr.write(`[${company.slug}/${agent.role}] ${s}`));

  const result = await runner.run({
    model: agent.model,
    maxTurns: opts.maxTurns ?? 12,
    cwd: company.workspacePath,
    addDirs: [company.workspacePath],
    tempDir: dataDir,
    allowedTools: def.tools,
    systemPrompt: systemPrompt(company, agent, record),
    prompt: opts.prompt,
    resumeSessionId: record.sessions[agent.id],
    mcpServers: {
      agentsitcom: {
        command: NPX,
        args: ["tsx", MCP_ENTRY],
        env: {
          AGENTSITCOM_COMPANY: company.slug,
          AGENTSITCOM_AGENT: agent.role,
          AGENTSITCOM_TOOL_LOG: join(dataDir, `tools-${company.slug}.jsonl`),
          AGENTSITCOM_BOARD_FILE: registry.fileFor(company.slug),
        },
      },
    },
  });

  if (result.sessionId) record.sessions[agent.id] = result.sessionId;

  const spend: Spend = {
    turns: company.spend.turns + 1, // one agent turn, however many steps the CLI took inside it
    // Cache reads are cheap and would dwarf everything else, so they are not counted against the cap.
    inputTokens: company.spend.inputTokens + (result.usage.input_tokens ?? 0) + (result.usage.cache_creation_input_tokens ?? 0),
    outputTokens: company.spend.outputTokens + (result.usage.output_tokens ?? 0),
    estimatedUsd: +(company.spend.estimatedUsd + result.totalCostUsd).toFixed(4),
  };
  const ratio = Math.max(spend.turns / company.budget.maxTurns, (spend.inputTokens + spend.outputTokens) / company.budget.maxTokens);
  const prevRatio = Math.max(company.spend.turns / company.budget.maxTurns, (company.spend.inputTokens + company.spend.outputTokens) / company.budget.maxTokens);
  if (ratio >= 1) town.emit({ ...ev(town, cid), type: "budget_exhausted", spend, budget: company.budget });
  else if (ratio >= 0.8 && prevRatio < 0.8) town.emit({ ...ev(town, cid), type: "budget_warning", spend, budget: company.budget });
  else town.emit({ ...ev(town, cid), type: "spend_updated", spend });

  const line = result.isError ? `error: ${result.finalText.slice(0, 80) || "turn failed"}` : (result.finalText.slice(0, 80) || "done");
  town.emit({ ...ev(town, cid), type: "agent_status", agentId: agent.id, status: "idle", line });

  // Persist the company's own slice of the event log.
  record.events = town.events.filter((e: Event) => e.companyId === cid);
  registry.save(record);
}
