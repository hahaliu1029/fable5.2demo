# 青云宗 · 御剑采灵 (Sword Flight at Dawn) — build report

## How to run

- **Play:** open `index.html` in a desktop or mobile browser (double-click works; it is one self-contained file
  and makes no network requests). Or serve the folder: `python3 -m http.server 8080`, then
  `http://localhost:8080/`.
- **Controls:** WASD or arrow keys steer (W/S speed up and brake, A/D turn), Space rises, Shift dives, mouse
  looks (click the view to capture the mouse, Esc releases it). Q toggles quality, M mutes, F shows fps,
  Enter starts. On touch screens: left stick steers, drag on the view to look, 升 / 降 buttons rise and dive.
- **Rebuild:** `npm install && node build.mjs`.
- **Automated playthrough:** `node tools/playthrough.mjs` (writes `screenshots/` and `gameplay.mp4`).
- **Frame-rate measurement:** `node tools/fps.mjs`.

The tools expect Chrome at the default macOS path (override with `CHROME=/path/to/chrome`) and ffmpeg on PATH.

## Deliverables

| File | What it is |
|---|---|
| `index.html` | The playable game, 552 KiB, single file |
| `src/main.js`, `src/audio.js`, `src/bot.js`, `src/index.template.html`, `build.mjs` | Source |
| `screenshots/title.png`, `midgame.png`, `complete.png` | Taken by the playthrough script |
| `gameplay.mp4` | 15 s, 1080x1920, 30 fps, H.264 + AAC, from the automated playthrough |
| `tools/playthrough.mjs`, `tools/fps.mjs`, `tools/trace.mjs` | Automated playthrough, fps measurement, autopilot trace |

## Stack

- **Three.js r170** (WebGL2) with hand-written GLSL for every surface and pass; **esbuild** bundles it into one
  HTML file. The HUD, title and completion screens are plain DOM and CSS over the canvas.
- **Web Audio API** for all sound. No audio files.
- **puppeteer-core** (driving the installed Chrome, GPU-backed headless) and **ffmpeg** for the playthrough.
- No image, video or audio generation models; no downloaded images, textures, models, footage or audio.
  The only downloads are the three npm code libraries.

## Scene elements

**Layered peaks in a sea of clouds.** About 96 rock spires (12 hand-placed behind the gate, the rest scattered in a
ring 185–655 m around the plateau, each with 1–2 satellites) are parametric surfaces with noise, ledges and
finite-difference normals. Their bases sit 60 m below the lake. The sea of clouds is a ray-marched volume in
a full-screen pass that reads the scene depth buffer: a noisy cloud-top height field between 2 and 21 m,
eroded with 3D fbm, advected by wind, lit by height inside the cloud plus a comparison of the cloud top
toward the sun. Around the plateau the cloud top is pulled down, so the lake sits in clear air and the
plateau reads as an island. Fly up and you look down on the cloud sea; fly out and you skim through it.
34 steps at half resolution on high quality.

**Drifting mist and spirit particles.** The same volumetric pass adds low wisps over the lake. 900 additive
point sprites (gold and jade) rise and twinkle in a box that wraps around the player, so the field is endless.

**Lake with reflection and ripples.** True planar reflection: the world is rendered a second time mirrored
about the water plane through the same camera, and the water shader samples it at the fragment's own screen
position offset by the ripple normal. The pass is skipped when the lake is out of view. While the player
flies below 4.6 m over the lake, the game drops a wake source every 0.16 s into a ring buffer of 10; the
shader turns each into an expanding, decaying ring, stronger the lower and faster you fly.

**Paifang with plaque.** Same gate as the cinematic: four pillars, three bays, three upturned roofs, lanterns,
terrace and stairs. `青云宗` is drawn with Canvas 2D `fillText` into a texture. When all orbs are collected
the plaque's emission ramps up and pulses, and a shimmering veil appears in the centre opening.

**Floating rocks.** 16 noise-displaced rocks (9 with pines), each with four debris stones, bob on sine curves
with their own period and phase and turn slowly. They are the obstacles.

