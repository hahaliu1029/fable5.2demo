# MOTHLIGHT // Vesper-9 — build report

A first-person exploration game set in a rain-soaked cyberpunk city. The mind that ran the city's lamps
(LUMEN) was switched off and scattered into twelve "echoes". You walk five districts, ride amber grav-lifts
to rooftops, glide between buildings, pulse the grid to find echoes, read six lore terminals, and carry
everything back to the Spire to release the signal.

## How to run

- **Play:** open `index.html` (double-click works; it is one self-contained 586 KiB file with no network
  requests). Or `npm run serve` and open `http://127.0.0.1:5179/`.
- **Controls:** WASD walk, Shift run, mouse look (click the view to capture the mouse; dragging or the arrow
  keys also look), Space jump / double-jump / hold to glide, Q pulse the grid, E interact, M mute.
- **Rebuild:** `npm install && npm run build`. **Tests:** `npm test`.

## Deliverables

| Path | What it is |
|---|---|
| `index.html` | The built game |
| `src/` | Source: 9 modules, about 2,100 lines of JavaScript and GLSL, plus the page template |
| `tests/` | 13 unit tests for the city generator and the collision code |
| `tools/serve.mjs`, `build.mjs` | Local server and esbuild bundling script |
| `screenshots/01`–`09` | Captures of the final build, HUD included |
| `REPORT.md` | This file |

The request I received listed deliverables starting at number 3 (source code, this report); items 1 and 2
were not in the message. I assumed they were the playable game and screenshots and delivered both.

## NIGHT RUN: the driving conversion (2026-11-11)

The game is now a driving game. Everything below this section describes the earlier walking version, whose city,
facades, rain, signs, monorail and moths are all still here; the walking controller, lifts-as-gameplay and terminals
are not (the lifts and terminals remain as scenery). The previous version is archived beside this folder as
`mothlight-before-driving.tgz`.

- **Play.** W/S throttle and brake, A/D steer, Space handbrake, Shift boost (sliding refills it), Q pulse, R back to
  the last gate, C camera, M mute. The Signal Run is twelve light gates taken in order through all five districts,
  then home to the ring in front of the Spire; each gate carries one of LUMEN's echoes. The clock starts when you
  move, the best time is kept, and progress saves.
- **Rules (`src/drive.js`, unit-tested).** Arcade car physics with lateral grip, handbrake slides and boost; collision
  against every ground-level box in the city; the gate route; ground traffic that keeps to lanes.
- **Models (`tools/blender/build_assets.py` -> `assets/mothlight.glb`, 7 models, about 12,000 triangles).** Scripted in
  Blender 5.2 with painted vertex colour and baked occlusion: the player's car (sculpted body with cut wheel arches,
  glass canopy, light blades, wing, thrusters), a wheel, a saloon and a van for traffic, the light gate, a pedestrian
  in a long coat under an umbrella (replacing the cylinder mannequins), and a junction signal. `npm run assets`.
- **Lighting.** A cube map of the city is rendered around the car every third frame, so the paint and glass carry
  real reflections of the signs and windows; the paint shifts hue with viewing angle. The headlamps are a real cone
  of light in the ground, facade, prop and pedestrian shaders. Traffic throws light pools ahead and a red glow
  behind. The car has a contact shadow, tail-light trails, wheel spray and a faint underglow.
- **City additions.** Signals on two corners of all 64 junctions; the minimap draws the remaining route.
- **Verified in Chrome:** driving, drifting, boost, wall and traffic collisions, all twelve gates in order, the
  finish and finale, save and restore, with no console errors, at about 120 fps on this machine (M4 Max, 1512x717).
  `npm test`: 21 of 21 pass (13 earlier tests plus 8 for the driving rules).
- **Not done / faked.** The gates and finish were reached in the test by placing the car before each one, not by
  driving a full lap by hand. Sound is unheard. The road itself is missing from the car's reflections (the mirror
  ground is hidden while the cube map is drawn). Traffic drives straight through junctions and ignores the signals,
  which never change. Pedestrians cannot be hit. Buildings are still boxes. There are no touch or gamepad controls.
- **Review.** An independent reviewer found six issues; five are fixed (bonnet camera inside the body, a cube-map
  feedback loop, an unclamped pitch on impact, collision using only the middle of the car, one-frame-late trails).
  The sixth, small per-frame allocations and the cube map's periodic cost, is left as is.

## Technology

- **three.js r170** on WebGL2. One dependency at runtime; everything else is hand-written.
- **GLSL `ShaderMaterial`s** for every large surface: building facades, wet ground, sky, rain, props,
  pedestrians, lifts, steam, light cones, holographic moths. There are **no three.js lights and no shadow
  maps**; all lighting is computed inside those shaders.
