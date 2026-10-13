import { WebSocketServer, type WebSocket } from "ws";
import { ClientMessage, type Approval, type Event, type FoundCompanyInput } from "@tokenvalley/shared";
import { join } from "node:path";
import { Town } from "./town.js";
import { FakeGenerator } from "./fake/generator.js";
import { CompanyRegistry, type CompanyRecord } from "./company/registry.js";
import { foundCompany } from "./company/founder.js";
import { updateCompanyFileBudget, watchCompanyFiles, writeConversationFile, writeStatusFile } from "./company/files.js";
import { runAgentTurn } from "./agent/turn.js";
import { Scheduler } from "./scheduler.js";
import { REPO_ROOT, savePersona } from "./roles.js";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const PORT = Number(process.env.TOKENVALLEY_PORT ?? 8787);
/** "fake" adds three demo companies driven by templates. "live" shows only real companies. */
const MODE = process.env.TOKENVALLEY_MODE ?? "fake";

const town = new Town();
const registry = new CompanyRegistry(join(REPO_ROOT, "data"));
const records = new Map<string, CompanyRecord>();
const pendingApprovals = new Map<string, Approval>();
const scheduler = new Scheduler(town, registry, records);
const wss = new WebSocketServer({ port: PORT });

// Restore live companies founded in earlier runs.
for (const rec of registry.list()) {
  records.set(rec.company.id, rec);
  town.companies.set(rec.company.id, rec.company);
  for (const a of rec.agents) {
    if (a.status === "working" || a.status === "talking" || a.status === "meeting") a.status = "idle";
    town.agents.set(a.id, a);
  }
  for (const t of rec.tasks) town.tasks.set(t.id, t);
  town.events.push(...rec.events.slice(-200));
  if (!town.focusedCompanyId) town.focusedCompanyId = rec.company.id;
}
if (records.size) console.log(`[tokenvalley] restored ${records.size} live compan${records.size === 1 ? "y" : "ies"}`);

const ev = (companyId: string) => ({ id: town.nextId("ev"), companyId, timestamp: Date.now() });

function describe(e: Event): string {
  const name = (id: string) => (id === "founder" ? "founder" : town.agents.get(id)?.name ?? id);
  switch (e.type) {
    case "send_message": return `${name(e.agentId)} to ${name(e.toAgentId)}: ${e.message.text}`;
    case "task_created": return `task created: ${e.task.title}`;
    case "task_started": return `${name(e.agentId)} started: ${e.task.title}`;
    case "task_done": return `${name(e.agentId)} finished task ${e.taskId}`;
    case "handoff": return `${name(e.agentId)} handed ${e.taskId} to ${name(e.toAgentId)}: ${e.note}`;
    case "call_meeting": return `${name(e.agentId)} called a meeting: ${e.topic}`;
    case "request_approval": return `CEO requests approval: ${e.approval.summary}`;
    case "approval_resolved": return `founder ${e.approval.status}: ${e.approval.founderComment ?? ""}`;
    case "tool_write_file": return `${name(e.agentId)} wrote ${e.path}`;
    case "agent_spawned": return `${e.agent.name} joined`;
    case "agent_retired": return `${name(e.agentId)} left`;
    case "budget_warning": return `budget warning: ${e.spend.turns}/${e.budget.maxTurns} turns`;
    case "budget_exhausted": return `budget exhausted`;
    default: return "";
  }
}

function writeChatFiles(rec: CompanyRecord): void {
  const dir = join(REPO_ROOT, "companies", rec.company.slug, "chat");
  if (!existsSync(join(dir, ".."))) return;
  mkdirSync(dir, { recursive: true });
  const name = (id: string) => (id === "founder" ? "Founder" : town.agents.get(id)?.name ?? id);
  const stamp = (t: number) => new Date(t).toISOString().slice(11, 19);
  const posts = town.events.filter((x): x is Extract<Event, { type: "post_message" }> => x.type === "post_message" && x.companyId === rec.company.id);
  const channels = ["general", ...rec.channels.map((c) => c.channel)];
  for (const ch of channels) {
    const title = ch === "general" ? "#general" : `#${ch}: ${rec.channels.find((c) => c.channel === ch)?.title ?? ""}`;
    const lines = posts.filter((p) => p.post.channel === ch).map((p) => `**${stamp(p.timestamp)} ${name(p.agentId)}:** ${p.post.text}\n`);
    writeFileSync(join(dir, `${ch}.md`), [`# ${rec.company.name} ${title}`, ``, ...lines, ``].join("\n"));
  }
}

