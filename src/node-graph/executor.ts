import type { NodeGraph, NodeInstance, EvalContext, ExecutorDeps } from "./types"
import { NODE_REGISTRY } from "./nodes"

interface AdjEntry {
  nodeId: string
  portMap: Map<string, string> // targetPortId → sourceNodeId:sourcePortId
}

export class NodeGraphExecutor {
  private topoOrder: string[] = []
  private adjacency: Map<string, AdjEntry[]> = new Map()
  private frameNodes: Set<string> = new Set()
  private portValues: Map<string, number> = new Map()
  private nodeStates: Map<string, Record<string, unknown>> = new Map()
  private oscUnsubs: Array<() => void> = []
  private oscNodes: Map<string, { nodeId: string; address: string }> = new Map()
  private ccNodes: NodeInstance[] = []
  private noteNodes: NodeInstance[] = []

  private graph: NodeGraph
  private deps: ExecutorDeps
  private canvasSize: { w: number; h: number }

  constructor(graph: NodeGraph, deps: ExecutorDeps) {
    this.graph = graph
    this.deps = deps
    this.canvasSize = deps.canvasSize
    this.compile()
  }

  recompile(graph: NodeGraph): void {
    this.destroy()
    this.graph = graph
    this.portValues = new Map()
    this.nodeStates = new Map()
    this.compile()
  }

  destroy(): void {
    for (const unsub of this.oscUnsubs) unsub()
    this.oscUnsubs = []
  }

  // -----------------------------------------------------------------------
  // MIDI handlers — called from the React hook
  // -----------------------------------------------------------------------

  handleMidiCC(cc: number, rawValue: number, channel: number): void {
    for (const node of this.ccNodes) {
      const cfgCC = node.config.cc as number
      const cfgCh = node.config.channel as number
      if (cfgCC !== cc) continue
      if (cfgCh !== -1 && cfgCh !== channel) continue
      const portKey = `${node.id}:_cc_raw`
      this.portValues.set(portKey, rawValue)
      this.evaluateReachable(node.id, "raw", rawValue)
    }
  }

  handleMidiNote(note: number, velocity: number, on: boolean, channel: number): void {
    for (const node of this.noteNodes) {
      const cfgNote = node.config.note as number
      const cfgCh = node.config.channel as number
      if (cfgNote !== -1 && cfgNote !== note) continue
      if (cfgCh !== -1 && cfgCh !== channel) continue
      this.portValues.set(`${node.id}:__note`, note)
      this.portValues.set(`${node.id}:__velocity`, velocity / 127)
      this.portValues.set(`${node.id}:__gate`, on ? 1 : 0)
      this.evaluateReachable(node.id, "__note", note)
      this.evaluateReachable(node.id, "__velocity", velocity / 127)
      this.evaluateReachable(node.id, "__gate", on ? 1 : 0)
    }
  }

  // -----------------------------------------------------------------------
  // Frame evaluation — called every rAF frame
  // -----------------------------------------------------------------------

  evaluateFrame(time: number, dt: number): void {
    const ctx: EvalContext = {
      time,
      dt,
      canvasSize: this.canvasSize,
      paramStoreSet: this.deps.paramStoreSet,
      engineBurst: this.deps.engineBurst,
      pulseFire: this.deps.pulseFire,
    }

    for (const nodeId of this.topoOrder) {
      if (!this.frameNodes.has(nodeId)) continue
      this.evaluateNode(nodeId, ctx)
    }
  }

  // -----------------------------------------------------------------------
  // Internal: compilation
  // -----------------------------------------------------------------------

