import { FoundCompanyInput, ROLE_LABEL, type Company, type CompanyPhase, type Event, type ModelTier, type RoleId, type TaskStatus } from "@tokenvalley/shared";
import { CHANNEL_FOUNDER, CHANNEL_GENERAL, FOUNDER_ID, type CameraMode, type ChatLine, type CompanyStatus, type PanelTab, type Store } from "../state/store";
import { ROLE_COLOR } from "../world/character";

export interface OverlayActions {
  focusCompany: (companyId: string) => void;
  selectAgent: (agentId: string) => void;
  setCamera: (mode: CameraMode) => void;
  setSpeed: (speed: number) => void;
  foundCompany: (input: FoundCompanyInput) => void;
  resolveApproval: (approvalId: string, status: "approved" | "rejected", comment: string | null) => void;
  sendFounderMessage: (companyId: string, text: string) => void;
  setAgentPersona: (agentId: string, name: string, style: string, job: string) => void;
  setCompanyBudget: (companyId: string, maxTurns: number, maxTokens: number) => void;
  pauseCompany: (companyId: string) => void;
  resumeCompany: (companyId: string) => void;
  panic: () => void;
}

type MenuId = "company" | "actions" | "view" | "help";

const MENU_IDS: { id: MenuId; label: string }[] = [
  { id: "company", label: "Company" },
  { id: "actions", label: "Actions" },
  { id: "view", label: "View" },
  { id: "help", label: "Help" },
];

/** One row of a dropdown. `divider` and `heading` rows carry no action. */
interface MenuItem {
  label?: string;
  divider?: boolean;
  heading?: string;
  onSelect?: () => void;
  disabled?: boolean;
  checked?: boolean;
  /** Muted key hint on the right. */
  hint?: string;
  /** Leading company status dot. */
  dot?: CompanyStatus;
  /** Muted secondary text after the label. */
  sub?: string;
  /** Right-aligned markers (LIVE, needs you). */
  right?: HTMLElement[];
  danger?: boolean;
  /** Visually armed (the panic "Are you sure?" step). */
  armed?: boolean;
  /** The menu stays open after selecting this item. */
  keepOpen?: boolean;
  title?: string;
}

const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ["1"], what: "Valley camera" },
  { keys: ["2"], what: "Office camera" },
  { keys: ["3"], what: "Follow the selected agent" },
  { keys: ["4"], what: "Meeting camera" },
  { keys: ["5"], what: "Walk (first person)" },
  { keys: ["Esc"], what: "Back to the office or valley; close menus and dialogs" },
  { keys: ["W", "A", "S", "D"], what: "Walk in first person; mouse to look; click to capture the mouse" },
  { keys: ["Drag"], what: "Orbit the camera" },
  { keys: ["Wheel"], what: "Zoom" },
  { keys: ["←", "→"], what: "Switch between open menus" },
  { keys: ["↑", "↓", "Enter"], what: "Move through a menu and choose an item" },
];

const INBOX_LIMIT = 8;
/** Consecutive messages by one author within this window share a header. */
const COLLAPSE_MS = 2 * 60 * 1000;
const PERSONA_NAME_MAX = 60;
const PERSONA_STYLE_MAX = 2000;
const PERSONA_JOB_MAX = 4000;
/** Mirrors the limits of the set_company_budget client message in the shared schema. */
const BUDGET_TURNS_MAX = 100_000;
const BUDGET_TOKENS_MAX = 1_000_000_000;
const BUDGET_TOPUPS = [25, 100];

/** Phases that get a one-line notice above the chat, telling the founder what to do next. */
const PHASE_NOTICE: Partial<Record<CompanyPhase, string>> = {
  awaiting_approval: "Waiting on you: open Actions to approve or reject.",
  out_of_budget: "Out of budget: edit the budget to resume.",
  paused: "Paused: resume from Actions.",
  shipped: "Shipped: the CEO still answers messages; new work reopens the company.",
};

const PANEL_TABS: { tab: PanelTab; label: string }[] = [
  { tab: "company", label: "Company" },
  { tab: "chat", label: "Chat" },
];

const CAMERA_MODES: { mode: CameraMode; label: string; key: string }[] = [
  { mode: "valley", label: "Valley", key: "1" },
  { mode: "office", label: "Office", key: "2" },
  { mode: "follow", label: "Follow", key: "3" },
  { mode: "meeting", label: "Meeting", key: "4" },
  { mode: "firstperson", label: "Walk", key: "5" },
];

const ROSTER_TEMPLATES = ["startup", "solo-founder", "enterprise"];
const PICKABLE_ROLES: RoleId[] = ["ceo", "pm", "engineer", "qa", "designer"];
const MODEL_CHOICES: (ModelTier | "inherit")[] = ["inherit", "opus", "sonnet", "haiku"];

const SPEEDS = [1, 2, 4];

const KANBAN: { status: TaskStatus; label: string }[] = [
  { status: "backlog", label: "Backlog" },
  { status: "in_progress", label: "Doing" },
  { status: "blocked", label: "Blocked" },
  { status: "review", label: "Review" },
  { status: "done", label: "Done" },
];

