import * as THREE from "three";
import { spotTile } from "../../world/office";
import type { Episode } from "../episode";

/**
 * The Bug. Angela files a bug and the jar fills. Dwight says it works on his
 * machine. The build fails: alarm, the incident sign resets with a buzzer,
 * Creed jogs to the closet and says "Restart it". Dwight fixes it, the build
 * passes, Angela gives a thumbs up and files a second bug.
 */
export const theBug: Episode = {
  id: "the-bug",
  title: "The Bug",
  tagline: "It works on his machine. His machine is not the internet.",
  durationSeconds: 80,
  nameCards: true,
  beats: (ctx) => {
    const { cast, send, post, dm, base, overview, follow, director, rig } = ctx;
    const tHtml = ctx.task("tb-t1", "Landing page: index.html", "engineer", cast.dwight.id, "in_progress");
    const tQa = ctx.task("tb-t2", "QA pass at 360", "qa", cast.angela.id, "in_progress");
    const tBug = ctx.task("tb-t3", "BUG: cards wrap at 360", "engineer", cast.dwight.id, "backlog", "qa");
    const tBug2 = ctx.task("tb-t4", "BUG: the fix took eleven minutes", "engineer", cast.dwight.id, "backlog", "qa");
    const jar = (n: number) => () => director.office?.bugJar.setCount(n);
    // The jar sits on the QA bench, one tile right and one back of where Angela stands.
    const JAR = new THREE.Vector3(3.7, 0.95, 7.7);
    // The incident sign hangs on the front wall facing into the room, so the camera swings round to read it.
    const SIGN = new THREE.Vector3(1.0, 1.0, 13.2);
    const toSign = (seconds: number) => rig.cinematicTo(SIGN, 7.5, 0.3, Math.PI - 0.35, seconds, "whip");

    return [
      {
        at: 0,
        run: () => {
          ctx.boot("office");
          send({ ...base(), type: "task_created", task: tHtml });
          send({ ...base(), type: "task_created", task: tQa });
          send({ ...base(), type: "task_started", agentId: cast.dwight.id, task: tHtml });
          send({ ...base(), type: "task_started", agentId: cast.angela.id, task: tQa });
          // Creed starts in the break room so the alarm sends him jogging.
          const creed = ctx.character(cast.creed);
          const breakSpot = spotTile("break_room") ?? { x: 35, z: 4 };
          creed?.teleport(breakSpot, { x: breakSpot.x, z: breakSpot.z - 1 });
          creed?.setState("coffee");
        },
      },
      { at: 3, run: () => overview(2) },
      // Angela finds it.
      {
        at: 5,
        run: () => {
          ctx.look("follow");
          follow(cast.angela, 1.8);
        },
      },
      { at: 6.5, run: () => send({ ...base(), type: "tool_read_file", agentId: cast.angela.id, path: "src/index.html" }) },
      { at: 8, run: () => send(post(cast.angela, "general", "BUG: cards wrap at 360. Filed. I measured.")) },
      { at: 8.2, run: () => send({ ...base(), type: "task_created", task: tBug }) },
      { at: 8.6, run: jar(1) },
      { at: 9.4, run: () => ctx.snapTo(JAR, 2.6, 1.4, 0.5) },
      { at: 12, run: () => send(dm(cast.angela.id, cast.dwight.id, "Dwight. Your cards wrap.", tBug.id)) },
      // Works on his machine.
      { at: 14.5, run: () => follow(cast.dwight, 1.5) },
      { at: 15.5, run: () => send(dm(cast.dwight.id, cast.angela.id, "Works on my machine.", tBug.id)) },
      { at: 16, run: () => ctx.gesture(cast.dwight, "shrug") },
      { at: 17, run: () => ctx.whipPan(cast.angela) },
      { at: 17.3, run: () => ctx.gesture(cast.angela, "headShake") },
      { at: 17.4, run: () => ctx.expression(cast.angela, "frown", 3) },
      { at: 18, run: () => ctx.snapZoom(cast.angela, 1.35, 1.1) },
      { at: 20, run: () => send(post(cast.angela, "general", "Second bug: 'works on his machine'. His machine is not the internet.")) },
      { at: 20.4, run: jar(2) },
      { at: 21.5, run: () => ctx.gesture(cast.jim, "lookAtCamera") },
      // The build fails.
      {
        at: 24,
        run: () => {
          ctx.look("office");
          overview(2);
        },
      },
      { at: 25, run: () => send({ ...base(), type: "tool_shell", agentId: cast.dwight.id, command: "pnpm build" }) },
      { at: 27, run: () => send({ ...base(), type: "build_failed", summary: "styles.css: unexpected token" }) },
      {
        at: 27.4,
        run: () => {
          ctx.look("follow");
          toSign(0.3);
        },
      },
      { at: 29.5, run: () => ctx.snapZoom(SIGN, 1.5, 1.0) },
      {
        at: 31.5,
        run: () => {
          // The closet is boxed in by racks on the camera's usual side; shoot from the door.
          ctx.look("follow");
          rig.cinematicTo(() => director.characterPosition(cast.creed.id), 8, 0.6, -0.55, 0.3, "whip");
        },
      },
      { at: 33, run: () => send(post(cast.angela, "general", "The alarm is also a bug. Three.")) },
      { at: 33.3, run: jar(3) },
      { at: 36, run: () => ctx.snapZoom(cast.creed, 1.4, 1.4) },
      // Dwight fixes it.
      { at: 39, run: () => follow(cast.dwight, 1.6) },
      { at: 40, run: () => send({ ...base(), type: "task_started", agentId: cast.dwight.id, task: { ...tBug, status: "in_progress" } }) },
      { at: 41.5, run: () => send({ ...base(), type: "tool_write_file", agentId: cast.dwight.id, path: "src/styles.css" }) },
      { at: 43.5, run: () => send({ ...base(), type: "tool_shell", agentId: cast.dwight.id, command: "pnpm build" }) },
      { at: 45.5, run: () => send({ ...base(), type: "build_passed", summary: "360 green" }) },
      { at: 45.8, run: () => ctx.whipPan(cast.angela) },
      { at: 46.6, run: () => ctx.snapZoom(cast.angela, 1.35, 1.2) },
      { at: 49, run: () => send(post(cast.angela, "general", "Passed. Filing a second bug: the fix took eleven minutes.")) },
      { at: 49.3, run: () => send({ ...base(), type: "task_created", task: tBug2 }) },
      { at: 49.6, run: jar(4) },
      { at: 50.5, run: () => ctx.whipPan(cast.dwight) },
      { at: 51, run: () => ctx.gesture(cast.dwight, "facepalm") },
      { at: 52.5, run: () => ctx.gesture(cast.jim, "lookAtCamera") },
      {
        at: 54,
        run: () => {
          ctx.look("office");
          overview(3);
        },
      },
      // Talking head.
      { at: 58, run: () => ctx.talkingHead(cast.angela, "I keep a list.", 6, "neutral") },
      {
        at: 64,
        run: () => {
          ctx.look("office");
          overview(0);
        },
      },
      { at: 65.5, run: () => send({ ...base(), type: "tool_write_file", agentId: cast.angela.id, path: "qa/bugs.md" }) },
      { at: 67, run: () => send({ ...base(), type: "task_done", agentId: cast.dwight.id, taskId: tBug.id }) },
      { at: 69, run: () => send(post(cast.angela, "general", "Five. The jar is a bug.")) },
      { at: 69.3, run: jar(5) },
      { at: 70, run: () => ctx.snapTo(JAR, 2.6, 1.6, 0.5) },
      { at: 73, run: () => ctx.gesture(cast.jim, "lookAtCamera") },
      { at: 74, run: () => overview(3) },
    ];
  },
};
