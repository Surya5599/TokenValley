import { DEFAULT_MODEL, ROLE_HOME, type Agent, type Company, type Event, type RoleId, type ServerMessage, type Task } from "@tokenvalley/shared";

/**
 * Standalone demo (?demo=1): a synthetic snapshot with two companies and a
 * scripted loop of events that covers every event type in the shared union.
 */

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

function company(id: string, name: string, tagline: string, plot: number, palette: Company["palette"]): Company {
  return {
    id,
    slug: id,
    name,
    tagline,
    brief: `${name} builds something small and useful.`,
    workspacePath: "",
    live: false,
    rosterTemplate: "startup",
    palette,
    budget: { maxTurns: 200, maxTokens: 2_000_000 },
    spend: { turns: 42, inputTokens: 310_000, outputTokens: 95_000, estimatedUsd: 4.2 },
    priority: 5,
    phase: "building",
    plot,
  };
}

/** Demo personas: the comedic style block and the job block per role. */
const STYLE: Partial<Record<RoleId, string>> = {
  ceo: "Wants to be your friend first and your boss second. Never finishes a metaphor.\nEvery meeting is secretly a party. Declares things by saying them loudly.",
  pm: "Deadpan. Looks at the camera when something absurd happens.\nTurns every problem into a ticket, then quietly fixes it anyway.",
  engineer: "Assistant to the regional engineer. Beets, bears, build systems.\nAnswers questions with file paths and a safety briefing.",
  qa: "Judges everything, approves nothing. Pixel counts are a moral issue.\nKeeps a list. You are probably on it.",
  designer: "Quietly the most competent person in the building.\nTalks about colours like they are people with feelings.",
  it: "Has restarted it. Nobody is sure what else he does here.\nMay or may not have a desk.",
  intern: "Eager, counts on his fingers, asks 'is this normal?' about everything.\nBrought chili once. Never again.",
};
const JOB: Partial<Record<RoleId, string>> = {
  ceo: "Owns the company brief and the plan. Talks to the founder, approves scope, calls meetings, and decides what ships.",
  pm: "Breaks the brief into tasks, keeps the board honest, and unblocks engineers. Reports progress in #general.",
  engineer: "Implements tasks in the workspace, runs tests, and hands finished work to QA.",
  qa: "Writes and runs smoke tests, reports build status, and blocks shipping on regressions.",
  designer: "Owns design tokens and layout. Reviews UI changes before they reach QA.",
  it: "Keeps the build and tooling running. Responds to build failures.",
  intern: "Helps whoever asks. Learns the codebase by reading it.",
};

function agent(id: string, companyId: string, role: RoleId, name: string, status: Agent["status"] = "idle"): Agent {
  const kind: Agent["kind"] = role === "cfo" || role === "receptionist" ? "npc" : ["ceo", "pm", "engineer", "qa", "designer"].includes(role) ? "core" : "hire";
  return {
    id,
    companyId,
    role,
    kind,
    name,
    model: DEFAULT_MODEL[role],
    effort: "medium",
    status,
    currentTaskId: null,
    home: ROLE_HOME[role],
    parentAgentId: null,
    style: kind === "npc" ? "" : (STYLE[role] ?? ""),
    job: kind === "npc" ? "" : (JOB[role] ?? ""),
  };
}

function post(companyId: string, channel: string, from: string, text: string) {
  return { id: nextId("post"), companyId, channel, from, text, timestamp: Date.now() };
}

function task(id: string, companyId: string, title: string, ownerRole: RoleId | null, ownerAgentId: string | null, status: Task["status"]): Task {
  return { id, companyId, title, ownerRole, ownerAgentId, status, dependsOn: [], files: [], createdBy: "pm" };
}

const A = "pixel-forge";
const B = "ledger-labs";
const C = "null-pointer";

const pf = {
  ceo: agent("pf-ceo", A, "ceo", "Michael (CEO)"),
  pm: agent("pf-pm", A, "pm", "Jim (PM)"),
  eng: agent("pf-eng", A, "engineer", "Dwight (Eng)", "working"),
  qa: agent("pf-qa", A, "qa", "Angela (QA)"),
  des: agent("pf-des", A, "designer", "Pam (Design)"),
  it: agent("pf-it", A, "it", "Creed (IT)"),
  cfo: agent("pf-cfo", A, "cfo", "Oscar (CFO)"),
  rec: agent("pf-rec", A, "receptionist", "Erin (Front desk)"),
};
const ll = {
  ceo: agent("ll-ceo", B, "ceo", "David (CEO)"),
  pm: agent("ll-pm", B, "pm", "Jan (PM)"),
  eng: agent("ll-eng", B, "engineer", "Darryl (Eng)", "working"),
  qa: agent("ll-qa", B, "qa", "Holly (QA)"),
};