**Sunrise light and shafts.** Fixed low sun, HDR disc, sun-lit high cloud layer on the sky dome. Shafts are a
36-tap screen-space radial blur of (unoccluded sun glow x cloud transmittance), fading out as the camera
turns away from the sun. Bloom, ACES tone mapping and a vignette finish the frame.

## Detail pass (after the first version was judged too rough)

All of this is still generated in code; Blender was not needed.

- **Sun shadows.** A 2048² orthographic depth map of the plateau along the sun direction, redrawn every frame
  (rocks and the player move), sampled with 4-tap PCF and a normal-offset bias. Hills, trees, the gate, rocks,
  buildings and the rider all cast and receive. High quality only.
- **Anti-aliasing.** FXAA on the opaque scene in the final pass (high quality only).
- **Surfaces.** Terrain: fine and micro grass noise, dry patches, wildflower specks, a worn stone path, rock
  with strata. Stone: masonry courses on vertical faces, paving slabs on top faces, rain streaks, moss.
  Roofs: tile ridges with overlapping courses and gilt end caps. Rock: strata, fissures, pitting, two bump
  scales. Timber: plank seams.
- **Vegetation.** Pines are five tiers of ragged, drooping skirts with a trunk and per-tree tint, planted in
  groves (about 300). About 420 bushes and 260 boulders on the hills. Pines cling to ledges on the peaks.
  Lily pads with veins and a notch, and lotus blooms, in the shallows.
- **Architecture.** The gate gains bracket rows under every eave, ridge beasts, pillar bands, beam caps,
  corbels, a balustrade round the terrace, hanging lanterns in the side bays and a pair of couplets on the
  pillars (`青云直上三千界` / `紫气东来第一峰`, drawn with Canvas text like the plaque). A double-eaved sect hall
  with lit door and windows stands at the head of the stairway and is a solid obstacle. Four pagodas sit on
  the rim hilltops, and the four largest floating rocks carry a small pavilion.
- **Rider.** Lathe-built layered robe, sash, collar, head, hair and topknot; a diamond-section blade with guard,
  grip and pommel; and cloth strips (outer robe, sleeves, hem, long hair, ribbons, sash tail, sword tassel)
  that stream back with speed in the vertex shader.
- **Life.** Thin waterfalls spill off the larger floating rocks and dissolve; three flocks of cranes circle in
  V formation with flapping wings.
- **Peaks** have more geometric resolution and a third noise octave on the silhouette.

## Blender polish pass (2026-11-11)

A second pass, done the way the Tidebell project was: models scripted in Blender, new effects in the existing
shaders, checked in real Chrome and by the automated playthrough. The game rules, layout, colliders and autopilot
were not touched; the playthrough finishes at the same 56.6 s with 20/20 orbs.

- **Models (`tools/blender/build_assets.py` -> `assets/qingyun.glb`, 14 models, about 50,000 triangles).** Every
  model is generated by Python inside Blender 5.2 with painted vertex colour, ray-cast ambient occlusion baked in and
  an emission mask in alpha. `npm run assets` rebuilds them (add `-- --preview` for a render of each).
  - *Rider and sword* replace the lathe-and-box figure: layered robe swept back with folds, wide sleeves, crossed
    collar, sash and jade pendant, a face, crowned topknot; a broad jian with rune inlays, cloud guard and bound grip.
    The streaming cloth strips are kept.
  - *Pines* are now gnarled mountain pines with tiers of needle tufts (a detailed variant round the lake, a lighter
    one on the far hills, peaks and floating rocks). *Peach trees* in blossom ring the lake.
  - *Cranes* are one red-crowned crane model drawn as 28 instances. Two bronze *incense burners* stand before the
    hall, with smoke. *Lotus* blooms replace the cone petals.
  - *The dragon* is one straight model bent along its flight path in the vertex shader. It circles high and far
    away; when the gate is unlocked it comes down to coil round the lake.
- **Loading.** `src/models.js` is a small synchronous GLB reader, so the scene is still assembled at module top
  level. The GLB and its metadata are inlined into `index.html` (now about 2.2 MiB, still one offline file).
