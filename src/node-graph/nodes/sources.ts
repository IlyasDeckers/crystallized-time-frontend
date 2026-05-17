import type { NodeDef, NodeEvaluator } from "../types"

// ---------------------------------------------------------------------------
// MIDI CC
// ---------------------------------------------------------------------------

export const midiCCDef: NodeDef = {
  type: "midi_cc",
  label: "MIDI CC",
  category: "source",
  ports: [
    { id: "raw", direction: "input", type: "number", label: "raw", default: 0 },
    { id: "value", direction: "output", type: "number", label: "value" },
    { id: "raw_out", direction: "output", type: "number", label: "raw" },
  ],
  configSchema: {
    cc: { type: "number", label: "CC", default: 74, min: 0, max: 127 },
    channel: { type: "number", label: "Channel", default: -1, min: -1, max: 15 },
  },
}

export const evaluateMidiCC: NodeEvaluator = ({ inputs }) => {
  const raw = inputs.raw ?? 0
  return { outputs: { value: raw / 127, raw_out: raw } }
}

// ---------------------------------------------------------------------------
// MIDI Note
// ---------------------------------------------------------------------------

export const midiNoteDef: NodeDef = {
  type: "midi_note",
  label: "MIDI Note",
  category: "source",
  ports: [
    { id: "__note", direction: "input", type: "number", label: "note", default: 0 },
    { id: "__velocity", direction: "input", type: "number", label: "vel", default: 0 },
    { id: "__gate", direction: "input", type: "trigger", label: "gate", default: 0 },
    { id: "note", direction: "output", type: "number", label: "note" },
    { id: "velocity", direction: "output", type: "number", label: "velocity" },
    { id: "gate", direction: "output", type: "trigger", label: "gate" },
  ],
  configSchema: {
    channel: { type: "number", label: "Channel", default: -1, min: -1, max: 15 },
    note: { type: "number", label: "Note", default: -1, min: -1, max: 127 },
  },
}

export const evaluateMidiNote: NodeEvaluator = ({ inputs }) => {
  return {
    outputs: {
      note: inputs.__note ?? 0,
      velocity: inputs.__velocity ?? 0,
      gate: inputs.__gate ?? 0,
    },
  }
}

// ---------------------------------------------------------------------------
// OSC Address
// ---------------------------------------------------------------------------

export const oscAddressDef: NodeDef = {
  type: "osc_address",
  label: "OSC Address",
  category: "source",
  ports: [
    { id: "value", direction: "output", type: "number", label: "value" },
    { id: "trigger", direction: "output", type: "trigger", label: "trigger" },
  ],
  configSchema: {
    address: { type: "string", label: "Address", default: "/foo/bar" },
  },
}

export const evaluateOscAddress: NodeEvaluator = ({ inputs }) => {
  return {
    outputs: {
      value: inputs.__value ?? 0,
      trigger: inputs.__trigger ?? 0,
    },
  }
}

// ---------------------------------------------------------------------------
// LFO
// ---------------------------------------------------------------------------

export const lfoDef: NodeDef = {
  type: "lfo",
  label: "LFO",
  category: "source",
  ports: [
    { id: "value", direction: "output", type: "number", label: "value" },
    { id: "unipolar", direction: "output", type: "number", label: "unipolar" },
  ],
  configSchema: {
    freq: { type: "number", label: "Freq", default: 1, min: 0.01, max: 20, step: 0.01 },
    shape: {
      type: "select",
      label: "Shape",
      default: "sine",
      options: ["sine", "square", "triangle", "sawtooth"],
    },
    phase: { type: "number", label: "Phase", default: 0, min: 0, max: 1, step: 0.01 },
  },
  frameEvaluated: true,
}

function shapeValue(shape: string, theta: number): number {
  switch (shape) {
    case "square":
      return Math.sign(Math.sin(theta))
    case "triangle":
      return (2 / Math.PI) * Math.asin(Math.sin(theta))
    case "sawtooth":
      return ((theta / Math.PI) % 2) - 1
    default:
      return Math.sin(theta)
  }
}

export const evaluateLFO: NodeEvaluator = ({ config, ctx }) => {
  const freq = (config.freq as number) ?? 1
  const shape = (config.shape as string) ?? "sine"
  const phase = (config.phase as number) ?? 0
  const theta = 2 * Math.PI * freq * (ctx.time + phase)
  const v = shapeValue(shape, theta)
  return { outputs: { value: v, unipolar: (v + 1) / 2 } }
}

// ---------------------------------------------------------------------------
// Constant
// ---------------------------------------------------------------------------

export const constantDef: NodeDef = {
  type: "constant",
  label: "Constant",
  category: "source",
  ports: [
    { id: "value", direction: "output", type: "number", label: "value" },
  ],
  configSchema: {
    value: { type: "number", label: "Value", default: 0, min: -1000, max: 1000, step: 0.01 },
  },
}

export const evaluateConstant: NodeEvaluator = ({ config }) => {
  return { outputs: { value: (config.value as number) ?? 0 } }
}
