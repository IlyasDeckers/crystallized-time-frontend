import type { UseParticlesResult } from "@/particles/engine"
import type { BackendEvent } from "@/backend/event-types"
import { hslToRgb } from "./color"

export interface ClockPulse {
  handle(
    event: Extract<BackendEvent, { type: "clock_pulse" }>,
    canvasSize: { w: number; h: number },
  ): void
  isPaused(): boolean
}

export function createClockPulse(engine: UseParticlesResult): ClockPulse {
  let lastPulseTime = -999

  function handle(
    event: Extract<BackendEvent, { type: "clock_pulse" }>,
    canvasSize: { w: number; h: number },
  ): void {
    const { magnetization } = event
    const cx = canvasSize.w / 2
    const cy = canvasSize.h / 2
    const hue = magnetization >= 0 ? 30 : 210
    const [r, g, b] = hslToRgb(hue, 1.0, 0.65)
    const speed = 80 + Math.abs(magnetization) * 80

    engine.burst({
      group: "clock",
      count: 24,
      x: cx,
      y: cy,
      speed,
      r, g, b,
      opacity: 0.9,
      size: 3,
      lifetime: 1.2,
    })

    lastPulseTime = performance.now() / 1000
  }

  function isPaused(): boolean {
    return performance.now() / 1000 - lastPulseTime > 2
  }

  return { handle, isPaused }
}