- **Shading.** A new surface kind for the models: vertex colour, emission, light coming through foliage when the sun
  is behind it, and softened, noise-broken normals so tuft clusters read as one mass.
- **Effects.** The title is an ink-wash painting and colour floods out from the centre when the flight begins;
  taking an orb bursts its spirit outward and streams it into the rider; the sword leaves a two-ribbon trail of
  light; unlocking the gate sends a ring of golden light across the land and raises a pillar of light over the gate;
  peach petals fall over the lake basin. Exposure, contrast and saturation were retuned.
- **Tests.** `npm test` runs five unit tests for the GLB reader. `node tools/playthrough.mjs` still passes.
- **Film.** `node tools/promo.mjs [--lang=zh]` renders `promo/qingyun-promo[-zh].mp4` from the real autopilot run
  with scripted cameras and a synthesised score.
- **Review.** An independent reviewer found six issues (one `pow()` with a negative base that could blank the frame
  on some GPUs, the pine triangle count, and four small ones); all six were fixed.

**Cost.** The extra geometry is not free. Uncapped work per frame on the M4 Max at 1440x900 went from 2.5 ms to
8.3 ms on high and from 1.6 ms to 5.3 ms on low (still 60 fps capped, 121 / 189 fps uncapped). The earlier estimate
for integrated GPUs no longer holds: expect them to fall short of 60 fps on high, and low quality has less headroom
than before because it is geometry-bound. The frame-rate table further down is from before this pass.

## Gameplay elements

**Flying sword, third person.** A rider on a glowing sword with a light trail. Speed eases toward the thrust
input (34 m/s forward, 8 m/s reverse), A/D yaw at 1.9 rad/s with banking, Space/Shift ease vertical speed to
±16 m/s. The camera trails 9.5 m behind with exponential smoothing; the mouse turns the player and pitches
the camera. Keyboard, touch and the autopilot all feed the same three analogue inputs.

**Touch controls.** Shown on coarse-pointer or touch devices: a virtual stick (pointer events with capture),
two hold buttons, and drag-to-look on the canvas, each tracking its own pointer id so they work together.

**20 spirit orbs.** Five skim the lake, two are behind and above the gate, nine sit on or beside floating rocks,
four are out over the cloud sea. Each is a glowing core plus a halo sprite visible from far away; collecting
one plays a chime that climbs a pentatonic scale, bursts the halo into a ring and updates `灵气 n/20`. A HUD
marker points to the nearest remaining orb (an arrow at the screen edge when it is off-screen) with distance.

**Rock collisions.** Each rock is an ellipsoid collider (flat top, long underside). A hit pushes the player out,
applies a 24 m/s knock-back impulse that decays, stuns input for 0.38 s, shakes the camera for 0.42 s and
plays a noise-crack-plus-thump sound. Peaks are colliders too, but you slide around them. The gate is solid
within its silhouette except for its three openings (the side bays only below the hanging lanterns), tested
at the point where the flight path crosses the gate plane; hitting stone there, or the hall, gives a smaller
bump.

**Unlock and finish.** Collecting the 20th orb lights the plaque, sounds a gong and shows a prompt. Crossing
the gate plane through any opening while unlocked ends the run: the camera swings round to face the lit
gate and the completion screen shows the time, orb count, rock hits and a restart button.

**Title screen.** Title, start button and a controls hint (Chinese and English) over a live view of the gate.

**Audio.** An ambient drone (open fifth on D, slightly detuned oscillators through a slowly breathing low-pass)
plus band-passed noise wind whose level and pitch follow flight speed. Effects: orb chime, rock hit, gate
bump, unlock gong, completion arpeggio, button click. All synthesised; the noise buffer is seeded.

**Quality toggle.** `画质 高/低` button or Q, remembered in localStorage. Low quality renders at 0.7x
resolution, uses 13 cloud steps at one-third resolution instead of 34 at half, a quarter-resolution
reflection, and turns off sun shadows, anti-aliasing, shafts and bloom. If the frame rate stays under 40 fps
for 3 s during play on high, the game switches to low by itself once and says so (that automatic switch is
not remembered, so a throttled tab does not downgrade later visits).

