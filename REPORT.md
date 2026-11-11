# Qingyun Sect Gate at Dawn — build report

## Deliverables

| File | What it is |
|---|---|
| `scene.mp4` | 10 s, 1080x1920, 30 fps, H.264 High, yuv420p, 300 frames |
| `stills/still_t1s.png`, `still_t5s.png`, `still_t9s.png` | The exact frames 30, 150 and 270 that went into the video |
| `src/main.js` | The whole scene: geometry, shaders, animation, post-processing |
| `build.mjs` | Bundles `src/main.js` + three.js into one self-contained `scene.html` |
| `capture.mjs` | Headless-Chrome frame capture piped into ffmpeg |
| `scene.html` | Built output; opens offline by double-click and plays a live preview |

Rebuild and re-render: `npm install && node build.mjs && node capture.mjs` (about 40 s on an M4 Max).
`node capture.mjs --stills-only` renders only the three stills.

Verification of the delivered video (ffprobe, counting decoded frames):

```
codec_name=h264  profile=High  width=1080  height=1920  pix_fmt=yuv420p
r_frame_rate=30/1  avg_frame_rate=30/1  duration=10.000000  nb_read_frames=300
```

Frame-to-frame luma difference over the 299 transitions averages 2.02 (min 1.12, max 2.66, 8-bit scale):
no zeros and no spikes, so there are no duplicated or popped frames.

## Stack

- **Three.js r170** (WebGL2) with hand-written GLSL `ShaderMaterial`s for every surface and pass. No built-in
  three.js lights, materials, or post-processing addons are used; the only addon is `mergeGeometries`.
- **esbuild** inlines everything into a single 501 KiB `scene.html`. It makes no network requests.
- **puppeteer-core** drives the locally installed Chrome (headless, Metal/ANGLE GPU). **ffmpeg** (libx264,
  CRF 15, preset slow, BT.709 tagged) encodes.
- No image or video generation models, no downloaded images, textures or footage. Three npm packages
  (three, esbuild, puppeteer-core) were installed; they are code libraries.

### Determinism

The frame is a pure function of time: `window.renderFrame(t)` sets every animated quantity from `t` and
renders. All randomness comes from a seeded PRNG (`mulberry32`) at build time; `Math.random` and wall-clock
time are not used in capture mode. `capture.mjs` calls `renderFrame(i / 30)` for `i = 0..299`, reads the canvas
back with `toDataURL` in the same call, and writes the PNG to ffmpeg's stdin in order, with back-pressure.
It encodes to `scene.partial.mp4`, then runs ffprobe on that file and only renames it to `scene.mp4` if it is
h264, 1080x1920, yuv420p, 30/1 with exactly 300 decoded frames. It aborts (and deletes the partial file) on a
page or shader error, a lost WebGL context, a software GL renderer, a readback that is not a 1080x1920 PNG,
or an early ffmpeg exit. Debug query strings are ignored for the video.
Film grain is hashed from the frame index, so it is also reproducible.

## How each required element is implemented

**Layered peaks.** 62 spires (14 hand-placed mains in three depth layers, 2–3 satellites each, 16 far
silhouettes) built as parametric surfaces: a height profile times angular lobes, fbm noise and a ledge
term, with finite-difference normals. One merged mesh. The fragment shader adds strata, vegetation on
flatter faces, backlit rim light and analytic exponential height fog for aerial perspective.

**Moving sea of clouds.** A full-screen pass ray-marches a density field (110 steps, jittered) using the scene
depth buffer: fbm from a 64³ 3D noise texture, a billowing top whose height varies with low-frequency noise,
a clear pocket around the lake, and wind advection in `t`. Each sample takes one extra density sample toward
the sun for self-shadowing, plus a forward-scattering term.

**Drifting mist and spirit particles.** The same volumetric pass has two more density terms: a thin mist bank
behind the gate and low wisps over the lake, both advected by the wind. 760 additive point sprites (gold and
jade) rise, sway and twinkle as closed-form functions of `t`; they are depth-tested manually against the
scene depth texture.

**Lake with reflection and ripples.** True planar reflection: the world group is rendered a second time with
`scale.y = -1` through the same camera, fragments below the water plane are discarded, and that mirrored
render gets its own cloud pass and particles. The water shader samples it at the fragment's own screen
position, offset by a ripple normal. Ripples are two scrolling noise layers plus five expanding ring sources
(as if from droplets), fading with distance. Fresnel blends the reflection with a dark water colour and adds
sun glints. The reflected plaque reads mirrored in the stills, which is the check that the reflection is real.

**Paifang with plaque.** A three-bay, four-pillar gate assembled from boxes and cylinders (pillars, plinths,
drum stones, beams, panels, red bracket layers) with three hip roofs built as parametric surfaces with a
concave slope, upturned eaves and shader-drawn tile rows. It stands on a stone terrace with steps into the
lake, a stairway behind and two glowing stone lanterns. The plaque is a Canvas 2D texture: `青云宗` drawn
with `fillText` in the system font Songti SC (Black), gold on dark lacquer with a double border.

**Floating rocks.** Seven noise-displaced rocks with flat mossy tops and jagged undersides, four carrying a
pine, each with three small debris stones. They bob on sine curves with individual periods and phases, turn
slowly and tilt slightly. They appear in the lake reflection.

