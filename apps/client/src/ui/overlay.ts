import { FoundCompanyInput, ROLE_LABEL, type Company, type Event, type ModelTier, type RoleId, type TaskStatus } from "@tokenvalley/shared";
import { CHANNEL_FOUNDER, CHANNEL_GENERAL, FOUNDER_ID, type CameraMode, type ChatLine, type PanelTab, type Store } from "../state/store";
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
}

const INBOX_LIMIT = 8;
/** Consecutive messages by one author within this window share a header. */
const COLLAPSE_MS = 2 * 60 * 1000;
const PERSONA_NAME_MAX = 60;
const PERSONA_STYLE_MAX = 2000;
const PERSONA_JOB_MAX = 4000;

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
  private readonly tabs: HTMLElement;
  private readonly tray: HTMLElement;
  private readonly cams: HTMLElement;
  private readonly speeds: HTMLElement;
  private readonly conn: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly feedList: HTMLElement;
  private readonly foundButton: HTMLButtonElement;
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
    this.tabs = el("div", "tabs");
    top.append(this.tabs);
    this.foundButton = el("button", "", "+ Found company");
    this.foundButton.title = "Found a new company";
    this.foundButton.addEventListener("click", () => this.openFoundModal());
    top.append(this.foundButton);
    top.append(el("div", "spacer"));
    this.tray = el("div", "tray");
    top.append(this.tray);
    this.cams = el("div", "group");
    for (const c of CAMERA_MODES) {
      const b = el("button", "", `${c.key} ${c.label}`);
      b.dataset.mode = c.mode;
      b.title = `Camera: ${c.label} (key ${c.key})`;
      b.addEventListener("click", () => actions.setCamera(c.mode));
      this.cams.append(b);
    }
    top.append(this.cams);
    this.speeds = el("div", "group");
    for (const s of SPEEDS) {
      const b = el("button", "", `${s}x`);
      b.dataset.speed = String(s);
      b.title = "Animation speed";
      b.addEventListener("click", () => actions.setSpeed(s));
      this.speeds.append(b);
    }
    top.append(this.speeds);
    this.conn = el("div", "conn disconnected", "disconnected");
    top.append(this.conn);
    root.append(top);

    this.panel = el("div", "panel");
    root.append(this.panel);

    const feed = el("div", "feed");
    feed.append(el("div", "title", "Activity"));
    this.feedList = el("div", "list");
    feed.append(this.feedList);
    root.append(feed);

    const hint = el("div", "hint");
    hint.innerHTML = "<kbd>1</kbd> valley <kbd>2</kbd> office <kbd>3</kbd> follow <kbd>4</kbd> meeting <kbd>Esc</kbd> back · drag to orbit, wheel to zoom";
    root.append(hint);

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

    store.onChange(() => this.schedule());
    this.render();
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
  }

  private renderTop(): void {
    const store = this.store;
    this.tabs.replaceChildren();
    for (const c of store.companyList()) {
      const b = el("button", `tab${c.id === store.focusedCompanyId ? " active" : ""}`);
      b.append(el("span", `dot ${store.statusOf(c.id)}`), el("span", "", c.name));
      b.title = `${c.name}: ${store.statusOf(c.id).replace(/_/g, " ")}`;
      b.addEventListener("click", () => this.actions.focusCompany(c.id));
      this.tabs.append(b);
    }
    this.tray.replaceChildren();
    for (const c of store.companyList()) {
      if (store.statusOf(c.id) !== "waiting_on_founder") continue;
      const pending = store.pendingApprovalFor(c.id);
      const pill = el("button", "pill pulse", `${c.name} needs you`);
      pill.addEventListener("click", () => {
        this.actions.focusCompany(c.id);
        if (pending) this.openApproval(pending.id);
      });
      this.tray.append(pill);
    }
    this.foundButton.disabled = store.demo;
    this.foundButton.title = store.demo ? "Not available in demo mode" : "Found a new company";
    for (const b of this.cams.querySelectorAll<HTMLButtonElement>("button")) b.classList.toggle("active", b.dataset.mode === store.cameraMode);
    for (const b of this.speeds.querySelectorAll<HTMLButtonElement>("button")) b.classList.toggle("active", Number(b.dataset.speed) === store.speed);
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
      const b = el("button", `ptab${store.panelTab === t.tab ? " active" : ""}`, t.label);
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
    panel.append(el("h3", "", "Spend vs budget"));
    const turnsPct = c.spend.turns / Math.max(1, c.budget.maxTurns);
    const tokens = c.spend.inputTokens + c.spend.outputTokens;
    const tokPct = tokens / Math.max(1, c.budget.maxTokens);
    const bar = (label: string, pct: number, right: string) => {
      const row = el("div", "row");
      row.append(el("span", "", label), el("span", "muted", right));
      panel.append(row);
      const b = el("div", `bar${pct >= 1 ? " over" : pct >= 0.8 ? " warn" : ""}`);
      const fill = el("div");
      fill.style.width = `${Math.min(100, pct * 100).toFixed(1)}%`;
      b.append(fill);
      panel.append(b);
    };
    bar("Turns", turnsPct, `${c.spend.turns} / ${c.budget.maxTurns}`);
    bar("Tokens", tokPct, `${fmtTokens(tokens)} / ${fmtTokens(c.budget.maxTokens)}`);
    const usd = el("div", "row");
    usd.append(el("span", "muted", "Estimated cost"), el("span", "", `$${c.spend.estimatedUsd.toFixed(2)}`));
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
      const row = el("div", `agent${a.id === store.selectedAgentId ? " selected" : ""}`);
      row.append(el("span", `status-dot ${a.status}`));
      const mid = el("div");
      mid.append(el("div", "name", a.name));
      const styleLine = firstLine(a.style);
      if (styleLine) {
        const s = el("div", "line style", styleLine);
        s.title = a.style;
        mid.append(s);
      }
      const line = store.agentLines.get(a.id) ?? `${ROLE_LABEL[a.role]} · ${a.status}${a.currentTaskId ? ` · ${store.tasks.get(a.currentTaskId)?.title ?? ""}` : ""}`;
      mid.append(el("div", "line", line));
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
    const activeEntry = keys.find((k) => k.key === active);
    head.append(el("span", "chat-channel", activeEntry?.label ?? active));
    panel.append(head);

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
