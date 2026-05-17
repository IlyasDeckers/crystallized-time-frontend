import { useCallback, useEffect, useRef } from "react"
import type { MidiMessage } from "@/hooks/use-midi"
import type { UseOscResult } from "@/hooks/use-osc"
import type { UseParticlesResult, FrameHook } from "@/particles/engine"
import type { UseShapes3DResult, Shape3DName } from "@/hooks/use-shapes3d"
import { STRIDE, F } from "@/particles/buffer"
import { useParticleAnimator } from "@/hooks/use-particle-animator"
import { useParticlePulse } from "@/hooks/use-particle-pulse"
import { SHAPES, type ShapeName } from "@/hooks/particle-shapes"
import { SHAPE_3D_NAMES } from "@/hooks/use-shapes3d"
import { MidiRouter } from "./router"
import type { MidiAction, MidiRoute } from "./router"
import { applyCC, lookupCC } from "./cc-registry"
import type { MidiSettings } from "@/components/ui/midi-settings-card"
import { paramStore, isParamKey } from "@/particles/param-store"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_NOTE_SHAPE_3D_MAP: Record<number, Shape3DName> = {
  60: "cube",  62: "sphere",    64: "torus",      65: "icosphere",
  67: "helix", 69: "trefoil",   71: "mobius",     72: "klein",      74: "octahedron",
}

// ---------------------------------------------------------------------------
// Route generation
// ---------------------------------------------------------------------------

export function buildRoutes(settings: MidiSettings): MidiRoute[] {
  const routes: MidiRoute[] = []

  // CC effects — checked first since they apply to cc messages
  if (settings.speedChannels !== null) {
    routes.push({
      msgType: "cc",
      ccNumber: settings.speedCC,
      ...(settings.speedChannels.length > 0 && { channel: settings.speedChannels }),
      action: { type: "set_param", param: "speed" },
    })
  }

  if (settings.linkDistanceChannels !== null) {
    routes.push({
      msgType: "cc",
      ccNumber: settings.linkDistanceCC,
      ...(settings.linkDistanceChannels.length > 0 && { channel: settings.linkDistanceChannels }),
      action: { type: "set_param", param: "linkDistance" },
    })
  }

  if (settings.rotationSpeedChannels !== null) {
    routes.push({
      msgType: "cc",
      ccNumber: settings.rotationSpeedCC,
      ...(settings.rotationSpeedChannels.length > 0 && { channel: settings.rotationSpeedChannels }),
      action: { type: "set_param", param: "rotationY" },
    })
  }

  // Catch-all CC: any CC registered in cc-registry → paramStore (no channel filter)
  routes.push({ msgType: "cc", action: { type: "set_param", param: "" } })

  // Note-off: release targets for mapped 3D shape notes
  for (const note of Object.keys(DEFAULT_NOTE_SHAPE_3D_MAP).map(Number)) {
    routes.push({
      msgType: "noteOff",
      noteRange: [note, note],
      action: { type: "release_targets" },
    })
  }

  // Bright pulse on designated channels — checked before shape notes so
  // pulse channels never trigger shape changes
  if (settings.pulseChannels !== null) {
    routes.push({
      msgType: "noteOn",
      ...(settings.pulseChannels.length > 0 && { channel: settings.pulseChannels }),
      action: { type: "pulse", bright: true, fanout: 1 },
    })
  }

  // 3D shape notes (noteOn on non-pulse channels)
  for (const [note, shape] of Object.entries(DEFAULT_NOTE_SHAPE_3D_MAP)) {
    routes.push({
      msgType: "noteOn",
      noteRange: [Number(note), Number(note)],
      action: { type: "apply_shape3d", shape },
    })
  }

  // Dim pulse catch-all for any remaining noteOn
  routes.push({
    msgType: "noteOn",
    action: { type: "pulse", bright: false, fanout: 1 },
  })

  return routes
}

// ---------------------------------------------------------------------------
// Hook config
// ---------------------------------------------------------------------------

export interface MidiRouterOptions {
  pulseFanout?: number
  maxParticles?: number
  particleLifetime?: number
  fadeOutDuration?: number
}

