import { STRIDE, F } from "@/particles/buffer"
import type { FrameHook, UseParticlesResult } from "@/particles/engine"
import type { BackendEvent, Chain } from "@/backend/event-types"
import type { VisualMappingConfig } from "./config"
import { hslToRgb } from "./color"

export interface WallLifecycle {
  handleWallCreated(event: Extract<BackendEvent, { type: "wall_created" }>): void
  handleWallDestroyed(event: Extract<BackendEvent, { type: "wall_destroyed" }>): void
  handleWallMoved(event: Extract<BackendEvent, { type: "wall_moved" }>): void
  handleWallNoteOn(event: Extract<BackendEvent, { type: "wall_note_on" }>): void
  handleWallNoteOff(event: Extract<BackendEvent, { type: "wall_note_off" }>): void
  frameHook: FrameHook
}

export function createWallLifecycle(
  engine: UseParticlesResult,
  getConfig: () => VisualMappingConfig | null,
): WallLifecycle {
  const wallMap = new Map<number, number>()        // wallId -> particleIndex
  const wallTargets = new Map<number, number>()    // particleIndex -> targetX
  const wallCreatedAt = new Map<number, number>()  // particleIndex -> birth time (s)
  let trailTimer: ReturnType<typeof setTimeout> | undefined
  const { buf } = engine

  function wallX(chain: Chain, position: number): number {
    const cfg = getConfig()
    if (!cfg) return 0
    const zone = chain === "a" ? cfg.chainA.zones.walls : cfg.chainB.zones.walls
    return zone.x + position * zone.w
  }

  function wallY(chain: Chain): number {
    const cfg = getConfig()
    if (!cfg) return 0
    const zone = chain === "a" ? cfg.chainA.zones.walls : cfg.chainB.zones.walls
    return zone.y + zone.h * 0.5
  }

  function wallHue(chain: Chain): number {
    const cfg = getConfig()
    if (!cfg) return 30
    return chain === "a" ? cfg.chainA.hue + 20 : cfg.chainB.hue + 20
  }

  function handleWallCreated(event: Extract<BackendEvent, { type: "wall_created" }>): void {
    const { chain, id, position } = event
    const [r, g, b] = hslToRgb(wallHue(chain), 1.0, 0.7)
    const group = chain === "a" ? "chain_a_walls" : "chain_b_walls"
    const idx = engine.spawn(group, {
      x: wallX(chain, position),
      y: wallY(chain),
      r, g, b,
      opacity: 1.0,
      size: 6,
      lifetime: Infinity,
    })
    if (idx >= 0) {
      wallMap.set(id, idx)
      wallCreatedAt.set(idx, performance.now() / 1000)
    }
  }

  function handleWallDestroyed(event: Extract<BackendEvent, { type: "wall_destroyed" }>): void {
    const { chain, id } = event
    const idx = wallMap.get(id)
    if (idx === undefined) return
    const base = idx * STRIDE
    const x = buf.data[base + F.X]
    const y = buf.data[base + F.Y]
    const [r, g, b] = hslToRgb(wallHue(chain), 1.0, 0.85)
    const group = chain === "a" ? "chain_a_walls" : "chain_b_walls"

    // Annihilation heuristic: wall that lived < 0.2s bursts large
    const birthTime = wallCreatedAt.get(idx) ?? (performance.now() / 1000)
    const actualLifetime = performance.now() / 1000 - birthTime
    wallCreatedAt.delete(idx)

    if (actualLifetime < 0.2) {
      const [ar, ag, ab] = hslToRgb(wallHue(chain), 1.0, 0.92)
      engine.burst({ group, count: 20, x, y, speed: 120, r: ar, g: ag, b: ab, opacity: 1.0, size: 4, lifetime: 1.5 })
    } else {
      engine.burst({ group, count: 8, x, y, speed: 60, r, g, b, opacity: 1.0, size: 3, lifetime: 0.8 })
    }

    engine.kill(idx)
    wallMap.delete(id)
    wallTargets.delete(idx)
  }

  function handleWallMoved(event: Extract<BackendEvent, { type: "wall_moved" }>): void {
    const { chain, id, to } = event
    const idx = wallMap.get(id)
    if (idx === undefined) return
    wallTargets.set(idx, wallX(chain, to))

    // Comet trail: enable trail mode for 0.5s while wall is in motion
    engine.setRenderConfig({ trailMode: true, trailDecay: 0.08 })
    clearTimeout(trailTimer)
    trailTimer = setTimeout(() => {
      engine.setRenderConfig({ trailMode: false })
    }, 500)
  }

  function handleWallNoteOn(event: Extract<BackendEvent, { type: "wall_note_on" }>): void {
    const { chain, pitch, channel } = event
    handleWallCreated({ type: "wall_created", chain, id: pitch, position: pitch / 127, channel })
  }

  function handleWallNoteOff(event: Extract<BackendEvent, { type: "wall_note_off" }>): void {
    handleWallDestroyed({ type: "wall_destroyed", chain: event.chain, id: event.pitch, lastPosition: 0, lifetime: 0 })
  }

  const frameHook: FrameHook = ({ buf: b, dt }) => {
    for (const [particleIdx, targetX] of wallTargets) {
      const base = particleIdx * STRIDE
      if (b.data[base + F.AGE] >= b.data[base + F.LIFETIME]) {
        wallTargets.delete(particleIdx)
        continue
      }
      const curX = b.data[base + F.X]
      const newX = curX + (targetX - curX) * (1 - Math.exp(-5 * dt))
      b.data[base + F.X] = newX
      if (Math.abs(newX - targetX) < 0.5) {
        b.data[base + F.X] = targetX
        wallTargets.delete(particleIdx)
      }
    }
  }

  return {
    handleWallCreated,
    handleWallDestroyed,
    handleWallMoved,
    handleWallNoteOn,
    handleWallNoteOff,
    frameHook,
  }
}