const tasksA: Task[] = [
  task("pf-t1", A, "Build landing page", "engineer", pf.eng.id, "in_progress"),
  task("pf-t2", A, "Design tokens", "designer", pf.des.id, "backlog"),
  task("pf-t3", A, "Write smoke tests", "qa", pf.qa.id, "backlog"),
  task("pf-t4", A, "Set up CI", "engineer", null, "review"),
];
const tasksB: Task[] = [
  task("ll-t1", B, "Parse CSV statements", "engineer", ll.eng.id, "in_progress"),
  task("ll-t2", B, "Reconcile totals", "qa", ll.qa.id, "backlog"),
];

pf.eng.currentTaskId = "pf-t1";
ll.eng.currentTaskId = "ll-t1";

export function demoSnapshot(): Extract<ServerMessage, { kind: "snapshot" }> {
  return {
    kind: "snapshot",
    town: { focusedCompanyId: A, poolSize: 3 },
    companies: [
      company(A, "Dunder Mindflin", "Limitless paper in a paperless world.", 0, { primary: "#3d5a80", secondary: "#98c1d9", accent: "#ee6c4d", floor: "#d8c3a5", wall: "#e0fbfc" }),
      company(B, "Sabre Labs", "Printers that print. Mostly.", 1, { primary: "#386641", secondary: "#a7c957", accent: "#f2e8cf", floor: "#c9b79c", wall: "#f7f7f2" }),
    ],
    agents: [...Object.values(pf), ...Object.values(ll)],
    tasks: [...tasksA, ...tasksB],
    recentEvents: [],
  };
}

type EventFactory = () => Event | null;

