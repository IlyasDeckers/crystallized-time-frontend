import { useEffect, useRef } from "react"
import type { UseParticlesResult } from "@/particles/engine"
import type { UseBackendBridgeResult } from "@/backend/bridge"
import { applyChainIdentity } from "./chain-identity"
import { makeConfig, type VisualMappingConfig } from "./config"
import { handleGatePulse } from "./gate-pulse"
import { createWallLifecycle } from "./wall-lifecycle"
import { createClockPulse } from "./clock-pulse"
import { createStateDriven } from "./state-driven"

export function useVisualMappings(
  engine: UseParticlesResult | null,
  bridge: UseBackendBridgeResult,
): void {
  const configRef = useRef<VisualMappingConfig | null>(null)

  // Recompute layout config whenever canvas dimensions change.
  useEffect(() => {
    if (!engine?.ready) return
    const { w, h } = engine.canvasSize
    if (w > 0 && h > 0) configRef.current = makeConfig(w, h)
  }, [engine?.ready, engine?.canvasSize.w, engine?.canvasSize.h])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!engine?.ready) return

    try { applyChainIdentity(engine) } catch { /* already registered in StrictMode */ }

    const wallLifecycle = createWallLifecycle(engine, () => configRef.current)
    const clockPulse = createClockPulse(engine)
    const stateDriven = createStateDriven(engine.canvasRef)

    const cleanWall  = engine.addFrameHook(wallLifecycle.frameHook)
    const cleanState = engine.addFrameHook(stateDriven.frameHook)

    const unsub = bridge.subscribe((event) => {
      const cfg = configRef.current
      // Lazily compute config if the canvas-size effect hasn't run yet.
      const resolvedCfg = cfg ?? (() => {
        const { w, h } = engine.canvasSize
        if (w === 0 || h === 0) return null
        const c = makeConfig(w, h)
        configRef.current = c
        return c
      })()
      if (!resolvedCfg) return

      switch (event.type) {
        case "gate":
          handleGatePulse(engine, resolvedCfg, event)
          break
        case "clock_pulse":
          clockPulse.handle(event, engine.canvasSize)
          break
        case "wall_created":
          wallLifecycle.handleWallCreated(event)
          break
        case "wall_destroyed":
          wallLifecycle.handleWallDestroyed(event)
          break
        case "wall_moved":
          wallLifecycle.handleWallMoved(event)
          break
        case "wall_note_on":
          wallLifecycle.handleWallNoteOn(event)
          break
        case "wall_note_off":
          wallLifecycle.handleWallNoteOff(event)
          break
        case "state":
          stateDriven.handle(event)
          break
      }
    })

    return () => {
      unsub()
      cleanWall()
      cleanState()
    }
  }, [engine?.ready])
}