## Automated playthrough

`tools/playthrough.mjs` steps the game at a fixed 1/30 s with no wall clock, so a run is reproducible. It:

1. Checks mechanics with real keyboard events and the real start button: W accelerates, Space rises, Shift
   dives, arrows steer, skimming the lake leaves ripples, flying through the gate before it is unlocked does
   not end the run, flying into a rock registers a hit with shake, knock-back and a sound, and the audio
   context is running. (The player is placed in front of a rock for that one check.) With real touch events
   on a touch-emulating page it checks the virtual stick and the rise button. It also verifies that no orb
   sits inside a collider, and that each screenshot frame is a real image (not black, blown out or flat).
2. Plays the whole game with the autopilot (`src/bot.js`). The autopilot only produces turn / thrust / climb
   inputs; it steers to the nearest orb, avoids rocks and peaks, then lines up and flies through the gate.
3. Replays the identical run, takes the three screenshots and records the **final 15 seconds** (last two
   orbs, plaque lighting up, flight back to the gate, completion screen), then asserts the replay finished
   at exactly the same game time.
4. Renders the soundtrack for those 15 s with the game's own audio code on an `OfflineAudioContext` and
   muxes it in. Then clicks restart and checks the run resets.

Result of the delivered run: PASS, 20/20 orbs, finish time 56.6 s of game time, 0 rock hits, 0 gate bumps,
`gameplay.mp4` verified by ffprobe as `h264,1080,1920,yuv420p,30/1,450`.

## Frame rate measured

Measured with `tools/fps.mjs` in headless Chrome on an **Apple M4 Max**, autopilot flying a real run.
"Real-time" is the normal `requestAnimationFrame` loop over 12 s; "work per frame" is the uncapped cost of one
game step plus all render passes with a forced GPU sync, averaged over 600 frames.

| Viewport | Quality | Render size | Real-time fps | p95 frame | Worst frame | Work per frame |
|---|---|---|---|---|---|---|
| 1440x900 @1x | high | 1440x900 | 60.0 | 16.8 ms | 16.8 ms | 2.49 ms |
| 1440x900 @1x | low | 1008x630 | 60.0 | 16.8 ms | 16.8 ms | 1.61 ms |
| 1440x900 @2x (retina) | high | 2160x1350 | 60.0 | 16.7 ms | 16.8 ms | 3.26 ms |
| 1440x900 @2x (retina) | low | 1512x945 | 60.0 | 16.7 ms | 16.8 ms | 1.65 ms |
| 390x844 @3x (phone size) | high | 585x1266 | 60.0 | 16.7 ms | 16.8 ms | 1.87 ms |
| 390x844 @3x (phone size) | low | 409x886 | 60.0 | 16.8 ms | 16.8 ms | 1.21 ms |

Real-time is pinned at the 60 Hz cap in every configuration, with no frame over 16.8 ms.

**This does not prove 60 fps on a typical laptop.** I only had this machine, and an M4 Max is far faster than
a typical laptop GPU. The useful number is the work per frame: an integrated GPU roughly 8–10x slower would
land around 20–33 ms on high at these resolutions (likely below 60 fps) and 13–16 ms on low (about 60 fps,
with little margin). That is an extrapolation, not a measurement. The detail pass roughly doubled the cost of
low quality (it is now geometry-bound: more trees, rocks and buildings, drawn twice when the lake is in view),
so low quality has less headroom than it had. The automatic drop to low quality exists for weak devices.

## Missing or faked

- **Shadows cover the plateau only** (300 m square, 15 cm texels). Peaks neither cast nor receive, clouds cast
  nothing on the ground, and low quality has no shadows at all. Cloth and waterfalls do not cast.
- **Clouds are not in the lake reflection.** The mirrored pass has fog but no volumetric pass, to save time.
  The rim hills hide most of the horizon, so it is hard to notice.
- **Light shafts are a screen-space overlay**, drawn over foreground objects and absent when the sun is
  off-screen or in low quality.