// Track approvals and keep each live company's status.md fresh.
town.onMessage((m) => {
  if (m.kind !== "event") return;
  const e = m.event;
  if (e.type === "request_approval") pendingApprovals.set(e.approval.id, e.approval);
  const rec = records.get(e.companyId);
  if (!rec) return;
  if (e.type === "agent_status" || e.type === "spend_updated" || e.type === "task_done" || e.type === "request_approval" || e.type === "budget_exhausted") {
    const lines = town.events.filter((x) => x.companyId === e.companyId).map(describe).filter(Boolean).slice(-25);
    writeStatusFile(rec.company.slug, rec.company, lines);
  }
  if (e.type === "post_message" || e.type === "channel_opened") writeChatFiles(rec);
  if (e.type === "send_message" || e.type === "handoff" || e.type === "call_meeting" || e.type === "request_approval" || e.type === "approval_resolved") {
    const name = (id: string) => (id === "founder" ? "Founder" : town.agents.get(id)?.name ?? id);
    const stamp = (t: number) => new Date(t).toISOString().slice(11, 19);
    const chat = town.events
      .filter((x) => x.companyId === e.companyId)
      .map((x) => {
        switch (x.type) {
          case "send_message": return `**${stamp(x.timestamp)} ${name(x.agentId)} → ${name(x.toAgentId)}:** ${x.message.text}`;
          case "handoff": return `*${stamp(x.timestamp)} ${name(x.agentId)} handed ${x.taskId} to ${name(x.toAgentId)}: ${x.note}*`;
          case "call_meeting": return `*${stamp(x.timestamp)} ${name(x.agentId)} called a meeting: ${x.topic}*`;
          case "request_approval": return `**${stamp(x.timestamp)} ${name(x.agentId)} → Founder (${x.approval.kind} approval):** ${x.approval.summary}`;
          case "approval_resolved": return `**${stamp(x.timestamp)} Founder:** ${x.approval.status.toUpperCase()}${x.approval.founderComment ? ` — ${x.approval.founderComment}` : ""}`;
          default: return "";
        }
      })
      .filter(Boolean)
      .map((l) => `${l}\n`);
    writeConversationFile(rec.company.slug, rec.company, chat);
  }
});

/** The CEO's first turn after founding: acknowledge the founder and lay out goals. */
async function kickoff(rec: CompanyRecord): Promise<void> {
  const ceo = rec.agents.find((a) => a.role === "ceo");
  if (!ceo) return;
  town.emit({ ...ev(rec.company.id), type: "company_phase", phase: "planning" });
  try {
    await runAgentTurn({
      town, registry, record: rec, agent: ceo, maxTurns: 12,
      prompt: [
        "The founder has just founded this company and put it in charge of the project folder.",
        "1. Look at the folder briefly with Glob and Read (no shell): list top-level files and read the README if there is one.",
        "2. Send the founder a one-line acknowledgement using send_message with to=\"founder\".",
        "3. Create three to six goal tasks on the board with create_task, assigning owner roles from your colleagues.",
        "4. Send the PM one line asking them to break the goals into tasks and get people moving.",
        "5. Post a one-line kickoff in #general so the whole company hears it, in character.",
        "Then stop.",
      ].join("\n"),
    });
    town.emit({ ...ev(rec.company.id), type: "company_phase", phase: "building" });
  } catch (err) {
    console.error(`[tokenvalley] CEO kickoff failed for ${rec.company.slug}:`, err);
  }
}

function found(input: FoundCompanyInput, slugHint?: string): CompanyRecord {
  const rec = foundCompany(town, registry, input, slugHint);
  records.set(rec.company.id, rec);
  town.focus(rec.company.id);
  void kickoff(rec);
  return rec;
}

