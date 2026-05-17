import { useCallback, useEffect, useRef } from "react"
import {
  applyMat3,
  makeRotationState,
  stepRotation,
  rotationMatrix,
  type RotationState,
  type Vec3,
} from "@/particles/math/math3d"
import {
  cubeVerts,
  sphereVerts,
  torusVerts,
  icosphereVerts,
  helixVerts,
  mobiusVerts,
  kleinVerts,
  trefoilVerts,
  octahedronVerts,
} from "@/particles/shapes/shapes3d"
import type { ShapeProvider, ShapeParams } from "@/particles/shapes/shapes2d"
import type { UseParticlesResult, FrameHook } from "@/particles/engine"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Shape3DName =
  | "cube"
  | "sphere"
  | "torus"
  | "icosphere"
  | "helix"
  | "mobius"
  | "klein"
  | "trefoil"
  | "octahedron"

export interface Shape3DConfig {
  /** Scale multiplier relative to the smaller viewport dimension. Default 0.32 */
  scale?: number
  /** Perspective focal length. Default 400. */
  focalLength?: number
  /** Z depth offset (pushes shape back from camera). Default 3. */
  depth?: number
  /** Initial rotation speeds in rad/s [rx, ry, rz]. */
  rotationSpeed?: [number, number, number]
  /** When true, rotation auto-animates every frame. Default true. */
  autoRotate?: boolean
}

export interface UseShapes3DResult {
  /** Get a ShapeProvider for the named 3D shape. */
  getProvider: (name: Shape3DName) => ShapeProvider
  /** Manually set rotation angles (radians). */
  setRotation: (rx: number, ry: number, rz: number) => void
  /** Set angular velocity (rad/s). */
  setRotationSpeed: (vx: number, vy: number, vz: number) => void
  /** Nudge rotation by an impulse. */
  impulse: (dvx: number, dvy: number, dvz: number) => void
  /** Current rotation state (readable). */
  rotation: RotationState
  /** All available 3D shape names. */
  shapeNames: Shape3DName[]
}

// ---------------------------------------------------------------------------
// Vertex generators map
// ---------------------------------------------------------------------------

const VERT_GENERATORS: Record<Shape3DName, (n: number) => Vec3[]> = {
  cube:       (n) => cubeVerts(n),
  sphere:     (n) => sphereVerts(n),
  torus:      (n) => torusVerts(n),
  icosphere:  (n) => icosphereVerts(n),
  helix:      (n) => helixVerts(n),
  mobius:     (n) => mobiusVerts(n),
  klein:      (n) => kleinVerts(n),
  trefoil:    (n) => trefoilVerts(n),
  octahedron: (n) => octahedronVerts(n),
}

export const SHAPE_3D_NAMES = Object.keys(VERT_GENERATORS) as Shape3DName[]

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useShapes3D(
  particlesApi: UseParticlesResult | null,
  config: Shape3DConfig = {},
): UseShapes3DResult {
  const {
    scale = 0.32,
    focalLength = 400,
    depth = 3,
    rotationSpeed = [0.15, 0.28, 0.06],
    autoRotate = true,
  } = config

  const rotRef = useRef<RotationState>(
    makeRotationState(...rotationSpeed)
  )

  const vertCacheRef = useRef<Map<string, Vec3[]>>(new Map())

  const rotHook = useCallback<FrameHook>(({ dt }) => {
    if (!autoRotate) return
    rotRef.current = stepRotation(rotRef.current, dt)
  }, [autoRotate])

  useEffect(() => {
    if (!particlesApi?.ready) return
    return particlesApi.addFrameHook(rotHook)
  }, [particlesApi?.ready, particlesApi, rotHook])

  const getProvider = useCallback((name: Shape3DName): ShapeProvider => {
    return ({ count, viewport }: ShapeParams) => {
      const cacheKey = `${name}:${count}`
      let baseVerts = vertCacheRef.current.get(cacheKey)
      if (!baseVerts) {
        baseVerts = VERT_GENERATORS[name](count)
        vertCacheRef.current.set(cacheKey, baseVerts)
      }

      const mat = rotationMatrix(rotRef.current)
      const s = Math.min(viewport.w, viewport.h) * scale
      const cx = viewport.w / 2
      const cy = viewport.h / 2

      return baseVerts.map(v => {
        const scaled: Vec3 = { x: v.x * s, y: v.y * s, z: v.z * s }
        const rotated = applyMat3(mat, scaled)
        const fl = focalLength
        const d = depth
        const w = fl / Math.max(1, rotated.z + d * s + fl)
        return {
          x: cx + rotated.x * w,
          y: cy + rotated.y * w,
        }
      })
    }
  }, [scale, focalLength, depth])

  const setRotation = useCallback((rx: number, ry: number, rz: number) => {
    rotRef.current = { ...rotRef.current, rx, ry, rz }
  }, [])

  const setRotationSpeed = useCallback((vx: number, vy: number, vz: number) => {
    rotRef.current = { ...rotRef.current, vx, vy, vz }
  }, [])

  const impulse = useCallback((dvx: number, dvy: number, dvz: number) => {
    rotRef.current = {
      ...rotRef.current,
      vx: rotRef.current.vx + dvx,
      vy: rotRef.current.vy + dvy,
      vz: rotRef.current.vz + dvz,
    }
  }, [])

  return {
    getProvider,
    setRotation,
    setRotationSpeed,
    impulse,
    get rotation() { return rotRef.current },
    shapeNames: SHAPE_3D_NAMES,
  }
}
