import { useCallback, useEffect, useRef } from "react"
import type { UseOscResult, OscInboundMessage } from "@/hooks/use-osc"
import type { UseParticlesResult, FrameHook } from "@/particles/engine"
import type { UseShapes3DResult } from "@/hooks/use-shapes3d"
import { paramStore, isParamKey, type ParamKey } from "./param-store"
import { STRIDE, F } from "./buffer"

// OSC address → param key
const OSC_PARAM_MAP: Record<string, ParamKey> = {
  "/particles/speed":         "speed",
  "/particles/link_distance": "linkDistance",
  "/particles/link_opacity":  "linkOpacity",
  "/particles/size":          "particleSize",
  "/particles/hue":           "hue",
  "/particles/trail_decay":   "trailDecay",
  "/particles/trail_mode":    "trailMode",
  "/particles/glow":          "glowAmount",
  "/particles/morph_speed":   "morphSpeed",
  "/particles/max_count":     "maxCount",
  "/rotation/x":              "rotationX",
  "/rotation/y":              "rotationY",
  "/rotation/z":              "rotationZ",
  "/pulse/fanout":            "pulseFanout",
  "/pulse/decay":             "pulseDecay",
  "/background/r":            "backgroundR",
  "/background/g":            "backgroundG",
  "/background/b":            "backgroundB",
  "/post/bloom_threshold":    "bloomThreshold",
  "/post/bloom_intensity":    "bloomIntensity",
}

// Last segment of each address → param key (for /group/{name}/{segment})
const OSC_SEGMENT_MAP: Record<string, ParamKey> = Object.fromEntries(
  Object.entries(OSC_PARAM_MAP).map(([addr, key]) => [addr.split("/").pop()!, key])
)

// RenderConfig fields that map directly from paramStore keys
const RENDER_CONFIG_KEYS: Array<[ParamKey, string]> = [
  ["linkDistance",   "linkDistance"],
  ["linkOpacity",    "linkOpacity"],
  ["trailDecay",     "trailDecay"],
  ["glowAmount",     "glowAmount"],
  ["bloomThreshold", "bloomThreshold"],
  ["bloomIntensity", "bloomIntensity"],
]

export function useParamOscBridge(
  osc: UseOscResult | null,
  particlesApi: UseParticlesResult | null,
  shapes3d: UseShapes3DResult | null,
): void {
  const particlesRef = useRef(particlesApi)
  const shapes3dRef = useRef(shapes3d)
  const oscRef = useRef(osc)
  useEffect(() => { particlesRef.current = particlesApi }, [particlesApi])
  useEffect(() => { shapes3dRef.current = shapes3d }, [shapes3d])
  useEffect(() => { oscRef.current = osc }, [osc])

  // -------------------------------------------------------------------------
  // Wire paramStore changes to engine effects
  // -------------------------------------------------------------------------
  useEffect(() => {
    const unsubs: Array<() => void> = []

    // Render config fields
    for (const [paramKey, cfgKey] of RENDER_CONFIG_KEYS) {
      unsubs.push(paramStore.subscribe(paramKey, (v) => {
        particlesRef.current?.setRenderConfig({ [cfgKey]: v as number })
      }))
    }

    // trailMode: string → boolean
    unsubs.push(paramStore.subscribe("trailMode", (v) => {
      particlesRef.current?.setRenderConfig({ trailMode: v !== "off" })
    }))

    // Speed: rescale all live particle velocities
    unsubs.push(paramStore.subscribe("speed", (v) => {
      const api = particlesRef.current
      if (!api?.ready) return
      const spd = v as number
      const { buf } = api
      for (let i = 0; i < buf.capacity; i++) {
        const b = i * STRIDE
        if (buf.data[b + F.AGE] < buf.data[b + F.LIFETIME]) {
          const vx = buf.data[b + F.VX]
          const vy = buf.data[b + F.VY]
          const cur = Math.sqrt(vx * vx + vy * vy)
          if (cur > 0.001) {
            buf.data[b + F.VX] = (vx / cur) * spd
            buf.data[b + F.VY] = (vy / cur) * spd
          }
        }
      }
    }))

    // Rotation: apply all three axes together on any axis change
    const applyRotation = () => {
      shapes3dRef.current?.setRotationSpeed(
        paramStore.get("rotationX") as number,
        paramStore.get("rotationY") as number,
        paramStore.get("rotationZ") as number,
      )
    }
    unsubs.push(paramStore.subscribe("rotationX", applyRotation))
    unsubs.push(paramStore.subscribe("rotationY", applyRotation))
    unsubs.push(paramStore.subscribe("rotationZ", applyRotation))

    return () => unsubs.forEach(fn => fn())
  }, [])

  // -------------------------------------------------------------------------
  // Tick lerps each frame
  // -------------------------------------------------------------------------
  const tickHook = useCallback<FrameHook>(() => {
    paramStore.tick(performance.now() / 1000)
  }, [])

  useEffect(() => {
    if (!particlesApi?.ready) return
    return particlesApi.addFrameHook(tickHook)
  }, [particlesApi?.ready, particlesApi, tickHook])

  // -------------------------------------------------------------------------
  // OSC subscriptions: incoming messages → paramStore + echo
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!osc) return
    const unsubs: Array<() => void> = []

    // Guard against re-entrant echo loops: when we set a param from OSC,
    // mark it so the general echo subscriber skips that change.
    let oscUpdating = false

    for (const [address, key] of Object.entries(OSC_PARAM_MAP)) {
      unsubs.push(osc.subscribe(address, (args) => {
        const raw = args[0]
        if (raw === undefined) return
        oscUpdating = true
        paramStore.set(key, raw as number | string)
        oscUpdating = false
        // Echo clamped effective value back
        oscRef.current?.send(address, paramStore.get(key) as number | string)
      }))
    }

    // Echo all non-OSC paramStore changes (e.g. from MIDI CC) back over OSC
    for (const [address, key] of Object.entries(OSC_PARAM_MAP)) {
      unsubs.push(paramStore.subscribe(key, (v) => {
        if (oscUpdating) return
        oscRef.current?.send(address, v as number | string)
      }))
    }

    // Per-group: /group/{name}/{param_segment} e.g. /group/chain_a_sites/hue 30
    unsubs.push(osc.subscribeAll((msg: OscInboundMessage) => {
      if (!msg.address.startsWith("/group/")) return
      const parts = msg.address.split("/")  // ["", "group", name, segment]
      if (parts.length !== 4) return
      const groupName = parts[2]
      const paramKey = OSC_SEGMENT_MAP[parts[3]]
      if (!paramKey || !isParamKey(paramKey)) return
      const raw = msg.args[0]
      if (raw === undefined) return
      paramStore.setGroup(groupName, paramKey, raw as number | string)
      oscRef.current?.send(msg.address, paramStore.getGroup(groupName, paramKey) as number | string)
    }))

    return () => unsubs.forEach(fn => fn())
  }, [osc])
}
