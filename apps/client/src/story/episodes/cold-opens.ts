import { spotTile, tileToWorld } from "../../world/office";
import type { Episode, EpisodeContext } from "../episode";

/** Cold opens: ten to fifteen seconds, one joke, cut. */

const COPIER = spotTile("copier") ?? { x: 14, z: 18 };
const BY_COPIER = { x: COPIER.x, z: COPIER.z - 1 };

function sitAtMeeting(ctx: EpisodeContext, who: typeof ctx.cast.michael): void {
  const office = ctx.director.office;
  const seat = office?.meetingSeats[3] ?? spotTile("meeting_room") ?? { x: 14, z: 5 };
  void ctx.character(who)?.goTo(seat, "meeting", office?.faceTiles.get(`seat_${seat.x}_${seat.z}`) ?? null);
}

/** The printer jams; Creed unplugs it and walks away. */
export const coldPrinter: Episode = {
  id: "cold-printer",
  title: "Paper Jam",
  tagline: "Cold open. The copier has opinions.",
  durationSeconds: 14,
  nameCards: true,
  beats: (ctx) => {
    const { cast, director, audio, rig } = ctx;
    const copierWorld = tileToWorld({ x: COPIER.x, z: COPIER.z + 1 }, 0.7);
    return [
      {
        at: 0,
        run: () => {
          ctx.boot("office");
          // Creed is already loitering by the copier. Nobody asked him to.
          const creed = ctx.character(cast.creed);
          creed?.teleport({ x: BY_COPIER.x + 2, z: BY_COPIER.z }, { x: COPIER.x, z: COPIER.z + 1 });
          creed?.setState("idle");
          ctx.look("follow");
          rig.cinematicTo(copierWorld, 8, 0.45, 0.62, 0);
        },
      },
      {
        at: 2.4,
        run: () => {
          director.office?.printer.jam(6);
          audio.play("grind");
        },
      },
      { at: 3, run: () => ctx.snapZoom(copierWorld, 1.5, 1.2) },
      { at: 4, run: () => ctx.gesture(cast.dwight, "lookAround") },
      { at: 4.5, run: () => void ctx.character(cast.creed)?.goTo(BY_COPIER, "idle", { x: COPIER.x, z: COPIER.z + 1 }) },
      {
        at: 6.5,
        run: () => {
          director.office?.printer.clear();
          ctx.say(cast.creed, "Unplugged it.", 2.5);
          ctx.gesture(cast.creed, "shrug");
        },
      },
      { at: 8, run: () => void ctx.character(cast.creed)?.goTo("server_closet", "idle") },
      { at: 8.6, run: () => ctx.whipPan(cast.jim, 9) },
      { at: 9.2, run: () => ctx.gesture(cast.jim, "lookAtCamera") },
      { at: 9.4, run: () => ctx.snapZoom(cast.jim, 1.35, 1.2) },
    ];
  },
};

/** Michael calls an all-hands to an empty room. */
export const coldAllHands: Episode = {
  id: "cold-allhands",
  title: "All-Hands",
  tagline: "Cold open. Attendance: one.",
  durationSeconds: 13,
  nameCards: true,
  beats: (ctx) => {
    const { cast, send, post, director } = ctx;
    const emptyChairs = () => tileToWorld(director.office?.meetingSeats[1] ?? { x: 13, z: 3 }, 0.5);
    return [
      {
        at: 0,
        run: () => {
          ctx.boot("office");
          // Michael starts at the conference room door so the walk fits a cold open.
          ctx.character(cast.michael)?.teleport({ x: 14, z: 9 }, { x: 14, z: 5 });
        },
      },
      { at: 0.5, run: () => send(post(cast.michael, "general", "All-hands! Conference room! It's a surprise!")) },
      { at: 1, run: () => sitAtMeeting(ctx, cast.michael) },
      {
        at: 1.2,
        run: () => {
          ctx.look("meeting");
          ctx.meeting(1.5);
        },
      },
      { at: 5, run: () => ctx.say(cast.michael, "...Guys?", 3) },
      { at: 5.3, run: () => ctx.gesture(cast.michael, "lookAround") },
      {
        at: 6,
        run: () => {
          ctx.snapZoom(emptyChairs(), 1.5, 1.4);
          ctx.cue("crickets");
        },
      },
      { at: 8.6, run: () => ctx.whipPan(cast.jim, 9) },
      { at: 9.2, run: () => ctx.gesture(cast.jim, "lookAtCamera") },
    ];
  },
};

/** Creed is in the server closet, then the kitchen, then the lobby couch. He did not walk. */
export const coldCreed: Episode = {
  id: "cold-creed",
  title: "Creed",
  tagline: "Cold open. He has always been here.",
  durationSeconds: 14,
  nameCards: true,
  beats: (ctx) => {
    const { cast, rig } = ctx;
    const closet = spotTile("server_closet") ?? { x: 35, z: 25 };
    const kitchen = spotTile("kitchen") ?? { x: 22, z: 4 };
    const couch = spotTile("couch") ?? { x: 4, z: 17 };
    const shot = (t: { x: number; z: number }) => rig.cinematicTo(tileToWorld(t, 0.8), 7, 0.5, 0.62, 0);
    const creedTo = (t: { x: number; z: number }, face: { x: number; z: number }) => {
      const ch = ctx.character(cast.creed);
      ch?.teleport(t, face);
      ch?.setState("idle", face);
      ch?.lookAt("camera");
    };
    return [
      {
        at: 0,
        run: () => {
          ctx.boot("office");
          ctx.look("follow");
          creedTo(closet, { x: closet.x + 1, z: closet.z + 2 });
          shot(closet);
        },
      },
      {
        at: 3.5,
        run: () => {
          creedTo({ x: kitchen.x, z: kitchen.z + 1 }, { x: kitchen.x + 1, z: kitchen.z + 3 });
          shot({ x: kitchen.x, z: kitchen.z + 1 });
        },
      },
      {
        at: 6.5,
        run: () => {
          creedTo(couch, { x: couch.x + 2, z: couch.z + 2 });
          shot(couch);
        },
      },
      { at: 7.5, run: () => ctx.say(cast.creed, "I've been here the whole time.", 3) },
      { at: 8, run: () => ctx.snapZoom(cast.creed, 1.3, 1.2) },
      { at: 9.6, run: () => rig.cinematicTo(() => ctx.director.characterPosition(cast.jim.id), 9, 0.62, 0.62, 0) },
      { at: 9.8, run: () => ctx.gesture(cast.jim, "lookAtCamera") },
      { at: 10, run: () => ctx.snapZoom(cast.jim, 1.35, 1.0) },
    ];
  },
};
