import * as THREE from "three";
import { DEFAULT_MODEL, HOME_SPOTS, ROLE_HOME, type Agent, type Approval, type Company, type Event, type RoleId, type ServerMessage, type Task } from "@tokenvalley/shared";
import { FOUNDER_ID, type CameraMode, type Store } from "./state/store";
import type { Overlay } from "./ui/overlay";
import type { CameraRig } from "./world/camera";
import type { Director } from "./world/director";
import { spotTile, tileToWorld, type Tile } from "./world/office";
import { nearestWalkable } from "./world/pathfinding";
import type { Valley } from "./world/valley";

/**
 * Story mode (?demo=story): a ~130 second deterministic storyline for
 * screen recording with a voiceover. Every office action goes through the
 * real event pipeline (store + director); only the opening wave, the group
 * cheer, the camera moves and the closing reveal are story-specific.
 */

export interface StoryHost {
  store: Store;
  director: Director;
  rig: CameraRig;
  overlay: Overlay;
  valley: Valley;
  overlayRoot: HTMLElement;
  handleMessage: (m: ServerMessage) => void;
  setCamera: (mode: CameraMode) => void;
}

export interface Story {
  /** Advances the storyline by `dt` seconds of sim time. */
  update(dt: number): void;
  /** Elapsed sim seconds. */
  readonly time: number;
  readonly duration: number;
}

interface Beat {
  at: number;
  run: () => void;
}

export const STORY_DURATION = 130;
const DEFAULT_DELIVERABLE = "http://127.0.0.1:8801/index.html";
const COMPANY = "dunder-mindflin";

// Camera framings reused across beats.
const OFFICE_TARGET = new THREE.Vector3(0, 0, 1);
const OFFICE = { radius: 40, elevation: 0.9, azimuth: 0.62 };
const FOLLOW = { radius: 9, elevation: 0.62, azimuth: 0.62 };

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

function agent(id: string, role: RoleId, name: string, style = "", job = ""): Agent {
  const kind: Agent["kind"] = role === "cfo" || role === "receptionist" ? "npc" : ["ceo", "pm", "engineer", "qa", "designer"].includes(role) ? "core" : "hire";
  return {
    id,
    companyId: COMPANY,
    role,
    kind,
    name,
    model: DEFAULT_MODEL[role],
    effort: "medium",
    status: "idle",
    currentTaskId: null,
    home: ROLE_HOME[role],
    parentAgentId: null,
    style,
    job,
  };
}

function company(id: string, name: string, tagline: string, plot: number, palette: Company["palette"], live = false): Company {
  return {
    id,
    slug: id,
    name,
    tagline,
    brief: `${name} builds a landing page for TokenValley.`,
    workspacePath: "",
    live,
    rosterTemplate: "startup",
    palette,
    budget: { maxTurns: 200, maxTokens: 2_000_000 },
    spend: { turns: 12, inputTokens: 80_000, outputTokens: 21_000, estimatedUsd: 0.9 },
    priority: 5,
    phase: "building",
    plot,
  };
}

function task(id: string, title: string, ownerRole: RoleId | null, ownerAgentId: string | null, status: Task["status"], createdBy = "pm"): Task {
  return { id, companyId: COMPANY, title, ownerRole, ownerAgentId, status, dependsOn: [], files: [], createdBy };
}

const cast = {
  michael: agent("dm-michael", "ceo", "Michael (CEO)", "Wants to be your friend first and your boss second. Never finishes a metaphor.", "Owns the brief and the plan. Talks to the founder, calls meetings, decides what ships."),
  jim: agent("dm-jim", "pm", "Jim (PM)", "Deadpan. Looks at the camera when something absurd happens.", "Breaks the brief into tasks and keeps the board honest."),
  dwight: agent("dm-dwight", "engineer", "Dwight (Engineer)", "Answers questions with file paths and a safety briefing.", "Implements tasks in the workspace and hands finished work to QA."),
  pam: agent("dm-pam", "designer", "Pam (Designer)", "Quietly the most competent person in the building.", "Owns design tokens and layout."),
  angela: agent("dm-angela", "qa", "Angela (QA)", "Judges everything, approves nothing. Keeps a list.", "Runs smoke tests and blocks shipping on regressions."),
  oscar: agent("dm-oscar", "cfo", "Oscar (CFO)"),
  erin: agent("dm-erin", "receptionist", "Erin (Front desk)"),
  kevin: agent("dm-kevin", "intern", "Kevin (Intern)", "Counts on his fingers. Asks 'is this normal?' about everything.", "Helps whoever asks."),
  creed: agent("dm-creed", "it", "Creed (IT)", "Has restarted it. Nobody is sure what else he does here.", "Keeps the build and tooling running."),
};

