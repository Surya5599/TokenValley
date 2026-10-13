# Research: making the characters and the office look and feel better

Date: 2026-10-13. Scope: what would move TokenValley from "primitives in a
box" to something that reads as a charming miniature office, without an art
team, and what each option costs in licensing, dependencies and effort.

## Where we are

Characters are capsule figures built from boxes, spheres and cylinders with
procedural looks per name. They have a handful of poses (idle bob, walk swing,
sit-typing jitter, talk head-bob, celebrate jump, wave). The world is flat
toon-shaded with one shadow light, a sky gradient, and fog. No post-processing,
no sound, no facial expression, no secondary motion.

The two biggest gaps a viewer notices first: **characters move like
puppets** (no real walk cycle, no sit, no gestures) and **the image is flat**
(no ambient occlusion, no depth of field, no outline, no vignette).

## Option A: keep procedural characters, add animation and juice

Cheapest. No assets, no licensing, no loader. Everything stays in code.

- **Procedural walk cycle done properly.** Hips sway, opposite arm swing,
  slight lean into the direction of travel, head bob at half the stride rate,
  foot plant with a tiny squash. This alone is most of the "puppet" fix.
- **Sit properly.** Rotate hips, bend knees, forearms on the desk, fingers
  jitter. Right now characters just lower.
- **Gestures as additive layers.** A small library of one-shot arm/head
  overlays (point, shrug, facepalm, thumbs up, nod, head shake, the Jim look)
  blended on top of whatever base state is running. Driven by message
  sentiment or by story beats.
- **Faces.** Two dot eyes and a mouth line on a tiny canvas texture per head
  gives blink, smile, frown, surprise and "talking" mouth for a few hundred
  bytes. Eyes can look toward whoever the character is talking to.
- **Squash and stretch** on celebrate, arrive and the bell ring; anticipation
  (a small crouch) before jumps; overshoot and settle on every state change.
- **Secondary motion.** Ties, ponytails and lanyards as two-segment pendulums
  that lag the body. Cheap, and it is what makes stiff rigs feel alive.
- **Idle variety.** Random fidgets every few seconds: stretch, look around,
  sip, check watch, rub eyes, tap pen. Pick from a per-character list so
  Dwight checks his watch and Kevin yawns.
- **Walk speed and path smoothing.** Bezier the A* path corners so nobody
  turns on a dime; slow down into desks and doors.

Effort: 2 to 3 days of focused work. Risk: low. Ceiling: a very good
"stylized toy" look, but never a professional character rig.

## Option B: real rigged characters from a CC0 or no-attribution pack

Replace the primitive bodies with a glTF rig that has a skeleton and real
animation clips, keep our name-based looks as material/colour swaps and
accessory attachments on the rig's bones.

Candidates, checked 2026-10-13:

| Source | What | Animations | Format | Licence | Notes |
| --- | --- | --- | --- | --- | --- |
| KayKit (Kay Lousberg) | Character packs (Adventurers, Skeletons, Mystery Monthly series) | Rigged and animated per pack; legacy animation pack has Idle, Walk, Run, Cheer, Wave, Interact, Pick up, Throw and more, no Sit or Typing | FBX, glTF/GLB | CC0 on the legacy animation pack and the free packs; paid series $19.99 each | Blocky, charming, consistent with our pastel look. Office-wear characters are not a pack; would need recolour. |
| Quaternius | Universal Base Characters, Animated Men/Women, Ultimate Modular Men/Women, Universal Animation Library 1 and 2 (130+ clips, humanoid rig "ready for retargeting") | UAL has locomotion and many emotes; sit/typing not confirmed | FBX, GLB, Blend | UAL 2 page says CC0; site licence page says Quaternius Asset License v1.0: free commercial use, no attribution, no redistribution of the raw assets | Modular outfit packs are the best fit for office clothes. Check per-pack licence; they differ. |
| Kenney | Animated Characters (Retro, Protagonists, Survivors), Furniture Kit (120 pieces), City Kits | "Animated Characters" series; clip names not listed on the pages | GLB mostly | CC0 | Furniture Kit is the fastest route to better desks, chairs, sofas, plants. |
| Mixamo (Adobe) | Thousands of clips incl. Sitting, Typing, Talking, Waving, Clapping, Idle variants | Yes, the richest library for office motion | FBX (convert to glTF) | Free with an Adobe account; FAQ allows commercial use with no attribution but forbids redistributing raw files. Mixamo is in maintenance mode. | A browser app serves the files, so anyone can download them. Grey area for an open-source repo. Better to use for private renders than to commit clips. |
| poly.pizza | Thousands of low-poly props | n/a | GLB | Mixed, mostly CC-BY, some CC0; check each model | Good for one-off props (printer, water cooler, bug jar). Record author and licence per file. |

Retargeting notes: three.js `SkeletonUtils.retargetClip` exists but is
under-documented and often produces wrong poses when rest poses or bone
names differ. The reliable path is to pick ONE rig family and use its own
clips (KayKit characters with KayKit animations, or Quaternius characters
with the Universal Animation Library), not mix rigs. Rig differences, not
proportions, are the usual cause of broken retargets.

Effort: 3 to 5 days: loader, animation state machine on `AnimationMixer`
(crossfades between idle/walk/sit/talk/wave/cheer), bone attachment for ties,
glasses, hats and props, material swaps for the Office looks, and a
"typing" clip which no CC0 pack ships, so it stays procedural (arms on desk,
finger jitter) layered over a sit clip.

Dependencies: `three/examples/jsm/loaders/GLTFLoader` only. Assets go in
`apps/client/public/models/` with a `CREDITS.md`. Keep the repo CC0-only so
anyone can fork without licence homework.

