import type { NodeDef, NodeEvaluator } from "../types"

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

export const scaleDef: NodeDef = {
  type: "scale",
  label: "Scale",
  category: "processing",
  ports: [
    { id: "value", direction: "input", type: "number", label: "value", default: 0 },
    { id: "value_out", direction: "output", type: "number", label: "value" },
  ],
  configSchema: {
    inMin: { type: "number", label: "In Min", default: 0, step: 0.01 },
    inMax: { type: "number", label: "In Max", default: 1, step: 0.01 },
    outMin: { type: "number", label: "Out Min", default: 0, step: 0.01 },
    outMax: { type: "number", label: "Out Max", default: 1, step: 0.01 },
  },
}

export const evaluateScale: NodeEvaluator = ({ config, inputs }) => {
  const inMin = (config.inMin as number) ?? 0
  const inMax = (config.inMax as number) ?? 1
  const outMin = (config.outMin as number) ?? 0
  const outMax = (config.outMax as number) ?? 1
  const v = inputs.value ?? 0
  const inRange = inMax - inMin
  if (Math.abs(inRange) < 1e-9) return { outputs: { value_out: outMin } }
  const t = Math.max(0, Math.min(1, (v - inMin) / inRange))
  return { outputs: { value_out: outMin + t * (outMax - outMin) } }
}

// ---------------------------------------------------------------------------
// Smooth (slew limiter)
// ---------------------------------------------------------------------------

export const smoothDef: NodeDef = {
  type: "smooth",
  label: "Smooth",
  category: "processing",
  ports: [
    { id: "value", direction: "input", type: "number", label: "value", default: 0 },
    { id: "value_out", direction: "output", type: "number", label: "value" },
  ],
  configSchema: {
    tau: { type: "number", label: "Tau (s)", default: 0.1, min: 0.001, max: 10, step: 0.001 },
  },
  frameEvaluated: true,
}

export const evaluateSmooth: NodeEvaluator = ({ config, inputs, state, ctx }) => {
  const tau = (config.tau as number) ?? 0.1
  const v = inputs.value ?? 0
  let current = state.current as number | undefined
  if (current === undefined) current = v
  const alpha = 1 - Math.exp(-ctx.dt / Math.max(tau, 0.001))
  const next = current + alpha * (v - current)
  return { outputs: { value_out: next }, state: { current: next } }
}

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

export const mathDef: NodeDef = {
  type: "math",
  label: "Math",
  category: "processing",
  ports: [
    { id: "a", direction: "input", type: "number", label: "a", default: 0 },
    { id: "b", direction: "input", type: "number", label: "b", default: 0 },
    { id: "value", direction: "output", type: "number", label: "value" },
  ],
  configSchema: {
    op: {
      type: "select",
      label: "Op",
      default: "add",
      options: ["add", "multiply", "mix", "clamp", "abs", "min", "max"],
    },
  },
}

export const evaluateMath: NodeEvaluator = ({ config, inputs }) => {
  const op = (config.op as string) ?? "add"
  const a = inputs.a ?? 0
  const b = inputs.b ?? 0
  let v: number
  switch (op) {
    case "add":
      v = a + b
      break
    case "multiply":
      v = a * b
      break
    case "mix":
      v = a + (b - a) * Math.max(0, Math.min(1, inputs.b ?? 0))
      break
    case "clamp":
      v = Math.max(0, Math.min(1, a))
      break
    case "abs":
      v = Math.abs(a)
      break
    case "min":
      v = Math.min(a, b)
      break
    case "max":
      v = Math.max(a, b)
      break
    default:
      v = a
  }
  return { outputs: { value: v } }
}

// ---------------------------------------------------------------------------
// Curve
// ---------------------------------------------------------------------------

export const curveDef: NodeDef = {
  type: "curve",
  label: "Curve",
  category: "processing",
  ports: [
    { id: "value", direction: "input", type: "number", label: "value", default: 0 },
    { id: "value_out", direction: "output", type: "number", label: "value" },
  ],
  configSchema: {
    type: {
      type: "select",
      label: "Type",
      default: "linear",
      options: ["linear", "exp", "log"],
    },
  },
}

export const evaluateCurve: NodeEvaluator = ({ config, inputs }) => {
  const t = (config.type as string) ?? "linear"
  const v = Math.max(0, Math.min(1, inputs.value ?? 0))
  let result: number
  switch (t) {
    case "exp":
      result = (Math.exp(v) - 1) / (Math.E - 1)
      break
    case "log":
      result = Math.log1p(v * 9) / Math.log(10)
      break
    default:
      result = v
  }
  return { outputs: { value_out: result } }
}
