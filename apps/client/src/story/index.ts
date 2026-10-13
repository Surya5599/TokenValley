import * as THREE from "three";
import { DEFAULT_MODEL, HOME_SPOTS, ROLE_HOME, type Agent, type Approval, type Company, type Event, type RoleId, type ServerMessage, type Task } from "@tokenvalley/shared";
import type { CameraMode } from "../state/store";
import { spotTile, tileToWorld, type Tile } from "../world/office";
import { nearestWalkable } from "../world/pathfinding";
import { StoryCards } from "./cards";
import type { Beat, CastName, Episode, EpisodeContext, StoryHost } from "./episode";
import { EPISODES, episodeById } from "./episodes";
import { Mocku } from "./mocku";

export type { Episode, StoryHost } from "./episode";
export { EPISODES } from "./episodes";

/**
 * Story mode (?demo=story&ep=<id>): deterministic, timed episodes for screen
 * recording. Every office action goes through the real event pipeline
 * (store + director + audio); only crowd moves, camera, talking heads and the
 * DOM cards are story-specific. Keys: P toggles the progress line, N skips to
 * the next beat, L toggles the name cards.
 */

export interface Story {
  /** Advances the storyline by `dt` seconds of sim time. */
  update(dt: number): void;
  /** Jumps to the next beat (rehearsal). */
  skip(): void;
  readonly time: number;
  readonly duration: number;
  readonly episode: Episode;
}

const DEFAULT_DELIVERABLE = "http://127.0.0.1:8801/index.html";
const COMPANY = "dunder-mindflin";
const TITLE_SECONDS = 2.5;
const END_SECONDS = 3;

// Camera framings shared by the episodes.
const OFFICE_TARGET = new THREE.Vector3(0, 0, 1);
const OFFICE = { radius: 40, elevation: 0.9, azimuth: 0.62 };
const FOLLOW = { radius: 9, elevation: 0.62, azimuth: 0.62 };
const MEETING = { radius: 18, elevation: 0.8, azimuth: 0.62 };

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

