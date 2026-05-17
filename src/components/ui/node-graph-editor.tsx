import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import type { NodeGraph } from "@/node-graph/types"
import { NODE_REGISTRY } from "@/node-graph/nodes"
import { saveGraph, EMPTY_GRAPH } from "@/node-graph/store"
import NodeGraphNode from "@/components/ui/node-graph-nodes/base-node"
import type { NodeGraphNodeData } from "@/components/ui/node-graph-nodes/base-node"

const nodeTypes = {
  nodeGraphNode: NodeGraphNode,
}

interface Props {
  graph: NodeGraph
  onChange: (graph: NodeGraph) => void
}

let idCounter = 0
function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`
}

function toFlowNodes(
  graph: NodeGraph,
  onConfigChange: NodeGraphNodeData["onConfigChange"],
): Node[] {
  return graph.nodes.map((n) => ({
    id: n.id,
    type: "nodeGraphNode",
    position: n.position,
    data: {
      nodeType: n.type,
      config: { ...n.config },
      onConfigChange,
    } satisfies NodeGraphNodeData,
  }))
}

function toFlowEdges(graph: NodeGraph): Edge[] {
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    sourceHandle: e.sourcePortId,
    targetHandle: e.targetPortId,
  }))
}

function fromFlow(nodes: Node[], edges: Edge[]): NodeGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.data as unknown as NodeGraphNodeData).nodeType,
      position: n.position,
      config: (n.data as unknown as NodeGraphNodeData).config,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.source,
      targetNodeId: e.target,
      sourcePortId: e.sourceHandle ?? "",
      targetPortId: e.targetHandle ?? "",
    })),
  }
}

function getPortDef(nodeType: string, portId: string) {
  return NODE_REGISTRY[nodeType]?.def.ports.find((p) => p.id === portId)
}

export function NodeGraphEditor({ graph, onChange }: Props) {
  // ---- React Flow internal state ----
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node>(
    toFlowNodes(graph, handleConfigChange),
  )
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<Edge>(
    toFlowEdges(graph),
  )

  // ---- Refs for latest values (callbacks capture them) ----
  const flowNodesRef = useRef(flowNodes)
  flowNodesRef.current = flowNodes
  const flowEdgesRef = useRef(flowEdges)
  flowEdgesRef.current = flowEdges
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const graphRef = useRef(graph)

  // ---- Prevent parent→child sync loops ----
  const internalUpdate = useRef(false)

  // Sync from parent graph → ReactFlow (only on external changes)
  useEffect(() => {
    if (internalUpdate.current) {
      internalUpdate.current = false
      return
    }
    if (graph === graphRef.current) return
    graphRef.current = graph
    setFlowNodes(toFlowNodes(graph, handleConfigChange))
    setFlowEdges(toFlowEdges(graph))
  }, [graph])

  // ---- Notify parent of internal changes ----
  function notifyParent(nodes: Node[], edges: Edge[]) {
    internalUpdate.current = true
    onChangeRef.current(fromFlow(nodes, edges))
  }

  // ---- Config change handler (stable reference) ----
  function handleConfigChange(
    id: string,
    config: Record<string, number | string | boolean>,
  ) {
    const next = flowNodesRef.current.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, config } } : n,
    )
    setFlowNodes(next)
    notifyParent(next, flowEdgesRef.current)
  }

  // ---- Connection handler ----
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return

    const sourceNode = flowNodesRef.current.find(
      (n) => n.id === connection.source,
    )
    const targetNode = flowNodesRef.current.find(
      (n) => n.id === connection.target,
    )
    if (!sourceNode || !targetNode) return

    const sourceType = (sourceNode.data as unknown as NodeGraphNodeData).nodeType
    const targetType = (targetNode.data as unknown as NodeGraphNodeData).nodeType

    const sourcePort = getPortDef(sourceType, connection.sourceHandle ?? "")
    const targetPort = getPortDef(targetType, connection.targetHandle ?? "")

    if (sourcePort && targetPort && sourcePort.type !== targetPort.type) {
      console.warn(
        `[NodeGraphEditor] port type mismatch: ${sourceType}.${sourcePort.id} (${sourcePort.type}) → ${targetType}.${targetPort.id} (${targetPort.type})`,
      )
      return
    }

    const already = flowEdgesRef.current.some(
      (e) =>
        e.source === connection.source &&
        e.target === connection.target &&
        e.sourceHandle === connection.sourceHandle &&
        e.targetHandle === connection.targetHandle,
    )
    if (!already) {
      const next = addEdge(
        {
          ...connection,
          id: uid("edge"),
          sourceHandle: connection.sourceHandle ?? "",
          targetHandle: connection.targetHandle ?? "",
        },
        flowEdgesRef.current,
      )
      setFlowEdges(next)
      notifyParent(flowNodesRef.current, next)
    }
  }, [])

  // ---- Delete handler: clean up edges connected to deleted nodes ----
  const onNodesDelete = useCallback((deletedNodes: Node[]) => {
    const deletedIds = new Set(deletedNodes.map((n) => n.id))
    const remainingNodes = flowNodesRef.current.filter((n) => !deletedIds.has(n.id))
    const remainingEdges = flowEdgesRef.current.filter(
      (e) => !deletedIds.has(e.source) && !deletedIds.has(e.target),
    )
    setFlowEdges(remainingEdges)
    notifyParent(remainingNodes, remainingEdges)
  }, [setFlowEdges])

  const onEdgesDelete = useCallback((deletedEdges: Edge[]) => {
    const deletedIds = new Set(deletedEdges.map((e) => e.id))
    const remaining = flowEdgesRef.current.filter((e) => !deletedIds.has(e.id))
    notifyParent(flowNodesRef.current, remaining)
  }, [])

  // ---- Add node ----
  const addNode = useCallback((type: string) => {
    const def = NODE_REGISTRY[type]?.def
    if (!def) return

    const id = uid("node")
    const config: Record<string, number | string | boolean> = {}
    for (const [key, field] of Object.entries(def.configSchema)) {
      config[key] = field.default
    }

    const newNode: Node = {
      id,
      type: "nodeGraphNode",
      position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
      data: {
        nodeType: type,
        config,
        onConfigChange: handleConfigChange,
      } satisfies NodeGraphNodeData,
    }

    const next = [...flowNodesRef.current, newNode]
    setFlowNodes(next)
    notifyParent(next, flowEdgesRef.current)
  }, [])

  // ---- Clear graph ----
  const clearGraph = useCallback(() => {
    setFlowNodes([])
    setFlowEdges([])
    internalUpdate.current = true
    onChangeRef.current(EMPTY_GRAPH)
  }, [])

  // ---- Save to localStorage ----
  const handleSave = useCallback(() => {
    saveGraph(fromFlow(flowNodesRef.current, flowEdgesRef.current))
  }, [])

  // ---- Export as JSON file ----
  const handleExport = useCallback(() => {
    const json = JSON.stringify(
      fromFlow(flowNodesRef.current, flowEdgesRef.current),
      null,
      2,
    )
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "node-graph.json"
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  // ---- Import JSON file ----
  const handleImport = useCallback(() => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".json"
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string) as NodeGraph
          if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
            throw new Error("Invalid graph shape")
          }
          onChangeRef.current(parsed)
        } catch {
          console.warn("[NodeGraphEditor] invalid graph file")
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }, [])

  // ---- Group node types by category for the dropdown ----
  const groupedTypes = useMemo(() => {
    const groups: Record<string, { type: string; label: string }[]> = {
      source: [],
      processing: [],
      sink: [],
    }
    for (const [type, entry] of Object.entries(NODE_REGISTRY)) {
      groups[entry.def.category].push({ type, label: entry.def.label })
    }
    return groups
  }, [])

  // ---- Add node dropdown state ----
  const [addMenuOpen, setAddMenuOpen] = useState(false)

  // ---- MiniMap node color ----
  const nodeColor = useCallback((n: Node) => {
    const cat = NODE_REGISTRY[(n.data as unknown as NodeGraphNodeData).nodeType]?.def
      .category
    if (cat === "source") return "#3b82f6"
    if (cat === "sink") return "#f59e0b"
    return "#6b7280"
  }, [])

  return (
    <div className="flex flex-col gap-2" style={{ width: "100%" }}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 flex-wrap">
        <div className="relative">
          <button
            onClick={() => setAddMenuOpen((v) => !v)}
            className="px-1.5 py-0.5 border border-border hover:bg-muted text-[10px]"
          >
            + node
          </button>
          {addMenuOpen && (
            <div
              className="absolute top-full left-0 mt-0.5 border border-border bg-background z-50 p-1 min-w-[140px] space-y-1"
              onClick={() => setAddMenuOpen(false)}
            >
              {(["source", "processing", "sink"] as const).map((cat) => (
                <div key={cat}>
                  <div className="text-muted-foreground text-[9px] px-1 uppercase tracking-wider">
                    {cat}
                  </div>
                  {groupedTypes[cat].map((t) => (
                    <button
                      key={t.type}
                      onClick={() => addNode(t.type)}
                      className="block w-full text-left px-2 py-0.5 hover:bg-muted text-[10px] text-foreground"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={clearGraph}
          className="px-1.5 py-0.5 border border-border hover:bg-muted text-[10px]"
        >
          clear
        </button>
        <button
          onClick={handleSave}
          className="px-1.5 py-0.5 border border-border hover:bg-muted text-[10px]"
        >
          save
        </button>
        <button
          onClick={handleExport}
          className="px-1.5 py-0.5 border border-border hover:bg-muted text-[10px]"
        >
          export
        </button>
        <button
          onClick={handleImport}
          className="px-1.5 py-0.5 border border-border hover:bg-muted text-[10px]"
        >
          import
        </button>
      </div>

      {/* Canvas */}
      <div style={{ width: "100%", height: 450 }}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          nodeTypes={nodeTypes}
          fitView
          deleteKeyCode={["Backspace", "Delete"]}
          className="border border-border bg-background"
          proOptions={{ hideAttribution: true }}
        >
          <Background color="oklch(1 0 0 / 6%)" gap={16} />
          <Controls className="!border !border-border !bg-background [&_button]:!border-border [&_button]:!bg-background [&_button]:!text-foreground [&_button]:hover:!bg-muted [&_svg]:!text-foreground" />
          <MiniMap
            className="!border !border-border !bg-background"
            nodeColor={nodeColor}
            maskColor="oklch(0 0 0 / 60%)"
          />
        </ReactFlow>
      </div>
    </div>
  )
}
