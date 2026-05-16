import { useCallback, useEffect, useRef } from "react"
import type { MidiMessage } from "@/hooks/use-midi"
import type { UseOscResult } from "@/hooks/use-osc"
import type { UseParticlesResult } from "@/hooks/use-particles"
import { useParticleAnimator } from "@/hooks/use-particle-animator"
import { useParticlePulse } from "@/hooks/use-particle-pulse"
import { SHAPES, type ShapeName } from "@/hooks/particle-shapes"

export interface ParticleEffectsConfig {
  noteShapeMap?: Record<number, ShapeName>
  speedCC?: number
  speedRange?: [number, number]
  linkDistanceCC?: number
  linkDistanceRange?: [number, number]
  oscPulseAddress?: string
  oscShapeAddress?: string
  oscScatterAddress?: string
  pulseChannel?: number
  pulseFanout?: number
  /**
   * Hard cap on particle count. Burst will never push beyond this.
   * Default 300.
   */
  maxParticles?: number
  /**
   * Which MIDI channel (0-indexed) triggers burst on noteOn.
   * Set to -1 to disable burst entirely. Default -1 (disabled).
   */
  burstChannel?: number
}

export function useParticleEffects(
  particlesApi: UseParticlesResult | null,
  osc: UseOscResult | null,
  config: ParticleEffectsConfig = {},
) {
  const {
    noteShapeMap = {
      60: "circle",
      62: "spiral",
      64: "grid",
      65: "rings",
      67: "star",
      69: "lissajous",
      71: "waveform",
      72: "scatter",
    },
    speedCC = 74,
    speedRange = [0.5, 8],
    linkDistanceCC = 71,
    linkDistanceRange = [60, 300],
    oscPulseAddress = "/pulse/fire",
    oscShapeAddress = "/shape/set",
    oscScatterAddress = "/scatter",
    pulseChannel = 15,
    pulseFanout = 1,
    maxParticles = 300,
    burstChannel = -1,
  } = config

  const animator = useParticleAnimator(particlesApi)
  const pulse = useParticlePulse(particlesApi)

  const particlesApiRef = useRef(particlesApi)
  const animatorRef = useRef(animator)
  const pulseRef = useRef(pulse)
  useEffect(() => { particlesApiRef.current = particlesApi }, [particlesApi])
  useEffect(() => { animatorRef.current = animator }, [animator])
  useEffect(() => { pulseRef.current = pulse }, [pulse])

  const canvasSizeRef = useRef({ w: 0, h: 0 })
  useEffect(() => {
    if (particlesApi?.ready) {
      canvasSizeRef.current = particlesApi.canvasSize
    }
  }, [particlesApi?.ready, particlesApi?.canvasSize])

  // -------------------------------------------------------------------------
  // applyShape
  // -------------------------------------------------------------------------
  const applyShape = useCallback((name: ShapeName, time = 0) => {
    const api = particlesApiRef.current
    if (!api?.ready) {
      console.warn("[particles] applyShape called before ready, shape:", name)
      return
    }
    const provider = SHAPES[name]
    if (!provider) {
      console.warn("[particles] unknown shape:", name)
      return
    }
    const targets = provider({
      count: api.particles.length,
      viewport: canvasSizeRef.current,
      time,
    })
    console.log("[particles] applyShape", name, "→", targets.length, "targets")
    animatorRef.current.setTargets(targets)
  }, [])

  // -------------------------------------------------------------------------
  // Safe burst — respects maxParticles cap
  // -------------------------------------------------------------------------
  const safeBurst = useCallback((n: number, x?: number, y?: number) => {
    const api = particlesApiRef.current
    if (!api?.ready) return
    const current = api.particles.length
    const allowed = Math.max(0, maxParticles - current)
    if (allowed === 0) return
    api.burst(Math.min(n, allowed), x, y)
  }, [maxParticles])

  // -------------------------------------------------------------------------
  // MIDI handler
  // -------------------------------------------------------------------------
  const handleMidi = useCallback((msg: MidiMessage) => {
    const api = particlesApiRef.current
    if (!api?.ready) return

    // Pulse channel
    if (msg.channel === pulseChannel && msg.type === "noteOn") {
      pulseRef.current.fireRandom(pulseFanout, msg.data2 / 127)
      return
    }

    if (msg.type === "noteOn") {
      // Shape trigger
      const shapeName = noteShapeMap[msg.data1]
      if (shapeName) {
        applyShape(shapeName)
        return
      }

      // Burst — only on the designated burst channel, and only if enabled
      if (burstChannel >= 0 && msg.channel === burstChannel) {
        const vp = canvasSizeRef.current
        safeBurst(
          Math.max(1, Math.round((msg.data2 / 127) * 4)),
          Math.random() * vp.w,
          Math.random() * vp.h,
        )
        return
      }

      // Everything else: just fire a pulse
      pulseRef.current.fire(-1, msg.data2 / 127)
      return
    }

    if (msg.type === "noteOff") {
      const shapeName = noteShapeMap[msg.data1]
      if (shapeName) animatorRef.current.setTargets(null)
      return
    }

    if (msg.type === "cc") {
      const t = msg.data2 / 127
      if (msg.data1 === speedCC) {
        api.setConfig({ speed: speedRange[0] + t * (speedRange[1] - speedRange[0]) })
      }
      if (msg.data1 === linkDistanceCC) {
        api.setConfig({
          linkedDistance:
            linkDistanceRange[0] + t * (linkDistanceRange[1] - linkDistanceRange[0]),
        })
      }
    }
  }, [
    pulseChannel,
    pulseFanout,
    noteShapeMap,
    speedCC,
    speedRange,
    linkDistanceCC,
    linkDistanceRange,
    burstChannel,
    applyShape,
    safeBurst,
  ])

  // -------------------------------------------------------------------------
  // OSC subscriptions
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!osc) return
    const unsubs: Array<() => void> = []

    unsubs.push(osc.subscribe(oscPulseAddress, (args) => {
      pulseRef.current.fireRandom(
        pulseFanout,
        typeof args[0] === "number" ? args[0] : 1.0,
      )
    }))

    unsubs.push(osc.subscribe(oscShapeAddress, (args) => {
      const name = args[0] as ShapeName
      if (SHAPES[name]) applyShape(name)
    }))

    unsubs.push(osc.subscribe(oscScatterAddress, () => {
      animatorRef.current.scatter()
    }))

    return () => unsubs.forEach(fn => fn())
  }, [osc, oscPulseAddress, oscShapeAddress, oscScatterAddress, applyShape, pulseFanout])

  return { handleMidi, applyShape, animator, pulse }
}