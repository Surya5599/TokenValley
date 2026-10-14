import {
  DEFAULT_MODEL,
  ROLE_HOME,
  ROLE_LABEL,
  type Agent,
  type Company,
  type Event,
  type RoleId,
  type Spend,
  type Task,
} from "@agentsitcom/shared";
import type { Town } from "../town.js";

/**
 * Phase 1 only. Founds a few fake companies and plays a scripted-but-random
 * stream of events so every visual in the mapping table gets exercised.
 * No model is ever called from here.
 */

type FakeCompanySpec = {
  slug: string;
  name: string;
  tagline: string;
  brief: string;
  palette: Company["palette"];
  roster: RoleId[];
  names: Record<string, string>;
};

const SPECS: FakeCompanySpec[] = [
  {
    slug: "scranton-software",
    name: "Scranton Software",
    tagline: "That is what she shipped.",
    brief: "Build a to-do list web app with local storage and a tidy UI.",
    palette: { primary: "#2fb37a", secondary: "#1f6f4e", accent: "#9be7c4", floor: "#2b2f36", wall: "#3b4350" },
    roster: ["ceo", "pm", "engineer", "qa", "designer", "cfo", "receptionist"],
    names: { ceo: "Michael", pm: "Jim", engineer: "Dwight", qa: "Angela", designer: "Pam", cfo: "Oscar", receptionist: "Erin" },
  },
  {
    slug: "dunder-mindflin",
    name: "Dunder Mindflin",
    tagline: "Limitless paper in a paperless world.",
    brief: "Build a CLI that turns markdown notes into a static site.",
    palette: { primary: "#4a7bd0", secondary: "#2f4f8a", accent: "#a9c4f5", floor: "#2a2b31", wall: "#4a4a58" },
    roster: ["ceo", "pm", "engineer", "qa", "cfo", "receptionist", "it"],
    names: { ceo: "David", pm: "Jan", engineer: "Darryl", qa: "Holly", cfo: "Kevin", receptionist: "Kelly", it: "Creed" },
  },
  {
    slug: "sabre-labs",
    name: "Sabre Labs",
    tagline: "Printers that print. Mostly.",
    brief: "Build a landing page and pricing calculator for a SaaS product.",
    palette: { primary: "#e0533d", secondary: "#8f2f22", accent: "#ffb3a3", floor: "#2e2a2a", wall: "#5a4646" },
    roster: ["ceo", "pm", "engineer", "designer", "marketing", "cfo"],
    names: { ceo: "Robert", pm: "Andy", engineer: "Stanley", designer: "Phyllis", marketing: "Ryan", cfo: "Toby" },
  },
];

const FILES = [
  "src/App.tsx", "src/store.ts", "src/components/List.tsx", "README.md", "package.json",
  "src/styles.css", "tests/list.test.ts", "src/api/notes.ts", "docs/spec.md", "design/tokens.json",
];
const TASK_TITLES = [
  "Set up project skeleton", "Write product spec", "Design list component", "Implement add item",
  "Implement delete item", "Persist to local storage", "Write unit tests", "Fix flaky test",
  "Polish empty state", "Write README", "Add dark mode", "Review accessibility",
];
const BUZZ = [
  "Let's circle back and synergize the roadmap.", "We need to 10x our velocity, team.",
  "Think of this as a paradigm shift.", "Let's take this offline and align.",
];
const PM_LINES = ["Can we get a quick sync on this?", "I'll put 30 minutes on the calendar.", "What's the acceptance criteria here?"];
const QA_LINES = ["Found a bug in the spec. And the title. And this sentence.", "Repro steps or it didn't happen.", "Blocking release until the tests pass."];
const DESIGN_LINES = ["That color is wrong on principle.", "The spacing is a crime.", "I rejected the blue. And the other blue."];
const ENG_LINES = ["...", "(headphones on)", "it works on my machine"];
const MISC_LINES = ["Everything is a launch.", "It depends.", "Have you tried restarting it?", "I can get coffee!"];

function linesFor(role: RoleId): string[] {
  switch (role) {
    case "ceo": return BUZZ;
    case "pm": return PM_LINES;
    case "qa": return QA_LINES;
    case "designer": return DESIGN_LINES;
    case "engineer": case "backend": case "frontend": return ENG_LINES;
    default: return MISC_LINES;
  }
}

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)] as T;

export class FakeGenerator {
  private timer: NodeJS.Timeout | null = null;
  private meetingOpen = new Map<string, string>();
  private approvalOpen = new Set<string>();
  private tick = 0;

  constructor(private town: Town, private intervalMs = 1800) {}

