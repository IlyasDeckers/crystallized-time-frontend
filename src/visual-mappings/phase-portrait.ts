import type { UseParticlesResult } from "@/particles/engine"
import type { BackendEvent } from "@/backend/event-types"
import { hslToRgb } from "./color"

export interface PhasePortrait {
  handle(event: Extract<BackendEvent, { type: "state" }>): void
  setFullscreen(full: boolean): void
}

/**
 * Phase portrait: plots (magnetization_a, magnetization_b) as a 2D attractor.
 * Particles spawn at the mapped position and fade over 4s, accumulating density
 * over time to reveal attractor structure (locked cluster, thermal cloud, lobes).
 */
export function createPhasePortrait(engine: UseParticlesResult): PhasePortrait {
  const lastMag: { a: number | null; b: number | null } = { a: null, b: null }
  let fullscreen = false

  try {
    engine.groups.addGroup("phase_portrait", { maxParticles: 512 })
  } catch { /* already registered in StrictMode double-mount */ }

  function getZone(): { x: number; y: number; w: number; h: number } {
    const { w, h } = engine.canvasSize
    if (fullscreen) return { x: 0, y: 0, w, h }
    // Bottom-right PiP: 30% width × 30% height with small margin
    return { x: w * 0.70, y: h * 0.70, w: w * 0.28, h: h * 0.28 }
  }

  function handle(event: Extract<BackendEvent, { type: "state" }>): void {
    lastMag[event.chain] = event.magnetization
    const { a, b } = lastMag
    if (a === null || b === null) return

    const zone = getZone()
    // Magnetization [-1, 1] → zone coordinates
    const x = zone.x + ((a + 1) / 2) * zone.w
    const y = zone.y + ((b + 1) / 2) * zone.h

    const [r, g, bl] = hslToRgb(200, 0.85, 0.72)
    engine.burst({
      group: "phase_portrait",
      count: 1,
      x,
      y,
      speed: 0,
      r,
      g,
      b: bl,
      opacity: 0.6,
      size: 2,
      lifetime: 4.0,
    })
  }

  return {
    handle,
    setFullscreen: (full) => { fullscreen = full },
  }
}
