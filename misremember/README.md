# MISREMEMBER

A first-person exploration game. Something has rebuilt your childhood home from what you remember of it, and
memory is lossy. Nothing ever changes while you watch it.

This folder currently holds the first two of five evenings:

1. **Almost** — dinner, a kitchen that drifts behind your back, a door that was not there, a wall you can only walk
   through with your eyes closed, and a watch that is still right.
2. **Count** — more doors than yesterday (all of them lead to your room), a table the Host keeps recounting, a
   pantry you can only enter walking backwards, and three napkin rings.

## Play

Open `index.html` in Chrome. It is one self-contained offline file.

- **W A S D** walk, **mouse** look, **E** use
- hold **Space** to close your eyes
- nod or shake the mouse to answer a note (or **Y** / **N**)

## Build

```
npm install
npm run house      # Blender: build rooms and props, bake lightmaps (add `-- --no-bake` to skip the bake)
npm run images     # convert generated images and lightmaps to WebP
npm run build      # bundle everything into index.html
npm test           # unit tests for the pure game logic
npm run serve      # http://127.0.0.1:5183/
```

`?nolock` runs without pointer lock (drag to look) and `?autostart` skips the title card; both exist for automated
browser checks. `window.__game` exposes the world, player and story for the same purpose.

## Layout

- `data/house.json` — rooms, doors, windows, furniture and materials. Read by both Blender and the game.
- `tools/blender/build_house.py` — builds every room and loose prop, bakes one Cycles lightmap per room, exports
  `assets/house.glb`, `assets/props.glb`, `assets/lm/*.png` and `assets/house_meta.json`.
- `assets/img/raw/` — images generated with Codex (wallpapers, floors, the family photographs, the views in the
  windows). `tools/images.mjs` converts them.
- `src/core/` — pure logic with tests: door-to-door room attachment, collision, the drift engine, the nod/shake
  reader, view tests, and the evening's story as a reducer.
- `src/game/` — three.js: rooms and stencil portals, loose props and notes, synthesised audio.

## How the house works

Rooms are separate chunks, each in its own coordinates with its own baked light. The room you are in sits at the
origin and its neighbours are attached door to door, drawn only through their doorway with a stencil mask. That is
what lets a doorway lead somewhere else the next time you open it.

Every doorway has three baked parts: a frame, a leaf and a **veil** (a patch of plain wall). Showing the veil
removes the door. Some veils only stand while your eyes are open; some only while you are looking at them, and if
one of those has to close in plain sight the game blinks for you first. A doorway can also be relinked to a
different room when it is opened.

Things that can change are **drift slots**. A change is queued and lands only after the slot has been off screen
for a while; each new state must then be seen before the next one lands. An **anchor** (the watch, the napkin
rings) holds a set of slots: they return to the truth instead.