export interface UseMidiRouterResult {
  handleMidi: (msg: MidiMessage) => void
  applyShape: (name: ShapeName, time?: number) => void
  applyShape3D: (name: Shape3DName) => void
  animator: ReturnType<typeof useParticleAnimator>
  pulse: ReturnType<typeof useParticlePulse>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMidiRouter(
  particlesApi: UseParticlesResult | null,
  osc: UseOscResult | null,
  shapes3d: UseShapes3DResult | null,
  settings: MidiSettings,
  options: MidiRouterOptions = {},
): UseMidiRouterResult {
  const {
    pulseFanout = 1,
    maxParticles = 400,
    particleLifetime = 10,
    fadeOutDuration = 2,
  } = options

  const animator = useParticleAnimator(particlesApi)
  const pulse = useParticlePulse(particlesApi)

  const particlesApiRef = useRef(particlesApi)
  const animatorRef = useRef(animator)
  const pulseRef = useRef(pulse)
  const shapes3dRef = useRef(shapes3d)
  const settingsRef = useRef(settings)
  useEffect(() => { particlesApiRef.current = particlesApi }, [particlesApi])
  useEffect(() => { animatorRef.current = animator }, [animator])
  useEffect(() => { pulseRef.current = pulse }, [pulse])
  useEffect(() => { shapes3dRef.current = shapes3d }, [shapes3d])
  useEffect(() => { settingsRef.current = settings }, [settings])

  const canvasSizeRef = useRef({ w: 0, h: 0 })
  useEffect(() => {
    if (particlesApi?.ready) canvasSizeRef.current = particlesApi.canvasSize
  }, [particlesApi?.ready, particlesApi?.canvasSize])

  // Router instance, updated whenever settings change
  const routerRef = useRef<MidiRouter>(new MidiRouter({ routes: buildRoutes(settings) }))
  useEffect(() => {
    routerRef.current.updateConfig({ routes: buildRoutes(settings) })
  }, [settings])

  // -------------------------------------------------------------------------
  // Spawned particle group
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
  // Fade-out frame hook
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
  // Count alive particles
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
    const targets = provider({ count, viewport: canvasSizeRef.current, time })
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
    const targets = provider({ count, viewport: canvasSizeRef.current, time: timeRef.current })
    animatorRef.current.setTargets(targets)
  }, [])

  // -------------------------------------------------------------------------
  // spawnParticle
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
      speed: 30 + (midiVelocity / 127) * 120,
      spread: 5,
      opacity: 0.7,
      size: 3.5,
      lifetime: particleLifetime,
    })
  }, [particleLifetime])

  // -------------------------------------------------------------------------
  // applyParam — routes named parameter + scaled value through param store
  // -------------------------------------------------------------------------
  const applyParam = useCallback((param: string, ccNumber: number, rawValue: number) => {
    const key = (param || lookupCC(ccNumber)?.param) ?? ""
    if (!isParamKey(key)) return
    const scaled = applyCC(ccNumber, rawValue)
    const reg = lookupCC(ccNumber)
    if (reg?.smoothFrames && reg.smoothFrames > 0) {
      paramStore.setLerp(key, scaled, reg.smoothFrames)
    } else {
      paramStore.set(key, scaled)
    }
  }, [])

  // -------------------------------------------------------------------------
  // Dispatch a MidiAction
  // -------------------------------------------------------------------------
  const dispatch = useCallback((action: MidiAction, msg: MidiMessage) => {
    switch (action.type) {
      case "apply_shape3d": {
        applyShape3D(action.shape as Shape3DName)
        shapes3dRef.current?.impulse(
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.2,
        )
        break
      }
      case "apply_shape":
        applyShape(action.shape as ShapeName)
        break
      case "pulse":
        if (action.bright) {
          pulseRef.current.fireRandom(
            action.fanout * pulseFanout,
            Math.max(0.8, msg.data2 / 127),
            true,
          )
        } else {
          pulseRef.current.fire(-1, (msg.data2 / 127) * 0.4)
        }
        break
      case "set_param":
        applyParam(action.param, msg.data1, msg.data2)
        break
      case "scatter":
        animatorRef.current.scatter()
        break
      case "release_targets":
        animatorRef.current.setTargets(null)
        break
    }
  }, [applyShape3D, applyShape, applyParam, pulseFanout])


  // -------------------------------------------------------------------------
  // MIDI message handler
  // -------------------------------------------------------------------------
  const handleMidi = useCallback((msg: MidiMessage) => {
    const api = particlesApiRef.current
    if (!api?.ready) return

    // Spawn runs independently — can combine with any other effect
    if (msg.type === "noteOn") {
      const { spawnChannels } = settingsRef.current
      if (spawnChannels !== null && (spawnChannels.length === 0 || spawnChannels.includes(msg.channel))) {
        spawnParticle(msg.data2)
      }
    }

    const action = routerRef.current.route(msg)
    if (action) dispatch(action, msg)
  }, [spawnParticle, dispatch])

  // -------------------------------------------------------------------------
  // OSC subscriptions (direct particle commands)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!osc) return
    const unsubs: Array<() => void> = []

    unsubs.push(osc.subscribe("/pulse/fire", (args) => {
      pulseRef.current.fireRandom(pulseFanout, typeof args[0] === "number" ? args[0] : 1.0, false)
    }))

    unsubs.push(osc.subscribe("/shape/set", (args) => {
      const name = args[0] as ShapeName
      if (SHAPES[name]) applyShape(name)
    }))

    unsubs.push(osc.subscribe("/shape3d/set", (args) => {
      const name = args[0] as Shape3DName
      if (SHAPE_3D_NAMES.includes(name)) applyShape3D(name)
    }))

    unsubs.push(osc.subscribe("/scatter", () => {
      animatorRef.current.scatter()
    }))

    unsubs.push(osc.subscribe("/rotation/impulse", (args) => {
      const dvx = typeof args[0] === "number" ? args[0] : 0
      const dvy = typeof args[1] === "number" ? args[1] : 0
      const dvz = typeof args[2] === "number" ? args[2] : 0
      shapes3dRef.current?.impulse(dvx, dvy, dvz)
    }))

    return () => unsubs.forEach(fn => fn())
  }, [osc, applyShape, applyShape3D, pulseFanout])

  return { handleMidi, applyShape, applyShape3D, animator, pulse }
}
