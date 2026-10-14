import { ROLE_LABEL, type Agent, type Event, type Message, type Task } from "@agentsitcom/shared";
import type { Town } from "./town.js";
import type { CompanyRecord, CompanyRegistry } from "./company/registry.js";
import { runAgentTurn } from "./agent/turn.js";

/**
 * The turn loop. Every few seconds, for each live company that is not paused
 * or out of budget, find agents with work (unread messages, or a task they
 * own that is not done) and run one turn each while the town pool has room.
 *
 * Work is what makes the office move: a turn is one `claude -p` process, and
 * everything the agent says or does arrives as events.
 */

export class Scheduler {
  private running = new Set<string>(); // agentIds mid-turn
  private lastTurnAt = new Map<string, number>(); // agentId -> ms
  private idleRounds = new Map<string, number>(); // companyId -> rounds with no work
  private timer: NodeJS.Timeout | null = null;
  private paused = new Set<string>();
  panic = false;

  constructor(
    private town: Town,
    private registry: CompanyRegistry,
    private records: Map<string, CompanyRecord>,
    private tickMs = 4000,
  ) {
    town.onMessage((m) => {
      if (m.kind !== "event") return;
      this.observe(m.event);
    });
  }

  start(): void {
    if (!this.timer) this.timer = setInterval(() => void this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  pause(companyId: string): void {
    this.paused.add(companyId);
  }

  resume(companyId: string): void {
    this.paused.delete(companyId);
    this.idleRounds.delete(companyId);
  }

  get liveCount(): number {
    return this.running.size;
  }

  private inboxOf(companyId: string, agentId: string): Message[] {
    const rec = this.records.get(companyId);
    if (!rec) return [];
    rec.inbox ??= {};
    return (rec.inbox[agentId] ??= []);
  }

  private deliver(companyId: string, agentId: string, msg: Message): void {
    this.inboxOf(companyId, agentId).push(msg);
    const rec = this.records.get(companyId);
    if (rec) this.registry.save(rec);
  }

  /** A message from the founder lands in the CEO inbox and the CEO gets the next turn. */
  founderMessage(rec: CompanyRecord, text: string): void {
    const ceo = rec.agents.find((a) => a.role === "ceo");
    if (!ceo) return;
    this.deliver(rec.company.id, ceo.id, { id: this.town.nextId("msg"), companyId: rec.company.id, from: "founder", to: ceo.id, text, taskId: null, timestamp: Date.now() });
    this.lastTurnAt.set(ceo.id, 0);
    this.idleRounds.delete(rec.company.id);
  }

  /** Keep inboxes in sync from the event stream, whoever emitted the event. */
  private observe(e: Event): void {
    if (e.type === "send_message") {
      if (e.toAgentId === "founder") return;
      this.deliver(e.companyId, e.toAgentId, e.message);
    } else if (e.type === "handoff") {
      this.deliver(e.companyId, e.toAgentId, { id: e.id, companyId: e.companyId, from: e.agentId, to: e.toAgentId, text: `Handoff of task ${e.taskId}: ${e.note}`, taskId: e.taskId, timestamp: e.timestamp });
    } else if (e.type === "post_message") {
      const rec = this.records.get(e.companyId);
      if (!rec) return;
      const members = e.post.channel === "general"
        ? rec.agents.filter((a) => a.kind !== "npc" && a.status !== "retired").map((a) => a.id)
        : rec.channels.find((c) => c.channel === e.post.channel)?.memberIds ?? [];
      const from = rec.agents.find((a) => a.id === e.agentId)?.name ?? e.agentId;
      for (const id of members) {
        if (id === e.agentId) continue;
        this.deliver(e.companyId, id, { id: `${e.id}_${id}`, companyId: e.companyId, from: e.agentId, to: id, text: `[#${e.post.channel}] ${from}: ${e.post.text}`, taskId: null, timestamp: e.timestamp });
      }
    } else if (e.type === "call_meeting") {
      const caller = this.records.get(e.companyId)?.agents.find((a) => a.id === e.agentId);
      for (const id of e.attendeeIds) {
        if (id === e.agentId) continue;
        const channel = this.records.get(e.companyId)?.channels.find((c) => c.title === e.topic && c.memberIds.includes(id))?.channel ?? "general";
        this.deliver(e.companyId, id, { id: `${e.id}_${id}`, companyId: e.companyId, from: e.agentId, to: id, text: `Meeting called by ${caller?.name ?? "a colleague"}: "${e.topic}". Post your position in #${channel} so everyone hears it.`, taskId: null, timestamp: e.timestamp });
      }
    } else if (e.type === "approval_resolved") {
      const rec = this.records.get(e.companyId);
      const ceo = rec?.agents.find((a) => a.role === "ceo");
      if (ceo) {
        const verdict = e.approval.status === "approved" ? "APPROVED" : "REJECTED";
        this.deliver(e.companyId, ceo.id, { id: e.id, companyId: e.companyId, from: "founder", to: ceo.id, text: `The founder ${verdict} your request "${e.approval.summary.slice(0, 80)}". ${e.approval.founderComment ?? ""}`.trim(), taskId: null, timestamp: e.timestamp });
      }
    }
  }

  private hasWork(rec: CompanyRecord, agent: Agent): boolean {
    if (this.inboxOf(rec.company.id, agent.id).length > 0) return true;
    return rec.tasks.some((t) => t.ownerAgentId === agent.id && (t.status === "backlog" || t.status === "in_progress"));
  }

  private async tick(): Promise<void> {
    if (this.panic) return;
    for (const rec of this.records.values()) {
      const c = rec.company;
      if (!c.live || this.paused.has(c.id)) continue;
      if (c.phase === "out_of_budget" || c.phase === "awaiting_approval" || c.phase === "paused") continue;
      if (c.spend.turns >= c.budget.maxTurns) continue;
      if (this.town.liveSlotsFree() <= 0) return;

      // A shipped company does no new task work, but it still answers messages
      // (the founder most of all). New tasks reopen it; see translate() in turn.ts.
      const shipped = c.phase === "shipped";
      const candidates = rec.agents
        .filter((a) => a.kind !== "npc" && a.status !== "retired" && a.model && !this.running.has(a.id))
        .filter((a) => (shipped ? this.inboxOf(c.id, a.id).length > 0 : this.hasWork(rec, a)))
        .sort((a, b) => (this.lastTurnAt.get(a.id) ?? 0) - (this.lastTurnAt.get(b.id) ?? 0));

      if (candidates.length === 0) {
        if (shipped) continue;
        const n = (this.idleRounds.get(c.id) ?? 0) + 1;
        this.idleRounds.set(c.id, n);
        if (n === 8) this.nudgeCeo(rec);
        continue;
      }
      this.idleRounds.set(c.id, 0);

      const focusedBonus = c.id === this.town.focusedCompanyId ? 2 : 1;
      for (const agent of candidates.slice(0, focusedBonus)) {
        if (this.town.liveSlotsFree() <= 0) break;
        void this.runOne(rec, agent);
      }
    }
  }

  /** Nobody has work and nothing is pending: ask the CEO to look at the board. */
  private nudgeCeo(rec: CompanyRecord): void {
    const ceo = rec.agents.find((a) => a.role === "ceo");
    if (!ceo) return;
    const open = rec.tasks.filter((t) => t.status !== "done");
    const text = open.length
      ? `Status check from the founder's office: ${open.length} task(s) still open and nobody is working. Assign owners or hand things off.`
      : `Status check from the founder's office: the board is empty. If the brief is done, request approval to ship. Otherwise create the next tasks.`;
    this.deliver(rec.company.id, ceo.id, { id: this.town.nextId("msg"), companyId: rec.company.id, from: "founder", to: ceo.id, text, taskId: null, timestamp: Date.now() });
  }

  private buildPrompt(rec: CompanyRecord, agent: Agent): string {
    const unread = [...this.inboxOf(rec.company.id, agent.id)];
    rec.inbox[agent.id] = [];
    this.registry.save(rec);
    const nameOf = (id: string) => {
      if (id === "founder") return "founder";
      const a = rec.agents.find((x) => x.id === id);
      return a ? `${a.name}` : id;
    };
    const myTasks = rec.tasks.filter((t) => t.ownerAgentId === agent.id && t.status !== "done");
    const lines: string[] = [];
    if (unread.length) {
      lines.push("## New messages for you");
      for (const m of unread) lines.push(`- from ${nameOf(m.from)}: ${m.text}`);
      lines.push("");
    }
    if (myTasks.length) {
      lines.push("## Your open tasks");
      for (const t of myTasks) lines.push(`- ${t.id} [${t.status}] ${t.title}${t.files.length ? ` (files: ${t.files.join(", ")})` : ""}`);
      lines.push("");
    }
    lines.push("## What to do this turn");
    lines.push("Reply to anything that needs a reply (one short message each, in character). Replies to a [#channel] line go back to that channel with post; replies to a person go with send_message.");
    if (myTasks.length) {
      lines.push("Then make real progress on ONE of your tasks. Mark it in_progress with update_task when you start, and done with update_task when it is finished and verified.");
      lines.push("If you finish, hand it to the right colleague with handoff (engineers hand to qa, qa hands bugs to the engineer).");
    } else {
      lines.push("You have no tasks. If you own the board, assign or create some. Otherwise tell the PM you are free, in one line.");
    }
    lines.push("Keep this turn short. Do not repeat yourself. Stop when you have done one meaningful thing.");
    return lines.join("\n");
  }

  private async runOne(rec: CompanyRecord, agent: Agent): Promise<void> {
    this.running.add(agent.id);
    this.lastTurnAt.set(agent.id, Date.now());
    this.town.reserveSlot();
    const prompt = this.buildPrompt(rec, agent);
    const pick = rec.tasks.find((t) => t.ownerAgentId === agent.id && t.status === "in_progress") ?? rec.tasks.find((t) => t.ownerAgentId === agent.id && t.status === "backlog");
    if (pick && agent.currentTaskId !== pick.id) {
      agent.currentTaskId = pick.id;
      this.town.emit({ id: this.town.nextId("ev"), companyId: rec.company.id, timestamp: Date.now(), type: "task_started", agentId: agent.id, task: pick });
    }
    try {
      await runAgentTurn({ town: this.town, registry: this.registry, record: rec, agent, prompt, maxTurns: agent.role === "engineer" || agent.role === "backend" || agent.role === "frontend" ? 25 : 10 });
    } catch (err) {
      console.error(`[agentsitcom] turn failed for ${rec.company.slug}/${ROLE_LABEL[agent.role]}:`, err instanceof Error ? err.message : err);
    } finally {
      this.running.delete(agent.id);
      this.town.releaseSlot();
      if (agent.kind === "hire" && !rec.tasks.some((t: Task) => t.ownerAgentId === agent.id && t.status !== "done")) {
        agent.status = "retired";
        this.town.emit({ id: this.town.nextId("ev"), companyId: rec.company.id, timestamp: Date.now(), type: "agent_retired", agentId: agent.id });
      }
    }
  }
}