- **Post-processing** with three's `EffectComposer`: MSAA half-float scene target, a NaN-sanitizing pass,
  `UnrealBloomPass`, a small grade pass (chromatic aberration, vignette, grain), ACES tone mapping.
- **three's `Reflector`** with a custom shader for the mirror-wet streets.
- **Web Audio API** for all sound. No audio files.
- **esbuild** to bundle into one HTML file. **node:test** for unit tests.
- **No downloaded or generated assets**: no textures, models, fonts, music or images. Sign textures are drawn
  at start-up with the 2D canvas API. Blender was available but not used; nothing here is a modelled mesh.

## How each part was implemented

**City (`src/city.js`).** A seeded generator (mulberry32) lays out a 9×9 grid of 60 m blocks with 16 m
roads. Each block is cut into lots by recursive guillotine splits, leaving 3 m alleys; heights, lot sizes
and lit-window ratios come from a per-district profile. Five districts (a 3×3 corporate core and four
pinwheel arms) each have their own palette, scale and street furniture. The Spire fills the centre block,
a monorail loop rings the core, and 150 unreachable towers stand in the water for depth. The same module
places 6 lifts, 12 echoes (6 on rooftops, 6 in alleys, spread by farthest-point selection), 6 terminals,
and 13,695 prop boxes (market stalls, vending machines, planters, crates, pipes, balconies, lantern
strings, awnings, rooftop AC units, tanks and masts). The layout is pure data, so it is unit-tested.

**Rendering (`src/world.js`, `src/shaders.js`).**
- All 694 building boxes are one instanced draw call. The facade shader draws windows by **interior
  mapping** (a ray is intersected with a virtual room behind each pane, so rooms show ceilings, walls,
  furniture and parallax), plus blinds, mullions, floor ledges, grime streaks, shopfronts with shelves of
  stock, rolled shutters, service doors and neon trims. Distant windows fade to an average to stop shimmer.
- Streets are a planar mirror. Its shader draws asphalt, paving slabs, lane paint, crossings and LED kerbs
  procedurally, then adds the reflection weighted by Fresnel, blurred by grain and rippled in puddles.
- All props and lamps are a second instanced draw call with faked street lighting. Each lamp has an
  additive cone so the light reads as a volume in the rain.
- 420 pedestrians are one instanced mesh; legs swing in the vertex shader. 170 flying cars with tail-light
  streaks, a four-car monorail, steam vents, 9,000 rain streaks that wrap around the camera, plaza
  holograms, three giant holographic moths circling the Spire, and small moth swarms around each echo.
- Sky dome with drifting lit cloud, occasional lightning, and an aurora that only appears after the finale.

**Player and rules (`src/main.js`, `src/physics.js`).** Axis-separated AABB collision against a spatial
hash of 4,135 solid boxes (buildings, rail, solid props), so every roof and crate can be stood on.
Movement has run, jump, double-jump, hold-to-glide, and lift columns that carry you up and hold you at the
top. Q sends a pulse across the ground and facades; echoes within 190 m get a beam, a minimap dot and a
compass marker. Progress (echoes, districts, terminals, position, finale) is saved to `localStorage`.

**HUD (`src/hud.js`, template).** District name, compass with target marker, altitude and movement mode,
counters, a minimap that reveals districts as you enter them, context prompts, typewriter messages.

**Audio (`src/audio.js`).** Filtered noise for rain, an eight-oscillator pad cycling four chords through a
breathing low-pass and feedback delay, sparse bell notes, and synthesized effects (steps, jump, landing,
pulse, pickup arpeggio, thunder, finale swell).

## What was verified, and how

- `npm test`: 13 of 13 pass (determinism, district partition, buildings off the roads, every rooftop echo
  reachable by a lift and not buried, lifts/terminals/echoes free of solid props, collision cases).
- In Chrome, driven through the page: walking and running, wall collision, a lift ride onto a roof,
  double-jump and glide, pulse reveal, terminal reading, the locked-uplink message, collecting all 12 echoes
  one after another, and the finale. All behaved as intended and the console showed no errors.
- Frame rate on this machine (Apple Silicon, 1512×717 window, 1.5 pixel ratio): about 80 fps at street
  level and from a 99 m rooftop.
- I looked through the screenshots and fixed what was visibly wrong: washed-out exposure and fog, a title
  camera that clipped through a tower, a blown-out echo crystal and beam, an over-bright monorail light,
  heavy chromatic aberration, a brown/green colour cast on walls, and two cases of **large black
  rectangles** caused by NaN pixels being smeared by bloom (fixed at the source and guarded by a pass).