wss.on("connection", (ws: WebSocket) => {
  const send = (msg: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const unsubscribe = town.onMessage(send);

  ws.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return;
    }
    const result = ClientMessage.safeParse(parsed);
    if (!result.success) return;
    const msg = result.data;
    switch (msg.kind) {
      case "hello":
        send(town.snapshot());
        break;
      case "found_company": {
        try {
          const rec = found(msg.input);
          send({ kind: "founded", companyId: rec.company.id });
        } catch (err) {
          send({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        }
        break;
      }
      case "focus_company":
        town.focus(msg.companyId);
        break;
      case "set_agent_model": {
        const agent = town.agents.get(msg.agentId);
        if (agent) town.emit({ ...ev(agent.companyId), type: "agent_model_changed", agentId: agent.id, model: msg.model });
        break;
      }
      case "pause_company":
        if (town.companies.has(msg.companyId)) {
          scheduler.pause(msg.companyId);
          town.emit({ ...ev(msg.companyId), type: "company_phase", phase: "paused" });
        }
        break;
      case "resume_company":
        if (town.companies.has(msg.companyId)) {
          scheduler.resume(msg.companyId);
          town.emit({ ...ev(msg.companyId), type: "company_phase", phase: "building" });
        }
        break;
      case "resolve_approval": {
        const approval = pendingApprovals.get(msg.approvalId);
        if (!approval) break;
        pendingApprovals.delete(msg.approvalId);
        const resolved: Approval = { ...approval, status: msg.status, founderComment: msg.comment };
        town.emit({ ...ev(approval.companyId), type: "approval_resolved", approval: resolved });
        const shipped = resolved.kind === "ship" && resolved.status === "approved";
        town.emit({ ...ev(approval.companyId), type: "company_phase", phase: shipped ? "shipped" : "building" });
        if (shipped) {
          const rec = records.get(approval.companyId);
          if (rec) registry.save(rec);
        }
        break;
      }
      case "set_company_budget": {
        const rec = records.get(msg.companyId);
        if (!rec) {
          send({ kind: "error", message: "Only live companies have a budget to edit." });
          break;
        }
        rec.company.budget = { maxTurns: msg.maxTurns, maxTokens: msg.maxTokens };
        town.emit({ ...ev(rec.company.id), type: "budget_changed", budget: rec.company.budget });
        const s = rec.company.spend;
        const under = s.turns < msg.maxTurns && s.inputTokens + s.outputTokens < msg.maxTokens;
        if (rec.company.phase === "out_of_budget" && under) {
          town.emit({ ...ev(rec.company.id), type: "company_phase", phase: "building" });
          scheduler.resume(rec.company.id);
        }
        registry.save(rec);
        try {
          updateCompanyFileBudget(rec.company.slug, msg.maxTurns, msg.maxTokens);
        } catch (err) {
          console.warn(`[tokenvalley] could not write budget to company.md for ${rec.company.slug}:`, err instanceof Error ? err.message : err);
        }
        break;
      }
      case "set_agent_persona": {
        const agent = town.agents.get(msg.agentId);
        const rec = agent ? records.get(agent.companyId) : undefined;
        if (!agent || !rec) {
          send({ kind: "error", message: "Only agents of a live company can be edited." });
          break;
        }
        try {
          savePersona(rec.company.slug, agent.role, { name: msg.name, style: msg.style, job: msg.job });
          town.emit({ ...ev(rec.company.id), type: "agent_persona_changed", agentId: agent.id, name: msg.name, style: msg.style, job: msg.job });
          registry.save(rec);
        } catch (err) {
          send({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        }
        break;
      }
      case "founder_message": {
        const rec = records.get(msg.companyId);
        if (!rec) break;
        const ceo = rec.agents.find((a) => a.role === "ceo");
        if (!ceo) break;
        town.emit({
          ...ev(rec.company.id), type: "send_message", agentId: "founder", toAgentId: ceo.id,
          message: { id: town.nextId("msg"), companyId: rec.company.id, from: "founder", to: ceo.id, text: msg.text, taskId: null, timestamp: Date.now() },
        });
        scheduler.founderMessage(rec, msg.text);
        if (rec.company.phase !== "paused" && rec.company.phase !== "out_of_budget") scheduler.resume(rec.company.id);
        break;
      }
      case "panic":
        scheduler.panic = true;
        for (const rec of records.values()) {
          scheduler.pause(rec.company.id);
          town.emit({ ...ev(rec.company.id), type: "company_phase", phase: "paused" });
        }
        console.log("[tokenvalley] PANIC: all companies paused");
        break;
    }
  });

  ws.on("close", unsubscribe);
});

if (MODE === "fake") {
  new FakeGenerator(town).start();
  console.log(`[tokenvalley] fake companies running (set TOKENVALLEY_MODE=live to hide them)`);
}

// Found companies from companies/<slug>/company.md, now and whenever one appears.
const known = new Set([...records.values()].map((r) => r.company.slug));
watchCompanyFiles((file) => {
  if (known.has(file.slug)) {
    // Existing company: pick up a budget change from the file (the usual way to top up).
    const rec = [...records.values()].find((r) => r.company.slug === file.slug);
    if (rec && (rec.company.budget.maxTurns !== file.input.maxTurns || rec.company.budget.maxTokens !== file.input.maxTokens)) {
      rec.company.budget = { maxTurns: file.input.maxTurns, maxTokens: file.input.maxTokens };
      town.emit({ ...ev(rec.company.id), type: "budget_changed", budget: rec.company.budget });
      if (rec.company.phase === "out_of_budget" && rec.company.spend.turns < rec.company.budget.maxTurns) {
        town.emit({ ...ev(rec.company.id), type: "company_phase", phase: "building" });
        scheduler.resume(rec.company.id);
      }
      registry.save(rec);
      console.log(`[tokenvalley] ${file.input.name}: budget updated to ${file.input.maxTurns} turns`);
    }
    return;
  }
  known.add(file.slug);
  try {
    found(file.input, file.slug);
    console.log(`[tokenvalley] founded ${file.input.name} from ${file.path}`);
  } catch (err) {
    console.error(`[tokenvalley] could not found ${file.slug}:`, err instanceof Error ? err.message : err);
  }
});

scheduler.start();
console.log(`[tokenvalley] server listening on ws://localhost:${PORT} (mode=${MODE}, pool=${town.poolSize})`);
