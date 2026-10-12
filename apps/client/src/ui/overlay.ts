import { FoundCompanyInput, ROLE_LABEL, type Event, type ModelTier, type RoleId, type TaskStatus } from "@tokenvalley/shared";
import type { CameraMode, Store } from "../state/store";

export interface OverlayActions {
  focusCompany: (companyId: string) => void;
  selectAgent: (agentId: string) => void;
  setCamera: (mode: CameraMode) => void;
  setSpeed: (speed: number) => void;
  foundCompany: (input: FoundCompanyInput) => void;
}

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

function base(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** One-line description of an event for the activity feed. */
export function describeEvent(e: Event, store: Store): { text: string; tone: "normal" | "alert" | "good" } {
  const name = (id: string) => store.agents.get(id)?.name ?? id;
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
  private scheduled = false;
  private lastFeedKey = "";

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

    store.onChange(() => this.schedule());
    this.render();
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
      const pill = el("button", "pill", `${c.name} needs you`);
      pill.addEventListener("click", () => this.actions.focusCompany(c.id));
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
    if (!c) {
      panel.append(el("div", "empty", "No company focused. Click a building or a tab."));
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
      const line = store.agentLines.get(a.id) ?? `${ROLE_LABEL[a.role]} · ${a.status}${a.currentTaskId ? ` · ${store.tasks.get(a.currentTaskId)?.title ?? ""}` : ""}`;
      mid.append(el("div", "line", line));
      row.append(mid);
      row.append(el("span", `badge ${a.model ?? "none"}`, a.model ? a.model.toUpperCase() : a.kind === "npc" ? "NPC" : "-"));
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
