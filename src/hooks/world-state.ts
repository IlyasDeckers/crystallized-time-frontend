/**
 * Sparse 2D grid of cell values. Backed by a Map keyed by "x,y" strings to
 * match the existing cellKey convention used in the canvas grid.
 *
 * The grid is logically infinite; cells with no entry render as the
 * canvas background. Only cells written by the anchor photo, by MIDI
 * region hits, or by mouse smearing have entries.
 */

export type ValueType = "grayscale" | "tinted" | "color"

/** Grayscale cell: single byte 0..255. */
export type GrayscaleValue = number

/** Tinted cell: lightness byte + hue (degrees). */
export interface TintedValue {
  /** 0..255, used as HSL lightness. */
  v: number
  /** 0..360 hue in degrees. */
  h: number
}

/** RGB cell: three bytes. */
export interface ColorValue {
  r: number
  g: number
  b: number
}

export type CellValue = GrayscaleValue | TintedValue | ColorValue

export const cellKey = (x: number, y: number): string => `${x},${y}`

export class WorldState {
  private cells = new Map<string, CellValue>()

  get(x: number, y: number): CellValue | undefined {
    return this.cells.get(cellKey(x, y))
  }

  set(x: number, y: number, value: CellValue): void {
    this.cells.set(cellKey(x, y), value)
  }

  has(x: number, y: number): boolean {
    return this.cells.has(cellKey(x, y))
  }

  get size(): number {
    return this.cells.size
  }

  /** Clear all cells. Used only at restart in dev/StrictMode. */
  clear(): void {
    this.cells.clear()
  }
}

/**
 * Blend two cell values. `w` is the weight of `src` (0..1).
 * Returns a new value of the same shape.
 */
export function blend(
  dst: CellValue,
  src: CellValue,
  w: number,
  valueType: ValueType,
): CellValue {
  const inv = 1 - w
  if (valueType === "grayscale") {
    const d = dst as number
    const s = src as number
    return Math.round(d * inv + s * w)
  }
  if (valueType === "tinted") {
    const d = dst as TintedValue
    const s = src as TintedValue
    return {
      v: Math.round(d.v * inv + s.v * w),
      // Hue is photo-anchored; copying preserves the source's hue.
      h: s.h,
    }
  }
  const d = dst as ColorValue
  const s = src as ColorValue
  return {
    r: Math.round(d.r * inv + s.r * w),
    g: Math.round(d.g * inv + s.g * w),
    b: Math.round(d.b * inv + s.b * w),
  }
}