function snapshot(): Extract<ServerMessage, { kind: "snapshot" }> {
  return {
    kind: "snapshot",
    town: { focusedCompanyId: COMPANY, poolSize: 3 },
    companies: [
      company(COMPANY, "Dunder Mindflin", "Limitless paper in a paperless world.", 0, { primary: "#3d5a80", secondary: "#98c1d9", accent: "#ee6c4d", floor: "#d8c3a5", wall: "#e0fbfc" }, true),
      company("sabre-labs", "Sabre Labs", "Printers that print. Mostly.", 1, { primary: "#386641", secondary: "#a7c957", accent: "#f2e8cf", floor: "#c9b79c", wall: "#f7f7f2" }),
      company("scott-paper", "Scott Paper Co.", "A paper company. In a closet.", 2, { primary: "#5a189a", secondary: "#9d4edd", accent: "#ffd60a", floor: "#cdb4db", wall: "#f1e4f3" }),
    ],
    agents: Object.values(cast),
    tasks: [],
    recentEvents: [],
  };
}

/** Where an agent sits: its home spot if known, else the role default (mirrors the director). */
function homeSpotId(a: Agent): string {
  return a.home in HOME_SPOTS ? a.home : ROLE_HOME[a.role];
}

export function startStory(host: StoryHost): Story {
  const { store, director, rig, handleMessage } = host;
  const base = () => ({ id: nextId("evt"), companyId: COMPANY, timestamp: Date.now() });
  const send = (e: Event) => handleMessage({ kind: "event", event: e });
  const post = (from: Agent, channel: string, text: string): Event => ({ ...base(), type: "post_message", agentId: from.id, post: { id: nextId("post"), companyId: COMPANY, channel, from: from.id, text, timestamp: Date.now() } });
  const dm = (from: string, to: string, text: string, taskId: string | null = null): Event => ({
    ...base(),
    type: "send_message",
    agentId: from,
    toAgentId: to,
    message: { id: nextId("msg"), companyId: COMPANY, from, to, text, taskId, timestamp: Date.now() },
  });
  const character = (a: Agent) => director.characters.get(a.id) ?? null;
  const follow = (a: Agent, seconds: number) => rig.cinematicTo(() => director.characterPosition(a.id), FOLLOW.radius, FOLLOW.elevation, FOLLOW.azimuth, seconds);
  const overview = (seconds: number) => rig.cinematicTo(OFFICE_TARGET, OFFICE.radius, OFFICE.elevation, OFFICE.azimuth, seconds);

  // Tasks and the approval, shared by several beats.
  const tTokens = task("dm-t1", "Design tokens (pastel)", "designer", cast.pam.id, "backlog");
  const tHtml = task("dm-t2", "Landing page: index.html", "engineer", cast.dwight.id, "backlog");
  const tCss = task("dm-t3", "Responsive styles, 360 to 1280", "engineer", cast.dwight.id, "backlog");
  const tQa = task("dm-t4", "QA pass at 360 and 1280", "qa", cast.angela.id, "backlog");
  const tBug = task("dm-t5", "BUG: cards wrap at 360", "engineer", cast.dwight.id, "backlog", "qa");
  const approval: Approval = { id: "dm-ap1", companyId: COMPANY, kind: "ship", summary: "Landing page is QA-passed at 360 and 1280. Ship it?", status: "pending", founderComment: null };

  // ---- DOM: progress line, deliverable card, wordmark ----
  const progress = document.createElement("div");
  progress.className = "story-progress";
  const progressFill = document.createElement("div");
  progress.append(progressFill);
  host.overlayRoot.append(progress);
  let progressVisible = true;
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
    if (e.key === "p" || e.key === "P") {
      progressVisible = !progressVisible;
      progress.classList.toggle("hidden", !progressVisible);
    }
  });

  const deliverableUrl = new URLSearchParams(window.location.search).get("deliverable") || DEFAULT_DELIVERABLE;
  let deliverableReachable: boolean | null = null;
  const probeDeliverable = () => {
    // A refused connection rejects; an opaque cross-origin response resolves. Either way we know whether to show the iframe.
    fetch(deliverableUrl, { mode: "no-cors", cache: "no-store" })
      .then(() => {
        deliverableReachable = true;
      })
      .catch(() => {
        deliverableReachable = false;
      });
  };

  const card = document.createElement("div");
  card.className = "story-card";
  const showDeliverable = () => {
    card.replaceChildren();
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "Shipped: TokenValley landing page";
    card.append(title);
    if (deliverableReachable !== false) {
      const frame = document.createElement("iframe");
      frame.className = "frame";
      frame.src = deliverableUrl;
      frame.title = "Shipped landing page";
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
      card.append(frame);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "placeholder";
      const line1 = document.createElement("div");
      line1.className = "big";
      line1.textContent = "TokenValley";
      const line2 = document.createElement("div");
      line2.textContent = "Pastel. Three feature cards. Works on a phone.";
      placeholder.append(line1, line2);
      card.append(placeholder);
    }
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = "Dunder Mindflin, QA-passed at 360 and 1280";
    card.append(sub);
    host.overlayRoot.append(card);
    // Next frame so the slide-in transition runs.
    requestAnimationFrame(() => card.classList.add("in"));
  };

  const wordmark = document.createElement("div");
  wordmark.className = "story-wordmark";
  wordmark.textContent = "TokenValley";
  host.overlayRoot.append(wordmark);

  // ---- helpers for the story-only bits ----
  const lobbyTiles = (): Tile[] => {
    const office = director.office;
    const lobby = spotTile("lobby") ?? { x: 5, z: 14 };
    const out: Tile[] = [];
    // A loose crowd around the lobby spot, in front of the reception desk.
    const offsets: [number, number][] = [
      [0, 0],
      [-2, 0],
      [2, 0],
      [-1, 2],
      [1, 2],
      [-3, 2],
      [3, 2],
      [-1, -1],
      [1, -1],
      [0, 3],
    ];
    for (const [dx, dz] of offsets) {
      const t = { x: lobby.x + dx, z: lobby.z + dz };
      const w = office ? nearestWalkable(office.grid, t, 2) : t;
      if (w && !out.some((o) => o.x === w.x && o.z === w.z)) out.push(w);
    }
    return out;
  };
  const toward = (t: Tile): Tile => ({ x: t.x + 3, z: t.z + 4 }); // roughly toward the office camera
  const lobbyWorld = tileToWorld(spotTile("lobby") ?? { x: 5, z: 14 }, 0.4);

  const gatherInLobby = () => {
    const tiles = lobbyTiles();
    let i = 0;
    for (const a of Object.values(cast)) {
      const ch = character(a);
      const t = tiles[i++ % tiles.length];
      if (!ch || !t) continue;
      ch.teleport(t, toward(t));
      ch.setState("idle", toward(t));
    }
  };
  const everyoneWaves = (seconds: number) => {
    for (const a of Object.values(cast)) {
      const ch = character(a);
      if (ch) ch.wave(seconds, toward(ch.tile));
    }
  };
  const everyoneToDesks = () => {
    for (const a of Object.values(cast)) {
      const ch = character(a);
      if (ch) void ch.goTo(homeSpotId(a), "idle");
    }
  };
  const everyoneCheers = () => {
    for (const a of Object.values(cast)) {
      const ch = character(a);
      if (ch && !ch.isMoving && a.id !== cast.michael.id) ch.setState("celebrate");
    }
  };

  // ---- the beats ----
  const beats: Beat[] = [
    // 0-8s: valley, slow orbit, then a zoom toward the building.
    {
      at: 0,
      run: () => {
        store.panelTab = "company";
        store.feedVisible = true;
        store.speed = 1;
        handleMessage(snapshot());
        host.setCamera("valley");
        gatherInLobby();
        rig.cinematicTo(new THREE.Vector3(0, 0, 0), 125, 0.78, 0.6, 0);
        rig.cinematicTo(new THREE.Vector3(0, 0, 0), 118, 0.74, 1.05, 5.5, "linear");
        probeDeliverable();
      },
    },
    {
      at: 4.5,
      run: () => {
        const p = host.valley.buildingPosition(COMPANY) ?? new THREE.Vector3();
        rig.cinematicTo(p.clone().add(new THREE.Vector3(0, 1.5, 0)), 26, 0.5, 1.05, 3.5);
      },
    },
    // 8-20s: cut to the lobby; everyone waves, then walks to their desks.
    {
      at: 8,
      run: () => {
        host.setCamera("office");
        rig.cinematicTo(lobbyWorld.clone().add(new THREE.Vector3(1, 0, 1)), 19, 0.62, 0.62, 0);
        everyoneWaves(6.5);
      },
    },
    { at: 9.5, run: () => rig.cinematicTo(lobbyWorld.clone().add(new THREE.Vector3(2, 0, 1)), 24, 0.68, 0.62, 5, "linear") },
    { at: 14.5, run: () => everyoneToDesks() },
    { at: 15, run: () => overview(5) },
    { at: 15.5, run: () => send(post(cast.erin, "general", "Welcome to Dunder Mindflin!")) },
    // 20-32s: the founder's brief; Michael answers at the bell.
    { at: 20, run: () => send(dm(FOUNDER_ID, cast.michael.id, "Michael, build us a landing page for TokenValley: pastel, three feature cards, works on a phone.")) },
    { at: 22, run: () => follow(cast.michael, 1.8) },
    { at: 23.5, run: () => send(dm(cast.michael.id, FOUNDER_ID, "Founder, say no more. Synergy time.")) },
    // 32-55s: the goal list, tasks on the board, Jim hands out work, desks get busy.
    { at: 31.5, run: () => overview(2.5) },
    { at: 32, run: () => send(post(cast.michael, "general", "Goal: a TokenValley landing page. Pastel. Three feature cards. Works on a phone. This is our moon landing.")) },
    { at: 34, run: () => send({ ...base(), type: "task_created", task: tTokens }) },
    { at: 35, run: () => send({ ...base(), type: "task_created", task: tHtml }) },
    { at: 36, run: () => send({ ...base(), type: "task_created", task: tCss }) },
    { at: 37, run: () => send({ ...base(), type: "task_created", task: tQa }) },
    { at: 38, run: () => send(dm(cast.jim.id, cast.pam.id, "Pam, tokens first. You pick the pink.", tTokens.id)) },
    { at: 42, run: () => send(dm(cast.jim.id, cast.dwight.id, "Dwight, index.html once the tokens land.", tHtml.id)) },
    { at: 44, run: () => send({ ...base(), type: "task_started", agentId: cast.pam.id, task: { ...tTokens, status: "in_progress" } }) },
    { at: 45.5, run: () => send({ ...base(), type: "tool_write_file", agentId: cast.pam.id, path: "src/tokens.json" }) },
    { at: 46, run: () => send(dm(cast.jim.id, cast.angela.id, "Angela, break it at 360.", tQa.id)) },
    { at: 47, run: () => send({ ...base(), type: "task_started", agentId: cast.dwight.id, task: { ...tHtml, status: "in_progress" } }) },
    { at: 47.5, run: () => follow(cast.dwight, 2) },
    { at: 48.5, run: () => send({ ...base(), type: "tool_write_file", agentId: cast.dwight.id, path: "src/index.html" }) },
    { at: 50, run: () => send({ ...base(), type: "tool_write_file", agentId: cast.dwight.id, path: "src/styles.css" }) },
    { at: 51, run: () => send({ ...base(), type: "task_started", agentId: cast.angela.id, task: { ...tQa, status: "in_progress" } }) },
    { at: 52, run: () => send({ ...base(), type: "tool_read_file", agentId: cast.angela.id, path: "src/index.html" }) },
    { at: 53, run: () => overview(2.5) },
    // 55-78s: Jim calls a meeting about the pink.
    { at: 55, run: () => send({ ...base(), type: "call_meeting", agentId: cast.jim.id, meetingId: "dm-m1", attendeeIds: [cast.pam.id, cast.dwight.id, cast.michael.id, cast.angela.id], topic: "Which pink?" }) },
    { at: 55.2, run: () => send({ ...base(), type: "channel_opened", channel: "meeting-1", title: "Which pink?", memberIds: [cast.jim.id, cast.pam.id, cast.dwight.id, cast.michael.id, cast.angela.id] }) },
    { at: 56.5, run: () => rig.cinematicTo(director.meetingCenter(), 18, 0.8, 0.62, 3) },
    { at: 62, run: () => send(post(cast.pam, "meeting-1", "Not that pink. That pink has been through things.")) },
    { at: 65, run: () => send(post(cast.dwight, "meeting-1", "Spec 4.2 says f5a3c7. It is in tokens.json. I have read tokens.json.")) },
    { at: 68, run: () => send(post(cast.michael, "meeting-1", "As the book says: a pink in the hand is worth two in the... other hand.")) },
    { at: 71, run: () => send(post(cast.angela, "meeting-1", "Noted. That is item 14 on my list.")) },
    { at: 74, run: () => send(post(cast.jim, "meeting-1", "f5a3c7 it is. Meeting over.")) },
    { at: 75.5, run: () => send({ ...base(), type: "meeting_ended", meetingId: "dm-m1" }) },
    { at: 76, run: () => overview(3) },
    // 78-98s: a bug, a fix, a green build, a handoff, done.
    { at: 79, run: () => send({ ...base(), type: "task_created", task: tBug }) },
    { at: 79.5, run: () => send(post(cast.angela, "general", "BUG: cards wrap at 360. Filed. I measured.")) },
    { at: 81.5, run: () => send({ ...base(), type: "task_started", agentId: cast.dwight.id, task: { ...tBug, status: "in_progress" } }) },
    { at: 83, run: () => send({ ...base(), type: "tool_write_file", agentId: cast.dwight.id, path: "src/styles.css" }) },
    { at: 84.5, run: () => send({ ...base(), type: "tool_shell", agentId: cast.dwight.id, command: "pnpm build" }) },
    { at: 86.5, run: () => send({ ...base(), type: "build_passed", summary: "360 and 1280 green" }) },
    { at: 88, run: () => send({ ...base(), type: "task_done", agentId: cast.pam.id, taskId: tTokens.id }) },
    { at: 88.5, run: () => send({ ...base(), type: "handoff", agentId: cast.dwight.id, taskId: tBug.id, toAgentId: cast.angela.id, note: "Fixed. Cards stack under 480px. Do your worst." }) },
    { at: 94.5, run: () => send({ ...base(), type: "task_done", agentId: cast.angela.id, taskId: tBug.id }) },
    { at: 95.5, run: () => send({ ...base(), type: "task_done", agentId: cast.dwight.id, taskId: tHtml.id }) },
    { at: 96, run: () => send({ ...base(), type: "task_updated", task: { ...tCss, status: "done" } }) },
    { at: 96.5, run: () => send({ ...base(), type: "task_done", agentId: cast.angela.id, taskId: tQa.id }) },
    // 98-115s: Michael rings the bell; the founder approves; everyone cheers; shipped.
    { at: 98, run: () => send({ ...base(), type: "request_approval", agentId: cast.michael.id, approval: { ...approval, status: "pending" } }) },
    { at: 98.2, run: () => follow(cast.michael, 2) },
    { at: 106, run: () => send({ ...base(), type: "approval_resolved", approval: { ...approval, status: "approved", founderComment: "Ship it." } }) },
    { at: 107, run: () => send({ ...base(), type: "company_phase", phase: "shipped" }) },
    { at: 107.5, run: () => everyoneCheers() },
    { at: 108, run: () => overview(3) },
    // 115-130s: the deliverable reveal, then the wordmark; freeze at the end.
    { at: 115, run: () => showDeliverable() },
    { at: 124, run: () => wordmark.classList.add("in") },
    {
      at: STORY_DURATION,
      run: () => {
        store.speed = 0;
        store.notify();
      },
    },
  ].sort((a, b) => a.at - b.at);

  let time = 0;
  let next = 0;
  let finished = false;

  const update = (dt: number) => {
    if (finished) return;
    time += dt;
    while (next < beats.length) {
      const b = beats[next];
      if (!b || b.at > time) break;
      next++;
      try {
        b.run();
      } catch (err) {
        console.error(`[story] beat at ${b.at}s failed`, err);
      }
    }
    progressFill.style.width = `${Math.min(100, (time / STORY_DURATION) * 100)}%`;
    if (next >= beats.length && time >= STORY_DURATION) finished = true;
  };

  // The first beat runs now so the snapshot exists before the first frame.
  update(0);

  return {
    update,
    get time() {
      return time;
    },
    duration: STORY_DURATION,
  };
}