/** Builds the scripted sequence. `first` is true on the first loop only. */
function buildScript(): EventFactory[] {
  const base = (companyId: string) => ({ id: nextId("evt"), companyId, timestamp: Date.now() });
  const intern = agent("pf-intern", A, "intern", "Kevin (Intern)");
  const contractor: Agent = { ...agent("pf-helper", A, "engineer", "Ryan (temp)"), kind: "contractor", model: "haiku", parentAgentId: pf.eng.id };
  const approval = { id: "pf-ap1", companyId: A, kind: "ship" as const, summary: "Ship landing page v1: nav fix, design tokens, smoke tests green. Merge to main?", status: "pending" as const, founderComment: null };
  const FOUNDER = "founder";
  const spendWarn = { turns: 165, inputTokens: 1_500_000, outputTokens: 310_000, estimatedUsd: 14.8 };
  const budgetA = { maxTurns: 200, maxTokens: 2_000_000 };
  let founded = false;
  let personaFlip = false;

  return [
    () => ({ ...base(A), type: "agent_spawned", agentId: intern.id, agent: { ...intern } }),
    () => ({ ...base(A), type: "task_created", task: task("pf-t5", A, "Fix nav on mobile", "engineer", null, "backlog") }),
    () => ({ ...base(A), type: "task_started", agentId: pf.eng.id, task: { ...task("pf-t5", A, "Fix nav on mobile", "engineer", pf.eng.id, "in_progress") } }),
    () => ({ ...base(A), type: "tool_read_file", agentId: pf.eng.id, path: "src/components/Nav.tsx" }),
    () => ({ ...base(A), type: "tool_write_file", agentId: pf.eng.id, path: "src/components/Nav.tsx" }),
    () => ({ ...base(A), type: "tool_shell", agentId: pf.eng.id, command: "pnpm test" }),
    () => ({ ...base(A), type: "agent_status", agentId: pf.qa.id, status: "working", line: "Writing smoke tests" }),
    () => ({
      ...base(A),
      type: "send_message",
      agentId: pf.pm.id,
      toAgentId: pf.eng.id,
      message: { id: nextId("msg"), companyId: A, from: pf.pm.id, to: pf.eng.id, text: "Can we ship the nav fix by Friday?", taskId: "pf-t5", timestamp: Date.now() },
    }),
    () => ({
      ...base(A),
      type: "send_message",
      agentId: pf.qa.id,
      toAgentId: pf.des.id,
      message: { id: nextId("msg"), companyId: A, from: pf.qa.id, to: pf.des.id, text: "The button is two pixels off. I measured.", taskId: null, timestamp: Date.now() },
    }),
    // #general banter round.
    () => ({ ...base(A), type: "post_message", agentId: pf.pm.id, post: post(A, "general", pf.pm.id, "Morning all! Nav fix is the priority today. Does that make sense?") }),
    () => ({ ...base(A), type: "post_message", agentId: pf.eng.id, post: post(A, "general", pf.eng.id, "src/components/Nav.tsx. On it.") }),
    () => ({ ...base(A), type: "post_message", agentId: pf.qa.id, post: post(A, "general", pf.qa.id, "I will be measuring it.") }),
    () => ({ ...base(A), type: "post_message", agentId: pf.qa.id, post: post(A, "general", pf.qa.id, "In pixels. Individually.") }),
    () => ({ ...base(A), type: "post_message", agentId: pf.des.id, post: post(A, "general", pf.des.id, "If anyone touches the blue, the blue will know.") }),
    () => ({ ...base(B), type: "task_started", agentId: ll.qa.id, task: { ...task("ll-t2", B, "Reconcile totals", "qa", ll.qa.id, "in_progress") } }),
    () => ({ ...base(A), type: "call_meeting", agentId: pf.ceo.id, meetingId: "pf-m1", attendeeIds: [pf.pm.id, pf.des.id, pf.eng.id], topic: "Synergy alignment all-hands" }),
    () => ({ ...base(A), type: "channel_opened", channel: "meeting-1", title: "Synergy alignment all-hands", memberIds: [pf.ceo.id, pf.pm.id, pf.des.id, pf.eng.id] }),
    // Meeting thread.
    () => ({ ...base(A), type: "post_message", agentId: pf.ceo.id, post: post(A, "meeting-1", pf.ceo.id, "Team. Let's circle back on the nav and really boil the ocean here.") }),
    () => ({ ...base(A), type: "post_message", agentId: pf.pm.id, post: post(A, "meeting-1", pf.pm.id, "Boiling is ticket PF-5. I made a sub-ticket for the lid.") }),
    () => ({ ...base(A), type: "post_message", agentId: pf.eng.id, post: post(A, "meeting-1", pf.eng.id, "Nav.tsx line 42. Fixed by Friday.") }),
    () => ({ ...base(A), type: "post_message", agentId: pf.des.id, post: post(A, "meeting-1", pf.des.id, "Friday is fine. The blue needs the weekend anyway.") }),
    () => ({ ...base(A), type: "tool_read_file", agentId: pf.qa.id, path: "tests/smoke.test.ts" }),
    () => ({ ...base(A), type: "meeting_ended", meetingId: "pf-m1" }),
    () => ({ ...base(A), type: "task_blocked", agentId: pf.eng.id, taskId: "pf-t5", blockedByRole: "designer", reason: "Need final nav colors" }),
    () => ({ ...base(A), type: "handoff", agentId: pf.des.id, taskId: "pf-t2", toAgentId: pf.eng.id, note: "Tokens are in tokens.json. Do not touch the blue." }),
    () => ({ ...base(A), type: "task_updated", task: task("pf-t5", A, "Fix nav on mobile", "engineer", pf.eng.id, "in_progress") }),
    () => ({ ...base(A), type: "agent_status", agentId: pf.eng.id, status: "working", line: "Applying design tokens" }),
    () => ({ ...base(A), type: "build_failed", summary: "tsc: 3 errors in Nav.tsx" }),
    () => ({ ...base(A), type: "tool_write_file", agentId: pf.eng.id, path: "src/components/Nav.tsx" }),
    () => ({ ...base(A), type: "build_passed", summary: "all green" }),
    () => ({ ...base(A), type: "task_done", agentId: pf.eng.id, taskId: "pf-t5" }),
    () => ({
      ...base(A),
      type: "send_message",
      agentId: FOUNDER,
      toAgentId: pf.ceo.id,
      message: { id: nextId("msg"), companyId: A, from: FOUNDER, to: pf.ceo.id, text: "How close are we to shipping?", taskId: null, timestamp: Date.now() },
    }),
    () => ({
      ...base(A),
      type: "send_message",
      agentId: pf.ceo.id,
      toAgentId: FOUNDER,
      message: { id: nextId("msg"), companyId: A, from: pf.ceo.id, to: FOUNDER, text: "Leveraging synergies: nav fix is done, build is green. Ready for your sign-off.", taskId: null, timestamp: Date.now() },
    }),
    () => ({ ...base(A), type: "request_approval", agentId: pf.ceo.id, approval: { ...approval, status: "pending" } }),
    () => ({ ...base(B), type: "budget_warning", spend: { turns: 170, inputTokens: 1_700_000, outputTokens: 200_000, estimatedUsd: 16.1 }, budget: budgetA }),
    () => ({ ...base(A), type: "approval_resolved", approval: { ...approval, status: "approved", founderComment: "Ship it." } }),
    () => ({ ...base(A), type: "company_phase", phase: "building" }),
    () => ({ ...base(A), type: "subagent_spawned", agentId: pf.eng.id, contractor: { ...contractor } }),
    () => ({ ...base(A), type: "tool_shell", agentId: contractor.id, command: "pnpm lint" }),
    () => ({ ...base(A), type: "subagent_finished", agentId: pf.eng.id, contractorId: contractor.id }),
    () => ({ ...base(A), type: "budget_warning", spend: spendWarn, budget: budgetA }),
    () => ({ ...base(A), type: "spend_updated", spend: { ...spendWarn, turns: 168 } }),
    () => ({ ...base(A), type: "idle_timeout", agentId: pf.qa.id }),
    () => ({ ...base(A), type: "agent_model_changed", agentId: pf.eng.id, model: "sonnet" }),
    () => ({ ...base(B), type: "budget_exhausted", spend: { turns: 200, inputTokens: 2_000_000, outputTokens: 250_000, estimatedUsd: 19.5 }, budget: budgetA }),
    () => {
      if (founded) return null;
      founded = true;
      return {
        ...base(C),
        type: "company_founded",
        company: company(C, "Scott Paper Co.", "A paper company. In a closet.", 2, { primary: "#5a189a", secondary: "#9d4edd", accent: "#ffd60a", floor: "#cdb4db", wall: "#f1e4f3" }),
      };
    },
    () => ({ ...base(A), type: "agent_status", agentId: pf.qa.id, status: "idle", line: "Back from coffee" }),
    () => {
      // The founder (or the script) rewrites the CEO's persona; alternates each loop.
      personaFlip = !personaFlip;
      return personaFlip
        ? { ...base(A), type: "agent_persona_changed", agentId: pf.ceo.id, name: "Michael (CEO)", style: "Has read one management book. Quotes it wrong.\nStill calls every meeting a surprise party.", job: JOB.ceo ?? "" }
        : { ...base(A), type: "agent_persona_changed", agentId: pf.ceo.id, name: "Michael (CEO)", style: STYLE.ceo ?? "", job: JOB.ceo ?? "" };
    },
    () => ({ ...base(A), type: "post_message", agentId: pf.ceo.id, post: post(A, "general", pf.ceo.id, "Great synergy today, everyone. Let's take this offline. Online.") }),
    () => ({ ...base(A), type: "agent_retired", agentId: intern.id }),
    () => ({ ...base(B), type: "company_phase", phase: "building" }),
    () => ({ ...base(B), type: "spend_updated", spend: { turns: 120, inputTokens: 900_000, outputTokens: 120_000, estimatedUsd: 9.4 } }),
    () => ({ ...base(A), type: "agent_model_changed", agentId: pf.eng.id, model: "opus" }),
  ];
}

/** Starts the demo: sends a snapshot, then one scripted event every `intervalMs`. Returns a stop function. */
export function startDemo(dispatch: (m: ServerMessage) => void, intervalMs = 1500): () => void {
  dispatch(demoSnapshot());
  const script = buildScript();
  let i = 0;
  const timer = window.setInterval(() => {
    const factory = script[i % script.length];
    i++;
    if (!factory) return;
    const event = factory();
    if (event) dispatch({ kind: "event", event });
  }, intervalMs);
  return () => window.clearInterval(timer);
}
