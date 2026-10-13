import { z } from "zod";

// ---------------------------------------------------------------------------
// Models and roles
// ---------------------------------------------------------------------------

export const ModelTier = z.enum(["opus", "sonnet", "haiku"]);
export type ModelTier = z.infer<typeof ModelTier>;

export const Effort = z.enum(["low", "medium", "high"]);
export type Effort = z.infer<typeof Effort>;

/** Role ids. Core cast, hire templates, and NPCs share one namespace. */
export const RoleId = z.enum([
  // core cast
  "ceo",
  "pm",
  "engineer",
  "qa",
  "designer",
  // hire templates
  "backend",
  "frontend",
  "marketing",
  "legal",
  "hr",
  "it",
  "intern",
  // NPCs (no model behind them)
  "cfo",
  "receptionist",
]);
export type RoleId = z.infer<typeof RoleId>;

export const AgentKind = z.enum(["core", "hire", "npc", "contractor"]);
export type AgentKind = z.infer<typeof AgentKind>;

export const AgentStatus = z.enum([
  "idle",
  "working",
  "talking",
  "meeting",
  "blocked",
  "away",
  "retired",
]);
export type AgentStatus = z.infer<typeof AgentStatus>;

/** The animation state machine states the client implements. */
export const AnimState = z.enum([
  "idle",
  "walk",
  "sit_typing",
  "talk",
  "meeting",
  "blocked",
  "celebrate",
  "coffee",
  "arrive",
  "leave",
  "wave",
]);
export type AnimState = z.infer<typeof AnimState>;

// ---------------------------------------------------------------------------
// Town, company, agent, task, message, approval
// ---------------------------------------------------------------------------

export const Palette = z.object({
  primary: z.string(),
  secondary: z.string(),
  accent: z.string(),
  floor: z.string(),
  wall: z.string(),
});
export type Palette = z.infer<typeof Palette>;

export const Budget = z.object({
  maxTurns: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
});
export type Budget = z.infer<typeof Budget>;

export const Spend = z.object({
  turns: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Client-side estimate from the CLI result messages. Not a bill. */
  estimatedUsd: z.number().nonnegative(),
});
export type Spend = z.infer<typeof Spend>;

export const CompanyPhase = z.enum([
  "founded",
  "planning",
  "awaiting_approval",
  "building",
  "testing",
  "shipped",
  "paused",
  "out_of_budget",
]);
export type CompanyPhase = z.infer<typeof CompanyPhase>;

export const Company = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  tagline: z.string().default(""),
  brief: z.string(),
  /** Folder this company is in charge of. Empty for fake companies. */
  workspacePath: z.string().default(""),
  /** True when real Claude Code agents run this company. */
  live: z.boolean().default(false),
  rosterTemplate: z.string(),
  palette: Palette,
  budget: Budget,
  spend: Spend,
  priority: z.number().int().min(0).max(10).default(5),
  phase: CompanyPhase,
  /** Plot index on the valley map. */
  plot: z.number().int().nonnegative(),
});
export type Company = z.infer<typeof Company>;

export const Agent = z.object({
  id: z.string(),
  companyId: z.string(),
  role: RoleId,
  kind: AgentKind,
  /** Display name, e.g. "Dana (CEO)". */
  name: z.string(),
  model: ModelTier.nullable(),
  effort: Effort.default("medium"),
  status: AgentStatus,
  currentTaskId: z.string().nullable(),
  /** Home spot id in the office layout, e.g. "ceo_office", "dev_pod_1". */
  home: z.string(),
  /** For contractors: the agent that spawned them. */
  parentAgentId: z.string().nullable().default(null),
  /** Persona: the comedic style block and the job block, editable per company. */
  style: z.string().default(""),
  job: z.string().default(""),
});
export type Agent = z.infer<typeof Agent>;

/** A message posted to a channel everyone in it can read. */
export const ChatPost = z.object({
  id: z.string(),
  companyId: z.string(),
  /** "general", or "meeting-<n>" for a meeting thread. */
  channel: z.string(),
  from: z.string(),
  text: z.string(),
  timestamp: z.number(),
});
export type ChatPost = z.infer<typeof ChatPost>;