function agent(id: string, role: RoleId, name: string, style = "", job = ""): Agent {
  const kind: Agent["kind"] = role === "cfo" || role === "receptionist" ? "npc" : ["ceo", "pm", "engineer", "qa", "designer"].includes(role) ? "core" : "hire";
  return { id, companyId: COMPANY, role, kind, name, model: DEFAULT_MODEL[role], effort: "medium", status: "idle", currentTaskId: null, home: ROLE_HOME[role], parentAgentId: null, style, job };
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

/** The Office cast of Dunder Mindflin, shared by every episode. */
export function makeCast(): Record<CastName, Agent> {
  return {
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
}

function snapshot(cast: Record<CastName, Agent>): Extract<ServerMessage, { kind: "snapshot" }> {
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

/** The episode id from the URL (?ep=), defaulting to the pilot. */
export function episodeFromUrl(): Episode {
  const id = new URLSearchParams(window.location.search).get("ep") ?? "pilot";
  const ep = episodeById(id);
  if (!ep) console.warn(`[story] unknown episode "${id}", playing the pilot`);
  return ep ?? (EPISODES[0] as Episode);
}

export function startStory(host: StoryHost, episode: Episode = episodeFromUrl()): Story {
  const { store, director, rig, handleMessage, audio } = host;
  const cast = makeCast();
  const mocku = new Mocku(rig, director, host.setLook);
  const cards = new StoryCards(host.overlayRoot);
  const cardsParam = new URLSearchParams(window.location.search).get("cards");
  cards.setNameCards(cardsParam === null ? episode.nameCards : cardsParam !== "0");
  const duration = episode.durationSeconds;

  // ---- event builders ----
  const castById: Record<string, Agent> = Object.fromEntries(Object.values(cast).map((a) => [a.id, a]));
  const base = () => ({ id: nextId("evt"), companyId: COMPANY, timestamp: Date.now() });
  const send = (e: Event) => {
    // First words introduce the speaker.
    if ((e.type === "post_message" || e.type === "send_message") && e.agentId in castById) cards.introduce(castById[e.agentId] as Agent);
    handleMessage({ kind: "event", event: e });
  };
  const post = (from: Agent, channel: string, text: string): Event => ({ ...base(), type: "post_message", agentId: from.id, post: { id: nextId("post"), companyId: COMPANY, channel, from: from.id, text, timestamp: Date.now() } });
  const dm = (from: string, to: string, text: string, taskId: string | null = null): Event => ({
    ...base(),
    type: "send_message",
    agentId: from,
    toAgentId: to,
    message: { id: nextId("msg"), companyId: COMPANY, from, to, text, taskId, timestamp: Date.now() },
  });
  const task = (id: string, title: string, ownerRole: RoleId | null, ownerAgentId: string | null, status: Task["status"], createdBy = "pm"): Task => ({ id, companyId: COMPANY, title, ownerRole, ownerAgentId, status, dependsOn: [], files: [], createdBy });
  const approval = (id: string, summary: string): Approval => ({ id, companyId: COMPANY, kind: "ship", summary, status: "pending", founderComment: null });

  // ---- characters and camera ----
  const character = (a: Agent) => director.characters.get(a.id) ?? null;
  const targetOf = (t: Agent | THREE.Vector3): THREE.Vector3 | (() => THREE.Vector3 | null) => (t instanceof THREE.Vector3 ? t : () => director.characterPosition(t.id));
  const follow = (a: Agent, seconds: number) => rig.cinematicTo(() => director.characterPosition(a.id), FOLLOW.radius, FOLLOW.elevation, FOLLOW.azimuth, seconds);
  const overview = (seconds: number) => rig.cinematicTo(OFFICE_TARGET, OFFICE.radius, OFFICE.elevation, OFFICE.azimuth, seconds);
  const meeting = (seconds: number) => rig.cinematicTo(director.meetingCenter(), MEETING.radius, MEETING.elevation, MEETING.azimuth, seconds);
  const spot = (id: string, y = 0) => tileToWorld(spotTile(id) ?? { x: 5, z: 14 }, y);

  // ---- DOM: progress line, deliverable card, wordmark ----
  const progress = document.createElement("div");
  progress.className = "story-progress";
  const progressFill = document.createElement("div");
  progress.append(progressFill);
  host.overlayRoot.append(progress);
  let progressVisible = true;

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

  // ---- crowd helpers ----
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

  const boot = (camera: "office" | "valley") => {
    store.panelTab = "company";
    store.feedVisible = true;
    store.speed = 1;
    handleMessage(snapshot(cast));
    host.setCamera(camera);
    if (camera === "office") {
      mocku.look("office");
      overview(0);
    }
    probeDeliverable();
  };

  const ctx: EpisodeContext = {
    store,
    director,
    rig,
    valley: host.valley,
    audio,
    mocku,
    companyId: COMPANY,
    cast,
    send,
    base,
    post,
    dm,
    task,
    approval,
    boot,
    character,
    homeSpotId,
    spot,
    follow,
    overview,
    meeting,
    look: (m: CameraMode) => mocku.look(m),
    gesture: (a, name) => character(a)?.gesture(name),
    expression: (a, e, seconds) => character(a)?.setExpression(e, seconds),
    state: (a, s, face) => character(a)?.setState(s, face),
    say: (a, text, seconds) => {
      cards.introduce(a);
      character(a)?.say(text, seconds);
    },
    gatherInLobby,
    everyoneWaves,
    everyoneToDesks,
    everyoneCheers,
    nameCard: (a) => cards.introduce(a, true),
    showDeliverable,
    showWordmark: () => wordmark.classList.add("in"),
    snapZoom: (t, factor, hold, elevation) => mocku.snapZoom(targetOf(t), factor, hold, elevation),
    snapTo: (t, radius, hold, elevation) => mocku.snapZoom(targetOf(t), Math.max(1.01, rig.framing.radius / radius), hold, elevation),
    whipPan: (t, radius, elevation) => mocku.whipPan(targetOf(t), radius, elevation),
    pushIn: (t, seconds) => mocku.pushIn(targetOf(t), seconds),
    talkingHead: (a, line, seconds, expression) => {
      const ch = character(a);
      if (!ch) return;
      cards.introduce(a);
      mocku.talkingHead(ch, line, seconds, expression, (l) => cards.showCaption(l, Math.max(1, seconds - 0.8)));
    },
    setCamera: host.setCamera,
  };

  // ---- the beats: the episode's, plus the cards and the freeze ----
  const beats: Beat[] = [
    ...episode.beats(ctx),
    {
      at: 0,
      run: () => {
        cards.showTitle(episode.title, episode.tagline);
        audio.play("titlecard");
      },
    },
    { at: TITLE_SECONDS, run: () => cards.hideTitle() },
    { at: Math.max(TITLE_SECONDS + 1, duration - END_SECONDS), run: () => cards.showEnd(episode.title) },
    {
      at: duration,
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
    mocku.update(dt);
    cards.update(dt);
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
    progressFill.style.width = `${Math.min(100, (time / duration) * 100)}%`;
    if (next >= beats.length && time >= duration) finished = true;
  };

  const skip = () => {
    const b = beats[next];
    if (!b || finished) return;
    update(Math.max(0, b.at - time));
  };

  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
    if (e.key === "p" || e.key === "P") {
      progressVisible = !progressVisible;
      progress.classList.toggle("hidden", !progressVisible);
    } else if (e.key === "n" || e.key === "N") {
      skip();
    } else if (e.key === "l" || e.key === "L") {
      cards.setNameCards(!cards.nameCardsOn);
    }
  });

  // The first beats run now so the snapshot exists before the first frame.
  update(0);

  return {
    update,
    skip,
    get time() {
      return time;
    },
    duration,
    episode,
  };
}
