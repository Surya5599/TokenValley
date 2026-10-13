import type { Episode } from "../episode";

/**
 * Which Pink? Jim calls a colour meeting. Pam rejects three pinks on
 * principle, Dwight cites a spec nobody has read, Michael quotes a
 * management book wrong, Angela adds everyone to her list, and the meeting
 * ends with Michael picking the first pink. Pam writes tokens.json anyway.
 */
export const whichPink: Episode = {
  id: "which-pink",
  title: "Which Pink?",
  tagline: "Three pinks were rejected on principle.",
  durationSeconds: 86,
  nameCards: true,
  beats: (ctx) => {
    const { cast, send, post, base, overview, follow } = ctx;
    const tTokens = ctx.task("wp-t1", "Design tokens (pastel)", "designer", cast.pam.id, "in_progress");
    const tHtml = ctx.task("wp-t2", "Landing page: index.html", "engineer", cast.dwight.id, "in_progress");
    const MEETING = "wp-m1";
    const CH = "meeting-1";

    return [
      {
        at: 0,
        run: () => {
          ctx.boot("office");
          send({ ...base(), type: "task_created", task: tTokens });
          send({ ...base(), type: "task_created", task: tHtml });
          send({ ...base(), type: "task_started", agentId: cast.pam.id, task: tTokens });
          send({ ...base(), type: "task_started", agentId: cast.dwight.id, task: tHtml });
        },
      },
      // A normal office, then Jim's quick one.
      { at: 3, run: () => overview(2.5) },
      { at: 4, run: () => send(post(cast.jim, "general", "Quick one. Colour meeting. Bring opinions, not swatches.")) },
      { at: 4.5, run: () => follow(cast.jim, 1.4) },
      { at: 6.2, run: () => ctx.gesture(cast.jim, "lookAtCamera") },
      { at: 8, run: () => send({ ...base(), type: "call_meeting", agentId: cast.jim.id, meetingId: MEETING, attendeeIds: [cast.pam.id, cast.dwight.id, cast.michael.id, cast.angela.id], topic: "Which pink?" }) },
      { at: 8.2, run: () => send({ ...base(), type: "channel_opened", channel: CH, title: "Which pink?", memberIds: [cast.jim.id, cast.pam.id, cast.dwight.id, cast.michael.id, cast.angela.id] }) },
      { at: 9, run: () => overview(2) },
      {
        at: 12,
        run: () => {
          ctx.look("meeting");
          ctx.meeting(3);
        },
      },
      // Pam rejects three pinks on principle.
      { at: 16, run: () => send(post(cast.pam, CH, "Not that pink.")) },
      { at: 16.4, run: () => ctx.gesture(cast.pam, "headShake") },
      { at: 19, run: () => send(post(cast.pam, CH, "Not that one either. That pink has been through things.")) },
      { at: 19.4, run: () => ctx.gesture(cast.pam, "headShake") },
      { at: 21.5, run: () => ctx.snapZoom(cast.pam, 1.3, 1.0) },
      { at: 22.5, run: () => send(post(cast.pam, CH, "No. That is salmon. Salmon is a fish.")) },
      { at: 22.9, run: () => ctx.expression(cast.pam, "frown", 2) },
      { at: 24, run: () => ctx.gesture(cast.dwight, "adjustGlasses") },
      // Dwight cites the spec.
      { at: 26, run: () => send(post(cast.dwight, CH, "Spec 4.2 says f5a3c7. Section 3. It is in tokens.json.")) },
      { at: 26.6, run: () => ctx.gesture(cast.dwight, "point") },
      { at: 29, run: () => send(post(cast.jim, CH, "Has anyone read Spec 4.2?")) },
      { at: 30.5, run: () => ctx.gesture(cast.angela, "armsCrossed") },
      { at: 31, run: () => send(post(cast.dwight, CH, "I have read Spec 4.2. I wrote Spec 4.2.")) },
      { at: 31.5, run: () => ctx.snapZoom(cast.dwight, 1.4, 1.1) },
      { at: 32, run: () => ctx.gesture(cast.dwight, "armsCrossed") },
      // Michael quotes the book wrong; snap zoom; Jim looks at the camera.
      { at: 35, run: () => send(post(cast.michael, CH, "As the book says: a pink in the hand is worth two in the... other hand.")) },
      { at: 35.3, run: () => ctx.snapZoom(cast.michael, 1.45, 1.3) },
      { at: 35.6, run: () => ctx.expression(cast.michael, "big_smile", 2.5) },
      { at: 37.4, run: () => ctx.gesture(cast.jim, "lookAtCamera") },
      { at: 37.6, run: () => ctx.snapZoom(cast.jim, 1.4, 1.2) },
      // Angela adds everyone to her list.
      { at: 40.5, run: () => send(post(cast.angela, CH, "Noted. You are all on the list now. Alphabetically.")) },
      { at: 41, run: () => ctx.gesture(cast.angela, "tapPen") },
      { at: 42.5, run: () => ctx.gesture(cast.pam, "facepalm") },
      // Michael picks the first pink.
      { at: 44.5, run: () => send(post(cast.michael, CH, "Great meeting. Lots of energy. We go with the first pink.")) },
      { at: 45, run: () => ctx.expression(cast.pam, "surprised", 1.2) },
      { at: 46, run: () => ctx.gesture(cast.jim, "lookAtCamera") },
      { at: 46.2, run: () => ctx.snapZoom(cast.jim, 1.35, 1.0) },
      { at: 48.5, run: () => send(post(cast.jim, CH, "The first pink it is. Meeting over.")) },
      { at: 50, run: () => send({ ...base(), type: "meeting_ended", meetingId: MEETING }) },
      {
        at: 50.5,
        run: () => {
          ctx.look("office");
          overview(3);
        },
      },
      // Talking heads.
      { at: 54, run: () => ctx.talkingHead(cast.pam, "I had a fourth pink.", 6, "neutral") },
      {
        at: 60,
        run: () => {
          ctx.look("office");
          overview(0);
        },
      },
      { at: 61, run: () => ctx.talkingHead(cast.dwight, "Spec 4.2 is eleven pages. I wrote it. Nobody has read it. I have read it.", 7, "neutral") },
      {
        at: 68,
        run: () => {
          ctx.look("office");
          overview(2);
        },
      },
      // Pam writes tokens.json anyway.
      {
        at: 70,
        run: () => {
          ctx.look("follow");
          follow(cast.pam, 1.6);
        },
      },
      { at: 71.5, run: () => send({ ...base(), type: "tool_write_file", agentId: cast.pam.id, path: "src/tokens.json" }) },
      { at: 73, run: () => send(post(cast.pam, "general", "tokens.json: pink is f5a3c7. The fourth one.")) },
      { at: 73.5, run: () => ctx.snapZoom(cast.pam, 1.3, 1.2) },
      { at: 73.8, run: () => ctx.expression(cast.pam, "smirk", 2.5) },
      { at: 76, run: () => send({ ...base(), type: "task_done", agentId: cast.pam.id, taskId: tTokens.id }) },
      { at: 78, run: () => ctx.gesture(cast.jim, "lookAtCamera") },
      {
        at: 79.5,
        run: () => {
          ctx.look("office");
          overview(3);
        },
      },
    ];
  },
};
