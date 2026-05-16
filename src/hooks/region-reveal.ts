import type { PhotoData } from "./photo-loader"
import { samplePhoto } from "./photo-loader"
import type { CellValue, ValueType, WorldState } from "./world-state"

export interface Region {
  /** Top-left grid cell of the square region. */
  x: number
  y: number
  /** Side length in cells. */
  size: number
}

export interface PendingUpdate {
  cellX: number
  cellY: number
  value: CellValue
  /** performance.now() / 1000 — seconds. */
  revealAt: number
}

/**
 * Enumerate the cells in `region`, shuffle them, and schedule each on
 * `queue` spread evenly across `durationSecs` starting at `now`.
 *
 * Source values are read from `photo` with **tiling**: `(gridX mod W,
 * gridY mod H)`. This matches the spec — photos 1..N are conceptually
 * tiled across the infinite plane so a region read at any viewport
 * position lands on real pixels.
 *
 * For photo 0 (the anchor) tiling is *not* used; callers that anchor
 * photo 0 should write its native footprint directly rather than going
 * through this function.
 */
export function scheduleRegion(
  photo: PhotoData,
  region: Region,
  valueType: ValueType,
  durationSecs: number,
  queue: PendingUpdate[],
  now: number,
): void {
  const updates: PendingUpdate[] = []
  for (let dy = 0; dy < region.size; dy++) {
    for (let dx = 0; dx < region.size; dx++) {
      const gridX = region.x + dx
      const gridY = region.y + dy
      // Tile sample coordinates into the photo. Handles negative grid
      // coords correctly — `((a % n) + n) % n`.
      const sx = ((gridX % photo.width) + photo.width) % photo.width
      const sy = ((gridY % photo.height) + photo.height) % photo.height
      const value = samplePhoto(photo, sx, sy, valueType)
      if (value === undefined) continue
      updates.push({ cellX: gridX, cellY: gridY, value, revealAt: 0 })
    }
  }
  // Fisher-Yates shuffle.
  for (let i = updates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = updates[i]
    updates[i] = updates[j]
    updates[j] = tmp
  }
  const n = updates.length
  if (n === 0) return
  for (let i = 0; i < n; i++) {
    updates[i].revealAt = now + (i / n) * durationSecs
    queue.push(updates[i])
  }
}

/**
 * Apply every pending update whose `revealAt` has passed. Returns the
 * number of cells actually written so the caller can surface it in the
 * HUD.
 *
 * Overlap policy is implicit: writes from later events arrive later in
 * the queue, so they overwrite earlier values on the same cell. Within
 * a single drain pass, queue order is preserved (FIFO insertion).
 */
export function drainPending(
  world: WorldState,
  queue: PendingUpdate[],
  now: number,
): number {
  if (queue.length === 0) return 0
  // Partition in place: keep entries that aren't due yet.
  let written = 0
  let writeIdx = 0
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i]
    if (u.revealAt <= now) {
      world.set(u.cellX, u.cellY, u.value)
      written++
    } else {
      queue[writeIdx++] = u
    }
  }
  queue.length = writeIdx
  return written
}

/**
 * Map a MIDI pitch (0..127) to a region side length in cells.
 *
 * Low pitches → large regions, high pitches → small regions. Outside
 * the [lowNote, highNote] band, the size is clamped.
 */
export function regionSizeFromPitch(
  pitch: number,
  lowNote: number,
  highNote: number,
  minSize: number,
  maxSize: number,
): number {
  const range = highNote - lowNote
  if (range <= 0) return maxSize
  const t = (pitch - lowNote) / range // 0 at low, 1 at high
  const size = Math.round(maxSize - t * (maxSize - minSize))
  return Math.max(minSize, Math.min(maxSize, size))
}