- After the first complete version I was told it still looked rough. The second pass replaced flat window
  quads with interior-mapped rooms and shopfronts, and added all props, lamp cones, walking pedestrians,
  car trails, steam and lantern strings. The screenshots are from after that pass.

## Not achieved, or faked

- **Real input was not fully verified.** Movement was tested by holding keys through a script hook and by
  teleporting (`window.__game`), not by hand. The automation's key presses are instantaneous and its click
  did not obtain pointer lock, so mouse-look under a real captured mouse and long real key holds are
  untested by me. Screenshots were staged with the same teleport hook.
- **Sound is unheard.** The audio code runs without errors, but I cannot listen to it; mix levels and
  whether the pad is pleasant are unjudged.
- **Lighting is fake throughout.** No lights, no shadows. Lamp pools are an analytic pattern in the ground
  shader; "street glow" on walls is a height falloff; nothing actually illuminates anything else.
- **Interiors are an illusion.** Rooms and shops are shader tricks on flat walls. No building can be entered.
- **Reflections exist only at street level**, as one planar mirror with noise blur. Rooftops, glass and
  puddles above the ground do not reflect.
- **Crowds and traffic are scenery.** Pedestrians walk fixed rectangles around blocks, turn instantly, and
  pass through stalls, lamps, each other and the player. Flying cars run straight lines and pass through
  the distant towers. The monorail cannot be boarded and passes through the player.
- **Rain ignores cover.** It falls through roofs, awnings and stall canopies.
- **Geometry is all boxes**, apart from the pedestrians' cylinders and cones. Vending machines, stalls,
  tanks and pipes are box stacks. Steam is two crossed quads.
- **One city.** The generator takes a seed but the game always uses seed 9; there is no seed picker.
- **Platform gaps.** No touch or gamepad controls, no pause or settings menu, no key rebinding. Tested in
  desktop Chrome on one Mac only. Sign text relies on system CJK fonts and will fall back elsewhere.

## My assessment of the weaknesses

1. **The game is thin.** It is a twelve-item collectathon with one tool (the pulse) and no opposition,
   puzzle, or change in the world until the ending. Twenty minutes covers it. Gliding and double-jumping
   are fun but nothing asks for them: every rooftop echo has a lift straight to it.
2. **Architecture is still boxy.** Up close the facades now hold up, but silhouettes are plain cuboids with
   at most one setback. There are no bridges, overhangs, stairs, tunnels or interiors, and alleys are empty.
3. **Repetition shows.** Shop interiors, room layouts and props draw from small sets. The two rooftops I
   looked at that carry echoes are bare slabs, because lift buildings are excluded from rooftop clutter.
4. **Districts differ in dressing more than in play.** Lantern Row and Kessel Market read distinctly; the
   Sump and Glasswater are less characterful, and no district has its own mechanic.
5. **The ending is modest**: an aurora, a brighter Spire beam and four lines of text.
6. **Pedestrians are mannequins** with a two-pose leg swing and no arms, and they ignore the player.
7. **Robustness.** Performance was measured on one fast machine; the only fallback is dropping resolution.
   The whole look depends on bloom, which is where both black-rectangle bugs came from.

## Process notes

- The folder already held two unrelated earlier projects, so this game lives in its own `mothlight/`
  directory and nothing outside it was changed.
- Browser checks were meant to use Claude in Chrome. Its extension was not connected at first, so the early
  checks used the Chrome DevTools bridge instead; once the extension became available, all later checks and
  every screenshot in `screenshots/` were done through Claude in Chrome.
- Independent review: Codex could not run (its configured model was rejected by the account), so the review
  was done by a separate Opus reviewer, read-only. It found nothing critical or high and five lower-severity
  issues, all fixed:
  1. A player restored inside a solid box was always pushed out toward +x/+z, which could throw an old
     save up to 26 m through a building. Now exits by the nearest side (new test).
  2. The ground shader drew lamp light pools along the island edge where no lamp stands. Masked.
  3. `tools/serve.mjs` accepted a sibling-folder path prefix, unlimited upload bodies, and any Host/Origin.
     Tightened (it only ever listens on 127.0.0.1).
  4. Thunder could cut off abruptly when its noise buffer ran out. Buffer lengthened, offset bounded.
  5. A still-focused title button could restart the intro on Enter during play. Guarded.
  The reviewer read the final versions of the physics, audio, HUD and server files in full; the last few
  edits to the shader, world and city files were only spot-checked by it, so those lines rest on my own
  testing. It also ran its own probes: all six lifts ridden at three frame rates, and a flood fill showing
  every street echo, lift, terminal and the uplink reachable on foot from the start.
