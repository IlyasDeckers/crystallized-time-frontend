import { paramStore, PARAM_DEFS, type ParamKey } from "@/particles/param-store"
import type { Scene } from "./types"

/** Crossfade all params in a scene over durationMs. String params switch at midpoint. */
export function crossfade(scene: Scene, durationMs: number): void {
  if (!scene.params) return
  const fps = 60
  const frames = (durationMs / 1000) * fps
  const halfMs = durationMs / 2

  for (const [rawKey, value] of Object.entries(scene.params)) {
    const key = rawKey as ParamKey
    if (value === undefined) continue
    const def = PARAM_DEFS[key]
    if (!def) continue

    if (typeof value === "number" && typeof def.default === "number") {
      paramStore.setLerp(key, value, frames, fps)
    } else if (typeof value === "string") {
      setTimeout(() => paramStore.set(key, value), halfMs)
    }
  }
}
