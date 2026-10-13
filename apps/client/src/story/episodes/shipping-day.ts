import type { Episode } from "../episode";

/**
 * Shipping Day. A compressed build montage (fast cuts between desks, typing,
 * whooshes), Angela's QA pass, Michael at the bell, the approval, the whole
 * office waves then cheers, Erin rings the bell again, and the deliverable
 * card reveals the landing page.
 */
export const shippingDay: Episode = {
  id: "shipping-day",
  title: "Shipping Day",
  tagline: "Everything is green. Angela is suspicious.",
  durationSeconds: 84,
  nameCards: true,
  beats: (ctx) => {
    const { cast, send, post, base, overview, follow, director, audio } = ctx;
    const tHtml = ctx.task("sd-t1", "Landing page: index.html", "engineer", cast.dwight.id, "in_progress");
    const tTokens = ctx.task("sd-t2", "Design tokens (pastel)", "designer", cast.pam.id, "in_progress");
    const tQa = ctx.task("sd-t3", "QA pass at 360 and 1280", "qa", cast.angela.id, "backlog");
    const approval = ctx.approval("sd-ap1", "Landing page is QA-passed at 360 and 1280. Ship it?");
    /** A montage cut: hard cut to a desk, a whoosh. */
    const cut = (who: typeof cast.dwight) => () => {
      follow(who, 0);
      audio.play("whoosh");
    };

    return [
      {
        at: 0,
        run: () => {
          ctx.boot("office");
          send({ ...base(), type: "task_created", task: tHtml });
          send({ ...base(), type: "task_created", task: tTokens });
          send({ ...base(), type: "task_created", task: tQa });
          send({ ...base(), type: "task_started", agentId: cast.dwight.id, task: tHtml });
          send({ ...base(), type: "task_started", agentId: cast.pam.id, task: tTokens });
        },
      },
      { at: 3, run: () => send(post(cast.michael, "general", "Shipping day, people. Today we make history. Or at least a web page.")) },
      { at: 3.2, run: () => overview(2) },
      // The montage.
      { at: 6, run: () => ctx.look("follow") },
      { at: 6, run: cut(cast.dwight) },
      { at: 6.3, run: () => send({ ...base(), type: "tool_write_file", agentId: cast.dwight.id, path: "src/index.html" }) },
      { at: 8, run: cut(cast.pam) },
      { at: 8.3, run: () => send({ ...base(), type: "tool_write_file", agentId: cast.pam.id, path: "src/tokens.json" }) },
      { at: 10, run: cut(cast.dwight) },
      { at: 10.3, run: () => send({ ...base(), type: "tool_write_file", agentId: cast.dwight.id, path: "src/styles.css" }) },
      { at: 12, run: cut(cast.angela) },
      { at: 12.3, run: () => send({ ...base(), type: "tool_read_file", agentId: cast.angela.id, path: "src/index.html" }) },
      { at: 14, run: cut(cast.dwight) },
      { at: 14.3, run: () => send({ ...base(), type: "tool_shell", agentId: cast.dwight.id, command: "pnpm build" }) },
      { at: 16, run: cut(cast.pam) },
      { at: 16.3, run: () => send({ ...base(), type: "tool_write_file", agentId: cast.pam.id, path: "src/tokens.json" }) },
      { at: 18, run: cut(cast.dwight) },
      { at: 18.3, run: () => send({ ...base(), type: "tool_write_file", agentId: cast.dwight.id, path: "src/index.html" }) },
      { at: 20, run: () => send({ ...base(), type: "tool_shell", agentId: cast.dwight.id, command: "pnpm build" }) },
      { at: 21.5, run: () => send({ ...base(), type: "build_passed", summary: "all green" }) },
      { at: 22, run: () => send({ ...base(), type: "task_done", agentId: cast.pam.id, taskId: tTokens.id }) },
      { at: 23, run: () => send({ ...base(), type: "task_done", agentId: cast.dwight.id, taskId: tHtml.id }) },
      {
        at: 24,
        run: () => {
          ctx.look("office");
          overview(2);
        },
      },
      // Angela's QA pass.
      { at: 27, run: () => send({ ...base(), type: "task_started", agentId: cast.angela.id, task: { ...tQa, status: "in_progress" } }) },
      {
        at: 27.5,
        run: () => {
          ctx.look("follow");
          follow(cast.angela, 1.6);
        },
      },
      { at: 29, run: () => send({ ...base(), type: "tool_read_file", agentId: cast.angela.id, path: "src/index.html" }) },
      { at: 30.5, run: () => send({ ...base(), type: "tool_read_file", agentId: cast.angela.id, path: "src/styles.css" }) },
      { at: 32, run: () => send(post(cast.angela, "general", "Measured at 360. Measured at 1280. It... passes.")) },
      { at: 32.3, run: () => ctx.expression(cast.angela, "frown", 1.6) },
      { at: 32.6, run: () => ctx.snapZoom(cast.angela, 1.35, 1.3) },
      { at: 34, run: () => ctx.gesture(cast.angela, "thumbsUp") },
      { at: 34.2, run: () => ctx.expression(cast.angela, "smirk", 2) },
      { at: 35.5, run: () => ctx.gesture(cast.jim, "lookAtCamera") },
      { at: 36.5, run: () => send({ ...base(), type: "task_done", agentId: cast.angela.id, taskId: tQa.id }) },
      // Michael to the bell; the approval modal; approve.
      { at: 39, run: () => send({ ...base(), type: "request_approval", agentId: cast.michael.id, approval: { ...approval, status: "pending" } }) },
      { at: 39.2, run: () => follow(cast.michael, 2) },
      { at: 47, run: () => send({ ...base(), type: "approval_resolved", approval: { ...approval, status: "approved", founderComment: "Ship it." } }) },
      { at: 47.5, run: () => ctx.snapZoom(cast.michael, 1.35, 1.0) },
      { at: 48.5, run: () => send({ ...base(), type: "company_phase", phase: "shipped" }) },
      // Everyone waves, then cheers.
      {
        at: 49,
        run: () => {
          ctx.look("office");
          overview(2.5);
          ctx.everyoneWaves(3.2);
          audio.play("wave");
        },
      },
      { at: 52.5, run: () => ctx.everyoneCheers() },
      // Erin rings the bell again.
      { at: 55.5, run: () => void ctx.character(cast.erin)?.goTo(director.office?.bellSpot ?? "bell", "idle", director.office?.faceTiles.get("bell") ?? null) },
      {
        at: 56,
        run: () => {
          ctx.look("follow");
          follow(cast.erin, 1.6);
        },
      },
      {
        at: 59.5,
        run: () => {
          director.office?.ringBell();
          audio.play("bell");
          ctx.say(cast.erin, "Again! For luck!", 3);
          ctx.gesture(cast.erin, "leanIn");
        },
      },
      { at: 60, run: () => ctx.snapZoom(cast.erin, 1.4, 1.2) },
      { at: 62.5, run: () => void ctx.character(cast.erin)?.goTo("reception", "idle") },
      {
        at: 63,
        run: () => {
          ctx.look("office");
          overview(2.5);
        },
      },
      // The reveal.
      { at: 67, run: () => ctx.showDeliverable() },
      { at: 76, run: () => ctx.showWordmark() },
    ];
  },
};
