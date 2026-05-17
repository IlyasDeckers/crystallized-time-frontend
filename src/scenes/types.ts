import type { ParamKey } from "@/particles/param-store"
import type { NodeGraph } from "@/node-graph/types"

export interface Scene {
  name: string
  createdAt: number
  params?: Partial<Record<ParamKey, number | string>>
  shape3d?: string | null
  shape2d?: string | null
  nodeGraph?: NodeGraph
}
