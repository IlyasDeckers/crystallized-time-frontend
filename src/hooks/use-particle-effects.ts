import { useCallback, useEffect, useRef } from "react"
import type { MidiMessage } from "@/hooks/use-midi"
import type { UseOscResult } from "@/hooks/use-osc"
import type { UseParticlesResult, FrameHook } from "@/particles/engine"
import { STRIDE, F } from "@/particles/buffer"
import { useParticleAnimator } from "@/hooks/use-particle-animator"
import { useParticlePulse } from "@/hooks/use-particle-pulse"
import { SHAPES, type ShapeName } from "@/hooks/particle-shapes"
import { type UseShapes3DResult, type Shape3DName, SHAPE_3D_NAMES } from "@/hooks/use-shapes3d"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParticleEffectsConfig {
  noteShapeMap?: Record<number, ShapeName>
  noteShape3DMap?: Record<number, Shape3DName>
  /** Channels (0-indexed) that trigger particle spawn. Empty = all, null = disabled. */
  spawnChannels?: number[] | null
  /** Channels (0-indexed) that trigger bright pulse. Empty = all, null = disabled. */
  pulseChannels?: number[] | null
  speedCC?: number
  speedRange?: [number, number]
  speedChannels?: number[] | null
  linkDistanceCC?: number
  linkDistanceRange?: [number, number]
  linkDistanceChannels?: number[] | null
  rotationSpeedCC?: number
  rotationSpeedChannels?: number[] | null
  oscPulseAddress?: string
  oscShapeAddress?: string
  oscShape3DAddress?: string
  oscScatterAddress?: string
  oscRotationImpulseAddress?: string
  pulseFanout?: number
  maxParticles?: number
  particleLifetime?: number
  fadeOutDuration?: number
}

function velocityToSpeed(midiVel: number, min = 0.3, max = 2.5): number {
  return min + (midiVel / 127) * (max - min)
}

