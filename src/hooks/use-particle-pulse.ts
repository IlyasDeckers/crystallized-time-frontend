import { useCallback, useEffect, useRef } from "react"
import type { FrameHook, Particle, PJSInstance, UseParticlesResult } from "@/hooks/use-particles"

export interface PulseConfig {
  decay?: number
  propagationSpeed?: number
  minCharge?: number
  /** Color at full charge [r, g, b]. Default white. */
  pulseColor?: [number, number, number]
  /** Color at zero charge [r, g, b]. Default dim grey. */
  baseColor?: [number, number, number]
  /**
   * Multiplier applied to pulseColor for bright pulses (e.g. ch 16).
   * Values > 1 push toward pure white. Default 1.
   * Pass values like 1.5–2.0 for the bright channel.
   */
  brightMultiplier?: number
  graphRebuildInterval?: number
}

export interface UseParticlePulseResult {
  /** Fire a pulse at a specific particle index. Pass -1 for random. */
  fire: (particleIndex?: number, charge?: number, bright?: boolean) => void
  /** Fire pulses at N random particles. */
  fireRandom: (count?: number, charge?: number, bright?: boolean) => void
}

function lerpColor(
  base: [number, number, number],
  pulse: [number, number, number],
  t: number,
  brightMultiplier = 1,
): { r: number; g: number; b: number } {
  const m = brightMultiplier
  return {
    r: Math.min(255, Math.round((base[0] + (pulse[0] - base[0]) * t) * m)),
    g: Math.min(255, Math.round((base[1] + (pulse[1] - base[1]) * t) * m)),
    b: Math.min(255, Math.round((base[2] + (pulse[2] - base[2]) * t) * m)),
  }
}

const patchedInstances = new WeakSet<PJSInstance>()

function patchLinkParticles(
  pjs: PJSInstance,
  getCharge: (i: number, j: number) => { charge: number; bright: boolean },
  baseColor: [number, number, number],
  pulseColor: [number, number, number],
  minCharge: number,
  brightMultiplier: number,
) {
  if (patchedInstances.has(pjs)) return
  patchedInstances.add(pjs)

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
    const { charge, bright } = getCharge(i, j)

    pjs.particles.line_linked.color_rgb_line =
      charge > minCharge
        ? lerpColor(baseColor, pulseColor, Math.min(charge, 1), bright ? brightMultiplier : 1)
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
    brightMultiplier = 2.0,
    graphRebuildInterval = 30,
  } = config

  const chargesRef = useRef<Float32Array>(new Float32Array(0))
  // Track whether each particle's charge came from a bright source
  const brightRef = useRef<Uint8Array>(new Uint8Array(0))
  const neighboursRef = useRef<number[][]>([])
  const frameCountRef = useRef(0)
  const patchedRef = useRef(false)

  const getCharge = useCallback((i: number, j: number) => {
    const ci = chargesRef.current[i] ?? 0
    const cj = chargesRef.current[j] ?? 0
    const charge = Math.max(ci, cj)
    const bright = !!(brightRef.current[i] || brightRef.current[j])
    return { charge, bright }
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

    // Resize buffers if particle count changed
    if (chargesRef.current.length !== n) {
      const newCharges = new Float32Array(n)
      newCharges.set(chargesRef.current.subarray(0, Math.min(n, chargesRef.current.length)))
      chargesRef.current = newCharges

      const newBright = new Uint8Array(n)
      newBright.set(brightRef.current.subarray(0, Math.min(n, brightRef.current.length)))
      brightRef.current = newBright
    }

    // Stamp indices
    for (let i = 0; i < n; i++) {
      (particles[i] as Particle & { _idx: number })._idx = i
    }

    if (!patchedRef.current) {
      patchedRef.current = true
      patchLinkParticles(pjs, getCharge, baseColor, pulseColor, minCharge, brightMultiplier)
    }

    frameCountRef.current++
    if (
      frameCountRef.current % graphRebuildInterval === 0 ||
      neighboursRef.current.length !== n
    ) {
      rebuildGraph(particles, pjs.particles.line_linked.distance)
    }

    const charges = chargesRef.current
    const brights = brightRef.current
    const neighbours = neighboursRef.current
    const nextCharges = new Float32Array(n)
    const nextBright = new Uint8Array(n)

    for (let i = 0; i < n; i++) {
      const c = charges[i]
      if (c < minCharge) continue

      const nbrs = neighbours[i]
      if (nbrs) {
        for (const j of nbrs) {
          const transfer = c * propagationSpeed * dt
          nextCharges[j] = Math.min(1, nextCharges[j] + transfer)
          // Propagate bright flag alongside charge
          if (brights[i]) nextBright[j] = 1
        }
      }
      nextCharges[i] = Math.max(0, c - decay * dt)
      if (brights[i] && nextCharges[i] > minCharge) nextBright[i] = 1
    }

    chargesRef.current = nextCharges
    brightRef.current = nextBright
  }, [decay, propagationSpeed, minCharge, graphRebuildInterval, rebuildGraph, getCharge, baseColor, pulseColor, brightMultiplier])

  useEffect(() => {
    if (!particlesApi?.ready) return
    return particlesApi.addFrameHook(frameHook)
  }, [particlesApi?.ready, particlesApi, frameHook])

  const fire = useCallback((particleIndex = -1, charge = 1.0, bright = false) => {
    const n = particlesApi?.particles.length ?? 0
    if (n === 0) return
    if (chargesRef.current.length !== n) {
      chargesRef.current = new Float32Array(n)
      brightRef.current = new Uint8Array(n)
    }
    const idx = particleIndex < 0 ? Math.floor(Math.random() * n) : particleIndex % n
    chargesRef.current[idx] = Math.min(1, chargesRef.current[idx] + charge)
    if (bright) brightRef.current[idx] = 1
  }, [particlesApi])

  const fireRandom = useCallback((count = 1, charge = 1.0, bright = false) => {
    for (let i = 0; i < count; i++) fire(-1, charge, bright)
  }, [fire])

  return { fire, fireRandom }
}