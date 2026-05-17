import { useCallback, useEffect, useRef } from "react"
import type { FrameHook, UseParticlesResult } from "@/particles/engine"
import { STRIDE, F, type ParticleBuffer } from "@/particles/buffer"

export interface PulseConfig {
  decay?: number
  propagationSpeed?: number
  minCharge?: number
  /** Color at full charge [r, g, b] 0..255. Default white. */
  pulseColor?: [number, number, number]
  /** Color at zero charge [r, g, b] 0..255. Default dim grey. */
  baseColor?: [number, number, number]
  /** Multiplier applied to pulseColor for bright pulses. Default 2. */
  brightMultiplier?: number
  graphRebuildInterval?: number
  /** Distance threshold for neighbor links. Should match renderConfig.linkDistance. */
  linkDistance?: number
}

export interface UseParticlePulseResult {
  /** Fire a pulse at a specific alive-particle index (-1 = random). */
  fire: (particleIndex?: number, charge?: number, bright?: boolean) => void
  /** Fire pulses at N random particles. */
  fireRandom: (count?: number, charge?: number, bright?: boolean) => void
}

function buildNeighborGraph(
  buf: ParticleBuffer,
  alive: number[],
  linkDist: number,
): Map<number, number[]> {
  const neighbours = new Map<number, number[]>()
  for (const i of alive) neighbours.set(i, [])
  const d2max = linkDist * linkDist
  for (let ai = 0; ai < alive.length; ai++) {
    const i = alive[ai]
    const bi = i * STRIDE
    const xi = buf.data[bi + F.X]
    const yi = buf.data[bi + F.Y]
    for (let aj = ai + 1; aj < alive.length; aj++) {
      const j = alive[aj]
      const bj = j * STRIDE
      const dx = xi - buf.data[bj + F.X]
      const dy = yi - buf.data[bj + F.Y]
      if (dx * dx + dy * dy <= d2max) {
        neighbours.get(i)!.push(j)
        neighbours.get(j)!.push(i)
      }
    }
  }
  return neighbours
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
    linkDistance = 130,
  } = config

  // Normalize colors to 0..1 once
  const pulseR = pulseColor[0] / 255
  const pulseG = pulseColor[1] / 255
  const pulseB = pulseColor[2] / 255
  const baseR = baseColor[0] / 255
  const baseG = baseColor[1] / 255
  const baseB = baseColor[2] / 255

  const chargesRef = useRef<Float32Array>(new Float32Array(0))
  const brightFlagRef = useRef<Uint8Array>(new Uint8Array(0))
  const neighboursRef = useRef<Map<number, number[]>>(new Map())
  const frameCountRef = useRef(0)
  const particlesApiRef = useRef(particlesApi)
  useEffect(() => { particlesApiRef.current = particlesApi }, [particlesApi])

  const frameHook = useCallback<FrameHook>(({ buf, dt }) => {
    const capacity = buf.capacity

    if (chargesRef.current.length !== capacity) {
      chargesRef.current = new Float32Array(capacity)
      brightFlagRef.current = new Uint8Array(capacity)
    }

    // Collect alive indices
    const alive: number[] = []
    for (let i = 0; i < capacity; i++) {
      const b = i * STRIDE
      if (buf.data[b + F.AGE] < buf.data[b + F.LIFETIME]) alive.push(i)
    }
    if (alive.length === 0) return

    frameCountRef.current++
    if (
      frameCountRef.current % graphRebuildInterval === 0 ||
      neighboursRef.current.size !== alive.length
    ) {
      neighboursRef.current = buildNeighborGraph(buf, alive, linkDistance)
    }

    const charges = chargesRef.current
    const brights = brightFlagRef.current
    const nextCharges = new Float32Array(capacity)
    const nextBright = new Uint8Array(capacity)

    for (const i of alive) {
      const c = charges[i]
      if (c < minCharge) continue
      const nbrs = neighboursRef.current.get(i)
      if (nbrs) {
        for (const j of nbrs) {
          const transfer = c * propagationSpeed * dt
          nextCharges[j] = Math.min(1, nextCharges[j] + transfer)
          if (brights[i]) nextBright[j] = 1
        }
      }
      nextCharges[i] = Math.max(0, c - decay * dt)
      if (brights[i] && nextCharges[i] > minCharge) nextBright[i] = 1
    }

    chargesRef.current = nextCharges
    brightFlagRef.current = nextBright

    // Write color + charge into buffer
    for (const i of alive) {
      const b = i * STRIDE
      const c = nextCharges[i]
      buf.data[b + F.CHARGE] = c
      const m = nextBright[i] ? brightMultiplier : 1
      buf.data[b + F.R] = Math.min(1, (baseR + (pulseR - baseR) * c) * m)
      buf.data[b + F.G] = Math.min(1, (baseG + (pulseG - baseG) * c) * m)
      buf.data[b + F.B] = Math.min(1, (baseB + (pulseB - baseB) * c) * m)
    }
  }, [decay, propagationSpeed, minCharge, graphRebuildInterval, linkDistance,
    brightMultiplier, pulseR, pulseG, pulseB, baseR, baseG, baseB])

  useEffect(() => {
    if (!particlesApi?.ready) return
    return particlesApi.addFrameHook(frameHook)
  }, [particlesApi?.ready, particlesApi, frameHook])

  const fire = useCallback((particleIndex = -1, charge = 1.0, bright = false) => {
    const buf = particlesApiRef.current?.buf
    if (!buf) return
    const capacity = buf.capacity

    if (chargesRef.current.length !== capacity) {
      chargesRef.current = new Float32Array(capacity)
      brightFlagRef.current = new Uint8Array(capacity)
    }

    // Collect alive indices
    const alive: number[] = []
    for (let i = 0; i < capacity; i++) {
      const b = i * STRIDE
      if (buf.data[b + F.AGE] < buf.data[b + F.LIFETIME]) alive.push(i)
    }
    if (alive.length === 0) return

    const slot = particleIndex < 0
      ? alive[Math.floor(Math.random() * alive.length)]
      : alive[particleIndex % alive.length]

    chargesRef.current[slot] = Math.min(1, chargesRef.current[slot] + charge)
    if (bright) brightFlagRef.current[slot] = 1
  }, [])

  const fireRandom = useCallback((count = 1, charge = 1.0, bright = false) => {
    for (let i = 0; i < count; i++) fire(-1, charge, bright)
  }, [fire])

  return { fire, fireRandom }
}
