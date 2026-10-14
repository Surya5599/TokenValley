import * as THREE from "three";
import { FOUNDER_ID } from "../../state/store";
import { spotTile, tileToWorld } from "../../world/office";
import type { Episode } from "../episode";

/**
 * The pilot: the original ~130 second storyline. Valley, lobby wave, the
 * founder's brief, tasks, the pink meeting, a bug, a green build, the bell,
 * approval, the cheer and the deliverable reveal. Freezes at the end.
 */
export const pilot: Episode = {
  id: "pilot",
  title: "Pilot",
  tagline: "A landing page. Three feature cards. One pink.",
  durationSeconds: 130,
  nameCards: false,
  beats: (ctx) => {
    const { cast, send, post, dm, base, rig, director, follow, overview } = ctx;
    const COMPANY = ctx.companyId;
    const lobbyWorld = tileToWorld(spotTile("lobby") ?? { x: 5, z: 14 }, 0.4);

    // Tasks and the approval, shared by several beats.
    const tTokens = ctx.task("dm-t1", "Design tokens (pastel)", "designer", cast.pam.id, "backlog");
    const tHtml = ctx.task("dm-t2", "Landing page: index.html", "engineer", cast.dwight.id, "backlog");
    const tCss = ctx.task("dm-t3", "Responsive styles, 360 to 1280", "engineer", cast.dwight.id, "backlog");
    const tQa = ctx.task("dm-t4", "QA pass at 360 and 1280", "qa", cast.angela.id, "backlog");
    const tBug = ctx.task("dm-t5", "BUG: cards wrap at 360", "engineer", cast.dwight.id, "backlog", "qa");
    const approval = ctx.approval("dm-ap1", "Landing page is QA-passed at 360 and 1280. Ship it?");

    return [
      // 0-8s: valley, slow orbit, then a zoom toward the building.
      {
        at: 0,
        run: () => {
          ctx.boot("valley");
          ctx.gatherInLobby();
          rig.cinematicTo(new THREE.Vector3(0, 0, 0), 125, 0.78, 0.6, 0);
          rig.cinematicTo(new THREE.Vector3(0, 0, 0), 118, 0.74, 1.05, 5.5, "linear");
        },
      },
      {
        at: 4.5,
        run: () => {
          const p = ctx.valley.buildingPosition(COMPANY) ?? new THREE.Vector3();
          rig.cinematicTo(p.clone().add(new THREE.Vector3(0, 1.5, 0)), 26, 0.5, 1.05, 3.5);
        },
      },
      // 8-20s: cut to the lobby; everyone waves, then walks to their desks.
      {
        at: 8,
        run: () => {
          ctx.setCamera("office");
          rig.cinematicTo(lobbyWorld.clone().add(new THREE.Vector3(1, 0, 1)), 19, 0.62, 0.62, 0);
          ctx.everyoneWaves(6.5);
        },
      },
      { at: 9.5, run: () => rig.cinematicTo(lobbyWorld.clone().add(new THREE.Vector3(2, 0, 1)), 24, 0.68, 0.62, 5, "linear") },
      { at: 14.5, run: () => ctx.everyoneToDesks() },
      { at: 15, run: () => overview(5) },
      { at: 15.5, run: () => send(post(cast.erin, "general", "Welcome to Dunder Mindflin!")) },
      // 20-32s: the founder's brief; Michael answers at the bell.
      { at: 20, run: () => send(dm(FOUNDER_ID, cast.michael.id, "Michael, build us a landing page for AgentSitcom: pastel, three feature cards, works on a phone.")) },
      { at: 22, run: () => follow(cast.michael, 1.8) },
      { at: 23.5, run: () => send(dm(cast.michael.id, FOUNDER_ID, "Founder, say no more. Synergy time.")) },
      // 32-55s: the goal list, tasks on the board, Jim hands out work, desks get busy.
      { at: 31.5, run: () => overview(2.5) },
      { at: 32, run: () => send(post(cast.michael, "general", "Goal: a AgentSitcom landing page. Pastel. Three feature cards. Works on a phone. This is our moon landing.")) },
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
      { at: 107.5, run: () => ctx.everyoneCheers() },
      { at: 108, run: () => overview(3) },
      // 115-130s: the deliverable reveal, then the wordmark; the runtime freezes at 130.
      { at: 115, run: () => ctx.showDeliverable() },
      { at: 124, run: () => ctx.showWordmark() },
    ];
  },
};
