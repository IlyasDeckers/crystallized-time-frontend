import { blend, type ValueType, type WorldState } from "./world-state"

export interface SmearConfig {
  /** Radius around the cursor (in cells) within which cells smear. */
  smearRadius: number
  /** Offset distance (in cells) the smeared copy is placed ahead of the source. */
  smearLength: number
  /** Blend weight 0..1 of source onto destination. */
  smearStrength: number
  /** Minimum cursor speed (pixels/sec) below which smearing is suppressed. */
  minSmearSpeed: number
}

export interface CursorState {
  /** Cursor cell coordinate (fractional — center is fine). */
  gridX: number
  gridY: number
  /** Velocity in grid units per second. */
  vGridX: number
  vGridY: number
  /** Velocity magnitude in screen pixels per second (used for the speed gate). */
  speedPx: number
}

/**
 * One frame of mouse smearing.
 *
 * For each cell within `smearRadius` of the cursor, copy its value to
 * the neighbor offset by the cursor's velocity direction, scaled by
 * `smearLength`. The destination is a blend: `dst * (1 - w) + src * w`.
 *
 * NOTE on the offset: velocity in grid units/sec at typical cursor
 * speeds would offset by tens of cells, which produces unreadable
 * trails. The spec's intent ("fast sweeps produce visible streaks") is
 * better served by using the velocity *direction* and scaling by
 * `smearLength`, with the magnitude affecting smear frequency (i.e.
 * whether the gate fires) rather than offset distance.
 */
export function applySmear(
  world: WorldState,
  cursor: CursorState,
  config: SmearConfig,
  valueType: ValueType,
): void {
  if (cursor.speedPx < config.minSmearSpeed) return

  const len = Math.hypot(cursor.vGridX, cursor.vGridY)
  if (len === 0) return
  const dirX = cursor.vGridX / len
  const dirY = cursor.vGridY / len

  const cx = Math.round(cursor.gridX)
  const cy = Math.round(cursor.gridY)
  const r = Math.ceil(config.smearRadius)
  const r2 = config.smearRadius * config.smearRadius

  // Offset in cells. Round so we land on integer cells; if the offset
  // rounds to (0,0), there's nothing to do.
  const offX = Math.round(dirX * config.smearLength)
  const offY = Math.round(dirY * config.smearLength)
  if (offX === 0 && offY === 0) return

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue
      const sx = cx + dx
      const sy = cy + dy
      const src = world.get(sx, sy)
      if (src === undefined) continue
      const tx = sx + offX
      const ty = sy + offY
      const dst = world.get(tx, ty)
      // If destination is empty, the smear deposits the source value
      // directly (weight 1). Otherwise blend.
      const next = dst === undefined ? src : blend(dst, src, config.smearStrength, valueType)
      world.set(tx, ty, next)
    }
  }
}