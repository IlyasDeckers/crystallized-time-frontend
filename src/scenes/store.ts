import { paramStore, PARAM_DEFS, type ParamKey } from "@/particles/param-store"
import type { Scene } from "./types"
import type { NodeGraph } from "@/node-graph/types"

const STORAGE_KEY = "ct:scenes"

type LoadHandler = (scene: Scene) => void
const loadHandlers = new Set<LoadHandler>()

type NodeGraphProvider = () => NodeGraph | null
let nodeGraphProvider: NodeGraphProvider | null = null

function readAll(): Record<string, Scene> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, Scene>
  } catch {
    return {}
  }
}

function writeAll(scenes: Record<string, Scene>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scenes))
}

export const sceneStore = {
  save(name: string): void {
    const scenes = readAll()
    const params: Partial<Record<ParamKey, number | string>> = {}
    for (const key of Object.keys(PARAM_DEFS) as ParamKey[]) {
      params[key] = paramStore.get(key)
    }
    const scene: Scene = { name, createdAt: Date.now(), params }
    const graph = nodeGraphProvider?.()
    if (graph && graph.nodes.length > 0) {
      scene.nodeGraph = graph
    }
    scenes[name] = scene
    writeAll(scenes)
  },

  load(name: string): void {
    const scenes = readAll()
    const scene = scenes[name]
    if (!scene) return
    for (const handler of loadHandlers) handler(scene)
  },

  list(): string[] {
    return Object.keys(readAll())
  },

  delete(name: string): void {
    const scenes = readAll()
    delete scenes[name]
    writeAll(scenes)
  },

  export(): string {
    return JSON.stringify(readAll(), null, 2)
  },

  import(json: string): void {
    try {
      const scenes = JSON.parse(json) as Record<string, Scene>
      writeAll(scenes)
    } catch {
      // ignore malformed JSON
    }
  },

  /** Register a handler called whenever a scene is loaded. Returns unsubscribe fn. */
  onLoad(handler: LoadHandler): () => void {
    loadHandlers.add(handler)
    return () => { loadHandlers.delete(handler) }
  },

  /** Provide a callback that returns the current node graph for inclusion in saves. */
  setNodeGraphProvider(provider: NodeGraphProvider | null): void {
    nodeGraphProvider = provider
  },
}
