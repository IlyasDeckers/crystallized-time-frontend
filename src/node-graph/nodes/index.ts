import type { NodeRegistryEntry } from "../types"

import { midiCCDef, evaluateMidiCC } from "./sources"
import { midiNoteDef, evaluateMidiNote } from "./sources"
import { oscAddressDef, evaluateOscAddress } from "./sources"
import { lfoDef, evaluateLFO } from "./sources"
import { constantDef, evaluateConstant } from "./sources"

import { scaleDef, evaluateScale } from "./processing"
import { smoothDef, evaluateSmooth } from "./processing"
import { mathDef, evaluateMath } from "./processing"
import { curveDef, evaluateCurve } from "./processing"

import { paramDef, evaluateParam } from "./sinks"
import { burstDef, evaluateBurst } from "./sinks"
import { pulseDef, evaluatePulse } from "./sinks"

export const NODE_REGISTRY: Record<string, NodeRegistryEntry> = {
  midi_cc: { def: midiCCDef, evaluate: evaluateMidiCC },
  midi_note: { def: midiNoteDef, evaluate: evaluateMidiNote },
  osc_address: { def: oscAddressDef, evaluate: evaluateOscAddress },
  lfo: { def: lfoDef, evaluate: evaluateLFO },
  constant: { def: constantDef, evaluate: evaluateConstant },
  scale: { def: scaleDef, evaluate: evaluateScale },
  smooth: { def: smoothDef, evaluate: evaluateSmooth },
  math: { def: mathDef, evaluate: evaluateMath },
  curve: { def: curveDef, evaluate: evaluateCurve },
  param: { def: paramDef, evaluate: evaluateParam },
  burst: { def: burstDef, evaluate: evaluateBurst },
  pulse: { def: pulseDef, evaluate: evaluatePulse },
}
