export type ParamKey =
  | "speed" | "linkDistance" | "linkOpacity" | "particleSize"
  | "hue" | "trailDecay" | "trailMode" | "glowAmount" | "morphSpeed"
  | "maxCount" | "rotationX" | "rotationY" | "rotationZ"
  | "pulseFanout" | "pulseDecay"
  | "backgroundR" | "backgroundG" | "backgroundB"
  | "bloomThreshold" | "bloomIntensity"

interface ParamDef {
  default: number | string
  min?: number
  max?: number
}

export const PARAM_DEFS: Record<ParamKey, ParamDef> = {
  speed:          { default: 0.5,  min: 0.1,  max: 5 },
  linkDistance:   { default: 130,  min: 10,   max: 400 },
  linkOpacity:    { default: 0.5, min: 0,    max: 1 },
  particleSize:   { default: 2.5,  min: 1.5,  max: 15 },
  hue:            { default: 0,    min: 0,    max: 360 },
  trailDecay:     { default: 0,    min: 0,    max: 0.95 },
  trailMode:      { default: "off" },
  glowAmount:     { default: 0,    min: 0,    max: 3 },
  morphSpeed:     { default: 3.0,  min: 0.5,  max: 15 },
  maxCount:       { default: 400,  min: 10,   max: 4096 },
  rotationX:      { default: 0.15, min: 0,    max: 3 },
  rotationY:      { default: 0.28, min: 0,    max: 3 },
  rotationZ:      { default: 0.06, min: 0,    max: 3 },
  pulseFanout:    { default: 1,    min: 1,    max: 20 },
  pulseDecay:     { default: 3.0,  min: 0.1,  max: 10 },
  backgroundR:    { default: 0,    min: 0,    max: 1 },
  backgroundG:    { default: 0,    min: 0,    max: 1 },
  backgroundB:    { default: 0,    min: 0,    max: 1 },
  bloomThreshold: { default: 0.8,  min: 0,    max: 1 },
  bloomIntensity: { default: 0.5,  min: 0,    max: 2 },
}

const PARAM_KEY_SET = new Set<string>(Object.keys(PARAM_DEFS))

export function isParamKey(key: string): key is ParamKey {
  return PARAM_KEY_SET.has(key)
}

function clampValue(key: ParamKey, value: number | string): number | string {
  if (typeof value === "string") return value
  const def = PARAM_DEFS[key]
  let v = value
  if (def.min !== undefined) v = Math.max(def.min, v)
  if (def.max !== undefined) v = Math.min(def.max, v)
  return v
}

interface LerpState {
  start: number
  target: number
  startWall: number  // performance.now() / 1000
  duration: number   // seconds
}

class ParamStoreImpl {
  private global = new Map<ParamKey, number | string>()
  private groups = new Map<string, Map<ParamKey, number | string>>()
  private subs = new Map<ParamKey, Set<(v: number | string) => void>>()
  private groupSubs = new Map<string, Set<(v: number | string) => void>>()
  private lerps = new Map<ParamKey, LerpState>()

  constructor() {
    for (const [key, def] of Object.entries(PARAM_DEFS) as [ParamKey, ParamDef][]) {
      this.global.set(key, def.default)
    }
  }

  get(key: ParamKey): number | string {
    return this.global.get(key) ?? PARAM_DEFS[key].default
  }

  set(key: ParamKey, value: number | string): void {
    const clamped = clampValue(key, value)
    this.lerps.delete(key)
    this.global.set(key, clamped)
    this.subs.get(key)?.forEach(fn => fn(clamped))
  }

  /** Lerp a numeric param to target over N frames (at assumed fps). */
  setLerp(key: ParamKey, target: number, frames: number, fps = 60): void {
    if (frames <= 0) { this.set(key, target); return }
    const clamped = clampValue(key, target) as number
    this.lerps.set(key, {
      start: this.get(key) as number,
      target: clamped,
      startWall: performance.now() / 1000,
      duration: frames / fps,
    })
  }

  /** Advance active lerps. Call each frame with wall-clock seconds. */
  tick(wallTime: number): void {
    if (this.lerps.size === 0) return
    for (const [key, state] of this.lerps) {
      const elapsed = wallTime - state.startWall
      if (elapsed >= state.duration) {
        this.lerps.delete(key)
        this.set(key, state.target)
      } else {
        const t = elapsed / state.duration
        const v = state.start + (state.target - state.start) * t
        const clamped = clampValue(key, v) as number
        this.global.set(key, clamped)
        this.subs.get(key)?.forEach(fn => fn(clamped))
      }
    }
  }

  subscribe(key: ParamKey, fn: (v: number | string) => void): () => void {
    let set = this.subs.get(key)
    if (!set) { set = new Set(); this.subs.set(key, set) }
    set.add(fn)
    return () => { this.subs.get(key)?.delete(fn) }
  }

  setGroup(group: string, key: ParamKey, value: number | string): void {
    let map = this.groups.get(group)
    if (!map) { map = new Map(); this.groups.set(group, map) }
    const clamped = clampValue(key, value)
    map.set(key, clamped)
    const subKey = `${group}:${key}`
    this.groupSubs.get(subKey)?.forEach(fn => fn(clamped))
  }

  getGroup(group: string, key: ParamKey): number | string {
    return this.groups.get(group)?.get(key) ?? this.get(key)
  }

  subscribeGroup(group: string, key: ParamKey, fn: (v: number | string) => void): () => void {
    const subKey = `${group}:${key}`
    let set = this.groupSubs.get(subKey)
    if (!set) { set = new Set(); this.groupSubs.set(subKey, set) }
    set.add(fn)
    return () => { this.groupSubs.get(subKey)?.delete(fn) }
  }
}

export const paramStore = new ParamStoreImpl()
