import type { Agent, Approval, ChatPost, Company, Event, ServerMessage, Task } from "@tokenvalley/shared";
import type { ConnStatus } from "../net/ws";

/** Derived building status shown on the valley map. */
export type CompanyStatus = "working" | "blocked" | "waiting_on_founder" | "done" | "out_of_budget" | "paused";

export type CameraMode = "valley" | "office" | "follow" | "meeting" | "firstperson";

const FEED_LIMIT = 50;
const FOUNDER_THREAD_LIMIT = 20;
const POST_LIMIT = 200;
const DM_LIMIT = 200;

export type PanelTab = "company" | "chat";

/** A channel announced by channel_opened ("general" is implicit and always present). */
export interface ChannelInfo {
  channel: string;
  title: string;
  memberIds: string[];
}

/** One agent-to-agent send_message, kept so DM threads can be derived. */
export interface DmMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
}

/** A derived 1:1 thread between two agents. */
export interface DmThread {
  /** "dm:<a>|<b>" with the ids sorted, stable across renders. */
  key: string;
  a: string;
  b: string;
  messages: DmMessage[];
  lastTimestamp: number;
}

/** A message of any chat channel, in the shape the chat view renders. */
export interface ChatLine {
  id: string;
  from: string;
  text: string;
  timestamp: number;
}

/** Channel list keys used by the chat view. */
export const CHANNEL_GENERAL = "general";
export const CHANNEL_FOUNDER = "founder";
export const dmKey = (x: string, y: string): string => `dm:${[x, y].sort().join("|")}`;

/** The founder is not an agent; this id marks messages to/from them. */
export const FOUNDER_ID = "founder";

export interface FounderMessage {
  id: string;
  /** "founder" when the founder wrote it, otherwise the sending agent's id (the CEO). */
  from: string;
  text: string;
  timestamp: number;
}

/**
 * All client state. The director and overlay read from here; only
 * applySnapshot/applyEvent and a handful of UI setters write to it.
 */
export class Store {
  readonly companies = new Map<string, Company>();
  readonly agents = new Map<string, Agent>();
  readonly tasks = new Map<string, Task>();
  /** Last FEED_LIMIT events per company, oldest first. */
  readonly events = new Map<string, Event[]>();
  /** Pending approvals by approval id. */
  readonly approvals = new Map<string, Approval>();
  /** Latest free-text status line per agent (from agent_status). */
  readonly agentLines = new Map<string, string>();
  /** Active meetings: meetingId -> attendee ids. */
  readonly meetings = new Map<string, string[]>();
  /** Founder <-> CEO thread per company (last FOUNDER_THREAD_LIMIT), oldest first. */
  readonly founderThreads = new Map<string, FounderMessage[]>();
  /** Channel posts per company (last POST_LIMIT), oldest first. */
  readonly posts = new Map<string, ChatPost[]>();
  /** Channels opened per company, in the order they were opened. */
  readonly channels = new Map<string, ChannelInfo[]>();
  /** Agent-to-agent messages per company (last DM_LIMIT), oldest first. */
  readonly dms = new Map<string, DmMessage[]>();
  /** Chat UI: last-viewed message timestamp per "<companyId>:<channelKey>". In memory only. */
  readonly chatLastViewed = new Map<string, number>();
  /** Chat UI: the open channel key per company. */
  readonly chatChannel = new Map<string, string>();

  focusedCompanyId: string | null = null;
  selectedAgentId: string | null = null;
  panelTab: PanelTab = "company";
  /** Whether the bottom-left activity feed is shown (View menu toggle). */
  feedVisible = true;
  cameraMode: CameraMode = "valley";
  speed = 1;
  connection: ConnStatus = "disconnected";
  demo = false;