  start(): void {
    SPECS.forEach((spec, i) => this.found(spec, i));
    this.timer = setInterval(() => this.step(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private now(): number {
    return Date.now();
  }

  private base(companyId: string) {
    return { id: this.town.nextId("ev"), companyId, timestamp: this.now() };
  }

  private found(spec: FakeCompanySpec, plot: number): void {
    const id = this.town.nextId("co");
    const company: Company = {
      id,
      slug: spec.slug,
      name: spec.name,
      tagline: spec.tagline,
      brief: spec.brief,
      workspacePath: "",
      live: false,
      rosterTemplate: "startup",
      palette: spec.palette,
      budget: { maxTurns: 200, maxTokens: 2_000_000 },
      spend: { turns: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
      priority: 5,
      phase: "planning",
      plot,
    };
    this.town.emit({ ...this.base(id), type: "company_founded", company });

    for (const role of spec.roster) {
      const agent: Agent = {
        id: this.town.nextId("ag"),
        companyId: id,
        role,
        kind: DEFAULT_MODEL[role] ? "core" : "npc",
        name: `${spec.names[role] ?? ROLE_LABEL[role]} (${ROLE_LABEL[role]})`,
        model: DEFAULT_MODEL[role],
        effort: "medium",
        status: "idle",
        currentTaskId: null,
        home: ROLE_HOME[role],
        parentAgentId: null,
        style: "",
        job: "",
      };
      this.town.emit({ ...this.base(id), agentId: agent.id, type: "agent_spawned", agent });
    }

    for (let i = 0; i < 4; i++) this.createTask(id, "ceo");
  }

  private createTask(companyId: string, createdBy: string): Task {
    const task: Task = {
      id: this.town.nextId("task"),
      companyId,
      title: pick(TASK_TITLES),
      ownerRole: null,
      ownerAgentId: null,
      status: "backlog",
      dependsOn: [],
      files: [],
      createdBy,
    };
    this.town.emit({ ...this.base(companyId), type: "task_created", task });
    return task;
  }

  private step(): void {
    this.tick += 1;
    for (const company of this.town.companies.values()) {
      if (company.live) continue; // real companies are driven by real agents
      if (company.phase === "out_of_budget" || company.phase === "paused") continue;
      // Each company gets one event per tick, at most. Background companies are quieter.
      const focused = company.id === this.town.focusedCompanyId;
      if (!focused && Math.random() < 0.6) continue;
      this.stepCompany(company);
    }
  }

  private stepCompany(company: Company): void {
    const cid = company.id;
    const agents = this.town.agentsOf(cid).filter((a) => a.kind !== "npc" && a.status !== "retired");
    const modelAgents = agents.filter((a) => a.kind !== "contractor");
    if (modelAgents.length === 0) return;

    if (this.meetingOpen.has(cid) && Math.random() < 0.35) {
      this.town.emit({ ...this.base(cid), type: "meeting_ended", meetingId: this.meetingOpen.get(cid)! });
      this.meetingOpen.delete(cid);
      return;
    }
    if (this.approvalOpen.has(cid)) {
      if (Math.random() < 0.15) {
        const approved = Math.random() < 0.75;
        this.town.emit({
          ...this.base(cid),
          type: "approval_resolved",
          approval: { id: this.town.nextId("ap"), companyId: cid, kind: "plan", summary: "Plan", status: approved ? "approved" : "rejected", founderComment: approved ? "Ship it." : "Too many blues." },
        });
        this.approvalOpen.delete(cid);
      }
      return;
    }

    const agent = pick(modelAgents);
    const roll = Math.random();
    const tasks = this.town.tasksOf(cid);
    const backlog = tasks.filter((t) => t.status === "backlog");
    const mine = tasks.find((t) => t.ownerAgentId === agent.id && t.status === "in_progress");

    if (agent.status === "away" && roll < 0.7) {
      this.town.emit({ ...this.base(cid), agentId: agent.id, type: "agent_status", status: "idle", line: "back from coffee" });
      return;
    }

    if (!mine && backlog.length > 0 && roll < 0.35) {
      const task = { ...pick(backlog), ownerRole: agent.role };
      this.town.emit({ ...this.base(cid), agentId: agent.id, type: "task_started", task });
      this.bumpSpend(company, agent);
      return;
    }
    if (mine && roll < 0.55) {
      const write = Math.random() < 0.5;
      const path = pick(FILES);
      this.town.emit(write
        ? { ...this.base(cid), agentId: agent.id, type: "tool_write_file", path }
        : { ...this.base(cid), agentId: agent.id, type: "tool_read_file", path });
      if (Math.random() < 0.25) this.town.emit({ ...this.base(cid), agentId: agent.id, type: "tool_shell", command: pick(["pnpm test", "pnpm build", "git status", "pnpm lint"]) });
      this.bumpSpend(company, agent);
      return;
    }
    if (mine && roll < 0.65) {
      this.town.emit({ ...this.base(cid), agentId: agent.id, type: "task_done", taskId: mine.id });
      if (backlog.length < 3) this.createTask(cid, agent.id);
      return;
    }
    if (roll < 0.75) {
      const others = modelAgents.filter((a) => a.id !== agent.id);
      if (others.length === 0) return;
      const to = pick(others);
      const text = pick(linesFor(agent.role));
      this.town.emit({
        ...this.base(cid), agentId: agent.id, type: "send_message", toAgentId: to.id,
        message: { id: this.town.nextId("msg"), companyId: cid, from: agent.id, to: to.id, text, taskId: mine?.id ?? null, timestamp: this.now() },
      });
      return;
    }
    if (roll < 0.80 && mine) {
      const others = modelAgents.filter((a) => a.id !== agent.id);
      if (others.length === 0) return;
      const to = pick(others);
      this.town.emit({ ...this.base(cid), agentId: agent.id, type: "handoff", taskId: mine.id, toAgentId: to.id, note: "Over to you." });
      this.town.emit({ ...this.base(cid), type: "task_updated", task: { ...mine, ownerAgentId: to.id, ownerRole: to.role, status: "in_progress" } });
      this.town.emit({ ...this.base(cid), agentId: agent.id, type: "agent_status", status: "idle", line: "handed off" });
      return;
    }
    if (roll < 0.84 && mine) {
      const blocker = pick(modelAgents.filter((a) => a.id !== agent.id)) ?? agent;
      this.town.emit({ ...this.base(cid), agentId: agent.id, type: "task_blocked", taskId: mine.id, blockedByRole: blocker.role, reason: "Waiting on " + ROLE_LABEL[blocker.role] });
      return;
    }
    if (roll < 0.88 && agent.role === "pm") {
      const meetingId = this.town.nextId("mt");
      const attendeeIds = modelAgents.slice(0, 4).map((a) => a.id);
      this.town.emit({ ...this.base(cid), agentId: agent.id, type: "call_meeting", meetingId, attendeeIds, topic: pick(["Sprint sync", "Retro", "Color alignment", "Launch readiness"]) });
      this.meetingOpen.set(cid, meetingId);
      return;
    }
    if (roll < 0.91 && agent.role === "ceo" && company.phase !== "awaiting_approval") {
      const approval = { id: this.town.nextId("ap"), companyId: cid, kind: "plan" as const, summary: "Plan v1: build the thing, then test the thing.", status: "pending" as const, founderComment: null };
      this.town.emit({ ...this.base(cid), agentId: agent.id, type: "request_approval", approval });
      this.approvalOpen.add(cid);
      return;
    }
    if (roll < 0.93) {
      const failed = Math.random() < 0.5;
      this.town.emit(failed
        ? { ...this.base(cid), type: "build_failed", summary: "TypeError: cannot read properties of undefined" }
        : { ...this.base(cid), type: "build_passed", summary: "42 tests passed" });
      return;
    }
    if (roll < 0.955 && (agent.role === "engineer" || agent.role === "backend" || agent.role === "frontend")) {
      const contractor: Agent = {
        id: this.town.nextId("ctr"), companyId: cid, role: "intern", kind: "contractor", name: "Subagent", model: "haiku", effort: "low",
        status: "working", currentTaskId: mine?.id ?? null, home: agent.home, parentAgentId: agent.id, style: "", job: "",
      };
      this.town.emit({ ...this.base(cid), agentId: agent.id, type: "subagent_spawned", contractor });
      setTimeout(() => this.town.emit({ ...this.base(cid), agentId: agent.id, type: "subagent_finished", contractorId: contractor.id }), 6000);
      return;
    }
    if (roll < 0.975 && agent.status === "idle") {
      this.town.emit({ ...this.base(cid), agentId: agent.id, type: "idle_timeout" });
      return;
    }
    if (roll < 0.985) {
      const model = pick(["opus", "sonnet", "haiku"] as const);
      this.town.emit({ ...this.base(cid), agentId: agent.id, type: "agent_model_changed", model });
      return;
    }
    if (roll < 0.993 && (agent.role === "pm" || agent.role === "ceo")) {
      const hire: Agent = {
        id: this.town.nextId("ag"), companyId: cid, role: pick(["intern", "marketing", "legal", "backend"] as const), kind: "hire", name: "", model: "haiku", effort: "low",
        status: "idle", currentTaskId: null, home: "floating_2", parentAgentId: null, style: "", job: "",
      };
      hire.name = `New hire (${ROLE_LABEL[hire.role]})`;
      hire.home = ROLE_HOME[hire.role];
      this.town.emit({ ...this.base(cid), agentId: hire.id, type: "agent_spawned", agent: hire });
      setTimeout(() => this.town.emit({ ...this.base(cid), agentId: hire.id, type: "agent_retired" }), 20000);
      return;
    }
  }

  private bumpSpend(company: Company, agent: Agent): void {
    const mult = agent.model === "opus" ? 3 : agent.model === "sonnet" ? 1 : 0.3;
    const spend: Spend = {
      turns: company.spend.turns + 1,
      inputTokens: company.spend.inputTokens + Math.round(4000 * mult),
      outputTokens: company.spend.outputTokens + Math.round(800 * mult),
      estimatedUsd: +(company.spend.estimatedUsd + 0.02 * mult).toFixed(4),
    };
    const ratio = spend.turns / company.budget.maxTurns;
    if (ratio >= 1) {
      this.town.emit({ ...this.base(company.id), type: "budget_exhausted", spend, budget: company.budget });
    } else if (ratio >= 0.8 && company.spend.turns / company.budget.maxTurns < 0.8) {
      this.town.emit({ ...this.base(company.id), type: "budget_warning", spend, budget: company.budget });
    } else {
      this.town.emit({ ...this.base(company.id), type: "spend_updated", spend });
    }
  }
}
