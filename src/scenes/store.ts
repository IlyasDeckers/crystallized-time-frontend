import { paramStore, PARAM_DEFS, type ParamKey } from "@/particles/param-store"
import type { Scene } from "./types"

const STORAGE_KEY = "ct:scenes"

type LoadHandler = (scene: Scene) => void
const loadHandlers = new Set<LoadHandler>()

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
    scenes[name] = { name, createdAt: Date.now(), params }
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
}