  private compile(): void {
    const { nodes, edges } = this.graph

    if (nodes.length === 0) {
      this.topoOrder = []
      this.adjacency = new Map()
      this.frameNodes = new Set()
      this.ccNodes = []
      this.noteNodes = []
      return
    }

    this.adjacency = new Map()
    const inDegree = new Map<string, number>()
    for (const node of nodes) {
      this.adjacency.set(node.id, [])
      inDegree.set(node.id, 0)
    }

    for (const edge of edges) {
      const adj = this.adjacency.get(edge.sourceNodeId)
      if (!adj) continue
      const existing = adj.find(e => e.nodeId === edge.targetNodeId)
      if (existing) {
        existing.portMap.set(edge.targetPortId, `${edge.sourceNodeId}:${edge.sourcePortId}`)
      } else {
        const pm = new Map<string, string>()
        pm.set(edge.targetPortId, `${edge.sourceNodeId}:${edge.sourcePortId}`)
        adj.push({ nodeId: edge.targetNodeId, portMap: pm })
      }
      inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) ?? 0) + 1)
    }

    // Kahn's algorithm
    const queue: string[] = []
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id)
    }

    this.topoOrder = []
    while (queue.length > 0) {
      const nodeId = queue.shift()!
      this.topoOrder.push(nodeId)
      const adj = this.adjacency.get(nodeId) ?? []
      for (const entry of adj) {
        const newDeg = (inDegree.get(entry.nodeId) ?? 1) - 1
        inDegree.set(entry.nodeId, newDeg)
        if (newDeg === 0) queue.push(entry.nodeId)
      }
    }

    if (this.topoOrder.length < nodes.length) {
      console.warn(
        "[NodeGraphExecutor] cycle detected —",
        nodes.length - this.topoOrder.length,
        "nodes excluded from evaluation"
      )
    }

    // Build frame node set
    this.frameNodes = new Set()
    this.ccNodes = []
    this.noteNodes = []

    for (const node of nodes) {
      const entry = NODE_REGISTRY[node.type]
      if (!entry) continue
      if (entry.def.frameEvaluated) {
        this.frameNodes.add(node.id)
      }
      if (node.type === "midi_cc") {
        this.ccNodes.push(node)
      }
      if (node.type === "midi_note") {
        this.noteNodes.push(node)
      }
    }

    // Collect all source (OscAddress) nodes — no incoming connections
    // means they receive data via external OSC subscriptions.
    // However, osc_address nodes may have no upstream — the executor
    // subscribes to their configured OSC addresses and injects values.
    this.subscribeOscNodes(nodes)

    // Initialize port defaults for all input ports
    for (const node of nodes) {
      const entry = NODE_REGISTRY[node.type]
      if (!entry) continue
      for (const port of entry.def.ports) {
        if (port.direction === "input" && port.default !== undefined) {
          const pk = `${node.id}:${port.id}`
          if (!this.portValues.has(pk)) {
            this.portValues.set(pk, port.default)
          }
        }
      }
    }

    // Initial evaluation for constant nodes — propagate to downstream sinks
    for (const node of nodes) {
      if (node.type === "constant") {
        this.evaluateReachable(node.id, "value", (node.config.value as number) ?? 0)
      }
    }
  }

  // -----------------------------------------------------------------------
  // OSC subscriptions
  // -----------------------------------------------------------------------

  private subscribeOscNodes(nodes: NodeInstance[]): void {
    for (const node of nodes) {
      if (node.type !== "osc_address") continue
      const address = (node.config.address as string) ?? ""
      if (!address) continue
      this.oscNodes.set(address + ":" + node.id, { nodeId: node.id, address })
      const unsub = this.deps.oscSubscribe(address, (args) => {
        const value = typeof args[0] === "number" ? args[0] : 0
        this.portValues.set(`${node.id}:__value`, value)
        this.portValues.set(`${node.id}:__trigger`, 1)
        this.evaluateReachable(node.id, "__value", value)
        this.evaluateReachable(node.id, "__trigger", 1)
        this.portValues.set(`${node.id}:__trigger`, 0)
      })
      this.oscUnsubs.push(unsub)
    }
  }

  // -----------------------------------------------------------------------
  // Partial evaluation: walk the reachable subgraph from a triggered node
  // -----------------------------------------------------------------------

  private evaluateReachable(nodeId: string, _portId: string, _value: number): void {
    const ctx = this.makeCtx(0, 0)
    const reachable = new Set<string>()
    const queue = [nodeId]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (reachable.has(id)) continue
      reachable.add(id)
      const adj = this.adjacency.get(id) ?? []
      for (const entry of adj) {
        queue.push(entry.nodeId)
      }
    }

    for (const id of this.topoOrder) {
      if (!reachable.has(id)) continue
      this.evaluateNode(id, ctx)
    }
  }

  // -----------------------------------------------------------------------
  // Node evaluation
  // -----------------------------------------------------------------------

  private evaluateNode(nodeId: string, ctx: EvalContext): void {
    const node = this.graph.nodes.find(n => n.id === nodeId)
    if (!node) return

    const entry = NODE_REGISTRY[node.type]
    if (!entry) return

    // Collect inputs from edges or defaults
    const inputs: Record<string, number> = {}
    for (const port of entry.def.ports) {
      if (port.direction !== "input") continue
      const adj = this.adjacency
      let found = false
      for (const [, adjEntries] of adj) {
        for (const ae of adjEntries) {
          if (ae.nodeId === nodeId && ae.portMap.has(port.id)) {
            const srcKey = ae.portMap.get(port.id)!
            const v = this.portValues.get(srcKey)
            if (v !== undefined) {
              inputs[port.id] = v
              found = true
            }
            break
          }
        }
        if (found) break
      }
      if (!found) {
        const pk = `${nodeId}:${port.id}`
        inputs[port.id] = this.portValues.get(pk) ?? port.default ?? 0
      }
    }

    // For midi_cc: copy the raw CC value from the injected port key
    if (node.type === "midi_cc") {
      const rawKey = `${nodeId}:_cc_raw`
      const rawVal = this.portValues.get(rawKey)
      if (rawVal !== undefined) inputs.raw = rawVal
    }

    const state = this.nodeStates.get(nodeId) ?? {}
    const result = entry.evaluate({ config: node.config, inputs, state, ctx })

    for (const [portId, value] of Object.entries(result.outputs)) {
      this.portValues.set(`${nodeId}:${portId}`, value)
    }

    if (result.state) {
      this.nodeStates.set(nodeId, result.state)
    }
  }

  private makeCtx(time: number, dt: number): EvalContext {
    return {
      time,
      dt,
      canvasSize: this.canvasSize,
      paramStoreSet: this.deps.paramStoreSet,
      engineBurst: this.deps.engineBurst,
      pulseFire: this.deps.pulseFire,
    }
  }
}
