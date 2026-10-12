import type {
  Agent,
  Company,
  Event,
  ServerMessage,
  Task,
} from "@tokenvalley/shared";

/**
 * In-memory town state. Phase 2 moves company state into one SQLite file per
 * company; the shape here is deliberately the same so that swap is mechanical.
 */
export class Town {
  readonly companies = new Map<string, Company>();
  readonly agents = new Map<string, Agent>();
  readonly tasks = new Map<string, Task>();
  readonly events: Event[] = [];
  focusedCompanyId: string | null = null;
  poolSize = Number(process.env.TOKENVALLEY_POOL ?? 2);
  private liveSlots = 0;

  liveSlotsFree(): number {
    return Math.max(0, this.poolSize - this.liveSlots);
  }
  reserveSlot(): void {
    this.liveSlots += 1;
  }
  releaseSlot(): void {
    this.liveSlots = Math.max(0, this.liveSlots - 1);
  }

  private listeners = new Set<(msg: ServerMessage) => void>();
  private seq = 0;

  onMessage(fn: (msg: ServerMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq.toString(36)}`;
  }

  /** Apply an event to state, persist it, and broadcast it. */
  emit(event: Event): void {
    this.apply(event);
    this.events.push(event);
    if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);
    this.broadcast({ kind: "event", event });
  }

  focus(companyId: string): void {
    if (!this.companies.has(companyId)) return;
    this.focusedCompanyId = companyId;
    this.broadcast({ kind: "focus_changed", companyId });
  }

  snapshot(): ServerMessage {
    return {
      kind: "snapshot",
      town: { focusedCompanyId: this.focusedCompanyId, poolSize: this.poolSize },
      companies: [...this.companies.values()],
      agents: [...this.agents.values()],
      tasks: [...this.tasks.values()],
      recentEvents: this.events.slice(-200),
    };
  }

  agentsOf(companyId: string): Agent[] {
    return [...this.agents.values()].filter((a) => a.companyId === companyId);
  }

  tasksOf(companyId: string): Task[] {
    return [...this.tasks.values()].filter((t) => t.companyId === companyId);
  }

  private broadcast(msg: ServerMessage): void {
    for (const fn of this.listeners) fn(msg);
  }

  /** Keep the derived state (agents, tasks, company phase, spend) in sync. */
  private apply(e: Event): void {
    const company = this.companies.get(e.companyId);
    switch (e.type) {
      case "company_founded":
        this.companies.set(e.company.id, e.company);
        if (!this.focusedCompanyId) this.focusedCompanyId = e.company.id;
        break;
      case "company_phase":
        if (company) company.phase = e.phase;
        break;
      case "agent_spawned":
        this.agents.set(e.agent.id, e.agent);
        break;
      case "agent_retired":
        this.patchAgent(e.agentId, { status: "retired" });
        break;
      case "agent_model_changed":
        this.patchAgent(e.agentId, { model: e.model });
        break;
      case "task_created":
      case "task_updated":
        this.tasks.set(e.task.id, e.task);
        break;
      case "task_started":
        this.tasks.set(e.task.id, { ...e.task, status: "in_progress", ownerAgentId: e.agentId });
        this.patchAgent(e.agentId, { status: "working", currentTaskId: e.task.id });
        break;
      case "task_blocked": {
        const t = this.tasks.get(e.taskId);
        if (t) t.status = "blocked";
        this.patchAgent(e.agentId, { status: "blocked" });
        break;
      }
      case "task_done": {
        const t = this.tasks.get(e.taskId);
        if (t) t.status = "done";
        this.patchAgent(e.agentId, { status: "idle", currentTaskId: null });
        break;
      }
      case "call_meeting":
        for (const id of e.attendeeIds) this.patchAgent(id, { status: "meeting" });
        break;
      case "meeting_ended":
        for (const a of this.agents.values()) {
          if (a.companyId === e.companyId && a.status === "meeting") {
            a.status = a.currentTaskId ? "working" : "idle";
          }
        }
        break;
      case "spend_updated":
      case "budget_warning":
        if (company) company.spend = e.spend;
        break;
      case "budget_exhausted":
        if (company) {
          company.spend = e.spend;
          company.phase = "out_of_budget";
        }
        break;
      case "request_approval":
        if (company) company.phase = "awaiting_approval";
        break;
      case "approval_resolved":
        if (company) company.phase = e.approval.status === "approved" ? "building" : "planning";
        break;
      case "subagent_spawned":
        this.agents.set(e.contractor.id, e.contractor);
        break;
      case "subagent_finished":
        this.agents.delete(e.contractorId);
        break;
      case "agent_status":
        this.patchAgent(e.agentId, { status: e.status });
        break;
      case "idle_timeout":
        this.patchAgent(e.agentId, { status: "away" });
        break;
      default:
        break;
    }
  }

  private patchAgent(id: string, patch: Partial<Agent>): void {
    const a = this.agents.get(id);
    if (a) Object.assign(a, patch);
  }
}
