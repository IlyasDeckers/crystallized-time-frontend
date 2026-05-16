import { useCallback, useEffect, useRef } from "react"
import type { FrameHook, Particle, PJSInstance, UseParticlesResult } from "@/hooks/use-particles"

export interface PulseConfig {
  decay?: number
  propagationSpeed?: number
  minCharge?: number
  pulseColor?: [number, number, number]
  baseColor?: [number, number, number]
  graphRebuildInterval?: number
}

export interface UseParticlePulseResult {
  fire: (particleIndex?: number, charge?: number) => void
  fireRandom: (count?: number, charge?: number) => void
}

function lerpColor(
  base: [number, number, number],
  pulse: [number, number, number],
  t: number,
): { r: number; g: number; b: number } {
  return {
    r: Math.round(base[0] + (pulse[0] - base[0]) * t),
    g: Math.round(base[1] + (pulse[1] - base[1]) * t),
    b: Math.round(base[2] + (pulse[2] - base[2]) * t),
  }
}

// Only patch once per pJS instance
const patchedInstances = new WeakSet<PJSInstance>()

function patchLinkParticles(
  pjs: PJSInstance,
  getCharge: (i: number, j: number) => number,
  baseColor: [number, number, number],
  pulseColor: [number, number, number],
  minCharge: number,
) {
  if (patchedInstances.has(pjs)) return
  patchedInstances.add(pjs)

  // Stamp indices onto existing particles
  const array = pjs.particles.array
  for (let i = 0; i < array.length; i++) {
    (array[i] as Particle & { _idx: number })._idx = i
  }

  const original = (pjs.fn.interact as Record<string, unknown>)["linkParticles"] as (
    p1: Particle,
    p2: Particle,
  ) => void

  if (!original) return

    ;(pjs.fn.interact as Record<string, unknown>)["linkParticles"] = function (
    p1: Particle & { _idx?: number },
    p2: Particle & { _idx?: number },
  ) {
    const i = p1._idx ?? 0
    const j = p2._idx ?? 0
    const charge = getCharge(i, j)

    pjs.particles.line_linked.color_rgb_line =
      charge > minCharge
        ? lerpColor(baseColor, pulseColor, Math.min(charge, 1))
        : { r: baseColor[0], g: baseColor[1], b: baseColor[2] }

    original.call(pjs.fn.interact, p1, p2)
  }
}

export function useParticlePulse(
  particlesApi: UseParticlesResult | null,
  config: PulseConfig = {},
): UseParticlePulseResult {
  const {
    decay = 1.8,
    propagationSpeed = 2.5,
    minCharge = 0.05,
    pulseColor = [255, 255, 255],
    baseColor = [80, 80, 80],
    graphRebuildInterval = 30,
  } = config

  const chargesRef = useRef<Float32Array>(new Float32Array(0))
  const neighboursRef = useRef<number[][]>([])
  const frameCountRef = useRef(0)
  const patchedRef = useRef(false)

  const getCharge = useCallback((i: number, j: number): number => {
    return Math.max(chargesRef.current[i] ?? 0, chargesRef.current[j] ?? 0)
  }, [])

  const rebuildGraph = useCallback((particles: Particle[], dist: number) => {
    const n = particles.length
    const neighbours: number[][] = Array.from({ length: n }, () => [])
    const dist2 = dist * dist
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = particles[i].x - particles[j].x
        const dy = particles[i].y - particles[j].y
        if (dx * dx + dy * dy <= dist2) {
          neighbours[i].push(j)
          neighbours[j].push(i)
        }
      }
    }
    neighboursRef.current = neighbours
  }, [])

  const frameHook = useCallback<FrameHook>(({ particles, pjs, dt }) => {
    const n = particles.length
    if (n === 0) return

    // Resize charge buffer if particle count changed
    if (chargesRef.current.length !== n) {
      const next = new Float32Array(n)
      next.set(chargesRef.current.subarray(0, Math.min(n, chargesRef.current.length)))
      chargesRef.current = next
    }

    // Stamp indices on all particles (handles newly pushed ones too)
    for (let i = 0; i < n; i++) {
      (particles[i] as Particle & { _idx: number })._idx = i
    }

    // Patch linkParticles once we have a live pjs instance
    if (!patchedRef.current) {
      patchedRef.current = true
      patchLinkParticles(pjs, getCharge, baseColor, pulseColor, minCharge)
    }

    // Periodically rebuild adjacency graph
    frameCountRef.current++
    if (
      frameCountRef.current % graphRebuildInterval === 0 ||
      neighboursRef.current.length !== n
    ) {
      rebuildGraph(particles, pjs.particles.line_linked.distance)
    }

    const charges = chargesRef.current
    const neighbours = neighboursRef.current
    const next = new Float32Array(n)

    for (let i = 0; i < n; i++) {
      const c = charges[i]
      if (c < minCharge) continue

      const nbrs = neighbours[i]
      if (nbrs) {
        for (const j of nbrs) {
          next[j] = Math.min(1, next[j] + c * propagationSpeed * dt)
        }
      }
      next[i] = Math.max(0, c - decay * dt)
    }

    chargesRef.current = next
  }, [decay, propagationSpeed, minCharge, graphRebuildInterval, rebuildGraph, getCharge, baseColor, pulseColor])

  // Register frame hook eagerly as soon as particlesApi is ready
  useEffect(() => {
    if (!particlesApi?.ready) return
    const cleanup = particlesApi.addFrameHook(frameHook)
    return cleanup
  }, [particlesApi?.ready, particlesApi, frameHook])

  const fire = useCallback((particleIndex = -1, charge = 1.0) => {
    const n = particlesApi?.particles.length ?? 0
    if (n === 0) return
    if (chargesRef.current.length !== n) {
      chargesRef.current = new Float32Array(n)
    }
    const idx = particleIndex < 0 ? Math.floor(Math.random() * n) : particleIndex % n
    chargesRef.current[idx] = Math.min(1, chargesRef.current[idx] + charge)
  }, [particlesApi])

  const fireRandom = useCallback((count = 1, charge = 1.0) => {
    for (let i = 0; i < count; i++) fire(-1, charge)
  }, [fire])

  return { fire, fireRandom }
}