export const TaskStatus = z.enum(["backlog", "in_progress", "blocked", "review", "done"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const Task = z.object({
  id: z.string(),
  companyId: z.string(),
  title: z.string(),
  ownerRole: RoleId.nullable(),
  ownerAgentId: z.string().nullable(),
  status: TaskStatus,
  dependsOn: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  createdBy: z.string(),
});
export type Task = z.infer<typeof Task>;

export const Message = z.object({
  id: z.string(),
  companyId: z.string(),
  from: z.string(),
  to: z.string(),
  text: z.string(),
  taskId: z.string().nullable(),
  timestamp: z.number(),
});
export type Message = z.infer<typeof Message>;

export const ApprovalStatus = z.enum(["pending", "approved", "rejected"]);
export const ApprovalKind = z.enum(["plan", "build", "ship"]);
export type ApprovalKind = z.infer<typeof ApprovalKind>;
export const Approval = z.object({
  id: z.string(),
  companyId: z.string(),
  kind: ApprovalKind.default("plan"),
  summary: z.string(),
  status: ApprovalStatus,
  founderComment: z.string().nullable(),
});
export type Approval = z.infer<typeof Approval>;

// ---------------------------------------------------------------------------
// Events: the only thing the client renders
// ---------------------------------------------------------------------------

const base = {
  id: z.string(),
  companyId: z.string(),
  timestamp: z.number(),
};

const agentBase = { ...base, agentId: z.string() };

export const Event = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("company_founded"), company: Company }),
  z.object({ ...base, type: z.literal("company_phase"), phase: CompanyPhase }),
  z.object({ ...agentBase, type: z.literal("agent_spawned"), agent: Agent }),
  z.object({ ...agentBase, type: z.literal("agent_retired") }),
  z.object({ ...agentBase, type: z.literal("agent_model_changed"), model: ModelTier }),
  z.object({ ...agentBase, type: z.literal("task_started"), task: Task }),
  z.object({ ...agentBase, type: z.literal("task_blocked"), taskId: z.string(), blockedByRole: RoleId, reason: z.string() }),
  z.object({ ...agentBase, type: z.literal("task_done"), taskId: z.string() }),
  z.object({ ...base, type: z.literal("task_created"), task: Task }),
  z.object({ ...base, type: z.literal("task_updated"), task: Task }),
  z.object({ ...agentBase, type: z.literal("tool_read_file"), path: z.string() }),
  z.object({ ...agentBase, type: z.literal("tool_write_file"), path: z.string() }),
  z.object({ ...agentBase, type: z.literal("tool_shell"), command: z.string() }),
  z.object({ ...agentBase, type: z.literal("send_message"), message: Message, toAgentId: z.string() }),
  z.object({ ...agentBase, type: z.literal("post_message"), post: ChatPost }),
  z.object({ ...base, type: z.literal("channel_opened"), channel: z.string(), title: z.string(), memberIds: z.array(z.string()) }),
  z.object({ ...agentBase, type: z.literal("agent_persona_changed"), name: z.string(), style: z.string(), job: z.string() }),
  z.object({ ...agentBase, type: z.literal("handoff"), taskId: z.string(), toAgentId: z.string(), note: z.string() }),
  z.object({ ...agentBase, type: z.literal("call_meeting"), meetingId: z.string(), attendeeIds: z.array(z.string()), topic: z.string() }),
  z.object({ ...base, type: z.literal("meeting_ended"), meetingId: z.string() }),
  z.object({ ...base, type: z.literal("build_failed"), summary: z.string() }),
  z.object({ ...base, type: z.literal("build_passed"), summary: z.string() }),
  z.object({ ...base, type: z.literal("budget_warning"), spend: Spend, budget: Budget }),
  z.object({ ...base, type: z.literal("budget_exhausted"), spend: Spend, budget: Budget }),
  z.object({ ...base, type: z.literal("spend_updated"), spend: Spend }),
  z.object({ ...base, type: z.literal("budget_changed"), budget: Budget }),
  z.object({ ...agentBase, type: z.literal("request_approval"), approval: Approval }),
  z.object({ ...base, type: z.literal("approval_resolved"), approval: Approval }),
  z.object({ ...agentBase, type: z.literal("subagent_spawned"), contractor: Agent }),
  z.object({ ...agentBase, type: z.literal("subagent_finished"), contractorId: z.string() }),
  z.object({ ...agentBase, type: z.literal("idle_timeout") }),
  z.object({ ...agentBase, type: z.literal("agent_status"), status: AgentStatus, line: z.string() }),
]);
export type Event = z.infer<typeof Event>;
export type EventType = Event["type"];

