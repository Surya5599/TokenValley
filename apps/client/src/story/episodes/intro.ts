import * as THREE from "three";
import { OFFICE_DEPTH, OFFICE_WIDTH, type AnimState } from "@agentsitcom/shared";
import { spotTile, tileToWorld, type Tile } from "../../world/office";
import { nearestWalkable } from "../../world/pathfinding";
import type { Episode, EpisodeContext } from "../episode";

/**
 * Opening titles: 9.5 seconds of hard cuts in the style of a mockumentary
 * sitcom intro, cut to a music track mixed in afterwards. Every cut is
 * instantaneous (0 s cinematicTo) with the handheld sway on; nobody walks,
 * everyone is placed. Draws its own credit captions and title card instead
 * of the generic cold-open and end cards.
 *
 * Cut points (s): 0.2, 1.2, 2.6, 4.0, 4.4, 5.75, 6.45, 7.15, 7.85, 8.55, hold to 9.5.
 */

/** The valley building's footprint, matching main.ts. The door is on the +z face. */
const BUILDING_HALF_D = 3.7;
/** Tile bounds a camera must stay within: the outer walls are tall and opaque. */
const OFFICE_MIN = { x: 1.2, z: 1.2 };
const OFFICE_MAX = { x: OFFICE_WIDTH - 2.2, z: OFFICE_DEPTH - 2.2 };

type Cast = EpisodeContext["cast"];

