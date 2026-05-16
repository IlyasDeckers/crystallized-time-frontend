import type { Point } from "@/hooks/use-particle-animator"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShapeParams {
  count: number
  viewport: { w: number; h: number }
  time: number
  /** Optional float32 data (photo luma, FFT, etc) normalised 0..1 */
  data?: Float32Array
}

export type ShapeProvider = (params: ShapeParams) => Point[]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cx = (vp: { w: number; h: number }) => vp.w / 2
const cy = (vp: { w: number; h: number }) => vp.h / 2

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Uniform random scatter — the default free state */
export const scatter: ShapeProvider = ({ count, viewport }) =>
  Array.from({ length: count }, () => ({
    x: Math.random() * viewport.w,
    y: Math.random() * viewport.h,
  }))

/** Perfect circle */
export const circle: ShapeProvider = ({ count, viewport }) => {
  const r = Math.min(viewport.w, viewport.h) * 0.35
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2
    return {
      x: cx(viewport) + Math.cos(angle) * r,
      y: cy(viewport) + Math.sin(angle) * r,
    }
  })
}

/** Spiral */
export const spiral: ShapeProvider = ({ count, viewport }) => {
  const maxR = Math.min(viewport.w, viewport.h) * 0.4
  return Array.from({ length: count }, (_, i) => {
    const t = i / count
    const angle = t * Math.PI * 8
    const r = t * maxR
    return {
      x: cx(viewport) + Math.cos(angle) * r,
      y: cy(viewport) + Math.sin(angle) * r,
    }
  })
}

/** Grid */
export const grid: ShapeProvider = ({ count, viewport }) => {
  const cols = Math.ceil(Math.sqrt(count * (viewport.w / viewport.h)))
  const rows = Math.ceil(count / cols)
  const spacingX = viewport.w * 0.8 / cols
  const spacingY = viewport.h * 0.8 / rows
  const offsetX = viewport.w * 0.1
  const offsetY = viewport.h * 0.1
  return Array.from({ length: count }, (_, i) => ({
    x: offsetX + (i % cols) * spacingX,
    y: offsetY + Math.floor(i / cols) * spacingY,
  }))
}

/** Horizontal line / waveform — data drives Y displacement */
export const waveform: ShapeProvider = ({ count, viewport, data }) => {
  const amplitude = viewport.h * 0.25
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    const sample = data ? data[Math.floor(t * data.length)] : 0
    return {
      x: viewport.w * 0.05 + t * viewport.w * 0.9,
      y: cy(viewport) + (sample * 2 - 1) * amplitude,
    }
  })
}

/** Ring of rings — nested concentric circles */
export const rings: ShapeProvider = ({ count, viewport }) => {
  const ringCount = 3
  const radii = [0.12, 0.24, 0.38].map(r => r * Math.min(viewport.w, viewport.h))
  const perRing = Math.floor(count / ringCount)
  const points: Point[] = []
  for (let r = 0; r < ringCount; r++) {
    const n = r === ringCount - 1 ? count - points.length : perRing
    for (let i = 0; i < n; i++) {
      const angle = (i / perRing) * Math.PI * 2
      points.push({
        x: cx(viewport) + Math.cos(angle) * radii[r],
        y: cy(viewport) + Math.sin(angle) * radii[r],
      })
    }
  }
  return points
}

/** Star polygon — nb_points controls spikiness */
export const star: ShapeProvider = ({ count, viewport }) => {
  const nbPoints = 5
  const outerR = Math.min(viewport.w, viewport.h) * 0.38
  const innerR = outerR * 0.45
  return Array.from({ length: count }, (_, i) => {
    const t = i / count
    const angle = t * Math.PI * 2
    // Alternate between outer and inner radii based on proximity to a point
    const sector = angle / (Math.PI / nbPoints)
    const frac = sector - Math.floor(sector)
    const r = frac < 0.5
      ? outerR - (outerR - innerR) * (frac * 2)
      : innerR + (outerR - innerR) * ((frac - 0.5) * 2)
    return {
      x: cx(viewport) + Math.cos(angle - Math.PI / 2) * r,
      y: cy(viewport) + Math.sin(angle - Math.PI / 2) * r,
    }
  })
}

/** Lissajous curve */
export const lissajous: ShapeProvider = ({ count, viewport, time = 0 }) => {
  const a = 3
  const b = 2
  const delta = time * 0.3
  const rX = viewport.w * 0.4
  const rY = viewport.h * 0.4
  return Array.from({ length: count }, (_, i) => {
    const t = (i / count) * Math.PI * 2
    return {
      x: cx(viewport) + Math.sin(a * t + delta) * rX,
      y: cy(viewport) + Math.sin(b * t) * rY,
    }
  })
}

/** Photo point cloud — samples luma from data, bright pixels become targets */
export const photoCloud: ShapeProvider = ({ count, viewport, data }) => {
  if (!data || data.length === 0) return scatter({ count, viewport, time: 0 })

  // data is expected to be row-major luma values, normalised 0..1
  // We treat it as a square for simplicity; caller can reshape
  const side = Math.sqrt(data.length)
  const points: Point[] = []
  const candidates: Point[] = []

  for (let i = 0; i < data.length; i++) {
    if (data[i] > 0.4) {
      const px = (i % side) / side
      const py = Math.floor(i / side) / side
      candidates.push({
        x: viewport.w * 0.1 + px * viewport.w * 0.8,
        y: viewport.h * 0.1 + py * viewport.h * 0.8,
      })
    }
  }

  if (candidates.length === 0) return scatter({ count, viewport, time: 0 })

  // Sample count points from candidates
  for (let i = 0; i < count; i++) {
    points.push(candidates[Math.floor(Math.random() * candidates.length)])
  }
  return points
}

// ---------------------------------------------------------------------------
// Registry — look up by name
// ---------------------------------------------------------------------------

export const SHAPES: Record<string, ShapeProvider> = {
  scatter,
  circle,
  spiral,
  grid,
  waveform,
  rings,
  star,
  lissajous,
  photoCloud,
}

export type ShapeName = keyof typeof SHAPES