**Sunrise light and shafts.** The sun is a small HDR disc low between the peaks, with a broken high cloud
layer on the sky dome lit from the sun side. Light shafts are a screen-space radial blur (90 taps toward the
sun's projected position) of the unoccluded sun glow, where "unoccluded" means sky pixels times the cloud
transmittance times the high-cloud transmittance, so peaks, the gate, rocks and cloud billows cut visible
streaks. Bloom, ACES tone mapping, a vignette and a mild contrast curve finish the frame.

**Camera push.** The camera travels from z=62 to z=41 toward the gate over 10 s, rising 0.7 m and drifting
1.8 m sideways for parallax, on a blend of linear and smoothstep easing so it never fully stops.

**Anti-aliasing.** Every pass runs at 2160x3840 and the final pass box-filters down to 1080x1920.

## Missing or faked

- **No cast shadows.** There is no shadow map. The gate, rocks and pines do not shadow the terrace, water or
  each other; only the clouds self-shadow (one sample). The backlit setup hides this, but nothing is grounded
  by a contact shadow.
- **Light shafts are screen-space**, not volumetric. They only exist while the sun is in frame, they are drawn
  over foreground objects as an additive overlay, and they are not present in the lake reflection.
- **The cloud top rises with distance** (up to about 290 m at 600 m out). A real cloud sea has a flat top; from
  a camera 2–3 m above the lake a flat top would be an edge-on sliver, so the height is cheated to make the
  peaks visibly rise out of it.
- **The plaque glyphs come from a system font**, rasterised by the browser's Canvas API. The text is drawn in
  code, but the letterforms are Songti SC, not procedural strokes. On a machine without that font the
  fallback chain picks another CJK face and the plaque will look different.
- **The plaque reads left to right** (青云宗) for legibility; a traditional plaque would read right to left.
- **Gilded characters get an emissive boost** so they stay readable on the shaded side of the gate.
- **Water has no depth, refraction, shoreline foam or caustics.** The ripple distortion is a screen-space
  offset of the reflection, not a per-pixel reflected ray, so it is plausible rather than exact; the
  undistorted reflection is exact.
- **High clouds are a 2D layer** painted on the sky dome, with a fake lighting offset.
- **Particles are not attenuated by mist** and are not sorted (additive, so order does not matter).
- **Hard-coded to macOS Chrome** in `capture.mjs` (override with `CHROME=/path`). The `--use-angle=metal`
  flag is macOS-specific.

## My assessment of the weaknesses

1. **It reads as stylised, not photoreal.** The pines are stacked cones, the hills are smooth green slopes
   with little detail, and the gate is clean box geometry with no carving, chips or wear beyond noise tint.
   The look is closer to a polished game diorama than a film matte painting.
2. **The cloud sea is soft.** It works as mist that swallows the peak bases, but it lacks crisp cauliflower
   billows; from this low camera you see its side, not a rolling surface. Its motion over 10 s is gentle.
3. **The image is high-key.** The backlit sun, shafts and bloom lift the upper right toward white, and the
   palette is pastel. A moodier grade with deeper shadows would feel more cinematic; I prioritised keeping
   the gate and plaque readable.
4. **Peaks are repetitive.** All spires come from one generator, so they share a silhouette family (tapered
   columns with ledges). There are no ridgelines, waterfalls, or buildings on the peaks.
5. **Sun glints on the lake are streaky blobs** in the lower frame rather than fine sparkle.
6. **Floating rock at upper right is nearly washed out by the shafts** at the end of the shot.
7. **The terrain behind the gate is plain**: a grass rise and a stair that ends in mist, with no hint of the
   sect buildings beyond.
8. **File size is 17 MB** for 10 s because of CRF 15 plus grain; raise the CRF if size matters.

## Process notes

- Three review rounds on the stills, not one. The first render was badly overexposed; debug views of the
  intermediate buffers showed the light-shaft buffer saturating the frame and the cloud sea sitting too low
  to be seen. Fixes: narrower shaft source and lower strength, a higher and denser cloud layer, a
  smaller sun disc, a 16-tap bloom downsample (the 4-tap one aliased), pillar-like peak profiles, and
  removal of odd ornaments on the lantern roofs.
- MSAA render targets were replaced by 2x supersampling during that debugging. I did not confirm MSAA was
  at fault, so that swap is a choice, not a fix.
- `?dbg=1..5` on `scene.html` shows intermediate buffers (composite, shafts, bloom, scene without clouds,
  cloud transmittance). It is off by default and does not affect the delivered render.

## Independent review

The code was reviewed once by a separate model (Claude Opus, read-only subagent). A Codex review was
attempted first and failed before reading anything (model not available on the account); it was then dropped
on request. The reviewer traced the planar reflection (mirror transform, winding, clipping, mirrored
ray-march start, depth reconstruction, screen-space sampling) and found no defects there. Findings applied:

- Particles were adding to the alpha channel that feeds the light shafts, so each sprite cast a faint streak.
  Particles now blend on RGB only.
- Seven `smoothstep` calls had reversed edges, which GLSL ES leaves undefined. Rewritten as
  `1.0 - smoothstep(lo, hi, x)`.
- `capture.mjs` hardening described under Determinism (verify the encoded file, partial-file rename, early
  error checks, no debug flags in the delivered video).

Findings not acted on: the grain hash uses `sin()` of large arguments and point sprites up to 64 px assume
GPU support for that size. Both are fine on this machine and could differ on another GPU. The plaque font
check only confirms that Songti SC resolves; a silent fallback on another machine is still possible.

The video and stills in this folder were re-rendered after these fixes.
