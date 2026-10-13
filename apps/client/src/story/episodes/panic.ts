import * as THREE from "three";
import { FOUNDER_ID } from "../../state/store";
import { spotTile, tileToWorld } from "../../world/office";
import { toonMat } from "../../world/style";
import type { Episode } from "../episode";

/**
 * Panic. A normal morning, two failed builds, Oscar walks the floor with the
 * budget, Michael calls an all-hands and nobody comes. The founder hits
 * panic: everyone freezes mid-action, the lights dim, silence. Then the
 * founder resumes, everyone jolts back, and Kevin spills chili in the kitchen.
 */
export const panic: Episode = {
  id: "panic",
  title: "Panic",
  tagline: "That's not a panic. That's a brand.",
  durationSeconds: 92,
  nameCards: true,
  beats: (ctx) => {
    const { cast, send, post, dm, base, overview, follow, director } = ctx;
    const tHtml = ctx.task("pn-t1", "Landing page: index.html", "engineer", cast.dwight.id, "in_progress");
    const tTokens = ctx.task("pn-t2", "Design tokens (pastel)", "designer", cast.pam.id, "in_progress");
    const budget = { maxTurns: 200, maxTokens: 2_000_000 };
    const spend = { turns: 168, inputTokens: 1_600_000, outputTokens: 300_000, estimatedUsd: 15.2 };
    const seatTile = () => director.office?.meetingSeats[3] ?? spotTile("meeting_room") ?? { x: 14, z: 5 };
    const emptyChairs = () => tileToWorld(seatTile(), 0.5);
    let chili: THREE.Mesh | null = null;
    const kitchen = spotTile("kitchen") ?? { x: 22, z: 4 };
    const spillTile = { x: kitchen.x + 1, z: kitchen.z + 1 };

    return [
      {
        at: 0,
        run: () => {
          ctx.boot("office");
          send({ ...base(), type: "task_created", task: tHtml });
          send({ ...base(), type: "task_created", task: tTokens });
          send({ ...base(), type: "task_started", agentId: cast.dwight.id, task: tHtml });
          send({ ...base(), type: "task_started", agentId: cast.pam.id, task: tTokens });
        },
      },
      // A normal morning.
      { at: 3, run: () => overview(2.5) },
      { at: 4, run: () => send(post(cast.erin, "general", "Morning! Coffee is on. Nothing is on fire.")) },
      { at: 7, run: () => send(post(cast.jim, "general", "Normal morning. Nothing to see.")) },
      { at: 7.5, run: () => follow(cast.jim, 1.4) },
      { at: 8.8, run: () => ctx.gesture(cast.jim, "lookAtCamera") },
      // Two failed builds.
      {
        at: 11,
        run: () => {
          ctx.look("follow");
          follow(cast.dwight, 1.5);
        },
      },
      { at: 12, run: () => send({ ...base(), type: "tool_shell", agentId: cast.dwight.id, command: "pnpm build" }) },
      { at: 14, run: () => send({ ...base(), type: "build_failed", summary: "tsc: 3 errors" }) },
      { at: 14.3, run: () => ctx.snapZoom(cast.dwight, 1.35, 1.0) },
      { at: 17, run: () => send({ ...base(), type: "tool_write_file", agentId: cast.dwight.id, path: "src/index.html" }) },
      { at: 19, run: () => send({ ...base(), type: "tool_shell", agentId: cast.dwight.id, command: "pnpm build" }) },
      { at: 21, run: () => send({ ...base(), type: "build_failed", summary: "tsc: 4 errors. It got worse." }) },
      { at: 21.3, run: () => ctx.snapZoom(cast.dwight, 1.5, 1.2) },
      { at: 22, run: () => ctx.gesture(cast.dwight, "facepalm") },
      // Oscar walks the floor with the budget.
      { at: 24.5, run: () => send({ ...base(), type: "budget_warning", spend, budget }) },
      { at: 25, run: () => follow(cast.oscar, 1.5) },
      { at: 28, run: () => send(post(cast.oscar, "general", "Eighty-four percent. I have the calculator. I have the receipts.")) },
      {
        at: 30.5,
        run: () => {
          ctx.look("office");
          overview(2);
        },
      },
      // Michael calls an all-hands. Nobody comes.
      { at: 33, run: () => send(post(cast.michael, "general", "ALL-HANDS. Conference room. Now. It's a surprise. Bring energy.")) },
      { at: 33.5, run: () => void ctx.character(cast.michael)?.goTo(seatTile(), "meeting", director.office?.faceTiles.get(`seat_${seatTile().x}_${seatTile().z}`) ?? null) },
      {
        at: 36,
        run: () => {
          ctx.look("meeting");
          ctx.meeting(2);
        },
      },
      { at: 40, run: () => ctx.say(cast.michael, "...Guys?", 3) },
      { at: 40.5, run: () => ctx.gesture(cast.michael, "lookAround") },
      { at: 41.5, run: () => ctx.snapZoom(emptyChairs(), 1.5, 1.6) },
      { at: 44.5, run: () => ctx.whipPan(cast.jim, 10) },
      { at: 45, run: () => ctx.gesture(cast.jim, "lookAtCamera") },
      // The founder hits panic: freeze, dim, silence.
      { at: 47.5, run: () => send(post(cast.michael, "general", "Fine. I will panic alone.")) },
      {
        at: 48.5,
        run: () => {
          ctx.look("office");
          overview(0.6);
        },
      },
      { at: 49.5, run: () => send({ ...base(), type: "company_phase", phase: "paused" }) },
      { at: 50, run: () => ctx.pushIn(new THREE.Vector3(0, 0, 1), 2.5) },
      // Resume: everyone jolts back.
      { at: 52.2, run: () => send({ ...base(), type: "company_phase", phase: "building" }) },
      { at: 52.6, run: () => overview(1.2) },
      // Kevin spills chili.
      { at: 54, run: () => void ctx.character(cast.kevin)?.goTo(spillTile, "idle", { x: spillTile.x, z: spillTile.z - 1 }) },
      {
        at: 55,
        run: () => {
          ctx.look("follow");
          follow(cast.kevin, 1.6);
        },
      },
      {
        at: 61,
        run: () => {
          const office = director.office;
          if (!office) return;
          // A flat red-brown blob on the kitchen floor.
          const geo = new THREE.CircleGeometry(0.55, 9);
          geo.rotateX(-Math.PI / 2);
          chili = new THREE.Mesh(geo, toonMat(0x8a3b1e));
          chili.position.copy(tileToWorld(spillTile, 0.015)).add(new THREE.Vector3(0.1, 0, -0.6));
          chili.scale.set(1.25, 1, 0.9);
          chili.receiveShadow = true;
          office.group.add(chili);
          ctx.say(cast.kevin, "Is this normal?", 3);
          ctx.gesture(cast.kevin, "facepalm");
          ctx.expression(cast.kevin, "surprised", 2);
        },
      },
      { at: 61.5, run: () => ctx.snapTo(tileToWorld(spillTile, 0.2).add(new THREE.Vector3(0.1, 0, -0.6)), 5, 1.4, 0.85) },
      { at: 64.5, run: () => ctx.gesture(cast.jim, "lookAtCamera") },
      // Michael reports to the founder.
      { at: 66, run: () => send(dm(cast.michael.id, FOUNDER_ID, "Founder. That was not a panic. That was a brand moment.")) },
      { at: 66.5, run: () => follow(cast.michael, 1.6) },
      {
        at: 72,
        run: () => {
          ctx.look("office");
          overview(2.5);
        },
      },
      // Talking head.
      { at: 75, run: () => ctx.talkingHead(cast.michael, "That's not a panic. That's a brand.", 6, "big_smile") },
      {
        at: 81,
        run: () => {
          ctx.look("office");
          overview(0);
        },
      },
      { at: 82, run: () => send(post(cast.angela, "general", "Chili is item fifteen.")) },
      { at: 83, run: () => ctx.gesture(cast.jim, "lookAtCamera") },
      { at: 83.2, run: () => ctx.snapZoom(cast.jim, 1.35, 1.0) },
      { at: 85.5, run: () => overview(3) },
    ];
  },
};