// ---------------------------------------------------------------------------
// WebSocket protocol
// ---------------------------------------------------------------------------

/** Server -> client. */
export const ServerMessage = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("snapshot"),
    town: z.object({
      focusedCompanyId: z.string().nullable(),
      poolSize: z.number().int().positive(),
    }),
    companies: z.array(Company),
    agents: z.array(Agent),
    tasks: z.array(Task),
    /** Recent events so a fresh client can rebuild the feed. */
    recentEvents: z.array(Event),
  }),
  z.object({ kind: z.literal("event"), event: Event }),
  z.object({ kind: z.literal("focus_changed"), companyId: z.string() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
  z.object({ kind: z.literal("founded"), companyId: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** Client -> server. */
export const FoundCompanyInput = z.object({
  name: z.string().min(1).max(60),
  tagline: z.string().max(120).default(""),
  brief: z.string().min(1).max(4000),
  /** Absolute path to the folder (or git checkout) this company is in charge of. */
  workspacePath: z.string().min(1),
  rosterTemplate: z.string().default("startup"),
  modelOverrides: z.record(ModelTier).default({}),
  maxTurns: z.number().int().positive().default(100),
  maxTokens: z.number().int().positive().default(5_000_000),
});
export type FoundCompanyInput = z.infer<typeof FoundCompanyInput>;

export const ClientMessage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hello") }),
  z.object({ kind: z.literal("found_company"), input: FoundCompanyInput }),
  z.object({ kind: z.literal("focus_company"), companyId: z.string() }),
  z.object({ kind: z.literal("set_agent_model"), agentId: z.string(), model: ModelTier }),
  z.object({ kind: z.literal("resolve_approval"), approvalId: z.string(), status: ApprovalStatus, comment: z.string().nullable() }),
  /** The founder talks to the CEO. The CEO is the only agent who hears the founder. */
  z.object({ kind: z.literal("founder_message"), companyId: z.string(), text: z.string().min(1).max(2000) }),
  /** Change a company's caps. Written back into its company.md so the file stays the source of truth. */
  z.object({ kind: z.literal("set_company_budget"), companyId: z.string(), maxTurns: z.number().int().positive().max(100_000), maxTokens: z.number().int().positive().max(1_000_000_000) }),
  /** Edit an agent's persona. Written to companies/<slug>/agents/<role>.md and used from the next turn. */
  z.object({ kind: z.literal("set_agent_persona"), agentId: z.string(), name: z.string().min(1).max(60), style: z.string().max(2000), job: z.string().max(4000) }),
  z.object({ kind: z.literal("pause_company"), companyId: z.string() }),
  z.object({ kind: z.literal("resume_company"), companyId: z.string() }),
  z.object({ kind: z.literal("panic") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---------------------------------------------------------------------------
// Office layout: shared so server can place agents and client can draw them
// ---------------------------------------------------------------------------

export const OFFICE_WIDTH = 40;
export const OFFICE_DEPTH = 30;

/**
 * Office layout, modelled on the Scranton paper-company floor plan: entrance
 * and reception on the left, manager office and conference room along the
 * back wall, kitchen, an open bullpen of desk clusters in the middle,
 * accounting in the front-left corner, and an annex with the break room and
 * vending machines on the far right. x runs left to right, z runs back (0)
 * to front (OFFICE_DEPTH - 1).
 */
export type Room = {
  id: string;
  label: string;
  /** Tile bounds, inclusive. */
  x0: number; z0: number; x1: number; z1: number;
  /** Door tiles on the room boundary that stay walkable. */
  doors: { x: number; z: number }[];
};

export const OFFICE_ROOMS: Room[] = [
  { id: "ceo_office", label: "Manager", x0: 1, z0: 1, x1: 9, z1: 8, doors: [{ x: 9, z: 6 }, { x: 6, z: 8 }] },
  { id: "meeting_room", label: "Conference Room", x0: 10, z0: 1, x1: 19, z1: 8, doors: [{ x: 14, z: 8 }] },
  { id: "kitchen", label: "Kitchen", x0: 20, z0: 1, x1: 25, z1: 8, doors: [{ x: 22, z: 8 }] },
  { id: "hallway", label: "Back Hall", x0: 26, z0: 1, x1: 30, z1: 8, doors: [{ x: 28, z: 8 }, { x: 30, z: 4 }] },
  { id: "break_room", label: "Break Room", x0: 31, z0: 1, x1: 38, z1: 8, doors: [{ x: 31, z: 4 }, { x: 34, z: 8 }] },
  { id: "annex", label: "Annex", x0: 31, z0: 9, x1: 38, z1: 20, doors: [{ x: 31, z: 14 }, { x: 34, z: 9 }] },
  { id: "server_closet", label: "IT Closet", x0: 31, z0: 21, x1: 38, z1: 28, doors: [{ x: 31, z: 24 }] },
  { id: "restrooms", label: "Restrooms", x0: 26, z0: 20, x1: 30, z1: 28, doors: [{ x: 26, z: 23 }] },
  { id: "accounting", label: "Accounting", x0: 1, z0: 20, x1: 12, z1: 28, doors: [{ x: 12, z: 24 }, { x: 8, z: 20 }] },
  { id: "lobby", label: "Reception", x0: 1, z0: 9, x1: 9, z1: 19, doors: [{ x: 9, z: 14 }, { x: 9, z: 11 }] },
];

/** Named spots on the floor, in tile coordinates. */
export const HOME_SPOTS: Record<string, { x: number; z: number; zone: string }> = {
  // entrance and reception (left)
  entrance: { x: 1, z: 14, zone: "lobby" },
  lobby: { x: 5, z: 14, zone: "lobby" },
  reception: { x: 6, z: 11, zone: "lobby" },
  bell: { x: 7, z: 12, zone: "lobby" },
  couch: { x: 4, z: 17, zone: "lobby" },
  // back wall
  ceo_office: { x: 4, z: 4, zone: "exec" },
  meeting_room: { x: 14, z: 5, zone: "meeting" },
  kitchen: { x: 22, z: 4, zone: "break" },
  // bullpen (center): PM by the whiteboard, dev cluster of four, two front desks
  pm_desk: { x: 13, z: 12, zone: "exec" },
  whiteboard: { x: 11, z: 10, zone: "exec" },
  dev_pod_1: { x: 18, z: 12, zone: "dev" },
  dev_pod_2: { x: 22, z: 12, zone: "dev" },
  dev_pod_3: { x: 18, z: 16, zone: "dev" },
  dev_pod_4: { x: 22, z: 16, zone: "dev" },
  design_corner: { x: 17, z: 23, zone: "design" },
  qa_bench: { x: 22, z: 23, zone: "qa" },
  copier: { x: 14, z: 18, zone: "dev" },
  // front-left corner
  cfo_desk: { x: 5, z: 24, zone: "finance" },
  // annex (right)
  break_room: { x: 35, z: 4, zone: "break" },
  vending: { x: 37, z: 2, zone: "break" },
  floating_1: { x: 34, z: 11, zone: "annex" },
  floating_2: { x: 34, z: 15, zone: "annex" },
  floating_3: { x: 34, z: 19, zone: "annex" },
  server_closet: { x: 35, z: 25, zone: "it" },
};

export const ROLE_HOME: Record<RoleId, string> = {
  ceo: "ceo_office",
  pm: "pm_desk",
  engineer: "dev_pod_1",
  qa: "qa_bench",
  designer: "design_corner",
  backend: "dev_pod_2",
  frontend: "dev_pod_3",
  marketing: "floating_1",
  legal: "floating_2",
  hr: "floating_3",
  it: "server_closet",
  intern: "floating_1",
  cfo: "cfo_desk",
  receptionist: "reception",
};

export const ROLE_LABEL: Record<RoleId, string> = {
  ceo: "CEO",
  pm: "Product Manager",
  engineer: "Engineer",
  qa: "QA Tester",
  designer: "Designer",
  backend: "Backend Engineer",
  frontend: "Frontend Engineer",
  marketing: "Marketing Lead",
  legal: "Legal Counsel",
  hr: "HR Manager",
  it: "IT Support",
  intern: "Intern",
  cfo: "CFO",
  receptionist: "Receptionist",
};

export const DEFAULT_MODEL: Record<RoleId, ModelTier | null> = {
  ceo: "sonnet",
  pm: "sonnet",
  engineer: "opus",
  qa: "sonnet",
  designer: "sonnet",
  backend: "opus",
  frontend: "opus",
  marketing: "haiku",
  legal: "haiku",
  hr: "haiku",
  it: "sonnet",
  intern: "haiku",
  cfo: null,
  receptionist: null,
};
