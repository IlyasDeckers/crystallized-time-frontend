import type { NodeGraph } from "./types"

const STORAGE_KEY = "crystallized:node-graph"

export function saveGraph(graph: NodeGraph): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(graph))
}

export function loadGraph(): NodeGraph | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as NodeGraph) : null
  } catch {
    return null
  }
}

export const EMPTY_GRAPH: NodeGraph = { nodes: [], edges: [] }
