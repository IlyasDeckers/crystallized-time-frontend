// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export type PortType = "number" | "trigger"

export interface PortDef {
  id: string
  direction: "input" | "output"
  type: PortType
  label: string
  default?: number
}

// ---------------------------------------------------------------------------
// Node definition (static, shared across all instances of a type)
// ---------------------------------------------------------------------------

export type ConfigFieldType = "number" | "select" | "boolean" | "string"

export interface ConfigField {
  type: ConfigFieldType
  label: string
  default: number | string | boolean
  min?: number
  max?: number
  step?: number
  options?: string[]
}

export interface NodeDef {
  type: string
  label: string
  category: "source" | "processing" | "sink"
  ports: PortDef[]
  configSchema: Record<string, ConfigField>
  frameEvaluated?: boolean
}

// ---------------------------------------------------------------------------
// Node instance (what gets serialised to JSON / saved in the graph)
// ---------------------------------------------------------------------------

export interface NodeInstance {
  id: string
  type: string
  position: { x: number; y: number }
  config: Record<string, number | string | boolean>
}

// ---------------------------------------------------------------------------
// Edge
// ---------------------------------------------------------------------------

export interface GraphEdge {
  id: string
  sourceNodeId: string
  sourcePortId: string
  targetNodeId: string
  targetPortId: string
}

// ---------------------------------------------------------------------------
// Full graph (serialised form)
// ---------------------------------------------------------------------------

export interface NodeGraph {
  nodes: NodeInstance[]
  edges: GraphEdge[]
}

// ---------------------------------------------------------------------------
// Evaluator contract
// ---------------------------------------------------------------------------

export interface EvalContext {
  time: number
  dt: number
  canvasSize: { w: number; h: number }
  paramStoreSet: (key: string, value: number) => void
  engineBurst: ((options: { group: string; count: number; x?: number; y?: number; speed?: number; spread?: number }) => void) | null
  pulseFire: ((particleIndex?: number, charge?: number, bright?: boolean) => void) | null
}

export type NodeEvaluator = (params: {
  config: Record<string, number | string | boolean>
  inputs: Record<string, number>
  state: Record<string, unknown>
  ctx: EvalContext
}) => {
  outputs: Record<string, number>
  state?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Registry entry
// ---------------------------------------------------------------------------

export interface NodeRegistryEntry {
  def: NodeDef
  evaluate: NodeEvaluator
}

// ---------------------------------------------------------------------------
// Executor dependencies (passed at construction)
// ---------------------------------------------------------------------------

export interface ExecutorDeps {
  paramStoreSet: (key: string, value: number) => void
  engineBurst: ((options: { group: string; count: number; x?: number; y?: number; speed?: number; spread?: number }) => void) | null
  pulseFire: ((particleIndex?: number, charge?: number, bright?: boolean) => void) | null
  oscSubscribe: (address: string, cb: (args: unknown[]) => void) => () => void
  canvasSize: { w: number; h: number }
}