Ceiling: much higher. Real walk cycles, sits, waves, cheers; this is what
makes screenshots look like a game.

## Option C: rendering and camera, independent of A or B

These apply either way and give the biggest visual jump per hour.

- **Ambient occlusion.** Contact shadows under desks, feet, walls. Use N8AO
  (`n8ao`, MIT) or the SSAO effect in the `postprocessing` library
  (pmndrs, zlib licence, merges effects into one pass). Both are small
  dependencies. This is the single largest "it looks real" upgrade for a
  flat-shaded scene.
- **Tilt-shift depth of field.** Blur that grows toward the top and bottom
  of the frame plus a saturation bump sells the miniature. The
  `postprocessing` library has Depth of Field; tilt-shift needs a small
  custom shader or the library's `TiltShiftEffect` where available.
- **Outline.** A thin dark warm outline on characters only (not the whole
  office) makes them pop off the pastel floor. `OutlinePass` in three.js or
  the `Outline` effect in `postprocessing`.
- **Vignette and gentle bloom** on monitors, the alarm light and the bell.
- **Lighting.** Bake-free but better: a second fill light from the window
  side, warm key, cool fill, and per-room point lights (desk lamps) with
  shadows off. Slightly lower the ambient so AO reads.
- **Camera.** Lower FOV (we are at 35; 28 to 30 reads more isometric),
  handheld micro-jitter in story mode, snap zooms for reactions, and
  look-at easing so the camera leads the character slightly.
- **Materials.** Keep toon, but add a subtle per-object colour variation
  (desks not all the same peach) and a faint floor grain. Rounded corners on
  desk tops and chairs (RoundedBoxGeometry, already in use).

Effort: 1 to 2 days. Dependency: one of `postprocessing` or `n8ao`.

## Option D: sound and music

Sound is half of "feel". Tiny Glade's charm is largely audio feedback.

- **Synthesized in code with Web Audio.** Keyboard clatter tied to
  `tool_write_file`, bell on `request_approval`, paper whoosh on `handoff`,
  vending clunk on `idle_timeout` in the break room, printer grind on the jam
  timer, buzzer when the incident sign resets, soft applause on ship, a
  low "lights off" thunk on `budget_exhausted`. Zero assets, zero licensing,
  a few hundred lines.
- **Music.** The show's theme is copyrighted; do not ship it. Options: an
  original 8-bar piano/ukulele loop synthesized or composed, or pick a
  licensed track from Instagram's library at post time. Keep music off in
  story mode by default so the voiceover is clean.
- **Mixing.** Keep effects short (under 300 ms), quiet, and rate-limited
  (no more than one keyboard clatter per 150 ms), with a master mute key.

Effort: 1 day for a good effects set. No dependencies.

## Option E: the mockumentary layer

Specific to the Office homage and cheap:

- Characters glance at the camera after an absurd line (Jim look): rotate
  head toward the camera for 1.2 s, hold, return.
- Snap zoom on the speaker for a punchline, slow push-in during Michael's
  buzzwords, a quick pan to whoever got mentioned.
- Lower-third name cards ("Dwight Schrute, Assistant to the Regional
  Engineer") that appear for 2 s the first time a character speaks in an
  episode. Optional, off during voiceover takes.
- Talking-head cutaways: a fixed camera on a chair against the wall where a
  character sits and "explains" (their last message shown as a caption).

Effort: 1 day on top of story mode.

## Recommendation, in order

1. **C first** (AO, tilt-shift, outline on characters, vignette, lower FOV).
   One or two days, one dependency, the biggest visual jump for every
   screenshot and every frame of the reel.
2. **D next** (synthesized sound effects, mute by default in story mode).
   One day, no dependencies, large feel gain in video.
3. **A** (proper walk cycle, sit, faces, gestures, secondary motion, fidgets).
   Two to three days, no dependencies, keeps the repo asset-free and CC0.
4. **E** (Jim looks, snap zooms, lower thirds) folded into the episode work.
5. **B** only if A still looks like puppets. If so, go KayKit end to end
   (characters plus their animation pack, CC0), keep looks as recolours and
   bone-attached props, and add a `CREDITS.md`. Avoid committing Mixamo
   clips to the public repo.

## Sources

- KayKit character animations: https://kaylousberg.itch.io/kaykit-animations
- KayKit catalog: https://kaylousberg.itch.io/
- Quaternius packs: https://quaternius.com/ and Universal Animation Library 2:
  https://quaternius.com/packs/universalanimationlibrary2.html
- Quaternius licence: https://quaternius.com/license.html
- Kenney 3D assets: https://kenney.nl/assets/category:3D and
  https://kenney.nl/assets/animated-characters-protagonists
- Kenney furniture kit (mirror): https://opengameart.org/content/furniture-kit
- Mixamo licensing FAQ thread:
  https://community.adobe.com/questions-696/mixamo-faq-licensing-royalties-ownership-eula-and-tos-589400
- pmndrs postprocessing: https://github.com/pmndrs/postprocessing
- N8AO: https://github.com/N8python/n8ao
- Tilt-shift in three.js discussion:
  https://discourse.threejs.org/t/how-to-have-a-tilt-shift-effect-on-a-3d-scene/40606
- SkeletonUtils retarget caveats:
  https://discourse.threejs.org/t/fixing-skeletonutils-retarget-and-retargetclip-functions/65149
- Game feel background: https://eolt.org/articles/game-feel/ and
  https://bugnet.io/blog/game-feel-why-juice-matters-and-how-to-add-it
- Tiny Glade audio feedback (review):
  https://shacknews.com/article/141431/tiny-glade-review-score