- **Colliders are approximate.** Peaks use the mean radius of their profile, so you can clip a bulge or stop
  short of a hollow by a few metres. Rocks are ellipsoids. The gate is one thin plane and the hall one box.
  Pines, bushes, boulders, lanterns, debris stones, balustrades, hilltop pagodas and rock pavilions have no
  collision, so you can fly through them.
- **Anti-aliasing is FXAA only** (plus a 1.5x render-scale cap on high); thin geometry such as balustrades and
  bracket rows still shimmers at a distance on 1x displays. The capture uses 2x supersampling, so the video
  and screenshots look cleaner than a 1x laptop screen.
- **The plaque glyphs and all UI text use system CJK fonts** (Songti SC first). On a machine without them the
  fallback chain picks another face.
- **The recorded clip is the last 15 s of a 57 s run**, not the whole run, and its audio is rendered offline
  from the logged sound events with a fixed wind level, not captured from the live output.
- **The rider is a stylised figure** with no face, fingers or skeletal animation; only the cloth moves.
- **Buildings are shells.** The hall and pagodas are boxes, columns and roofs with emissive door and window
  panels; there are no interiors. The couplet text is my own choice of two conventional lines.
- **Not exercised by a human or on real devices.** Keyboard, touch stick, rise button, start and restart are
  covered by the script with real input events. Mouse-look, pointer lock, drag-to-look on touch, multi-touch
  combinations and audible output are written but unverified, as are Firefox, Safari and real phones.

## My assessment of the weaknesses

1. **Shallow gameplay.** One loop, no fail state, no difficulty curve; rocks are easy to avoid in open sky
   (the autopilot finishes with zero hits). It is a pleasant fly-around more than a challenge.
2. **The look is stylised, not photoreal.** After the detail pass it holds up at mid distance, but up close the
   rock and grass textures are procedural noise, the cliff faces below the plateau are large plain slopes,
   and the cloud sea uses 34 half-resolution steps, so its surface is soft.
3. **Camera.** It can pass through hills, rocks and the gate; only the ground height is respected.
4. **Orbs far out rely on the HUD marker.** Without it the four cloud-sea orbs would be hard to find.
5. **Performance on weak hardware is unverified** (see above), and the detail pass made it heavier. Most
   geometry is drawn three times a frame when the lake is in view (shadow map, reflection, main view), and
   several surface shaders do 15+ 3D-texture lookups per pixel. Low quality does not reduce geometry.
6. **Mobile is the least tested surface.** Layout and controls are there; real-device behaviour is not known.
7. **Audio is simple**: a static drone and short synthesised effects, no music or spatialisation.

## Process notes

- **Review rounds.** First playthrough exposed an orb inside a hill and an autopilot that orbited orbs sitting
  on rocks and climbed forever; both fixed. First screenshots showed the rider's arms raised in a Y, a trail
  as wide as a beam, a title layout hiding the gate and a completion camera stuck inside a hillside; all fixed.
  After the detail pass, the hall's bracket rows were floating above the gate (missing z offset) and rock
  fissures read as drawn contour lines; both fixed.
- **Independent review.** One read-only review by a separate model (Claude Opus subagent). It found no way to
  finish without all 20 orbs, no permanent stuck state, no tunnelling and no non-determinism in the stepped
  path. Applied from its findings: the gate's solid region now matches its silhouette and is tested at the
  crossing point; timer rounding (59.96 s showed as 00:60.0); restart clears look deltas, tilt and ripples;
  key-repeat no longer flips quality; focus loss clears drag and touch state; rise and dive buttons and a
  second finger on the stick no longer cancel each other; audio resumes from any non-running state and
  suspends when the tab is hidden; the unlock sound's delay is the same live and in the offline render; wind
  drops on the completion screen; reflected sprites are sized for the reflection target; the automatic
  quality drop is not persisted; 8-bit fallback when float render targets are missing; and the playthrough
  script gained the locked-gate, touch, pixel and per-phase error checks.
- **Not acted on.** The script still launches Chrome with the autoplay policy relaxed, so it does not prove the
  user-gesture path on a stock browser (the code does create and resume the context inside the click).
- **Codex** was not used for this task (the model is unavailable on this account).
