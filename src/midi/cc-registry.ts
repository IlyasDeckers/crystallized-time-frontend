export interface CCRegistration {
  cc: number
  param: string
  range: [number, number]
  curve?: "linear" | "exp" | "log"
  smoothFrames?: number
}

const registry = new Map<number, CCRegistration>()

export function registerCC(reg: CCRegistration): void {
  registry.set(reg.cc, reg)
}

export function lookupCC(cc: number): CCRegistration | undefined {
  return registry.get(cc)
}

export function applyCC(cc: number, rawValue: number): number {
  const reg = registry.get(cc)
  if (!reg) return rawValue / 127
  const t = rawValue / 127
  const [min, max] = reg.range
  let scaled: number
  if (reg.curve === "log") {
    scaled = Math.log1p(t * 9) / Math.log(10)
  } else if (reg.curve === "exp") {
    scaled = (Math.exp(t) - 1) / (Math.E - 1)
  } else {
    scaled = t
  }
  return min + scaled * (max - min)
}

// Default registrations — called once at module load
registerCC({ cc: 70, param: "maxCount",       range: [10, 4096] })
registerCC({ cc: 71, param: "linkDistance",   range: [10, 400] })
registerCC({ cc: 72, param: "linkOpacity",    range: [0, 1] })
registerCC({ cc: 73, param: "particleSize",   range: [0.5, 15] })
registerCC({ cc: 74, param: "speed",          range: [0.5, 8],   curve: "log" })
registerCC({ cc: 75, param: "hue",            range: [0, 360] })
registerCC({ cc: 78, param: "trailDecay",     range: [0, 0.95] })
registerCC({ cc: 79, param: "glowAmount",     range: [0, 3] })
registerCC({ cc: 80, param: "morphSpeed",     range: [0.5, 15] })
registerCC({ cc: 81, param: "pulseFanout",    range: [1, 20] })
registerCC({ cc: 82, param: "pulseDecay",     range: [0.1, 10] })
registerCC({ cc: 83, param: "bloomThreshold", range: [0, 1] })
registerCC({ cc: 84, param: "bloomIntensity", range: [0, 2] })
registerCC({ cc: 85, param: "wallMotionScale", range: [0, 1] })
registerCC({ cc: 12, param: "rotationX",      range: [0, 3] })
registerCC({ cc: 13, param: "rotationY",      range: [0, 3] })
registerCC({ cc: 14, param: "rotationZ",      range: [0, 3] })
