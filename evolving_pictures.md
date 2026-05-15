# Evolving Photographs

*A grid-state experiment driven by MIDI events.*

`Status: spec, pre-implementation`

---

## Purpose

Use the existing canvas grid as a display for slowly-evolving photographs. A
stack of N source photos is loaded; one is the initial state of the grid.
Each MIDI note-on event copies a region from another photo into the current
state, slowly revealed pixel-by-pixel. Mouse movement perturbs the cells it
passes over. Over time the visible image becomes a chimera — a stable
composite shaped by where MIDI activity has happened and where the mouse
has traveled.

This is a foundation for a building-in-different-states sequence: as MIDI
activity accumulates, the displayed building gradually transforms from
state 1 to state 10 through localized swaps. The proof of concept uses
arbitrary photos to validate the mechanics.

---

## Why each piece is here

**One world state, not per-photo states.** The grid displays a single
evolving raster. The N source photos are samples we pull *from*, not
layers we composite. A cell at any moment has one value, drawn from one
photo. This keeps the rendering trivially cheap (one lookup per visible
cell) and the mental model clear ("the grid is a photograph that is
becoming a different photograph").

**Image space = grid space.** A photo's pixel (x, y) lives at grid cell
(x, y). Negative grid coordinates fall outside the photos and stay at a
neutral default. This eliminates a coordinate-transform layer: the
photo *is* the world. Panning the grid moves the window over the
photographs naturally.

**Sequential cycling through photos.** Each MIDI hit pulls from the
"next" photo in the stack, advancing a single global cursor. After photo
10 the cursor wraps to photo 0, or stops at 10 — TBD by listening. The
sequential ordering means the visible image evolves through a *path*,
not a random walk: photo 1 → 2 → 3 territory accumulates predictably.
This matches a building-transformation use case where the photos
represent ordered stages.

**Pitch-scaled region size.** MIDI note number determines how much of the
new photo arrives per hit. Low notes paint big regions; high notes paint
small ones. This gives the substrate-as-input a *vocabulary*: low rumbles
splash large areas, high pings make precise edits. The mapping is
configurable; pitch is the natural axis because it varies continuously
and is already meaningful to the user.

**Slow pixel-by-pixel reveal.** A region swap doesn't replace cells
instantly. The set of cells in the region is shuffled, then those cells
update over a configurable duration (default ~1 second). Multiple swaps
can overlap — a new hit on top of an in-progress region just contributes
more pending updates. The reveal makes individual hits *legible* rather
than instantaneous, and the overlap-resolution policy ("last write wins
per cell, per frame") is simple and predictable.

**Configurable cell value type.** The grid renderer is unchanged. The
world state stores per-cell values. The value type is one of:

- `Grayscale`: one byte per cell, painted as `rgb(v, v, v)`.
- `Tinted`: grayscale plus a per-photo hue, painted as HSL with constant
  saturation, lightness from cell value, hue from source photo.
- `Color`: full RGB per cell, desaturated at load time by a configurable
  factor.

Configured at startup; the value type cannot change mid-run because the
storage layout differs. Default: `Grayscale`. The setting is exposed in
the experiment's config object, not the grid component.

**Mouse smearing as drag.** Cells under the cursor are dragged in the
cursor's velocity direction. Concretely: each cell touched copies its
value to a neighbor offset by the velocity vector and weighted by a
small amount. The cell remains, but its value is *also* pasted slightly
ahead of the cursor's motion. Fast cursor movement produces visible
streaks; slow movement produces small drifts. This is the most
viscerally "physical" smear option and aligns with the gravity-warp
metaphor already in the grid.

---

## Data model

### World state

A 2D map from grid cell coordinates to cell values. Backed by a `Map<string, CellValue>`
keyed by `"x,y"` strings (matching the existing `cellKey` convention),
because the grid is logically infinite and a dense array would waste
memory for cells outside any photo. Sparse storage; cells with no entry
render as the default background.

For a typical 200×200-cell photo footprint, the map holds 40,000 entries.
A `Map<string, number>` with grayscale values is roughly 2-3 MB. If a
benchmark reveals the string-keyed map is the bottleneck, an alternative
representation is a `Uint8Array` of size `W * H` keyed by integer offset,
with an explicit bounding box. The spec assumes the simple version is
fast enough until measurement says otherwise.

### Source photos

Loaded once at startup into an array `photos: PhotoData[]`. Each entry
is the decoded pixel data in the configured value type, along with the
photo's dimensions:

```ts
interface PhotoData {
  width: number
  height: number
  values: Uint8Array  // grayscale: 1 byte per pixel
                      // tinted:    1 byte per pixel + photo's hue
                      // color:     3 bytes per pixel (RGB)
}
```

Decoding happens off-screen via a hidden `<canvas>` element — load image
URL, draw to canvas at natural size, read back `ImageData`, convert to
the configured representation. Asynchronous; the experiment must handle
the "still loading" state by rendering the background until photos are
ready.

### Pending updates

A queue of cells waiting to be revealed:

```ts
interface PendingUpdate {
  cellX: number
  cellY: number
  value: CellValue
  revealAt: number  // performance.now() / 1000 seconds
}
```

When a MIDI hit lands, the cells in the swap region are collected,
shuffled, and pushed onto the queue with `revealAt` times spread evenly
across the reveal duration. The animation loop drains entries whose
`revealAt` has passed, writing them into the world state.

The queue is processed per-frame, *before* the renderer reads. A single
overlap policy: if two pending updates target the same cell, the one
that fires later in wall-clock time wins. This is automatic from the
queue structure — earlier writes are overwritten by later ones because
both pass through the same map.

---

## Behavior

### Photo cycling

A single integer `nextPhotoIndex`, initialized to 0. On each MIDI hit:

1. Choose source = `photos[nextPhotoIndex]`.
2. Increment: `nextPhotoIndex = (nextPhotoIndex + 1) % photos.length`.

The grid's initial state at startup is the first photo, painted in full.
Subsequent hits start pulling from photo 1, then 2, and so on. After the
last photo, the cycle wraps. This matches the "evolving through stages"
metaphor — wrapping means the cycle is continuous rather than terminating.

### Region size from pitch

MIDI note numbers are 0–127. The region size in cells:

```
size = round(MAX_SIZE * (1 - (pitch - LOW_NOTE) / (HIGH_NOTE - LOW_NOTE)))
size = clamp(size, MIN_SIZE, MAX_SIZE)
```

with defaults `MIN_SIZE = 3`, `MAX_SIZE = 30`, `LOW_NOTE = 24` (C1),
`HIGH_NOTE = 108` (C8). Lower notes produce larger regions; higher notes
produce smaller. The region is a square centered on the hit cell — the
exact same cell-selection mechanism the existing flash effect uses.

The region's *position* in the grid is a random cell in the current
viewport — same as the current MIDI handler. The region's *contents*
come from the same coordinates in the source photo (image space = grid
space). If the region's grid coordinates fall outside the photo's
bounds, the out-of-bounds cells contribute no update (we don't extend
photos by tiling or by repeating edges).

### Region reveal

Given a region `{ x, y, size }` and a source `photo`:

1. Enumerate the cells in the square: `(x..x+size, y..y+size)`.
2. For each cell, if `(x, y)` is inside the photo's footprint, read the
   source value.
3. Shuffle the resulting list.
4. Schedule each cell with `revealAt = now + (i / list.length) * duration`,
   where `duration` is the reveal-duration config (default 1.0 seconds).

The shuffle is Fisher-Yates. The reveal duration is per-event, so a
larger region takes the same wall-clock time as a smaller one but covers
more cells in that time — equivalent reveal velocity, varied surface
area. If preferred, the duration could scale with `size`; specced as
constant for now.

### Mouse smearing

The cursor's screen-space position is already tracked in the grid for
the gravity warp. The smear extends this:

1. Compute the cursor's *velocity* in pixels/second by differencing
   positions across frames. Smooth over ~5 frames with a moving average
   to suppress jitter.
2. Translate velocity to *grid units/second* by dividing by cell size.
3. Each frame, for each cell within `SMEAR_RADIUS` of the cursor in grid
   space, copy that cell's value to the neighbor at
   `(cell.x + vx * SMEAR_LENGTH, cell.y + vy * SMEAR_LENGTH)` with weight
   `SMEAR_STRENGTH`.

"Weight" means: if the source cell value is `s` and the destination is
`d`, the destination becomes `d * (1 - w) + s * w`. With `w = 0.3`, fast
sweeps produce blended trails; with `w = 1.0`, the cursor stamps copies
of the source ahead of itself.

The smear only fires when cursor velocity exceeds a small threshold
(`MIN_SMEAR_SPEED = 50 px/s`), so a stationary cursor doesn't keep
copying cells onto themselves.

For the Color value type, smearing blends the RGB channels independently.
For Grayscale and Tinted, it blends the single value.

### Rendering

The grid's `renderCell` callback reads from `worldState.get(cellKey(x, y))`:

- If present: paint the cell with the value according to its type.
- If absent: leave the cell empty (transparent — the dark background shows
  through, matching the existing canvas behavior).

Cell values are looked up per-frame per-visible-cell. With ~600 visible
cells at typical zoom, that's 600 Map lookups per frame, well below any
budget concern.

---

## Configuration

The experiment is configured at the App level, not the canvas grid. A
single object passed to the experiment's main hook:

```ts
interface EvolvingPhotosConfig {
  photoUrls: string[]            // 1..N URLs; loaded sequentially
  valueType: 'grayscale' | 'tinted' | 'color'

  // Region sizing
  minRegionSize: number          // cells, default 3
  maxRegionSize: number          // cells, default 30
  lowNote: number                // MIDI note for max size, default 24
  highNote: number               // MIDI note for min size, default 108

  // Reveal
  revealDurationSecs: number     // per-event reveal time, default 1.0

  // Smear
  smearRadius: number            // cells, default 4
  smearLength: number            // cell units the copy is offset, default 1.5
  smearStrength: number          // 0..1 blend weight, default 0.3
  minSmearSpeed: number          // px/sec, default 50

  // Photo cycling
  wrapPhotos: boolean            // default true; if false, cycle stops at last
}
```

Defaults are tuned for the proof-of-concept use case. Tuning happens by
editing the App-level config, not by exposing controls in UI.

---

## Module layout

A new module owns the experiment's logic, separate from any grid concern:

**`src/experiments/evolving-photos/world-state.ts`**
- `WorldState` class: the cell map, with `get`, `set`, `forEach`, etc.
- `CellValue` type and value-type variants.

**`src/experiments/evolving-photos/photo-loader.ts`**
- `loadPhoto(url, valueType): Promise<PhotoData>` — decode an image URL
  into the configured representation.
- `loadPhotos(urls[], valueType): Promise<PhotoData[]>` — load in
  parallel, await all.

**`src/experiments/evolving-photos/region-reveal.ts`**
- `scheduleRegion(world, photo, region, duration, queue)` — enumerate,
  shuffle, schedule.
- `drainPending(world, queue, now)` — pop expired entries and write them.

**`src/experiments/evolving-photos/smear.ts`**
- `applySmear(world, cursor, velocity, config, dt)` — one-frame smear
  update.

**`src/experiments/evolving-photos/use-evolving-photos.ts`**
- React hook that wires the above together. Returns:
    - `renderCell: CellRenderer` — for the canvas grid.
    - `onMidiMessage: (msg: MidiMessage) => void` — for the MIDI hook.
    - `onCellClick: (cell: CellCoord) => void` — for the canvas grid.
    - Status info for the debug HUD (photos loaded, current photo index,
      pending update count).

App composes these.

---

## Definition of done

1. With 10 photo URLs configured and value type `Grayscale`, the app
   displays the first photo at startup (within a second of load), with
   the photo's pixel (0, 0) at grid cell (0, 0).
2. Incoming MIDI note-ons trigger region swaps. Low pitches produce
   large regions; high pitches produce small ones. Regions are drawn from
   `photos[0]` first, then `photos[1]`, then `[2]`, wrapping at the end.
3. Each swap reveals its region pixel-by-pixel over approximately one
   second. Multiple swaps can overlap in time and space without visual
   glitches; later writes win on contested cells.
4. Mouse movement at typical speeds (~500 px/s) leaves a visible smear
   trail in the cell values it passes over. Stationary cursor produces
   no change. Very fast sweeps blur larger regions.
5. Switching the config's `valueType` to `Tinted` or `Color` and
   reloading produces the corresponding rendering with no other code
   changes (the value type is honored end-to-end).
6. With the debug HUD enabled, the current photo index, total photos
   loaded, and pending update count are visible.
7. The canvas grid, MIDI hook, and draggable card components are
   unchanged.

---

## What's intentionally not in this iteration

- **Camera-driven photo selection.** Real photos with EXIF, building IDs,
  or a server-driven photo source. Out of scope; the experiment loads
  static URLs at startup.
- **Region shapes other than squares.** Circular or splash regions are
  easy to add later by changing the cell-enumeration step. Squares first.
- **Animation curves on the reveal.** Linear distribution across the
  duration is sufficient. Could ease in/out later.
- **Undo / history.** The world state is destructive. A region overwrites
  whatever was there. No journaling.
- **Persistence across reloads.** World state is in-memory only.
- **Multiple smear modes.** Drag-direction copy is the only smear. Blur,
  erase, scramble are deferred.
- **Per-photo metadata in the HUD.** Just photo index + count for the
  proof of concept. Names/labels later.

---

## Migration path forward

Once the proof of concept feels right with random photos, the building
sequence drops in by replacing `photoUrls` with the ordered building
photos. Nothing else needs to change. If the building photos are taken
at different framings or resolutions, an alignment step (resize/crop on
load) goes into `photo-loader.ts` — it's the only module that needs to
know about that.

OSC-driven photo selection (chain state determines which photo gets
sampled, instead of the sequential counter) is a one-function swap on
`nextPhotoIndex`. When the OSC/WebSocket bridge lands, this can be
hooked up without touching the rest of the module.

---

*Spec for Crystallized Time frontend | Evolving Photographs experiment*