  private readonly listeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    for (const fn of this.listeners) fn();
  }

  // ---- queries ------------------------------------------------------------

  companyList(): Company[] {
    return [...this.companies.values()].sort((a, b) => a.plot - b.plot);
  }

  agentsOf(companyId: string): Agent[] {
    return [...this.agents.values()].filter((a) => a.companyId === companyId && a.status !== "retired");
  }

  tasksOf(companyId: string): Task[] {
    return [...this.tasks.values()].filter((t) => t.companyId === companyId);
  }

  eventsOf(companyId: string): Event[] {
    return this.events.get(companyId) ?? [];
  }

  pendingApprovalFor(companyId: string): Approval | null {
    for (const a of this.approvals.values()) if (a.companyId === companyId && a.status === "pending") return a;
    return null;
  }

  /** Number of pending approvals across every company. */
  pendingApprovalCount(): number {
    let n = 0;
    for (const a of this.approvals.values()) if (a.status === "pending") n++;
    return n;
  }

  founderThreadOf(companyId: string): FounderMessage[] {
    return this.founderThreads.get(companyId) ?? [];
  }

  postsOf(companyId: string): ChatPost[] {
    return this.posts.get(companyId) ?? [];
  }

  channelsOf(companyId: string): ChannelInfo[] {
    return this.channels.get(companyId) ?? [];
  }

  dmsOf(companyId: string): DmMessage[] {
    return this.dms.get(companyId) ?? [];
  }

  /** One thread per agent pair that exchanged messages, most recent first. */
  dmThreadsOf(companyId: string): DmThread[] {
    const threads = new Map<string, DmThread>();
    for (const m of this.dmsOf(companyId)) {
      const key = dmKey(m.from, m.to);
      let t = threads.get(key);
      if (!t) {
        const pair = [m.from, m.to].sort();
        t = { key, a: pair[0] ?? m.from, b: pair[1] ?? m.to, messages: [], lastTimestamp: 0 };
        threads.set(key, t);
      }
      t.messages.push(m);
      t.lastTimestamp = Math.max(t.lastTimestamp, m.timestamp);
    }
    return [...threads.values()].sort((x, y) => y.lastTimestamp - x.lastTimestamp);
  }

  /** Messages of a chat channel key as a uniform list, oldest first. */
  channelMessagesOf(companyId: string, key: string): ChatLine[] {
    if (key === CHANNEL_FOUNDER) return this.founderThreadOf(companyId);
    if (key.startsWith("dm:")) return this.dmThreadsOf(companyId).find((t) => t.key === key)?.messages ?? [];
    return this.postsOf(companyId).filter((p) => p.channel === key);
  }

  /** Messages newer than the last time the founder looked at that channel. */
  unreadCount(companyId: string, key: string): number {
    const seen = this.chatLastViewed.get(`${companyId}:${key}`);
    const msgs = this.channelMessagesOf(companyId, key);
    if (seen === undefined) return msgs.length;
    let n = 0;
    for (const m of msgs) if (m.timestamp > seen) n++;
    return n;
  }

  /** Marks every current message of a channel as seen. */
  markChannelViewed(companyId: string, key: string): void {
    let last = this.chatLastViewed.get(`${companyId}:${key}`) ?? 0;
    for (const m of this.channelMessagesOf(companyId, key)) if (m.timestamp > last) last = m.timestamp;
    this.chatLastViewed.set(`${companyId}:${key}`, last);
  }

  focusedCompany(): Company | null {
    return this.focusedCompanyId ? (this.companies.get(this.focusedCompanyId) ?? null) : null;
  }

  statusOf(companyId: string): CompanyStatus {
    const c = this.companies.get(companyId);
    if (!c) return "paused";
    if (c.phase === "out_of_budget") return "out_of_budget";
    if (c.phase === "paused") return "paused";
    if (c.phase === "shipped") return "done";
    if (c.phase === "awaiting_approval" || this.pendingApprovalFor(companyId)) return "waiting_on_founder";
    for (const t of this.tasks.values()) if (t.companyId === companyId && t.status === "blocked") return "blocked";
    for (const a of this.agents.values()) if (a.companyId === companyId && a.status === "blocked") return "blocked";
    return "working";
  }

  // ---- mutations ----------------------------------------------------------

  applySnapshot(msg: Extract<ServerMessage, { kind: "snapshot" }>): void {
    this.companies.clear();
    this.agents.clear();
    this.tasks.clear();
    this.events.clear();
    this.approvals.clear();
    this.meetings.clear();
    this.founderThreads.clear();
    this.posts.clear();
    this.channels.clear();
    this.dms.clear();
    for (const c of msg.companies) this.companies.set(c.id, c);
    for (const a of msg.agents) this.agents.set(a.id, a);
    for (const t of msg.tasks) this.tasks.set(t.id, t);
    for (const e of msg.recentEvents) {
      this.pushEvent(e);
      this.reduce(e);
    }
    const focus = msg.town.focusedCompanyId ?? this.companyList()[0]?.id ?? null;
    if (focus && this.companies.has(focus)) this.focusedCompanyId = focus;
    else if (!this.focusedCompanyId || !this.companies.has(this.focusedCompanyId)) this.focusedCompanyId = this.companyList()[0]?.id ?? null;
    this.notify();
  }

  /** Records the event in the feed and reduces it into state. */
  applyEvent(e: Event): void {
    this.pushEvent(e);
    this.reduce(e);
    this.notify();
  }

  setFocus(companyId: string | null): void {
    if (companyId !== null && !this.companies.has(companyId)) return;
    this.focusedCompanyId = companyId;
    if (this.selectedAgentId) {
      const a = this.agents.get(this.selectedAgentId);
      if (!a || a.companyId !== companyId) this.selectedAgentId = null;
    }
    this.notify();
  }

  private pushEvent(e: Event): void {
    let list = this.events.get(e.companyId);
    if (!list) {
      list = [];
      this.events.set(e.companyId, list);
    }
    list.push(e);
    if (list.length > FEED_LIMIT) list.splice(0, list.length - FEED_LIMIT);
  }

  private reduce(e: Event): void {
    const company = this.companies.get(e.companyId);
    switch (e.type) {
      case "company_founded":
        this.companies.set(e.company.id, e.company);
        break;
      case "company_phase":
        if (company) company.phase = e.phase;
        break;
      case "agent_spawned":
        this.agents.set(e.agent.id, e.agent);
        break;
      case "agent_retired": {
        const a = this.agents.get(e.agentId);
        if (a) a.status = "retired";
        break;
      }
      case "agent_model_changed": {
        const a = this.agents.get(e.agentId);
        if (a) a.model = e.model;
        break;
      }
      case "task_started": {
        this.tasks.set(e.task.id, { ...e.task, status: "in_progress" });
        const a = this.agents.get(e.agentId);
        if (a) {
          a.status = "working";
          a.currentTaskId = e.task.id;
        }
        break;
      }
      case "task_blocked": {
        const t = this.tasks.get(e.taskId);
        if (t) t.status = "blocked";
        const a = this.agents.get(e.agentId);
        if (a) a.status = "blocked";
        break;
      }
      case "task_done": {
        const t = this.tasks.get(e.taskId);
        if (t) t.status = "done";
        const a = this.agents.get(e.agentId);
        if (a) {
          a.status = "idle";
          a.currentTaskId = null;
        }
        break;
      }
      case "task_created":
      case "task_updated":
        this.tasks.set(e.task.id, e.task);
        break;
      case "tool_read_file":
      case "tool_write_file":
      case "tool_shell": {
        const a = this.agents.get(e.agentId);
        if (a && a.status === "idle") a.status = "working";
        break;
      }
      case "send_message":
        if (e.agentId === FOUNDER_ID || e.toAgentId === FOUNDER_ID) {
          let thread = this.founderThreads.get(e.companyId);
          if (!thread) {
            thread = [];
            this.founderThreads.set(e.companyId, thread);
          }
          thread.push({ id: e.message.id, from: e.agentId, text: e.message.text, timestamp: e.timestamp });
          if (thread.length > FOUNDER_THREAD_LIMIT) thread.splice(0, thread.length - FOUNDER_THREAD_LIMIT);
        } else {
          let list = this.dms.get(e.companyId);
          if (!list) {
            list = [];
            this.dms.set(e.companyId, list);
          }
          list.push({ id: e.message.id, from: e.agentId, to: e.toAgentId, text: e.message.text, timestamp: e.timestamp });
          if (list.length > DM_LIMIT) list.splice(0, list.length - DM_LIMIT);
        }
        break;
      case "post_message": {
        let list = this.posts.get(e.companyId);
        if (!list) {
          list = [];
          this.posts.set(e.companyId, list);
        }
        list.push(e.post);
        if (list.length > POST_LIMIT) list.splice(0, list.length - POST_LIMIT);
        break;
      }
      case "channel_opened": {
        let list = this.channels.get(e.companyId);
        if (!list) {
          list = [];
          this.channels.set(e.companyId, list);
        }
        const existing = list.find((c) => c.channel === e.channel);
        if (existing) {
          existing.title = e.title;
          existing.memberIds = [...e.memberIds];
        } else list.push({ channel: e.channel, title: e.title, memberIds: [...e.memberIds] });
        break;
      }
      case "agent_persona_changed": {
        const a = this.agents.get(e.agentId);
        if (a) {
          a.name = e.name;
          a.style = e.style;
          a.job = e.job;
        }
        break;
      }
      case "handoff": {
        const t = this.tasks.get(e.taskId);
        const to = this.agents.get(e.toAgentId);
        if (t) {
          t.ownerAgentId = e.toAgentId;
          if (to) t.ownerRole = to.role;
          if (t.status === "in_progress") t.status = "review";
        }
        break;
      }
      case "call_meeting":
        this.meetings.set(e.meetingId, [...new Set([e.agentId, ...e.attendeeIds])]);
        for (const id of [e.agentId, ...e.attendeeIds]) {
          const a = this.agents.get(id);
          if (a) a.status = "meeting";
        }
        break;
      case "meeting_ended": {
        const ids = this.meetings.get(e.meetingId) ?? [];
        this.meetings.delete(e.meetingId);
        for (const id of ids) {
          const a = this.agents.get(id);
          if (a && a.status === "meeting") a.status = a.currentTaskId ? "working" : "idle";
        }
        break;
      }
      case "build_failed":
      case "build_passed":
        break;
      case "budget_warning":
      case "spend_updated":
        if (company) company.spend = e.spend;
        break;
      case "budget_exhausted":
        if (company) {
          company.spend = e.spend;
          company.phase = "out_of_budget";
        }
        break;
      case "request_approval":
        this.approvals.set(e.approval.id, e.approval);
        if (company) company.phase = "awaiting_approval";
        break;
      case "approval_resolved":
        this.approvals.delete(e.approval.id);
        // The server should follow with company_phase; this keeps the map sane meanwhile.
        if (company && company.phase === "awaiting_approval") company.phase = "building";
        break;
      case "subagent_spawned":
        this.agents.set(e.contractor.id, e.contractor);
        break;
      case "subagent_finished":
        this.agents.delete(e.contractorId);
        break;
      case "idle_timeout": {
        const a = this.agents.get(e.agentId);
        if (a) a.status = "away";
        break;
      }
      case "agent_status": {
        const a = this.agents.get(e.agentId);
        if (a) a.status = e.status;
        this.agentLines.set(e.agentId, e.line);
        break;
      }
    }
  }
}