const EMPTY_CHANNELS: number[] = []
const DEFAULT_PULSE_CHANNELS: number[] = [15]
const DEFAULT_NOTE_SHAPE_3D_MAP: Record<number, Shape3DName> = {
  60: "cube", 62: "sphere", 64: "torus", 65: "icosphere",
  67: "helix", 69: "trefoil", 71: "mobius", 72: "klein", 74: "octahedron",
}
const DEFAULT_SPEED_RANGE: [number, number] = [0.5, 8]
const DEFAULT_LINK_RANGE: [number, number] = [60, 300]

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useParticleEffects(
  particlesApi: UseParticlesResult | null,
  osc: UseOscResult | null,
  shapes3d: UseShapes3DResult | null,
  config: ParticleEffectsConfig = {},
) {
  const {
    noteShapeMap = {},
    noteShape3DMap = DEFAULT_NOTE_SHAPE_3D_MAP,
    spawnChannels = EMPTY_CHANNELS,
    pulseChannels = DEFAULT_PULSE_CHANNELS,
    speedCC = 74,
    speedRange = DEFAULT_SPEED_RANGE,
    speedChannels = EMPTY_CHANNELS,
    linkDistanceCC = 71,
    linkDistanceRange = DEFAULT_LINK_RANGE,
    linkDistanceChannels = EMPTY_CHANNELS,
    rotationSpeedCC = 1,
    rotationSpeedChannels = EMPTY_CHANNELS,
    oscPulseAddress = "/pulse/fire",
    oscShapeAddress = "/shape/set",
    oscShape3DAddress = "/shape3d/set",
    oscScatterAddress = "/scatter",
    oscRotationImpulseAddress = "/rotation/impulse",
    pulseFanout = 1,
    maxParticles = 400,
    particleLifetime = 10,
    fadeOutDuration = 2,
  } = config

  const animator = useParticleAnimator(particlesApi)
  const pulse = useParticlePulse(particlesApi)

  const particlesApiRef = useRef(particlesApi)
  const animatorRef = useRef(animator)
  const pulseRef = useRef(pulse)
  const shapes3dRef = useRef(shapes3d)
  useEffect(() => { particlesApiRef.current = particlesApi }, [particlesApi])
  useEffect(() => { animatorRef.current = animator }, [animator])
  useEffect(() => { pulseRef.current = pulse }, [pulse])
  useEffect(() => { shapes3dRef.current = shapes3d }, [shapes3d])

  const canvasSizeRef = useRef({ w: 0, h: 0 })
  useEffect(() => {
    if (particlesApi?.ready) canvasSizeRef.current = particlesApi.canvasSize
  }, [particlesApi?.ready, particlesApi?.canvasSize])

  // -------------------------------------------------------------------------
  // Group setup for spawned particles
  // -------------------------------------------------------------------------
  useEffect(() => {
    const api = particlesApiRef.current
    if (!api?.ready) return
    try {
      api.groups.addGroup("spawned", { maxParticles })
    } catch {
      // group may already exist on hot-reload
    }
    return () => {
      particlesApiRef.current?.groups.removeGroup("spawned")
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [particlesApi?.ready, maxParticles])

  // -------------------------------------------------------------------------
  // Fade-out hook — lerps opacity to 0 as particles near end of life
  // -------------------------------------------------------------------------
  const fadeHook = useCallback<FrameHook>(({ buf }) => {
    for (let i = 0; i < buf.capacity; i++) {
      const b = i * STRIDE
      const age = buf.data[b + F.AGE]
      const lifetime = buf.data[b + F.LIFETIME]
      if (age < lifetime && lifetime !== Infinity) {
        const remaining = lifetime - age
        if (remaining < fadeOutDuration) {
          buf.data[b + F.OPACITY] = 0.7 * (remaining / fadeOutDuration)
        }
      }
    }
  }, [fadeOutDuration])

  useEffect(() => {
    if (!particlesApi?.ready) return
    return particlesApi.addFrameHook(fadeHook)
  }, [particlesApi?.ready, particlesApi, fadeHook])

  // Time ref kept in sync by a lightweight hook
  const timeRef = useRef(0)
  const timeHook = useCallback<FrameHook>(({ time }) => { timeRef.current = time }, [])
  useEffect(() => {
    if (!particlesApi?.ready) return
    return particlesApi.addFrameHook(timeHook)
  }, [particlesApi?.ready, particlesApi, timeHook])

  // -------------------------------------------------------------------------
  // Spawn particle
  // -------------------------------------------------------------------------
  const spawnParticle = useCallback((midiVelocity: number) => {
    const api = particlesApiRef.current
    if (!api?.ready) return
    const vp = canvasSizeRef.current
    const x = vp.w * 0.05 + Math.random() * vp.w * 0.9
    const y = vp.h * 0.05 + Math.random() * vp.h * 0.9
    api.burst({
      group: "spawned",
      count: 1,
      x, y,
      speed: velocityToSpeed(midiVelocity),
      opacity: 0.7,
      size: 2.5,
      lifetime: particleLifetime,
    })
  }, [particleLifetime])

  // -------------------------------------------------------------------------
  // Count alive particles (used for shape target generation)
  // -------------------------------------------------------------------------
  function countAlive(api: UseParticlesResult): number {
    let n = 0
    const { buf } = api
    for (let i = 0; i < buf.capacity; i++) {
      const b = i * STRIDE
      if (buf.data[b + F.AGE] < buf.data[b + F.LIFETIME]) n++
    }
    return n
  }

  // -------------------------------------------------------------------------
  // applyShape (2D)
  // -------------------------------------------------------------------------
  const applyShape = useCallback((name: ShapeName, time = 0) => {
    const api = particlesApiRef.current
    if (!api?.ready) return
    const provider = SHAPES[name]
    if (!provider) return
    const count = countAlive(api)
    const targets = provider({
      count,
      viewport: canvasSizeRef.current,
      time,
    })
    animatorRef.current.setTargets(targets)
  }, [])

  // -------------------------------------------------------------------------
  // applyShape3D
  // -------------------------------------------------------------------------
  const applyShape3D = useCallback((name: Shape3DName) => {
    const api = particlesApiRef.current
    const s3d = shapes3dRef.current
    if (!api?.ready || !s3d) return
    const count = countAlive(api)
    const provider = s3d.getProvider(name)
    const targets = provider({
      count,
      viewport: canvasSizeRef.current,
      time: timeRef.current,
    })
    console.log("[particles] applyShape3D", name, "->", targets.length, "targets")
    animatorRef.current.setTargets(targets)
  }, [])

  // -------------------------------------------------------------------------
  // MIDI handler
  // -------------------------------------------------------------------------
  const handleMidi = useCallback((msg: MidiMessage) => {
    const api = particlesApiRef.current
    if (!api?.ready) return

    if (msg.type === "noteOn") {
      const inSpawn = spawnChannels !== null && (spawnChannels.length === 0 || spawnChannels.includes(msg.channel))
      if (inSpawn) spawnParticle(msg.data2)

      const inPulse = pulseChannels !== null && (pulseChannels.length === 0 || pulseChannels.includes(msg.channel))
      if (inPulse) {
        pulseRef.current.fireRandom(pulseFanout, Math.max(0.8, msg.data2 / 127), true)
        return
      }

      const shape3DName = noteShape3DMap[msg.data1]
      if (shape3DName) {
        applyShape3D(shape3DName)
        shapes3dRef.current?.impulse(
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.2,
        )
        return
      }

      const shapeName = noteShapeMap[msg.data1]
      if (shapeName) {
        applyShape(shapeName)
        return
      }

      pulseRef.current.fire(-1, (msg.data2 / 127) * 0.4)
      return
    }

    if (msg.type === "noteOff") {
      if (noteShape3DMap[msg.data1] || noteShapeMap[msg.data1]) {
        animatorRef.current.setTargets(null)
      }
      return
    }

    if (msg.type === "cc") {
      const t = msg.data2 / 127
      const inSpeedCh = speedChannels !== null && (speedChannels.length === 0 || speedChannels.includes(msg.channel))
      if (msg.data1 === speedCC && inSpeedCh) {
        const targetSpeed = speedRange[0] + t * (speedRange[1] - speedRange[0])
        const buf = api.buf
        for (let i = 0; i < buf.capacity; i++) {
          const b = i * STRIDE
          if (buf.data[b + F.AGE] < buf.data[b + F.LIFETIME]) {
            const vx = buf.data[b + F.VX]
            const vy = buf.data[b + F.VY]
            const spd = Math.sqrt(vx * vx + vy * vy)
            if (spd > 0.001) {
              buf.data[b + F.VX] = (vx / spd) * targetSpeed
              buf.data[b + F.VY] = (vy / spd) * targetSpeed
            }
          }
        }
      }
      const inLinkCh = linkDistanceChannels !== null && (linkDistanceChannels.length === 0 || linkDistanceChannels.includes(msg.channel))
      if (msg.data1 === linkDistanceCC && inLinkCh) {
        api.setRenderConfig({
          linkDistance: linkDistanceRange[0] + t * (linkDistanceRange[1] - linkDistanceRange[0]),
        })
      }
      const inRotCh = rotationSpeedChannels !== null && (rotationSpeedChannels.length === 0 || rotationSpeedChannels.includes(msg.channel))
      if (msg.data1 === rotationSpeedCC && inRotCh) {
        shapes3dRef.current?.setRotationSpeed(0.15, t * 2, 0.06)
      }
    }
  }, [
    spawnChannels, pulseChannels, pulseFanout, noteShape3DMap, noteShapeMap,
    speedCC, speedChannels, speedRange,
    linkDistanceCC, linkDistanceChannels, linkDistanceRange,
    rotationSpeedCC, rotationSpeedChannels,
    applyShape, applyShape3D, spawnParticle,
  ])

  // -------------------------------------------------------------------------
  // OSC subscriptions
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!osc) return
    const unsubs: Array<() => void> = []

    unsubs.push(osc.subscribe(oscPulseAddress, (args) => {
      pulseRef.current.fireRandom(pulseFanout, typeof args[0] === "number" ? args[0] : 1.0, false)
    }))

    unsubs.push(osc.subscribe(oscShapeAddress, (args) => {
      const name = args[0] as ShapeName
      if (SHAPES[name]) applyShape(name)
    }))

    unsubs.push(osc.subscribe(oscShape3DAddress, (args) => {
      const name = args[0] as Shape3DName
      if (SHAPE_3D_NAMES.includes(name)) applyShape3D(name)
    }))

    unsubs.push(osc.subscribe(oscScatterAddress, () => {
      animatorRef.current.scatter()
    }))

    unsubs.push(osc.subscribe(oscRotationImpulseAddress, (args) => {
      const dvx = typeof args[0] === "number" ? args[0] : 0
      const dvy = typeof args[1] === "number" ? args[1] : 0
      const dvz = typeof args[2] === "number" ? args[2] : 0
      shapes3dRef.current?.impulse(dvx, dvy, dvz)
    }))

    return () => unsubs.forEach(fn => fn())
  }, [osc, oscPulseAddress, oscShapeAddress, oscShape3DAddress, oscScatterAddress,
    oscRotationImpulseAddress, applyShape, applyShape3D, pulseFanout])

  return { handleMidi, applyShape, applyShape3D, animator, pulse }
}
