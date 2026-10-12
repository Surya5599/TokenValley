import * as THREE from "three";
import { HOME_SPOTS, ROLE_HOME, type Agent, type AgentStatus, type AnimState, type Event, type RoleId } from "@tokenvalley/shared";
import { FOUNDER_ID, type Store } from "../state/store";
import { Character } from "./character";
import { Office, spotTile, type Tile } from "./office";
import { isWalkable, nearestWalkable, tileDistance } from "./pathfinding";

export interface SceneLights {
  sun: THREE.DirectionalLight;
  sky: THREE.HemisphereLight;
}

const FAR_TILES = 6;
const INCIDENT_DAY_SECONDS = 15;

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** Which animation state an agent's stored status implies when nothing else is going on. */
function stateForStatus(status: AgentStatus): AnimState {
  switch (status) {
    case "working":
      return "sit_typing";
    case "talking":
      return "talk";
    case "meeting":
      return "meeting";
    case "blocked":
      return "blocked";
    case "away":
      return "coffee";
    case "retired":
      return "leave";
    case "idle":
      return "idle";
  }
}

/**
 * Turns events into office behaviour. Owns the Office for the focused
 * company and one Character per visible agent. Events for other companies
 * only touch the store (which happens before handle() is called).
 */
export class Director {
  office: Office | null = null;
  readonly characters = new Map<string, Character>();
  private officeCompanyId: string | null = null;
  private readonly seatsByMeeting = new Map<string, Map<string, Tile>>();
  private readonly timers: { at: number; fn: () => void }[] = [];
  private readonly incidentSeconds = new Map<string, number>();
  private time = 0;
  private dimmed = false;
  private idleToggle = false;
  private readonly baseIntensity: { sun: number; sky: number };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly store: Store,
    private readonly lights: SceneLights,
  ) {
    this.baseIntensity = { sun: lights.sun.intensity, sky: lights.sky.intensity };
  }

  // ---- focus / lifecycle ----------------------------------------------------

  /** Rebuilds the office for a company and places its agents from their stored status. */
  setFocus(companyId: string | null): void {
    if (companyId === this.officeCompanyId && this.office) return;
    this.clearOffice();
    this.officeCompanyId = companyId;
    const company = companyId ? this.store.companies.get(companyId) : null;
    if (!company) return;
    const office = new Office(company.palette, company.name);
    this.office = office;
    this.scene.add(office.group);
    this.syncBoard();
    office.setIncidentDays(this.incidentDays(company.id));
    this.setDimmed(company.phase === "out_of_budget");

    // Seats for meetings already in progress.
    for (const [meetingId, ids] of this.store.meetings) {
      const anyHere = ids.some((id) => this.store.agents.get(id)?.companyId === company.id);
      if (anyHere) this.assignSeats(meetingId, ids);
    }
    const agents = this.store.agentsOf(company.id);
    for (const agent of agents) {
      if (agent.kind === "contractor") continue;
      const ch = this.createCharacter(agent, this.homeTile(agent));
      this.placeByStatus(ch, agent.status, true);
    }
    for (const agent of agents) {
      if (agent.kind !== "contractor") continue;
      this.spawnContractor(agent);
    }
  }

  setVisible(v: boolean): void {
    if (this.office) this.office.group.visible = v;
  }

  characterPosition(agentId: string | null): THREE.Vector3 | null {
    if (!agentId) return null;
    const ch = this.characters.get(agentId);
    return ch ? ch.worldPosition() : null;
  }

  meetingCenter(): THREE.Vector3 {
    return this.office ? this.office.meetingCenter.clone() : new THREE.Vector3();
  }

  update(dt: number): void {
    this.time += dt;
    for (const id of this.store.companies.keys()) {
      this.incidentSeconds.set(id, (this.incidentSeconds.get(id) ?? 0) + dt);
    }
    if (this.office && this.officeCompanyId) {
      this.office.setIncidentDays(this.incidentDays(this.officeCompanyId));
      this.office.update(dt);
    }
    for (const ch of this.characters.values()) ch.update(dt);
    // Fire due timers (sim time, so the speed multiplier applies).
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      if (t && t.at <= this.time) {
        this.timers.splice(i, 1);
        t.fn();
      }
    }
  }

  // ---- event mapping ----------------------------------------------------------

  /** Called after the store has reduced the event. */
  handle(e: Event): void {
    if (e.type === "build_failed") this.incidentSeconds.set(e.companyId, 0);
    if (e.companyId !== this.officeCompanyId || !this.office) {
      // Not the focused company: state only. A founded company that becomes
      // the first focus is handled by main via setFocus.
      return;
    }
    const office = this.office;
    switch (e.type) {
      case "company_founded":
        break;
      case "company_phase": {
        this.setDimmed(e.phase === "out_of_budget");
        this.byRole("ceo")?.say(`Phase: ${e.phase.replace(/_/g, " ")}`, 3);
        break;
      }
      case "agent_spawned": {
        const agent = this.store.agents.get(e.agentId) ?? e.agent;
        this.removeCharacter(agent.id);
        const ch = this.createCharacter(agent, office.entranceSpot);
        ch.fadeIn();
        ch.setState("arrive");
        this.byRole("receptionist")?.say(`Welcome, ${firstName(agent.name)}!`, 3);
        const spot = this.homeSpotId(agent);
        void ch.goTo(spot, stateForStatus(agent.status)).then((ok) => {
          if (ok) this.placeByStatus(ch, this.store.agents.get(agent.id)?.status ?? agent.status, false);
        });
        break;
      }
      case "agent_retired": {
        const ch = this.characters.get(e.agentId);
        if (ch) {
          ch.say("Bye!", 2);
          void ch.leave().then(() => this.removeCharacter(e.agentId));
        }
        break;
      }
      case "agent_model_changed": {
        const ch = this.characters.get(e.agentId);
        const agent = this.store.agents.get(e.agentId);
        if (ch && agent) ch.setAgent({ ...agent });
        break;
      }
      case "task_started": {
        const ch = this.characters.get(e.agentId);
        if (ch) {
          ch.say(e.task.title, 3);
          void ch.goTo(this.homeSpotId(ch.agent), "sit_typing");
        }
        this.syncBoard();
        break;
      }
      case "task_blocked": {
        const ch = this.characters.get(e.agentId);
        if (!ch) break;
        ch.setState("blocked");
        ch.say(e.reason, 4);
        const blocker = this.byRole(e.blockedByRole);
        if (blocker && blocker !== ch) {
          void ch.goTo(this.adjacentTo(blocker.tile, ch.tile), "blocked", blocker.tile).then((ok) => {
            if (!ok) return;
            ch.say(e.reason, 4);
            blocker.say("On it.", 2);
            this.later(3, () => void ch.goTo(this.homeSpotId(ch.agent), "blocked"));
          });
        }
        this.syncBoard();
        break;
      }
      case "task_done": {
        const ch = this.characters.get(e.agentId);
        if (ch) {
          const title = this.store.tasks.get(e.taskId)?.title ?? "Done";
          ch.say(`Done: ${title}`, 3);
          ch.setState("celebrate");
        }
        this.syncBoard();
        break;
      }
      case "task_created":
      case "task_updated":
        this.syncBoard();
        break;
      case "tool_read_file": {
        const ch = this.characters.get(e.agentId);
        if (ch) {
          ch.glance();
          ch.say(baseName(e.path), 1.5);
        }
        break;
      }
      case "tool_write_file": {
        const ch = this.characters.get(e.agentId);
        if (ch) {
          ch.typingBoost(2.5);
          ch.addPaper(office.faceTiles.get(this.homeSpotId(ch.agent)) ?? null);
          ch.say(baseName(e.path), 1.5);
        }
        break;
      }
      case "tool_shell": {
        const ch = this.characters.get(e.agentId);
        if (ch) {
          office.glowMonitor(this.homeSpotId(ch.agent), 2);
          ch.say(`$ ${e.command}`, 2);
        }
        this.byRole("it")?.nod();
        break;
      }
      case "send_message": {
        // The founder has no character: founder messages play out on the CEO.
        if (e.agentId === FOUNDER_ID) {
          const ceo = this.characters.get(e.toAgentId) ?? this.byRole("ceo");
          if (ceo) {
            ceo.say(`Founder: ${e.message.text}`, 5);
            if (!ceo.isMoving) {
              const prev = this.currentState(ceo);
              ceo.setState("talk");
              this.later(3, () => {
                if (!ceo.isMoving && ceo.state === "talk") ceo.setState(prev === "talk" ? "idle" : prev);
              });
            }
          }
          break;
        }
        if (e.toAgentId === FOUNDER_ID) {
          // Reporting to the founder: walk to the lobby bell, say it, walk back.
          const ceo = this.characters.get(e.agentId) ?? this.byRole("ceo");
          if (!ceo) break;
          ceo.say(e.message.text, 4);
          const home = this.homeSpotId(ceo.agent);
          void ceo.goTo(office.bellSpot, "talk", office.faceTiles.get("bell") ?? null).then((ok) => {
            if (!ok) return;
            ceo.say(e.message.text, 5);
            this.later(4, () => void ceo.goTo(home, this.currentState(ceo)));
          });
          break;
        }
        const sender = this.characters.get(e.agentId);
        const recipient = this.characters.get(e.toAgentId);
        if (!sender) break;
        sender.say(e.message.text, 4);
        if (recipient && recipient !== sender && tileDistance(sender.tile, recipient.tile) > FAR_TILES) {
          const home = this.homeSpotId(sender.agent);
          void sender.goTo(this.adjacentTo(recipient.tile, sender.tile), "talk", recipient.tile).then((ok) => {
            if (!ok) return;
            sender.say(e.message.text, 4);
            recipient.setState("talk");
            this.later(3, () => {
              this.restoreState(recipient);
              void sender.goTo(home, this.currentState(sender));
            });
          });
        } else {
          const prev = this.currentState(sender);
          if (!sender.isMoving) sender.setState("talk");
          this.later(2.5, () => {
            if (!sender.isMoving && sender.state === "talk") sender.setState(prev === "talk" ? "idle" : prev);
          });
        }
        break;
      }
      case "post_message": {
        // The poster bubbles the text wherever they are: at a meeting seat
        // for a meeting thread, at their desk for #general. Unknown ids are ignored.
        const ch = this.characters.get(e.agentId);
        if (!ch) break;
        ch.say(e.post.text, 4);
        const inMeeting = e.post.channel !== "general" && this.seatOf(e.agentId) !== null;
        if (!inMeeting && !ch.isMoving && ch.state !== "celebrate") {
          const prev = this.currentState(ch);
          ch.setState("talk");
          this.later(2.5, () => {
            if (!ch.isMoving && ch.state === "talk") ch.setState(prev === "talk" ? "idle" : prev);
          });
        }
        break;
      }
      case "channel_opened":
        // A meeting thread opening is already shown by call_meeting.
        break;
      case "agent_persona_changed": {
        const ch = this.characters.get(e.agentId);
        const agent = this.store.agents.get(e.agentId);
        if (!ch) break;
        ch.setAgent(agent ? { ...agent } : { ...ch.agent, name: e.name, style: e.style, job: e.job });
        ch.rebuildNameTag();
        break;
      }
      case "handoff": {
        const sender = this.characters.get(e.agentId);
        const recipient = this.characters.get(e.toAgentId);
        if (!sender) break;
        const title = this.store.tasks.get(e.taskId)?.title ?? "task";
        sender.carry("folder");
        sender.say(`Handing off: ${title}`, 3);
        const home = this.homeSpotId(sender.agent);
        const dest = recipient ? this.adjacentTo(recipient.tile, sender.tile) : sender.tile;
        void sender.goTo(dest, "talk", recipient?.tile ?? null).then((ok) => {
          sender.carry(null);
          if (!ok) return;
          sender.say(e.note, 4);
          recipient?.say("Got it.", 2);
          this.later(2.5, () => void sender.goTo(home, this.currentState(sender)));
        });
        this.syncBoard();
        break;
      }
      case "call_meeting": {
        const ids = [...new Set([e.agentId, ...e.attendeeIds])];
        const seats = this.assignSeats(e.meetingId, ids);
        for (const id of ids) {
          const ch = this.characters.get(id);
          const seat = seats.get(id);
          if (!ch || !seat) continue;
          const faceTile = office.faceTiles.get(`seat_${seat.x}_${seat.z}`) ?? null;
          void ch.goTo(seat, "meeting", faceTile).then((ok) => {
            if (ok && id === e.agentId) ch.say(e.topic, 5);
          });
        }
        this.characters.get(e.agentId)?.say(`Meeting: ${e.topic}`, 3);
        break;
      }
      case "meeting_ended": {
        const seats = this.seatsByMeeting.get(e.meetingId);
        this.seatsByMeeting.delete(e.meetingId);
        if (!seats) break;
        for (const id of seats.keys()) {
          const ch = this.characters.get(id);
          if (ch) void ch.goTo(this.homeSpotId(ch.agent), this.currentState(ch));
        }
        break;
      }
      case "build_failed": {
        office.flashAlarm(4);
        office.setIncidentDays(0);
        this.byRole("qa")?.say(`Build failed: ${e.summary}`, 4);
        const it = this.byRole("it");
        if (it) {
          void it.goTo(office.closetSpot, "idle", office.faceTiles.get("server_closet") ?? null).then((ok) => {
            if (!ok) return;
            it.say("Restart it.", 3);
            this.later(4, () => void it.goTo(this.homeSpotId(it.agent), this.currentState(it)));
          });
        }
        break;
      }
      case "build_passed": {
        const qa = this.byRole("qa") ?? this.byRole("engineer");
        if (qa) {
          qa.say(`Build passed: ${e.summary}`, 3);
          if (!qa.isMoving) qa.setState("celebrate");
        }
        break;
      }
      case "budget_warning": {
        const cfo = this.byRole("cfo");
        const pct = Math.round((e.spend.turns / Math.max(1, e.budget.maxTurns)) * 100);
        if (cfo) {
          cfo.say(`Budget at ${pct}%!`, 4);
          const loop: (string | Tile)[] = ["pm_desk", "dev_pod_2", "copier", "qa_bench", "kitchen", "lobby", "cfo_desk"];
          const walk = async () => {
            for (const stop of loop) {
              const ok = await cfo.goTo(stop, "idle");
              if (!ok) return;
              cfo.say(`${pct}% of budget spent`, 2);
            }
            cfo.setState("idle", office.faceTiles.get("cfo_desk") ?? null);
          };
          void walk();
        } else {
          this.byRole("ceo")?.say(`Budget at ${pct}%`, 3);
        }
        break;
      }
      case "budget_exhausted": {
        this.setDimmed(true);
        this.byRole("ceo")?.say("We are out of budget.", 5);
        let i = 0;
        for (const ch of this.characters.values()) {
          const spot = office.breakSpots[i % office.breakSpots.length] ?? office.breakSpots[0];
          i++;
          if (spot) void ch.goTo(spot, "coffee");
        }
        break;
      }
      case "spend_updated":
        break;
      case "request_approval": {
        const ceo = this.characters.get(e.agentId) ?? this.byRole("ceo");
        if (!ceo) break;
        ceo.say(`Founder, a ${e.approval.kind} approval?`, 2);
        void ceo.goTo(office.bellSpot, "idle", office.faceTiles.get("bell") ?? null).then((ok) => {
          if (!ok) return;
          office.ringBell();
          ceo.say(e.approval.summary, 8);
        });
        break;
      }
      case "approval_resolved": {
        const ceo = this.byRole("ceo");
        if (!ceo) break;
        const verdict = e.approval.status === "approved" ? "Approved!" : e.approval.status === "rejected" ? `Rejected: ${e.approval.founderComment ?? "no comment"}` : "Pending...";
        ceo.say(verdict, 4);
        if (e.approval.status === "approved") ceo.setState("celebrate");
        this.later(1.5, () => void ceo.goTo(this.homeSpotId(ceo.agent), this.currentState(ceo)));
        break;
      }
      case "subagent_spawned": {
        const parent = this.characters.get(e.agentId);
        parent?.say("Spawning a helper...", 2);
        const contractor = this.store.agents.get(e.contractor.id) ?? e.contractor;
        this.spawnContractor(contractor);
        break;
      }
      case "subagent_finished": {
        const ch = this.characters.get(e.contractorId);
        if (ch) {
          ch.say("Done!", 1.5);
          ch.fadeOutAndRemove(() => this.removeCharacter(e.contractorId));
        }
        this.characters.get(e.agentId)?.nod();
        break;
      }
      case "idle_timeout": {
        const ch = this.characters.get(e.agentId);
        if (!ch) break;
        // Alternate between the kitchen and the break room.
        this.idleToggle = !this.idleToggle;
        const pool = this.idleToggle && office.kitchenSpots.length > 0 ? office.kitchenSpots : office.breakSpots;
        const spot = pool[Math.floor(Math.random() * pool.length)] ?? pool[0];
        if (!spot) break;
        ch.say("Coffee time.", 2);
        void ch.goTo(spot, "coffee").then((ok) => {
          if (!ok) return;
          this.later(8, () => {
            const status = this.store.agents.get(e.agentId)?.status ?? "idle";
            void ch.goTo(this.homeSpotId(ch.agent), status === "away" ? "idle" : stateForStatus(status));
          });
        });
        break;
      }
      case "agent_status": {
        const ch = this.characters.get(e.agentId);
        if (ch && !ch.isMoving && ch.state !== "celebrate") this.placeByStatus(ch, e.status, false);
        break;
      }
    }
  }

  // ---- helpers ---------------------------------------------------------------------

  private later(seconds: number, fn: () => void): void {
    this.timers.push({ at: this.time + seconds, fn });
  }

  private incidentDays(companyId: string): number {
    return Math.floor((this.incidentSeconds.get(companyId) ?? 0) / INCIDENT_DAY_SECONDS);
  }

  private syncBoard(): void {
    if (!this.office || !this.officeCompanyId) return;
    const titles = this.store
      .tasksOf(this.officeCompanyId)
      .filter((t) => t.status !== "done")
      .map((t) => t.title);
    this.office.setTasks(titles);
  }

  private setDimmed(dim: boolean): void {
    if (dim === this.dimmed) return;
    this.dimmed = dim;
    this.lights.sun.intensity = dim ? this.baseIntensity.sun * 0.25 : this.baseIntensity.sun;
    this.lights.sky.intensity = dim ? this.baseIntensity.sky * 0.35 : this.baseIntensity.sky;
  }

  private byRole(role: RoleId): Character | null {
    for (const ch of this.characters.values()) if (ch.agent.role === role && ch.agent.kind !== "contractor") return ch;
    return null;
  }

  /** The spot id an agent sits at: its home if known, else its role default. */
  private homeSpotId(agent: Agent): string {
    if (agent.home in HOME_SPOTS) return agent.home;
    return ROLE_HOME[agent.role];
  }

  private homeTile(agent: Agent): Tile {
    const t = spotTile(this.homeSpotId(agent)) ?? this.office?.entranceSpot ?? { x: 1, z: 14 };
    const grid = this.office?.grid;
    return grid ? (nearestWalkable(grid, t) ?? t) : t;
  }

  /** The current "resting" state of a character, derived from the store. */
  private currentState(ch: Character): AnimState {
    const agent = this.store.agents.get(ch.agent.id) ?? ch.agent;
    const s = stateForStatus(agent.status);
    return s === "leave" ? "idle" : s;
  }

  private restoreState(ch: Character): void {
    if (ch.isMoving) return;
    ch.setState(this.currentState(ch));
  }

  /** A walkable tile next to `target`, preferring the side nearest `from`. */
  private adjacentTo(target: Tile, from: Tile): Tile {
    const grid = this.office?.grid;
    if (!grid) return target;
    const candidates: Tile[] = [
      { x: target.x + 1, z: target.z },
      { x: target.x - 1, z: target.z },
      { x: target.x, z: target.z + 1 },
      { x: target.x, z: target.z - 1 },
    ].filter((t) => isWalkable(grid, t.x, t.z));
    candidates.sort((a, b) => tileDistance(a, from) - tileDistance(b, from));
    return candidates[0] ?? nearestWalkable(grid, target) ?? target;
  }

  private createCharacter(agent: Agent, tile: Tile, small = false): Character {
    const office = this.office;
    if (!office) throw new Error("no office");
    const ch = new Character({ ...agent }, office, tile, { small });
    this.characters.set(agent.id, ch);
    this.scene.add(ch.group);
    office.group.add(ch.papers);
    return ch;
  }

  private removeCharacter(id: string): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.dispose();
    this.characters.delete(id);
  }

  private spawnContractor(agent: Agent): void {
    const office = this.office;
    if (!office) return;
    const parent = agent.parentAgentId ? this.characters.get(agent.parentAgentId) : null;
    const anchor = parent ? parent.tile : office.entranceSpot;
    const tile = this.adjacentTo(anchor, { x: anchor.x + 1, z: anchor.z });
    this.removeCharacter(agent.id);
    const ch = this.createCharacter(agent, tile, true);
    ch.fadeIn();
    ch.setState("sit_typing", parent ? parent.tile : null);
  }

  /** Puts a character where its status says it should be. */
  private placeByStatus(ch: Character, status: AgentStatus, initial: boolean): void {
    const office = this.office;
    if (!office) return;
    const state = stateForStatus(status);
    const homeSpot = this.homeSpotId(ch.agent);
    const face = office.faceTiles.get(homeSpot) ?? null;
    switch (status) {
      case "meeting": {
        let seat: Tile | null = null;
        for (const seats of this.seatsByMeeting.values()) seat = seats.get(ch.agent.id) ?? seat;
        if (!seat) seat = this.takeFreeSeat(ch.agent.id);
        if (seat) {
          const faceTile = office.faceTiles.get(`seat_${seat.x}_${seat.z}`) ?? null;
          if (initial) {
            ch.teleport(seat, faceTile);
            ch.setState("meeting");
          } else void ch.goTo(seat, "meeting", faceTile);
        } else ch.setState("idle", face);
        break;
      }
      case "away": {
        const spot = office.breakSpots[Math.floor(Math.random() * office.breakSpots.length)] ?? office.entranceSpot;
        if (initial) {
          ch.teleport(spot, null);
          ch.setState("coffee");
        } else void ch.goTo(spot, "coffee");
        break;
      }
      case "retired":
        void ch.leave().then(() => this.removeCharacter(ch.agent.id));
        break;
      default:
        if (initial) {
          ch.teleport(this.homeTile(ch.agent), face);
          ch.setState(state, face);
        } else if (ch.tile.x === this.homeTile(ch.agent).x && ch.tile.z === this.homeTile(ch.agent).z) {
          ch.setState(state, face);
        } else {
          void ch.goTo(homeSpot, state);
        }
    }
  }

  /** The meeting seat an agent currently holds, if any. */
  private seatOf(agentId: string): Tile | null {
    for (const seats of this.seatsByMeeting.values()) {
      const s = seats.get(agentId);
      if (s) return s;
    }
    return null;
  }

  private assignSeats(meetingId: string, ids: string[]): Map<string, Tile> {
    let seats = this.seatsByMeeting.get(meetingId);
    if (!seats) {
      seats = new Map();
      this.seatsByMeeting.set(meetingId, seats);
    }
    for (const id of ids) {
      if (seats.has(id)) continue;
      const seat = this.takeFreeSeat(id, seats);
      if (seat) seats.set(id, seat);
    }
    return seats;
  }

  private takeFreeSeat(agentId: string, into?: Map<string, Tile>): Tile | null {
    const office = this.office;
    if (!office) return null;
    const used = new Set<string>();
    for (const seats of this.seatsByMeeting.values()) for (const [id, s] of seats) if (id !== agentId) used.add(`${s.x},${s.z}`);
    for (const s of office.meetingSeats) {
      if (!used.has(`${s.x},${s.z}`)) {
        into?.set(agentId, s);
        return s;
      }
    }
    return null;
  }

  private clearOffice(): void {
    for (const id of [...this.characters.keys()]) this.removeCharacter(id);
    this.seatsByMeeting.clear();
    this.timers.length = 0;
    if (this.office) {
      this.office.dispose();
      this.office = null;
    }
    this.officeCompanyId = null;
  }
}

function firstName(name: string): string {
  return name.split(/[\s(]/)[0] ?? name;
}
