import type { RefObject } from "react"
import type { FrameHook } from "@/particles/engine"
import type { BackendEvent } from "@/backend/event-types"

export interface StateDriven {
  handle(event: Extract<BackendEvent, { type: "state" }>): void
  frameHook: FrameHook
}

export function createStateDriven(
  canvasRef: RefObject<HTMLCanvasElement | null>,
): StateDriven {
  const tint: [number, number, number] = [0, 0, 0]
  const target: [number, number, number] = [0, 0, 0]

  function handle(event: Extract<BackendEvent, { type: "state" }>): void {
    const m = Math.max(-1, Math.min(1, event.magnetization))
    if (m > 0.1) {
      const s = (m - 0.1) / 0.9
      target[0] = s * 0.04  // amber
      target[1] = s * 0.02
      target[2] = 0
    } else if (m < -0.1) {
      const s = (-m - 0.1) / 0.9
      target[0] = 0          // indigo
      target[1] = 0
      target[2] = s * 0.06
    } else {
      target[0] = 0
      target[1] = 0
      target[2] = 0
    }
  }

  const frameHook: FrameHook = ({ dt }) => {
    const t = 1 - Math.exp(-1.5 * dt)
    tint[0] += (target[0] - tint[0]) * t
    tint[1] += (target[1] - tint[1]) * t
    tint[2] += (target[2] - tint[2]) * t

    const canvas = canvasRef.current
    if (!canvas) return
    const r = Math.round(tint[0] * 255)
    const g = Math.round(tint[1] * 255)
    const b = Math.round(tint[2] * 255)
    canvas.style.backgroundColor = `rgb(${r},${g},${b})`
  }

  return { handle, frameHook }
}
