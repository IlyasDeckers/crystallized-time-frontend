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

**Anchored home, explorable void.** Photo 0 is written into world state
at its native coordinates (cells `0..W, 0..H`) at startup. The viewport
starts at the origin so the user sees photo 0 immediately. Panning with
WASD moves the viewport over the world; cells outside photo 0's
footprint contain nothing and render as the dark canvas background.

MIDI hits paint regions at random cells *within the current viewport*,
regardless of where the viewport is. So panning out into the void and
firing MIDI events deposits fragments of subsequent photos — photo 1,
then 2, then 3 — in places the user has chosen by where they panned.
Photo 0 is the *home*; everywhere else is built by the interaction of
the user's exploration and the substrate's events.

This makes WASD navigation an act of composition rather than just
scrolling. Where you pan determines where future photos can be
discovered. Photo 0 remains anchored at the origin as a stable
reference; the rest of the visible image at any moment is a record of
where MIDI activity and exploration have coincided.

**Channel 16 inverts the viewport.** Independent of the photo
mechanics: any incoming MIDI note-on on channel 16 toggles a global
invert flag. When the flag is on, every painted cell value is rendered
inverted (grayscale `v` becomes `255 - v`; colors become their
complement). This is a viewport-level rendering effect, not a
modification of stored cell values — toggling it twice returns the
exact original state.

Channel 16 is the substrate's clock channel in the Rust app's default
config. Tying the inversion to it means the visual world *flips* in
time with the chain's master clock — a rhythmic, hard-edged
counterpoint to the slow pixel-by-pixel evolution of the photo
mechanics. The clock dying in the thermal phase (per the spec in the
Rust repo) means the inversion stops happening; the chain leaving the
crystal phase becomes visually legible.

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

### Photo cycling and startup

At startup, photo 0 is written into world state at its native
coordinates (cells `0..W, 0..H`). The viewport opens at (0, 0). This is
the *anchor*: photo 0 occupies a specific, stable region of the
infinite plane.

A single integer `nextPhotoIndex` is initialized to 1 (not 0 — photo 0
has already been "placed" by the anchor). On each MIDI hit:

1. Choose source = `photos[nextPhotoIndex]`.
2. Increment: `nextPhotoIndex = (nextPhotoIndex + 1) % photos.length`.

So the first MIDI hit reads from photo 1, the second from photo 2, and
so on. After the last photo, the cycle wraps back to photo 1 — photo 0
is *only* used to anchor; it does not re-enter the cycle. If
`wrapPhotos: false`, the cycle stops at the last photo and all
subsequent hits keep pulling from that one.

Cells written by MIDI hits or by mouse smearing overwrite whatever was
there — including parts of photo 0 inside its anchor footprint. The
anchor is a *starting condition*, not an invariant.

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
viewport — the viewport's current pan offset is the only thing that
determines where the region lands. The region's *contents* come from
the corresponding coordinates in the source photo. Because only photo 0
shares its native coordinates with the grid (cells `0..W`), photos 1+
are sampled at *the region's grid coordinates modulo the source photo's
dimensions* — i.e. each subsequent photo is conceptually tiled, and the
hit reads from `(gridX mod photoW, gridY mod photoH)`. Photo 0 is *not*
tiled; its contents only appear in its native footprint, set once at
startup and modified locally by later writes.

This means panning to (500, 500) and firing a MIDI hit reads from
photo 1 at coordinates `(500 mod W, 500 mod H)` — which is some
recognizable fragment of photo 1, just not the part you'd see at
(500, 500) if photo 1 were displayed in full. Across many hits in
varied viewport positions, all parts of all photos become reachable.

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

### Channel 16 invert

Any incoming MIDI note-on on channel 16 toggles a boolean
`invertedRef.current`. The toggle is debounced: only the rising edge of
a note-on event triggers a toggle, with a minimum interval of 50 ms
between toggles to ignore the spuriously-rapid duplicate hits some
controllers emit.

The invert flag does *not* modify world state. It's read by the
renderer each frame and applied at paint time. Cell value 200 renders
as `rgb(200, 200, 200)` when not inverted, `rgb(55, 55, 55)` when
inverted. For Color values, each channel is complemented independently:
`(r, g, b)` becomes `(255-r, 255-g, 255-b)`. For Tinted, the lightness
is inverted while the hue stays the same.

Channel 16's note number is ignored — any note-on on the channel
toggles. This means the substrate's clock pulses fire the toggle on
every magnetization zero-crossing.

### Rendering

The grid's `renderCell` callback reads from `worldState.get(cellKey(x, y))`:

- If present: paint the cell with the value according to its type,
  applying the current invert flag.
- If absent: leave the cell empty (transparent — the dark background
  shows through, matching the existing canvas behavior).

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

  // Invert
  invertChannel: number          // 0..15, channel that toggles invert. Default 15 (channel 16).
  invertDebounceMs: number       // minimum ms between toggles, default 50
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
   displays photo 0 at startup (within a second of load), with the
   photo's pixel (0, 0) at grid cell (0, 0). The viewport opens at the
   origin.
2. Panning with WASD into territory outside photo 0's footprint shows
   the dark canvas background. Photo 0 is not extended or tiled; it
   appears only in its native footprint.
3. Incoming MIDI note-ons trigger region swaps at random viewport
   positions. Low pitches produce large regions; high pitches produce
   small ones. Regions are drawn from `photos[1]` first, then `[2]`,
   etc., wrapping back to `photos[1]` after the last photo.
4. Each swap reveals its region pixel-by-pixel over approximately one
   second. Multiple swaps can overlap in time and space without visual
   glitches; later writes win on contested cells.
5. Mouse movement at typical speeds (~500 px/s) leaves a visible smear
   trail in the cell values it passes over. Stationary cursor produces
   no change. Very fast sweeps blur larger regions.
6. Note-on events on the configured invert channel (default channel 16)
   toggle a viewport-level invert. Toggling twice returns the visible
   image to its original colors exactly. Spurious rapid duplicate hits
   within the debounce window are ignored.
7. Switching the config's `valueType` to `Tinted` or `Color` and
   reloading produces the corresponding rendering with no other code
   changes (the value type is honored end-to-end). Invert works for
   all three value types.
8. With the debug HUD enabled, the current photo index, total photos
   loaded, pending update count, and invert state are visible.
9. The canvas grid, MIDI hook, and draggable card components are
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