/** Everything visible about a menu row, so a dropdown is only rebuilt when a row changes. */
function menuItemKey(i: MenuItem): string {
  if (i.divider) return "-";
  if (i.heading !== undefined) return `#${i.heading}`;
  const right = (i.right ?? []).map((r) => r.textContent).join(",");
  return [i.label, i.disabled ? 1 : 0, i.checked ? 1 : 0, i.hint, i.dot, i.sub, right, i.danger ? 1 : 0, i.armed ? 1 : 0, i.title].join("|");
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function firstName(name: string): string {
  return name.split(/[\s(]/)[0] ?? name;
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? "";
}

function cssColor(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

/** Mixes a packed RGB colour toward white so dark role colours stay readable as text on the panel. */
function lightened(n: number, amount = 0.45): string {
  const ch = (shift: number) => Math.round(((n >> shift) & 0xff) + (255 - ((n >> shift) & 0xff)) * amount);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function base(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** One-line description of an event for the activity feed. */
export function describeEvent(e: Event, store: Store): { text: string; tone: "normal" | "alert" | "good" } {
  const name = (id: string) => (id === FOUNDER_ID ? "Founder" : (store.agents.get(id)?.name ?? id));
  const task = (id: string) => store.tasks.get(id)?.title ?? id;
  switch (e.type) {
    case "company_founded":
      return { text: `Founded ${e.company.name}`, tone: "good" };
    case "company_phase":
      return { text: `Phase: ${e.phase.replace(/_/g, " ")}`, tone: "normal" };
    case "agent_spawned":
      return { text: `${e.agent.name} joined as ${ROLE_LABEL[e.agent.role]}`, tone: "normal" };
    case "agent_retired":
      return { text: `${name(e.agentId)} left`, tone: "normal" };
    case "agent_model_changed":
      return { text: `${name(e.agentId)} switched to ${e.model.toUpperCase()}`, tone: "normal" };
    case "task_started":
      return { text: `${name(e.agentId)} started: ${e.task.title}`, tone: "normal" };
    case "task_blocked":
      return { text: `${name(e.agentId)} blocked by ${ROLE_LABEL[e.blockedByRole]}: ${e.reason}`, tone: "alert" };
    case "task_done":
      return { text: `${name(e.agentId)} finished: ${task(e.taskId)}`, tone: "good" };
    case "task_created":
      return { text: `New task: ${e.task.title}`, tone: "normal" };
    case "task_updated":
      return { text: `Task "${e.task.title}" is now ${e.task.status.replace(/_/g, " ")}`, tone: "normal" };
    case "tool_read_file":
      return { text: `${name(e.agentId)} read ${base(e.path)}`, tone: "normal" };
    case "tool_write_file":
      return { text: `${name(e.agentId)} wrote ${base(e.path)}`, tone: "normal" };
    case "tool_shell":
      return { text: `${name(e.agentId)} ran: ${e.command}`, tone: "normal" };
    case "send_message":
      return { text: `${name(e.agentId)} to ${name(e.toAgentId)}: ${e.message.text}`, tone: "normal" };
    case "post_message":
      return { text: `${name(e.agentId)} in #${e.post.channel}: ${e.post.text}`, tone: "normal" };
    case "channel_opened":
      return { text: `Opened #${e.channel}: ${e.title}`, tone: "normal" };
    case "agent_persona_changed":
      return { text: `${e.name} has a new persona`, tone: "normal" };
    case "handoff":
      return { text: `${name(e.agentId)} handed "${task(e.taskId)}" to ${name(e.toAgentId)}`, tone: "normal" };
    case "call_meeting":
      return { text: `${name(e.agentId)} called a meeting: ${e.topic}`, tone: "normal" };
    case "meeting_ended":
      return { text: "Meeting ended", tone: "normal" };
    case "build_failed":
      return { text: `Build failed: ${e.summary}`, tone: "alert" };
    case "build_passed":
      return { text: `Build passed: ${e.summary}`, tone: "good" };
    case "budget_warning":
      return { text: `Budget warning: ${e.spend.turns}/${e.budget.maxTurns} turns`, tone: "alert" };
    case "budget_exhausted":
      return { text: "Budget exhausted", tone: "alert" };
    case "budget_changed":
      return { text: `Budget set to ${e.budget.maxTurns} turns, ${fmtTokens(e.budget.maxTokens)} tokens`, tone: "good" };
    case "spend_updated":
      return { text: `Spend: ${e.spend.turns} turns, ${fmtTokens(e.spend.inputTokens + e.spend.outputTokens)} tokens`, tone: "normal" };
    case "request_approval":
      return { text: `${name(e.agentId)} requests approval: ${e.approval.summary}`, tone: "alert" };
    case "approval_resolved":
      return { text: `Approval ${e.approval.status}${e.approval.founderComment ? `: ${e.approval.founderComment}` : ""}`, tone: e.approval.status === "approved" ? "good" : "alert" };
    case "subagent_spawned":
      return { text: `${name(e.agentId)} spawned a helper`, tone: "normal" };
    case "subagent_finished":
      return { text: `${name(e.agentId)}'s helper finished`, tone: "normal" };
    case "idle_timeout":
      return { text: `${name(e.agentId)} went for coffee`, tone: "normal" };
    case "agent_status":
      return { text: `${name(e.agentId)}: ${e.line}`, tone: "normal" };
  }
}

/** The 2D DOM overlay. Re-renders from the store on every change (rAF-throttled). */
export class Overlay {
  private readonly root: HTMLElement;
  private readonly menus: HTMLElement;
  private readonly menuEls = new Map<MenuId, { wrap: HTMLElement; button: HTMLButtonElement; label: HTMLElement; count: HTMLElement; dropdown: HTMLElement }>();
  private openMenuId: MenuId | null = null;
  /** Content signature of each open dropdown, to skip needless rebuilds. */
  private readonly menuKeys = new Map<MenuId, string>();
  private panicArmed = false;
  private readonly bell: HTMLButtonElement;
  private readonly bellCount: HTMLElement;
  private readonly conn: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly feedList: HTMLElement;
  private readonly infoBackdrop: HTMLElement;
  private readonly infoBody: HTMLElement;
  private readonly modalBackdrop: HTMLElement;
  private readonly modalError: HTMLElement;
  private readonly modalForm: HTMLFormElement;
  private readonly approvalBackdrop: HTMLElement;
  private readonly approvalBody: HTMLElement;
  private readonly approvalComment: HTMLTextAreaElement;
  private approvalOpenId: string | null = null;
  private readonly personaBackdrop: HTMLElement;
  private readonly personaTitle: HTMLElement;
  private readonly personaName: HTMLInputElement;
  private readonly personaStyle: HTMLTextAreaElement;
  private readonly personaJob: HTMLTextAreaElement;
  private readonly personaStyleField: HTMLElement;
  private readonly personaJobField: HTMLElement;
  private readonly personaNpcNote: HTMLElement;
  private readonly personaError: HTMLElement;
  private personaOpenId: string | null = null;
  private readonly budgetBackdrop: HTMLElement;
  private readonly budgetTitle: HTMLElement;
  private readonly budgetTurns: HTMLInputElement;
  private readonly budgetTokens: HTMLInputElement;
  private readonly budgetTurnsUsed: HTMLElement;
  private readonly budgetTokensUsed: HTMLElement;
  private readonly budgetTokensHint: HTMLElement;
  private readonly budgetFileHint: HTMLElement;
  private readonly budgetError: HTMLElement;
  private budgetOpenId: string | null = null;
  private inboxDraft = "";
  private scheduled = false;
  private lastFeedKey = "";
  /** Chat view scroll memory: stick to the bottom unless the founder scrolled up. */
  private chatAtBottom = true;
  private chatScrollTop = 0;
  private chatScrollKey = "";

  constructor(
    root: HTMLElement,
    private readonly store: Store,
    private readonly actions: OverlayActions,
  ) {
    this.root = root;
    const top = el("div", "topbar");
    top.append(el("div", "brand", "TokenValley"));
    this.menus = el("div", "menus");
    this.menus.setAttribute("role", "menubar");
    for (const m of MENU_IDS) {
      const wrap = el("div", "menu");
      wrap.dataset.menu = m.id;
      const button = el("button", "menu-btn");
      button.type = "button";
      button.setAttribute("aria-haspopup", "true");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", `${m.label} menu`);
      const label = el("span", "label", m.label);
      const count = el("span", "count");
      const caret = el("span", "caret", "▾");
      button.append(label, count, caret);
      button.addEventListener("click", () => (this.openMenuId === m.id ? this.closeMenus() : this.openMenu(m.id)));
      button.addEventListener("mouseenter", () => {
        if (this.openMenuId !== null && this.openMenuId !== m.id) this.openMenu(m.id);
      });
      const dropdown = el("div", "dropdown");
      dropdown.setAttribute("role", "menu");
      wrap.append(button, dropdown);
      this.menus.append(wrap);
      this.menuEls.set(m.id, { wrap, button, label, count, dropdown });
    }
    this.menus.addEventListener("keydown", (e) => this.onMenuKey(e));
    top.append(this.menus);
    top.append(el("div", "spacer"));
    this.bell = el("button", "bell");
    this.bell.type = "button";
    this.bell.title = "Something needs the founder";
    this.bell.setAttribute("aria-label", "Pending requests");
    this.bell.innerHTML =
      '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 1.5a1 1 0 0 1 1 1v.4a4.5 4.5 0 0 1 3.5 4.4V10l1.3 1.6a.6.6 0 0 1-.5 1H2.7a.6.6 0 0 1-.5-1L3.5 10V7.3A4.5 4.5 0 0 1 7 2.9v-.4a1 1 0 0 1 1-1Zm-1.8 12h3.6a1.8 1.8 0 0 1-3.6 0Z"/></svg>';
    this.bellCount = el("span", "count");
    this.bell.append(this.bellCount);
    this.bell.addEventListener("click", () => this.openMenu("actions", true));
    top.append(this.bell);
    this.conn = el("div", "conn disconnected", "disconnected");
    top.append(this.conn);
    root.append(top);

    document.addEventListener("pointerdown", (e) => {
      if (this.openMenuId === null) return;
      if (!(e.target instanceof Node) || !this.menus.contains(e.target)) this.closeMenus();
    });

    this.panel = el("div", "panel");
    root.append(this.panel);

    this.feed = el("div", "feed");
    this.feed.append(el("div", "title", "Activity"));
    this.feedList = el("div", "list");
    this.feed.append(this.feedList);
    root.append(this.feed);

    // Info modal (keyboard shortcuts, about).
    this.infoBackdrop = el("div", "modal-backdrop");
    const imodal = el("div", "modal info");
    this.infoBody = el("div");
    imodal.append(this.infoBody);
    const iactions = el("div", "actions");
    const iclose = el("button", "primary", "Close");
    iclose.type = "button";
    iclose.addEventListener("click", () => this.closeInfo());
    iactions.append(iclose);
    imodal.append(iactions);
    this.infoBackdrop.append(imodal);
    this.infoBackdrop.addEventListener("click", (e) => {
      if (e.target === this.infoBackdrop) this.closeInfo();
    });
    root.append(this.infoBackdrop);

    // First-person HUD.
    root.append(el("div", "crosshair"));
    root.append(el("div", "fp-hint", "WASD to walk, mouse to look, Esc to leave. Click to capture the mouse."));

    // Found-company modal.
    this.modalBackdrop = el("div", "modal-backdrop");
    const modal = el("div", "modal");
    modal.append(el("h2", "", "Found a company"));
    this.modalForm = this.buildFoundForm();
    modal.append(this.modalForm);
    this.modalError = el("div", "error");
    modal.append(this.modalError);
    this.modalBackdrop.append(modal);
    this.modalBackdrop.addEventListener("click", (e) => {
      if (e.target === this.modalBackdrop) this.closeFoundModal();
    });
    root.append(this.modalBackdrop);

    // Approval modal.
    this.approvalBackdrop = el("div", "modal-backdrop");
    const amodal = el("div", "modal approval");
    this.approvalBody = el("div");
    amodal.append(this.approvalBody);
    amodal.append(el("label", "", "Comment (optional)"));
    this.approvalComment = el("textarea");
    this.approvalComment.placeholder = "Notes for the CEO";
    amodal.append(this.approvalComment);
    const aactions = el("div", "actions");
    const later = el("button", "", "Later");
    later.type = "button";
    later.addEventListener("click", () => this.closeApproval());
    const reject = el("button", "danger", "Reject");
    reject.type = "button";
    reject.addEventListener("click", () => this.submitApproval("rejected"));
    const approve = el("button", "primary", "Approve");
    approve.type = "button";
    approve.addEventListener("click", () => this.submitApproval("approved"));
    aactions.append(later, reject, approve);
    amodal.append(aactions);
    this.approvalBackdrop.append(amodal);
    this.approvalBackdrop.addEventListener("click", (e) => {
      if (e.target === this.approvalBackdrop) this.closeApproval();
    });
    root.append(this.approvalBackdrop);

    // Persona editor modal.
    this.personaBackdrop = el("div", "modal-backdrop");
    const pmodal = el("div", "modal persona");
    this.personaTitle = el("h2", "", "Edit persona");
    pmodal.append(this.personaTitle);
    const pform = el("form");
    const pfield = (label: string, input: HTMLElement, hint?: string) => {
      const wrap = el("div");
      wrap.append(el("label", "", label), input);
      if (hint) wrap.append(el("div", "hintline", hint));
      return wrap;
    };
    this.personaName = el("input");
    this.personaName.name = "name";
    this.personaName.type = "text";
    this.personaName.maxLength = PERSONA_NAME_MAX;
    this.personaName.placeholder = "Dana (CEO)";
    pform.append(pfield("Name", this.personaName));
    this.personaNpcNote = el("div", "npc-note", "This is an NPC: there is no model behind them, so they have no style or job. Only the name can change.");
    pform.append(this.personaNpcNote);
    this.personaStyle = el("textarea");
    this.personaStyle.name = "style";
    this.personaStyle.rows = 4;
    this.personaStyle.maxLength = PERSONA_STYLE_MAX;
    this.personaStyleField = pfield("Style", this.personaStyle, "How they talk. Comedy lives here.");
    pform.append(this.personaStyleField);
    this.personaJob = el("textarea");
    this.personaJob.name = "job";
    this.personaJob.rows = 8;
    this.personaJob.maxLength = PERSONA_JOB_MAX;
    this.personaJobField = pfield("Job", this.personaJob, "What they are responsible for. Keep comedy out.");
    pform.append(this.personaJobField);
    this.personaError = el("div", "error");
    pform.append(this.personaError);
    const pactions = el("div", "actions");
    const pcancel = el("button", "", "Cancel");
    pcancel.type = "button";
    pcancel.addEventListener("click", () => this.closePersona());
    const psave = el("button", "primary", "Save");
    psave.type = "submit";
    pactions.append(pcancel, psave);
    pform.append(pactions);
    pform.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submitPersona();
    });
    pmodal.append(pform);
    this.personaBackdrop.append(pmodal);
    this.personaBackdrop.addEventListener("click", (e) => {
      if (e.target === this.personaBackdrop) this.closePersona();
    });
    root.append(this.personaBackdrop);

    // Budget editor modal.
    this.budgetBackdrop = el("div", "modal-backdrop");
    const bmodal = el("div", "modal budget");
    this.budgetTitle = el("h2", "", "Budget");
    bmodal.append(this.budgetTitle);
    const bform = el("form");
    const bfield = (label: string, input: HTMLElement, used: HTMLElement, hint?: HTMLElement) => {
      const wrap = el("div");
      wrap.append(el("label", "", label), input);
      if (hint) wrap.append(hint);
      wrap.append(used);
      return wrap;
    };
    this.budgetTurns = el("input");
    this.budgetTurns.name = "maxTurns";
    this.budgetTurns.type = "number";
    this.budgetTurns.min = "1";
    this.budgetTurns.step = "1";
    this.budgetTurns.max = String(BUDGET_TURNS_MAX);
    this.budgetTurnsUsed = el("div", "hintline used");
    bform.append(bfield("Turn cap", this.budgetTurns, this.budgetTurnsUsed));
    const topups = el("div", "topups");
    for (const n of BUDGET_TOPUPS) {
      const b = el("button", "topup", `+${n} turns`);
      b.type = "button";
      b.title = `Add ${n} turns to the turn cap`;
      b.addEventListener("click", () => {
        const cur = Math.max(0, Math.floor(Number(this.budgetTurns.value) || 0));
        this.budgetTurns.value = String(Math.min(BUDGET_TURNS_MAX, cur + n));
        this.budgetError.textContent = "";
      });
      topups.append(b);
    }
    bform.append(topups);
    this.budgetTokens = el("input");
    this.budgetTokens.name = "maxTokens";
    this.budgetTokens.type = "number";
    this.budgetTokens.min = "1";
    this.budgetTokens.step = "1";
    this.budgetTokens.max = String(BUDGET_TOKENS_MAX);
    this.budgetTokensHint = el("div", "hintline");
    this.budgetTokensUsed = el("div", "hintline used");
    bform.append(bfield("Token cap", this.budgetTokens, this.budgetTokensUsed, this.budgetTokensHint));
    this.budgetTokens.addEventListener("input", () => this.renderBudgetHint());
    this.budgetFileHint = el("div", "npc-note");
    bform.append(this.budgetFileHint);
    this.budgetError = el("div", "error");
    bform.append(this.budgetError);
    const bactions = el("div", "actions");
    const bcancel = el("button", "", "Cancel");
    bcancel.type = "button";
    bcancel.addEventListener("click", () => this.closeBudget());
    const bsave = el("button", "primary", "Save");
    bsave.type = "submit";
    bactions.append(bcancel, bsave);
    bform.append(bactions);
    bform.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submitBudget();
    });
    bmodal.append(bform);
    this.budgetBackdrop.append(bmodal);
    this.budgetBackdrop.addEventListener("click", (e) => {
      if (e.target === this.budgetBackdrop) this.closeBudget();
    });
    root.append(this.budgetBackdrop);

    store.onChange(() => this.schedule());
    this.render();
  }

  // ---- menu bar ------------------------------------------------------------------

  isMenuOpen(): boolean {
    return this.openMenuId !== null;
  }

  /** Opens one menu (closing any other). With `focusFirst`, keyboard focus lands on its first item. */
  openMenu(id: MenuId, focusFirst = false): void {
    if (this.openMenuId !== id) this.panicArmed = false;
    this.openMenuId = id;
    this.renderMenus();
    const m = this.menuEls.get(id);
    if (!m) return;
    if (focusFirst) this.focusMenuItem(id, 0);
    else m.button.focus();
  }

  /** Closes the open menu; with `refocus`, keyboard focus returns to its button. */
  closeMenus(refocus = false): void {
    const prev = this.openMenuId;
    this.openMenuId = null;
    this.panicArmed = false;
    this.renderMenus();
    if (refocus && prev) this.menuEls.get(prev)?.button.focus();
  }

  private menuItemsOf(id: MenuId): HTMLButtonElement[] {
    const m = this.menuEls.get(id);
    return m ? [...m.dropdown.querySelectorAll<HTMLButtonElement>("button.mi:not(:disabled)")] : [];
  }

  /** Focuses the enabled item at `index` (negative counts from the end, wrapping). */
  private focusMenuItem(id: MenuId, index: number): void {
    const items = this.menuItemsOf(id);
    if (items.length === 0) return;
    const i = ((index % items.length) + items.length) % items.length;
    items[i]?.focus();
  }

  private onMenuKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const wrap = target.closest<HTMLElement>(".menu");
    const id = wrap?.dataset.menu as MenuId | undefined;
    if (!id) return;
    const order = MENU_IDS.map((m) => m.id);
    const sibling = (delta: number) => order[(order.indexOf(id) + delta + order.length) % order.length] ?? id;
    const onButton = target.classList.contains("menu-btn");
    switch (e.key) {
      case "Escape":
        if (this.openMenuId === null) return;
        e.preventDefault();
        e.stopPropagation(); // the window handler would otherwise also move the camera
        this.closeMenus(true);
        return;
      case "ArrowLeft":
      case "ArrowRight": {
        e.preventDefault();
        const next = sibling(e.key === "ArrowRight" ? 1 : -1);
        if (this.openMenuId !== null) this.openMenu(next, !onButton);
        else this.menuEls.get(next)?.button.focus();
        return;
      }
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (this.openMenuId !== id) {
          this.openMenu(id, true);
          return;
        }
        const items = this.menuItemsOf(id);
        const cur = items.indexOf(target as HTMLButtonElement);
        const delta = e.key === "ArrowDown" ? 1 : -1;
        this.focusMenuItem(id, cur === -1 ? (delta === 1 ? 0 : -1) : cur + delta);
        return;
      }
      case "Home":
      case "End":
        if (this.openMenuId !== id) return;
        e.preventDefault();
        this.focusMenuItem(id, e.key === "Home" ? 0 : -1);
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        if (onButton) {
          if (this.openMenuId === id) this.closeMenus(true);
          else this.openMenu(id, true);
        } else target.click();
        return;
      case "Tab":
        if (this.openMenuId !== null) this.closeMenus();
        return;
    }
  }

  private buildMenuItem(item: MenuItem): HTMLElement {
    if (item.divider) return el("div", "mdiv");
    if (item.heading !== undefined) return el("div", "mhead", item.heading);
    const b = el("button", `mi${item.danger ? " danger" : ""}${item.armed ? " armed" : ""}`);
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.disabled = item.disabled === true || !item.onSelect;
    if (item.title) b.title = item.title;
    const lead = item.dot ? el("span", `dot ${item.dot}`) : el("span", "check", item.checked ? "✓" : "");
    if (item.checked) b.setAttribute("aria-checked", "true");
    b.append(lead);
    const text = el("span", "mi-text");
    text.append(el("span", "mi-label", item.label ?? ""));
    if (item.sub) text.append(el("span", "mi-sub", item.sub));
    b.append(text);
    const right = el("span", "mi-right");
    for (const r of item.right ?? []) right.append(r);
    if (item.hint) right.append(el("kbd", "", item.hint));
    b.append(right);
    b.addEventListener("click", () => {
      if (b.disabled || !item.onSelect) return;
      item.onSelect();
      if (!item.keepOpen) this.closeMenus();
    });
    return b;
  }

  private companyMenu(): MenuItem[] {
    const store = this.store;
    const items: MenuItem[] = [];
    const list = store.companyList();
    if (list.length === 0) items.push({ label: "No companies yet", disabled: true });
    for (const c of list) {
      const status = store.statusOf(c.id);
      const right: HTMLElement[] = [];
      if (c.live) right.push(el("span", "badge live", "LIVE"));
      if (status === "waiting_on_founder") right.push(el("span", "needs", "needs you"));
      items.push({
        label: c.name,
        sub: c.phase.replace(/_/g, " "),
        dot: status,
        right,
        checked: c.id === store.focusedCompanyId,
        title: `${c.name}: ${status.replace(/_/g, " ")}`,
        onSelect: () => this.actions.focusCompany(c.id),
      });
    }
    items.push({ divider: true });
    items.push({
      label: "Found company…",
      disabled: store.demo,
      title: store.demo ? "Not available in demo mode" : "Found a new company",
      onSelect: () => this.openFoundModal(),
    });
    return items;
  }

  private actionsMenu(): MenuItem[] {
    const store = this.store;
    const c = store.focusedCompany();
    const pending = c ? store.pendingApprovalFor(c.id) : null;
    const paused = c?.phase === "paused";
    const items: MenuItem[] = [
      {
        label: "Approve / reject pending request…",
        disabled: !pending,
        title: pending ? pending.summary : "Nothing is waiting on you in this company",
        onSelect: () => {
          if (pending) this.openApproval(pending.id);
        },
      },
      {
        label: "Message the CEO",
        disabled: !c,
        onSelect: () => {
          if (c) this.messageCeo(c.id);
        },
      },
      {
        label: paused ? "Resume company" : "Pause company",
        disabled: !c,
        onSelect: () => {
          if (!c) return;
          if (paused) this.actions.resumeCompany(c.id);
          else this.actions.pauseCompany(c.id);
        },
      },
      { divider: true },
      {
        label: this.panicArmed ? "Are you sure? Click again to confirm" : "Panic: stop all spending",
        danger: true,
        armed: this.panicArmed,
        keepOpen: !this.panicArmed,
        onSelect: () => {
          if (this.panicArmed) {
            this.panicArmed = false;
            this.actions.panic();
          } else {
            this.panicArmed = true;
            this.renderMenus();
            this.menuItemsOf("actions").find((b) => b.classList.contains("armed"))?.focus();
          }
        },
      },
    ];
    return items;
  }

  private viewMenu(): MenuItem[] {
    const store = this.store;
    const items: MenuItem[] = [{ heading: "Camera" }];
    for (const cam of CAMERA_MODES) {
      items.push({ label: cam.label, checked: store.cameraMode === cam.mode, hint: cam.key, onSelect: () => this.actions.setCamera(cam.mode) });
    }
    items.push({ divider: true }, { heading: "Speed" });
    for (const s of SPEEDS) items.push({ label: `${s}x`, checked: store.speed === s, onSelect: () => this.actions.setSpeed(s) });
    items.push({ divider: true }, { heading: "Panel" });
    for (const t of PANEL_TABS) {
      items.push({ label: t.tab === "company" ? "Company panel" : t.label, checked: store.panelTab === t.tab, onSelect: () => this.setPanelTab(t.tab) });
    }
    items.push({
      label: "Activity feed",
      checked: store.feedVisible,
      onSelect: () => {
        store.feedVisible = !store.feedVisible;
        store.notify();
      },
    });
    return items;
  }

  private helpMenu(): MenuItem[] {
    return [
      { label: "Keyboard shortcuts", onSelect: () => this.openShortcuts() },
      {
        label: "Open demo mode",
        disabled: this.store.demo,
        title: this.store.demo ? "You are in demo mode" : "Reload the client with ?demo=1 (no server needed)",
        onSelect: () => {
          window.location.search = "?demo=1";
        },
      },
      { divider: true },
      { label: "About TokenValley", onSelect: () => this.openAbout() },
    ];
  }

  private menuItems(id: MenuId): MenuItem[] {
    switch (id) {
      case "company":
        return this.companyMenu();
      case "actions":
        return this.actionsMenu();
      case "view":
        return this.viewMenu();
      case "help":
        return this.helpMenu();
    }
  }

  /** Rebuilds every dropdown from the store and syncs open/closed state. Keeps keyboard focus on the same item. */
  private renderMenus(): void {
    const store = this.store;
    const c = store.focusedCompany();
    const pendingTotal = store.pendingApprovalCount();
    for (const { id } of MENU_IDS) {
      const m = this.menuEls.get(id);
      if (!m) continue;
      const open = this.openMenuId === id;
      m.wrap.classList.toggle("open", open);
      m.button.setAttribute("aria-expanded", open ? "true" : "false");
      if (!open) {
        m.dropdown.replaceChildren();
        this.menuKeys.delete(id);
      } else {
        // Only rebuild the nodes when the content changed, so hover and clicks
        // in progress are not disturbed by unrelated store updates.
        const items = this.menuItems(id);
        const key = items.map(menuItemKey).join("\n");
        if (key !== this.menuKeys.get(id)) {
          const prevIndex = this.menuItemsOf(id).indexOf(document.activeElement as HTMLButtonElement);
          m.dropdown.replaceChildren(...items.map((item) => this.buildMenuItem(item)));
          this.menuKeys.set(id, key);
          if (prevIndex >= 0) this.menuItemsOf(id)[prevIndex]?.focus();
        }
      }
      if (id === "company") {
        m.label.replaceChildren();
        if (c) {
          m.label.append(el("span", `dot ${store.statusOf(c.id)}`), el("span", "name", c.name));
          m.button.title = `${c.name}: ${store.statusOf(c.id).replace(/_/g, " ")}`;
        } else {
          m.label.append(el("span", "name muted", "No company"));
          m.button.title = "No company focused";
        }
      }
      if (id === "actions") {
        m.count.textContent = pendingTotal > 0 ? String(pendingTotal) : "";
        m.count.classList.toggle("show", pendingTotal > 0);
      }
    }
    this.bell.classList.toggle("show", pendingTotal > 0);
    this.bellCount.textContent = String(pendingTotal);
    this.bell.title = pendingTotal === 1 ? "1 request needs you" : `${pendingTotal} requests need you`;
  }

  /** Switches the panel to the Founder chat thread and focuses the compose box. */
  private messageCeo(companyId: string): void {
    this.store.panelTab = "chat";
    this.store.chatChannel.set(companyId, CHANNEL_FOUNDER);
    this.chatAtBottom = true;
    this.store.notify();
    this.render();
    this.panel.querySelector<HTMLInputElement>(".compose input")?.focus();
  }

  // ---- info modal (shortcuts, about) --------------------------------------------

  isInfoOpen(): boolean {
    return this.infoBackdrop.classList.contains("open");
  }

  closeInfo(): void {
    this.infoBackdrop.classList.remove("open");
  }

  private openShortcuts(): void {
    this.infoBody.replaceChildren(el("h2", "", "Keyboard shortcuts"));
    const table = el("div", "shortcuts");
    for (const s of SHORTCUTS) {
      const keys = el("span", "keys");
      for (const k of s.keys) keys.append(el("kbd", "", k));
      table.append(keys, el("span", "what", s.what));
    }
    this.infoBody.append(table);
    this.infoBackdrop.classList.add("open");
    this.infoBackdrop.querySelector<HTMLButtonElement>("button")?.focus();
  }

  private openAbout(): void {
    this.infoBody.replaceChildren(el("h2", "", "About TokenValley"));
    this.infoBody.append(
      el(
        "p",
        "about",
        "TokenValley is a low-poly valley of AI companies. Each building is a company staffed by Claude Code agents that build a project in a folder on your machine, while a cartoon office shows them walking between desks, calling meetings, and arguing in speech bubbles. You are the founder: you found companies, hand each one a brief, watch, and approve or reject at gates. It runs on your own Claude Code subscription; the client only renders what the server's events say.",
      ),
    );
    const repo = el("p", "about muted");
    repo.append("Source: ", el("code", "", "github.com/Surya5599/TokenValley"), " (this client lives in ", el("code", "", "apps/client"), ")");
    this.infoBody.append(repo);
    this.infoBackdrop.classList.add("open");
    this.infoBackdrop.querySelector<HTMLButtonElement>("button")?.focus();
  }

  /**
   * Handles the Escape key for everything the overlay owns, topmost first.
   * Returns true when something was closed (so the caller leaves the camera alone).
   */
  handleEscape(): boolean {
    if (this.openMenuId !== null) {
      this.closeMenus(true);
      return true;
    }
    if (this.isInfoOpen()) {
      this.closeInfo();
      return true;
    }
    if (this.isModalOpen()) {
      this.closeFoundModal();
      return true;
    }
    if (this.isPersonaOpen()) {
      this.closePersona();
      return true;
    }
    if (this.isBudgetOpen()) {
      this.closeBudget();
      return true;
    }
    if (this.isApprovalOpen()) {
      this.closeApproval();
      return true;
    }
    return false;
  }

  // ---- persona modal ------------------------------------------------------------

  isPersonaOpen(): boolean {
    return this.personaOpenId !== null;
  }

  /** Opens the editor pre-filled from the agent's current persona. */
  openPersona(agentId: string): void {
    const a = this.store.agents.get(agentId);
    if (!a) return;
    this.personaOpenId = agentId;
    const npc = a.kind === "npc";
    this.personaTitle.textContent = `Edit ${a.name}`;
    this.personaName.value = a.name;
    this.personaStyle.value = a.style;
    this.personaJob.value = a.job;
    this.personaNpcNote.style.display = npc ? "" : "none";
    this.personaStyleField.style.display = npc ? "none" : "";
    this.personaJobField.style.display = npc ? "none" : "";
    this.personaError.textContent = "";
    this.personaBackdrop.classList.add("open");
    this.personaName.focus();
    this.personaName.select();
  }

  /** Closes the editor; with an id, only if that agent is the one being edited. */
  closePersona(agentId?: string): void {
    if (agentId !== undefined && this.personaOpenId !== agentId) return;
    this.personaOpenId = null;
    this.personaBackdrop.classList.remove("open");
  }

  private submitPersona(): void {
    const id = this.personaOpenId;
    if (!id) return;
    const a = this.store.agents.get(id);
    if (!a) {
      this.closePersona();
      return;
    }
    const name = this.personaName.value.trim();
    if (!name) {
      this.personaError.textContent = "Name cannot be empty.";
      return;
    }
    const npc = a.kind === "npc";
    const style = npc ? "" : this.personaStyle.value;
    const job = npc ? "" : this.personaJob.value;
    this.personaError.textContent = "";
    this.actions.setAgentPersona(id, name.slice(0, PERSONA_NAME_MAX), style.slice(0, PERSONA_STYLE_MAX), job.slice(0, PERSONA_JOB_MAX));
  }

  // ---- budget modal -------------------------------------------------------------

  isBudgetOpen(): boolean {
    return this.budgetOpenId !== null;
  }

  /** Opens the budget editor pre-filled from the company's current budget. Only live companies can be edited. */
  openBudget(companyId: string): void {
    const c = this.store.companies.get(companyId);
    if (!c || !c.live) return;
    this.budgetOpenId = companyId;
    this.budgetTitle.textContent = `Budget for ${c.name}`;
    this.budgetTurns.value = String(c.budget.maxTurns);
    this.budgetTokens.value = String(c.budget.maxTokens);
    this.budgetFileHint.textContent = `Also written to companies/${c.slug}/company.md`;
    this.budgetError.textContent = "";
    this.renderBudgetUsage(c);
    this.renderBudgetHint();
    this.budgetBackdrop.classList.add("open");
    this.budgetTurns.focus();
    this.budgetTurns.select();
  }

  /** Closes the editor; with an id, only if that company is the one being edited. */
  closeBudget(companyId?: string): void {
    if (companyId !== undefined && this.budgetOpenId !== companyId) return;
    this.budgetOpenId = null;
    this.budgetBackdrop.classList.remove("open");
  }

  private renderBudgetUsage(c: Company): void {
    this.budgetTurnsUsed.textContent = `used ${c.spend.turns} of ${c.budget.maxTurns}`;
    const tokens = c.spend.inputTokens + c.spend.outputTokens;
    this.budgetTokensUsed.textContent = `used ${fmtTokens(tokens)} of ${fmtTokens(c.budget.maxTokens)}`;
  }

  /** The helper line under the token cap ("5.0M tokens"), following the input as it is typed. */
  private renderBudgetHint(): void {
    const n = Number(this.budgetTokens.value);
    this.budgetTokensHint.textContent = Number.isFinite(n) && n > 0 ? `${fmtTokens(Math.floor(n))} tokens` : "Tokens, as a whole number";
  }

  private submitBudget(): void {
    const id = this.budgetOpenId;
    if (!id) return;
    const c = this.store.companies.get(id);
    if (!c) {
      this.closeBudget();
      return;
    }
    const parse = (raw: string, max: number, what: string): number | string => {
      const t = raw.trim();
      if (!/^\d+$/.test(t)) return `${what} must be a whole number.`;
      const n = Number(t);
      if (!Number.isSafeInteger(n) || n < 1) return `${what} must be at least 1.`;
      if (n > max) return `${what} cannot exceed ${max.toLocaleString()}.`;
      return n;
    };
    const turns = parse(this.budgetTurns.value, BUDGET_TURNS_MAX, "Turn cap");
    if (typeof turns === "string") {
      this.budgetError.textContent = turns;
      this.budgetTurns.focus();
      return;
    }
    const tokens = parse(this.budgetTokens.value, BUDGET_TOKENS_MAX, "Token cap");
    if (typeof tokens === "string") {
      this.budgetError.textContent = tokens;
      this.budgetTokens.focus();
      return;
    }
    this.budgetError.textContent = "";
    this.actions.setCompanyBudget(id, turns, tokens);
  }

  // ---- panel tabs / chat ---------------------------------------------------------

  setPanelTab(tab: PanelTab): void {
    if (this.store.panelTab === tab) return;
    this.store.panelTab = tab;
    this.chatAtBottom = true;
    this.store.notify();
  }

  private selectChannel(companyId: string, key: string): void {
    this.store.chatChannel.set(companyId, key);
    this.chatAtBottom = true;
    this.store.notify();
  }

  // ---- approval modal ------------------------------------------------------------

  isApprovalOpen(): boolean {
    return this.approvalOpenId !== null;
  }

  /** Shows the approval dialog for a pending approval id. */
  openApproval(approvalId: string): void {
    const a = this.store.approvals.get(approvalId);
    if (!a || a.status !== "pending") return;
    const company = this.store.companies.get(a.companyId);
    this.approvalOpenId = approvalId;
    this.approvalBody.replaceChildren();
    const head = el("h2", "", company?.name ?? a.companyId);
    head.append(el("span", `kind-badge ${a.kind}`, a.kind));
    this.approvalBody.append(head);
    this.approvalBody.append(el("div", "tagline", "The CEO is waiting at the lobby bell."));
    this.approvalBody.append(el("div", "summary", a.summary));
    this.approvalComment.value = "";
    this.approvalBackdrop.classList.add("open");
  }

  /** Closes the dialog; with an id, only if that approval is the one shown. */
  closeApproval(approvalId?: string): void {
    if (approvalId !== undefined && this.approvalOpenId !== approvalId) return;
    this.approvalOpenId = null;
    this.approvalBackdrop.classList.remove("open");
  }

  private submitApproval(status: "approved" | "rejected"): void {
    const id = this.approvalOpenId;
    if (!id) return;
    const comment = this.approvalComment.value.trim();
    this.actions.resolveApproval(id, status, comment.length > 0 ? comment : null);
    this.closeApproval();
  }

  // ---- found-company modal ------------------------------------------------------

  isModalOpen(): boolean {
    return this.modalBackdrop.classList.contains("open");
  }

  openFoundModal(): void {
    if (this.store.demo) return;
    this.modalError.textContent = "";
    this.modalBackdrop.classList.add("open");
    this.modalForm.querySelector<HTMLInputElement>("input[name=name]")?.focus();
  }

  closeFoundModal(): void {
    this.modalBackdrop.classList.remove("open");
    this.setFormBusy(false);
  }

  showFoundError(message: string): void {
    this.modalError.textContent = message;
    this.setFormBusy(false);
  }

  private setFormBusy(busy: boolean): void {
    const submit = this.modalForm.querySelector<HTMLButtonElement>("button[type=submit]");
    if (submit) submit.disabled = busy;
  }

  private buildFoundForm(): HTMLFormElement {
    const form = el("form");
    const field = (label: string, input: HTMLElement, hint?: string) => {
      const wrap = el("div");
      wrap.append(el("label", "", label), input);
      if (hint) wrap.append(el("div", "hintline", hint));
      return wrap;
    };
    const input = (name: string, placeholder = "", type = "text") => {
      const i = el("input");
      i.name = name;
      i.type = type;
      i.placeholder = placeholder;
      return i;
    };
    form.append(field("Name", input("name", "Pixel Forge")));
    form.append(field("Tagline", input("tagline", "We ship pixels.")));
    const brief = el("textarea");
    brief.name = "brief";
    brief.placeholder = "What should this company build?";
    form.append(field("Brief", brief));
    form.append(field("Workspace path", input("workspacePath", ""), "absolute path to the folder this company is in charge of"));
    const grid = el("div", "grid2");
    const roster = el("select");
    roster.name = "rosterTemplate";
    for (const r of ROSTER_TEMPLATES) {
      const o = el("option", "", r);
      o.value = r;
      roster.append(o);
    }
    grid.append(field("Roster template", roster));
    const turns = input("maxTurns", "", "number");
    turns.value = "100";
    turns.min = "1";
    grid.append(field("Turn budget", turns));
    form.append(grid);
    form.append(el("label", "", "Models per role"));
    const models = el("div", "models");
    for (const role of PICKABLE_ROLES) {
      const sel = el("select");
      sel.name = `model_${role}`;
      for (const m of MODEL_CHOICES) {
        const o = el("option", "", m);
        o.value = m;
        sel.append(o);
      }
      models.append(field(ROLE_LABEL[role], sel));
    }
    form.append(models);
    const actions = el("div", "actions");
    const cancel = el("button", "", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => this.closeFoundModal());
    const submit = el("button", "primary", "Found it");
    submit.type = "submit";
    actions.append(cancel, submit);
    form.append(actions);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submitFoundForm(form);
    });
    return form;
  }

  private submitFoundForm(form: HTMLFormElement): void {
    const data = new FormData(form);
    const str = (k: string) => String(data.get(k) ?? "").trim();
    const modelOverrides: Record<string, ModelTier> = {};
    for (const role of PICKABLE_ROLES) {
      const v = str(`model_${role}`);
      if (v === "opus" || v === "sonnet" || v === "haiku") modelOverrides[role] = v;
    }
    const raw = {
      name: str("name"),
      tagline: str("tagline"),
      brief: str("brief"),
      workspacePath: str("workspacePath"),
      rosterTemplate: str("rosterTemplate") || "startup",
      modelOverrides,
      maxTurns: Number(str("maxTurns") || "100"),
    };
    const parsed = FoundCompanyInput.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      this.showFoundError(issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid input");
      return;
    }
    this.modalError.textContent = "";
    this.setFormBusy(true);
    this.actions.foundCompany(parsed.data);
  }

  schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.render();
    });
  }

  render(): void {
    this.renderTop();
    this.renderPanel();
    this.renderFeed();
    // Keep the "used x of y" lines honest while the budget editor is open.
    if (this.budgetOpenId) {
      const c = this.store.companies.get(this.budgetOpenId);
      if (c) this.renderBudgetUsage(c);
      else this.closeBudget();
    }
  }

  private renderTop(): void {
    const store = this.store;
    this.renderMenus();
    this.feed.style.display = store.feedVisible ? "" : "none";
    if (store.demo) {
      this.conn.className = "conn demo";
      this.conn.textContent = "demo";
    } else {
      this.conn.className = `conn ${store.connection}`;
      this.conn.textContent = store.connection;
    }
  }

  private renderPanel(): void {
    const store = this.store;
    const c = store.focusedCompany();
    const panel = this.panel;
    panel.replaceChildren();
    panel.classList.toggle("chat", store.panelTab === "chat" && c !== null);
    if (!c) {
      panel.append(el("div", "empty", "No company focused. Click a building or a tab."));
      return;
    }
    // Tab strip: Company | Chat. Chat carries the total unread count.
    const strip = el("div", "panel-tabs");
    const totalUnread = this.channelKeys(c).reduce((n, k) => n + store.unreadCount(c.id, k.key), 0);
    for (const t of PANEL_TABS) {
      const b = el("button", `ptab${store.panelTab === t.tab ? " active" : ""}`);
      b.append(el("span", "ptab-label", t.label));
      if (t.tab === "chat" && totalUnread > 0) b.append(el("span", "unread", String(totalUnread)));
      b.addEventListener("click", () => this.setPanelTab(t.tab));
      strip.append(b);
    }
    panel.append(strip);
    if (store.panelTab === "chat") {
      this.renderChat(c);
      return;
    }
    const title = el("h2", "", c.name);
    if (c.live) title.append(el("span", "badge live", "LIVE"));
    panel.append(title);
    if (c.tagline) panel.append(el("div", "tagline", c.tagline));
    panel.append(el("span", "phase", c.phase.replace(/_/g, " ")));
    if (c.workspacePath) {
      const path = el("div", "path", c.workspacePath);
      path.title = c.workspacePath;
      panel.append(path);
    }

    // Budget.
    const budgetHead = el("h3", "with-action", "Spend vs budget");
    const editBudget = el("button", "icon edit", "✎");
    editBudget.type = "button";
    editBudget.setAttribute("aria-label", `Edit budget for ${c.name}`);
    editBudget.disabled = !c.live;
    editBudget.title = c.live ? "Edit budget" : "Set in the company file";
    editBudget.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.openBudget(c.id);
    });
    budgetHead.append(editBudget);
    panel.append(budgetHead);
    const turnsPct = c.spend.turns / Math.max(1, c.budget.maxTurns);
    const tokens = c.spend.inputTokens + c.spend.outputTokens;
    const tokPct = tokens / Math.max(1, c.budget.maxTokens);
    const bar = (label: string, pct: number, right: string) => {
      const row = el("div", "row spend-row");
      row.append(el("span", "", label), el("span", "muted num", right));
      panel.append(row);
      const b = el("div", `bar${pct >= 1 ? " over" : pct >= 0.8 ? " warn" : ""}`);
      const fill = el("div");
      fill.style.width = `${Math.min(100, pct * 100).toFixed(1)}%`;
      b.append(fill);
      panel.append(b);
    };
    bar("Turns", turnsPct, `${c.spend.turns} / ${c.budget.maxTurns}`);
    bar("Tokens", tokPct, `${fmtTokens(tokens)} / ${fmtTokens(c.budget.maxTokens)}`);
    const usd = el("div", "row spend-row");
    usd.append(el("span", "muted", "Estimated cost"), el("span", "num", `${c.spend.estimatedUsd.toFixed(2)}`));
    panel.append(usd);

    // Founder inbox: the CEO's messages to the founder and the founder's replies.
    panel.append(el("h3", "", "From the CEO"));
    const inbox = el("div", "inbox");
    const thread = store.founderThreadOf(c.id).slice(-INBOX_LIMIT);
    if (thread.length === 0) inbox.append(el("div", "empty", "No messages yet."));
    for (const m of thread) {
      const mine = m.from === FOUNDER_ID;
      const row = el("div", `msg${mine ? " mine" : ""}`);
      row.append(el("span", "who", mine ? "You" : (store.agents.get(m.from)?.name ?? "CEO")), el("span", "text", m.text));
      row.title = fmtTime(m.timestamp);
      inbox.append(row);
    }
    panel.append(inbox);
    inbox.scrollTop = inbox.scrollHeight;
    panel.append(this.buildCompose(c));

    // Agents.
    panel.append(el("h3", "", "Agents"));
    const agents = el("div", "agents");
    const list = store.agentsOf(c.id);
    if (list.length === 0) agents.append(el("div", "empty", "Nobody here yet."));
    for (const a of list) {
      const row = el("div", `agent${a.id === store.selectedAgentId ? " selected" : ""}${a.kind === "contractor" ? " contractor" : ""}`);
      row.append(el("span", `status-dot ${a.status}`));
      const mid = el("div", "agent-text");
      mid.append(el("div", "name", a.name));
      const line = store.agentLines.get(a.id) ?? `${ROLE_LABEL[a.role]} · ${a.status}${a.currentTaskId ? ` · ${store.tasks.get(a.currentTaskId)?.title ?? ""}` : ""}`;
      const lineEl = el("div", "line", line);
      lineEl.title = line;
      mid.append(lineEl);
      const styleLine = firstLine(a.style);
      if (styleLine) {
        const s = el("div", "line style", styleLine);
        s.title = a.style;
        mid.append(s);
      }
      row.append(mid);
      const right = el("div", "agent-right");
      right.append(el("span", `badge ${a.model ?? "none"}`, a.model ? a.model.toUpperCase() : a.kind === "npc" ? "NPC" : "-"));
      if (a.kind !== "contractor") {
        const edit = el("button", "icon edit", "✎");
        edit.type = "button";
        edit.title = "Edit persona";
        edit.setAttribute("aria-label", `Edit ${a.name}`);
        edit.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.openPersona(a.id);
        });
        right.append(edit);
      }
      row.append(right);
      row.title = "Select for follow camera";
      row.addEventListener("click", () => this.actions.selectAgent(a.id));
      agents.append(row);
    }
    panel.append(agents);

    // Kanban.
    panel.append(el("h3", "", "Board"));
    const kanban = el("div", "kanban");
    const tasks = store.tasksOf(c.id);
    for (const col of KANBAN) {
      const colEl = el("div", `col ${col.status}`);
      colEl.append(el("h4", "", col.label));
      for (const t of tasks.filter((t) => t.status === col.status)) {
        const card = el("div", "card", t.title);
        card.title = t.title;
        colEl.append(card);
      }
      kanban.append(colEl);
    }
    panel.append(kanban);
  }

  /** The founder's compose box; used by the inbox and by the Founder chat channel. */
  private buildCompose(c: Company): HTMLFormElement {
    const store = this.store;
    const compose = el("form", "compose");
    const input = el("input");
    input.type = "text";
    input.placeholder = store.demo ? "Disabled in demo mode" : "Message the CEO";
    input.value = this.inboxDraft;
    input.maxLength = 2000;
    const canSend = !store.demo && store.connection === "connected";
    input.disabled = !canSend;
    input.addEventListener("input", () => (this.inboxDraft = input.value));
    const send = el("button", "primary", "Send");
    send.type = "submit";
    send.disabled = !canSend;
    compose.append(input, send);
    compose.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || !canSend) return;
      this.actions.sendFounderMessage(c.id, text);
      this.inboxDraft = "";
      input.value = "";
    });
    return compose;
  }

  /** The channel list for a company: #general, meetings, Founder, then DM pairs. */
  private channelKeys(c: Company): { key: string; label: string; sub: string; group: "channels" | "dms" }[] {
    const store = this.store;
    const name = (id: string) => (id === FOUNDER_ID ? "Founder" : firstName(store.agents.get(id)?.name ?? id));
    const out: { key: string; label: string; sub: string; group: "channels" | "dms" }[] = [{ key: CHANNEL_GENERAL, label: "#general", sub: "", group: "channels" }];
    for (const ch of store.channelsOf(c.id)) {
      if (ch.channel === CHANNEL_GENERAL) continue;
      out.push({ key: ch.channel, label: `#${ch.channel}`, sub: `${ch.title} · ${ch.memberIds.length}`, group: "channels" });
    }
    out.push({ key: CHANNEL_FOUNDER, label: "Founder", sub: "", group: "channels" });
    for (const t of store.dmThreadsOf(c.id)) out.push({ key: t.key, label: `${name(t.a)} ↔ ${name(t.b)}`, sub: "", group: "dms" });
    return out;
  }

  private renderChat(c: Company): void {
    const store = this.store;
    const panel = this.panel;
    const keys = this.channelKeys(c);
    let active = store.chatChannel.get(c.id) ?? CHANNEL_GENERAL;
    if (!keys.some((k) => k.key === active)) active = CHANNEL_GENERAL;
    store.chatChannel.set(c.id, active);
    // Everything in the open channel counts as seen.
    store.markChannelViewed(c.id, active);

    const head = el("div", "chat-head");
    head.append(el("span", "chat-company", c.name));
    head.append(el("span", "phase", c.phase.replace(/_/g, " ")));
    const activeEntry = keys.find((k) => k.key === active);
    head.append(el("span", "chat-channel", activeEntry?.label ?? active));
    panel.append(head);

    // One-line notice for phases where the founder has to do something.
    const notice = PHASE_NOTICE[c.phase];
    if (notice) {
      const n = el("div", `chat-notice ${c.phase}`);
      if (c.phase === "out_of_budget") {
        n.append("Out of budget: ");
        const link = el("button", "linkish", "edit the budget");
        link.type = "button";
        link.disabled = !c.live;
        link.title = c.live ? "Edit budget" : "Set in the company file";
        link.addEventListener("click", () => this.openBudget(c.id));
        n.append(link, " to resume.");
      } else n.textContent = notice;
      panel.append(n);
    }

    const body = el("div", "chat-body");
    // Channel list.
    const list = el("div", "chat-channels");
    const section = (label: string) => list.append(el("div", "chat-section", label));
    section("Channels");
    let dmHeader = false;
    for (const k of keys) {
      if (k.group === "dms" && !dmHeader) {
        section("DMs");
        dmHeader = true;
      }
      const b = el("button", `chan${k.key === active ? " active" : ""}`);
      const text = el("span", "chan-text");
      text.append(el("span", "chan-label", k.label));
      if (k.sub) text.append(el("span", "chan-sub", k.sub));
      b.append(text);
      const unread = store.unreadCount(c.id, k.key);
      if (unread > 0) b.append(el("span", "unread", String(unread)));
      b.title = k.sub ? `${k.label} — ${k.sub}` : k.label;
      b.addEventListener("click", () => this.selectChannel(c.id, k.key));
      list.append(b);
    }
    body.append(list);

    // Message list.
    const right = el("div", "chat-main");
    const msgs = el("div", "chat-msgs");
    const lines = store.channelMessagesOf(c.id, active);
    if (lines.length === 0) msgs.append(el("div", "empty", active === CHANNEL_FOUNDER ? "No messages yet. Say hi to the CEO." : "Nothing posted here yet."));
    let prev: ChatLine | null = null;
    for (const m of lines) {
      const collapse = prev !== null && prev.from === m.from && m.timestamp - prev.timestamp <= COLLAPSE_MS;
      msgs.append(this.buildChatRow(m, collapse));
      prev = m;
    }
    right.append(msgs);
    if (active === CHANNEL_FOUNDER) right.append(this.buildCompose(c));
    body.append(right);
    panel.append(body);

    // Keep the scroll position across re-renders: stick to the bottom when
    // the founder was at the bottom, otherwise restore where they were.
    const scrollKey = `${c.id}:${active}`;
    if (scrollKey !== this.chatScrollKey) {
      this.chatScrollKey = scrollKey;
      this.chatAtBottom = true;
    }
    msgs.addEventListener("scroll", () => {
      this.chatScrollTop = msgs.scrollTop;
      this.chatAtBottom = msgs.scrollTop + msgs.clientHeight >= msgs.scrollHeight - 6;
    });
    if (this.chatAtBottom) msgs.scrollTop = msgs.scrollHeight;
    else msgs.scrollTop = this.chatScrollTop;
  }

  private buildChatRow(m: ChatLine, collapse: boolean): HTMLElement {
    const store = this.store;
    const isFounder = m.from === FOUNDER_ID;
    const agent = isFounder ? null : (store.agents.get(m.from) ?? null);
    const row = el("div", `cmsg${collapse ? " cont" : ""}${isFounder ? " founder" : ""}`);
    const color = isFounder ? "var(--green)" : agent ? cssColor(ROLE_COLOR[agent.role]) : "var(--grey)";
    const textColor = isFounder ? "var(--green)" : agent ? lightened(ROLE_COLOR[agent.role]) : "var(--grey)";
    if (!collapse) {
      const dot = el("span", "avatar");
      dot.style.background = color;
      row.append(dot);
      const header = el("div", "cmsg-head");
      const who = el("button", "author", isFounder ? "Founder" : (agent?.name ?? m.from));
      who.type = "button";
      who.style.color = textColor;
      if (agent) {
        who.title = "Follow this agent";
        who.addEventListener("click", () => this.actions.selectAgent(agent.id));
      } else who.disabled = true;
      header.append(who);
      header.append(el("span", "role", isFounder ? "You" : agent ? ROLE_LABEL[agent.role] : "unknown"));
      header.append(el("span", "time", fmtClock(m.timestamp)));
      row.append(header);
    } else {
      const t = el("span", "time hover", fmtClock(m.timestamp));
      row.append(t);
    }
    const text = el("div", "cmsg-text", m.text);
    text.title = fmtTime(m.timestamp);
    row.append(text);
    return row;
  }

  private renderFeed(): void {
    const store = this.store;
    const id = store.focusedCompanyId;
    const events = id ? store.eventsOf(id) : [];
    const last = events[events.length - 1];
    const key = `${id ?? ""}:${events.length}:${last?.id ?? ""}`;
    if (key === this.lastFeedKey) return;
    this.lastFeedKey = key;
    this.feedList.replaceChildren();
    if (events.length === 0) {
      this.feedList.append(el("div", "entry empty", "Nothing yet."));
      return;
    }
    for (const e of events) {
      const d = describeEvent(e, store);
      const agentId = "agentId" in e ? e.agentId : null;
      const row = el("div", `entry${d.tone !== "normal" ? ` ${d.tone}` : ""}${agentId ? " clickable" : ""}`);
      row.append(el("span", "time", fmtTime(e.timestamp)), el("span", "text", d.text));
      row.title = d.text;
      if (agentId) row.addEventListener("click", () => this.actions.selectAgent(agentId));
      this.feedList.append(row);
    }
    this.feedList.scrollTop = this.feedList.scrollHeight;
  }

  /** Visible for tests/debug; the overlay root element. */
  get element(): HTMLElement {
    return this.root;
  }
}