export const intro: Episode = {
  id: "intro",
  title: "Opening Titles",
  tagline: "9.5 seconds, cut to your track",
  durationSeconds: 9.5,
  nameCards: false,
  noCards: true,
  beats: (ctx) => {
    const { cast, rig, director, store } = ctx;
    const COMPANY = ctx.companyId;

    // ---- placement: teleport + setState, no walking ----
    const faceOf = (spotId: string, fallback: Tile): Tile => director.office?.faceTiles.get(spotId) ?? fallback;
    const place = (a: Cast[keyof Cast], tile: Tile, face: Tile | null, state: AnimState) => {
      const ch = ctx.character(a);
      if (!ch) return;
      ch.lookAt(null);
      ch.teleport(tile, face);
      ch.setState(state, face);
    };
    /** Sits someone at their desk, typing. */
    const atDesk = (a: Cast[keyof Cast]) => {
      const id = ctx.homeSpotId(a);
      const tile = spotTile(id) ?? { x: 5, z: 14 };
      place(a, tile, faceOf(id, { x: tile.x, z: tile.z - 1 }), "sit_typing");
    };
    const everyoneAtDesks = () => {
      for (const a of Object.values(cast)) atDesk(a);
    };

    // ---- camera: every move is a hard cut ----
    const cut = (target: THREE.Vector3 | (() => THREE.Vector3 | null), radius: number, elevation: number, azimuth: number) => rig.cinematicTo(target, radius, elevation, azimuth, 0);
    const on = (a: Cast[keyof Cast]) => () => director.characterPosition(a.id);
    /**
     * A tight credit shot from in front of a seated character: the azimuth
     * comes from the way their desk faces (plus `offset` radians), and the
     * elevation rises until the camera is inside the outer walls, which are
     * tall and opaque. Uses the follow look (tilt-shift almost off).
     */
    const tight = (a: Cast[keyof Cast], offset: number, radius = 5.2, elevation = 0.3, facing?: Tile) => {
      const ch = ctx.character(a);
      const tile = ch?.tile ?? spotTile(ctx.homeSpotId(a)) ?? { x: 5, z: 14 };
      const face = facing ?? faceOf(ctx.homeSpotId(a), { x: tile.x, z: tile.z - 1 });
      const azimuth = Math.atan2(face.x - tile.x, face.z - tile.z) + offset;
      // The largest horizontal reach that keeps the camera a tile inside the office.
      const sx = Math.sin(azimuth);
      const sz = Math.cos(azimuth);
      const reachX = sx > 0 ? (OFFICE_MAX.x - tile.x) / sx : sx < 0 ? (OFFICE_MIN.x - tile.x) / sx : Infinity;
      const reachZ = sz > 0 ? (OFFICE_MAX.z - tile.z) / sz : sz < 0 ? (OFFICE_MIN.z - tile.z) / sz : Infinity;
      const h = Math.min(radius * Math.cos(elevation), reachX, reachZ);
      ctx.look("follow");
      cut(on(a), radius, Math.acos(Math.min(1, h / radius)), azimuth);
    };
    const building = () => ctx.valley.buildingPosition(COMPANY) ?? new THREE.Vector3();
    /** Name tags off from the first credit on: the captions name people, and a tag fills a tight frame. */
    const TAG_MAX_Y = 2.4;
    const hideTags = () => {
      for (const a of Object.values(cast)) {
        const ch = ctx.character(a);
        if (!ch) continue;
        for (const o of ch.group.children) if ((o as THREE.Sprite).isSprite && o.position.y < TAG_MAX_Y) o.visible = false;
      }
    };

    // ---- the group pose in the lobby: Michael front and centre, the rest in a loose V behind him ----
    const lobby = spotTile("lobby") ?? { x: 5, z: 14 };
    const GROUP: [keyof Cast, number, number][] = [
      ["michael", 0, 2],
      ["jim", -2, 1],
      ["pam", 2, 1],
      ["dwight", -1, 0],
      ["angela", 1, 0],
      ["kevin", -3, -1],
      ["erin", 0, -1],
      ["oscar", 3, -1],
      ["creed", -2, -2],
    ];
    // The camera is in front of the lobby (+z), looking back at the reception sign.
    const toCamera = (t: Tile): Tile => ({ x: t.x + 1, z: t.z + 5 });
    const groupPose = () => {
      const office = director.office;
      for (const [who, dx, dz] of GROUP) {
        const want = { x: lobby.x + dx, z: lobby.z + dz };
        const t = (office ? nearestWalkable(office.grid, want, 2) : null) ?? want;
        place(cast[who], t, toCamera(t), "idle");
        ctx.character(cast[who])?.lookAt("camera");
      }
    };

    // Kitchen and closet for the funny moment.
    const kitchen = spotTile("kitchen") ?? { x: 22, z: 4 };
    const kevinTile = { x: kitchen.x, z: kitchen.z + 1 };
    const closetDoor = { x: 31, z: 24 };

    return [
      // 0.0: black. Boot into the valley behind it so the first frame is ready.
      {
        at: 0,
        run: () => {
          ctx.blackout(true);
          ctx.boot("valley");
          store.feedVisible = false;
          store.notify();
          everyoneAtDesks();
          director.office?.bugJar.setCount(6);
        },
      },
      // 0.2: valley, high and wide, a slow push toward the Dunder Mindflin building.
      {
        at: 0.2,
        run: () => {
          ctx.blackout(false);
          const p = building().add(new THREE.Vector3(0, 1.5, 0));
          cut(p, 115, 0.72, 0.55);
          rig.cinematicTo(p, 72, 0.62, 0.55, 1.0, "linear");
          ctx.credit("AGENTSITCOM");
          ctx.cue("tick");
        },
      },
      // 1.2: street level by the HQ door, a slight pan.
      {
        at: 1.2,
        run: () => {
          const door = building().add(new THREE.Vector3(0, 1.3, BUILDING_HALF_D));
          // On the road in front of the door (the first-person spawn line), so no filler building is in the way.
          ctx.look("follow");
          cut(door, 12, 0.18, 0.12);
          rig.cinematicTo(door, 12, 0.2, -0.16, 1.4, "linear");
          ctx.cue("tick");
        },
      },
      // 2.6: the office, wide from the lobby side; the whole cast typing, the company sign in frame.
      {
        at: 2.6,
        run: () => {
          ctx.credit(null);
          ctx.setCamera("office");
          ctx.look("office");
          everyoneAtDesks();
          cut(tileToWorld({ x: 12, z: 14 }, 0.4), 30, 0.5, 0.3);
          ctx.cue("tick");
        },
      },
      // 4.0: MICHAEL. Tight across his desk; he straightens his tie and beams at the lens.
      {
        at: 4.0,
        run: () => {
          hideTags();
          // His desk backs onto the outer wall, so he swivels round to face the room (and the lens), desk behind him.
          const ceo = spotTile("ceo_office") ?? { x: 4, z: 4 };
          const roomward = { x: ceo.x, z: ceo.z + 1 };
          place(cast.michael, ceo, roomward, "meeting");
          tight(cast.michael, 0.35, 5, 0.3, roomward);
          ctx.gesture(cast.michael, "straightenTie");
          ctx.character(cast.michael)?.lookAt("camera");
          ctx.expression(cast.michael, "big_smile", 1.5);
          ctx.credit("Michael (CEO)");
          ctx.cue("tick");
        },
      },
      // 4.4: DWIGHT (the loudest hit). Glasses, a look, neutral, then the frown.
      {
        at: 4.4,
        run: () => {
          tight(cast.dwight, 0.3);
          ctx.gesture(cast.dwight, "adjustGlasses");
          ctx.character(cast.dwight)?.lookAt("camera");
          ctx.expression(cast.dwight, "neutral", 0.6);
          ctx.credit("Dwight (Engineer)");
          ctx.cue("tick");
        },
      },
      { at: 5.0, run: () => ctx.expression(cast.dwight, "frown", 1.5) },
      // 5.75: JIM. The look. (ctx.gesture plays the record scratch for lookAtCamera.)
      {
        at: 5.75,
        run: () => {
          tight(cast.jim, -0.3);
          ctx.gesture(cast.jim, "lookAtCamera");
          ctx.expression(cast.jim, "smirk", 1.2);
          ctx.credit("Jim (PM)");
        },
      },
      // 6.45: PAM at the design corner, warm smile, pen in hand.
      {
        at: 6.45,
        run: () => {
          tight(cast.pam, 0.3);
          ctx.gesture(cast.pam, "tapPen");
          ctx.character(cast.pam)?.lookAt("camera");
          ctx.expression(cast.pam, "smile", 1.5);
          ctx.credit("Pam (Designer)");
          ctx.cue("tick");
        },
      },
      // 7.15: ANGELA at the QA bench, arms crossed, the bug jar beside her.
      {
        at: 7.15,
        run: () => {
          place(cast.angela, spotTile("qa_bench") ?? { x: 22, z: 23 }, faceOf("qa_bench", { x: 22, z: 22 }), "idle");
          // Offset toward the jar's side of the bench (one tile +x of her).
          tight(cast.angela, -0.55, 5.6);
          ctx.gesture(cast.angela, "armsCrossed");
          ctx.character(cast.angela)?.lookAt("camera");
          ctx.expression(cast.angela, "frown", 1.5);
          ctx.credit("Angela (QA)");
          ctx.cue("tick");
        },
      },
      // 7.85: the kitchen. Kevin mid-yawn with his cup; Creed in the closet doorway, facing the wall.
      {
        at: 7.85,
        run: () => {
          ctx.credit(null);
          place(cast.kevin, kevinTile, { x: kevinTile.x, z: kevinTile.z + 3 }, "coffee");
          ctx.gesture(cast.kevin, "yawn");
          place(cast.creed, closetDoor, { x: closetDoor.x, z: closetDoor.z - 1 }, "idle");
          ctx.look("follow");
          cut(tileToWorld(kevinTile, 0.8), 7, 0.3, -0.3);
          ctx.cue("tick");
        },
      },
      // 8.2: snap onto Creed. He is looking the wrong way.
      {
        at: 8.2,
        run: () => {
          ctx.snapZoom(cast.creed, 1.4, 0.6, 0.5);
          ctx.credit("Creed (IT)");
          ctx.cue("rimshot");
          ctx.cue("talkinghead");
        },
      },
      // 8.55: everyone in the lobby, facing the camera; the printer jams behind them; the title card lands.
      {
        at: 8.55,
        run: () => {
          ctx.credit(null);
          groupPose();
          ctx.look("office");
          cut(tileToWorld(lobby, 0.9), 12, 0.42, 0.15);
          ctx.gesture(cast.michael, "shrug");
          ctx.expression(cast.michael, "big_smile");
          // Straight to the character: the record scratch belongs to Jim's own credit, not the title hit.
          ctx.character(cast.jim)?.gesture("lookAtCamera");
          ctx.gesture(cast.angela, "armsCrossed");
          ctx.expression(cast.angela, "frown");
          ctx.gesture(cast.kevin, "thumbsUp");
          ctx.expression(cast.kevin, "big_smile");
          ctx.gesture(cast.dwight, "adjustGlasses");
          for (const a of [cast.pam, cast.erin, cast.oscar, cast.creed]) {
            const ch = ctx.character(a);
            ch?.wave(2);
            ch?.lookAt("camera");
          }
          ctx.expression(cast.pam, "smile");
          ctx.expression(cast.erin, "big_smile");
          director.office?.printer.jam(2);
          ctx.bigTitle("AgentSitcom", "The Office: Agent Edition");
          ctx.cue("titlecard");
          ctx.cue("boing");
        },
      },
    ];
  },
};
