import type { NodeDef, NodeEvaluator } from "../types"

// ---------------------------------------------------------------------------
// Param — writes a value to paramStore
// ---------------------------------------------------------------------------

export const paramDef: NodeDef = {
  type: "param",
  label: "Param",
  category: "sink",
  ports: [
    { id: "value", direction: "input", type: "number", label: "value", default: 0 },
  ],
  configSchema: {
    key: {
      type: "select",
      label: "Key",
      default: "speed",
      options: [
        "speed", "linkDistance", "linkOpacity", "particleSize",
        "hue", "trailDecay", "glowAmount", "morphSpeed",
        "maxCount", "rotationX", "rotationY", "rotationZ",
        "pulseFanout", "pulseDecay",
        "backgroundR", "backgroundG", "backgroundB",
        "bloomThreshold", "bloomIntensity",
      ],
    },
  },
}

export const evaluateParam: NodeEvaluator = ({ config, inputs, state, ctx }) => {
  const key = (config.key as string) ?? "speed"
  const value = inputs.value ?? 0
  const prev = state.prevValue as number | undefined
  if (prev === value) return { outputs: {} }
  ctx.paramStoreSet(key, value)
  return { outputs: {}, state: { prevValue: value } }
}

// ---------------------------------------------------------------------------
// Burst — fires engine.burst() on trigger rising edge
// ---------------------------------------------------------------------------

export const burstDef: NodeDef = {
  type: "burst",
  label: "Burst",
  category: "sink",
  ports: [
    { id: "trigger", direction: "input", type: "trigger", label: "trigger", default: 0 },
    { id: "x", direction: "input", type: "number", label: "x", default: 0 },
    { id: "y", direction: "input", type: "number", label: "y", default: 0 },
  ],
  configSchema: {
    group: { type: "string", label: "Group", default: "default" },
    count: { type: "number", label: "Count", default: 10, min: 1, max: 100 },
    speed: { type: "number", label: "Speed", default: 60, min: 1, max: 500 },
    spread: { type: "number", label: "Spread", default: 0, min: 0, max: 200 },
  },
}

export const evaluateBurst: NodeEvaluator = ({ config, inputs, state, ctx }) => {
  const trigger = inputs.trigger ?? 0
  const prevTrigger = (state.prevTrigger as number) ?? 0
  if (trigger > 0 && prevTrigger === 0 && ctx.engineBurst) {
    const group = (config.group as string) ?? "default"
    const count = (config.count as number) ?? 10
    const speed = (config.speed as number) ?? 60
    const spread = (config.spread as number) ?? 0
    ctx.engineBurst({
      group,
      count,
      speed,
      spread,
      x: inputs.x !== undefined ? inputs.x : undefined,
      y: inputs.y !== undefined ? inputs.y : undefined,
    })
  }
  return { outputs: {}, state: { prevTrigger: trigger } }
}

// ---------------------------------------------------------------------------
// Pulse — fires pulse.fire() on trigger rising edge
// ---------------------------------------------------------------------------

export const pulseDef: NodeDef = {
  type: "pulse",
  label: "Pulse",
  category: "sink",
  ports: [
    { id: "trigger", direction: "input", type: "trigger", label: "trigger", default: 0 },
    { id: "charge", direction: "input", type: "number", label: "charge", default: 1 },
  ],
  configSchema: {
    bright: { type: "boolean", label: "Bright", default: false },
  },
}

export const evaluatePulse: NodeEvaluator = ({ config, inputs, state, ctx }) => {
  const trigger = inputs.trigger ?? 0
  const prevTrigger = (state.prevTrigger as number) ?? 0
  if (trigger > 0 && prevTrigger === 0 && ctx.pulseFire) {
    const bright = (config.bright as boolean) ?? false
    const charge = inputs.charge ?? 0
    ctx.pulseFire(-1, charge, bright)
  }
  return { outputs: {}, state: { prevTrigger: trigger } }
}
