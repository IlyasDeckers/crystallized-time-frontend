import { useCallback, useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import {
  createBuffer, spawnParticle, killParticle,
  type ParticleBuffer, type SpawnProps, STRIDE, F,
} from "./buffer"
import { DEFAULT_RENDER_CONFIG, type RenderConfig } from "./renderer"
import type { Renderer } from "./renderer"
import { WebGLRenderer } from "./renderer-webgl"
import { Canvas2DRenderer } from "./renderer-canvas2d"

export type { ParticleBuffer, SpawnProps }

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EngineConfig {
  maxParticles?: number
  /** "auto" tries WebGL2, falls back to canvas2d. */
  renderer?: "webgl" | "canvas2d" | "auto"
  /** Override any default render settings. */
  renderConfig?: Partial<RenderConfig>
  /** Max seconds per frame passed to hooks (default 0.1). */
  dtCap?: number
}

export type FrameHook = (ctx: {
  buf: ParticleBuffer
  time: number
  dt: number
}) => void

export interface GroupConfig {
  maxParticles: number
}

export interface BurstOptions {
  group: string
  count: number
  x?: number
  y?: number
  speed?: number
  r?: number
  g?: number
  b?: number
  opacity?: number
  size?: number
  lifetime?: number
}

export interface UseParticlesResult {
  ready: boolean
  canvasRef: RefObject<HTMLCanvasElement | null>
  buf: ParticleBuffer
  canvasSize: { w: number; h: number }
  addFrameHook: (fn: FrameHook) => () => void
  groups: {
    addGroup: (name: string, config: GroupConfig) => void
    removeGroup: (name: string) => void
    setGroupShape: (name: string, shape: string) => void
  }
  burst: (options: BurstOptions) => void
  spawn: (group: string, props: SpawnProps) => number
  kill: (index: number) => void
  setRenderConfig: (patch: Partial<RenderConfig>) => void
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

interface GroupEntry {
  name: string
  start: number
  end: number
  activeCount: { value: number }
  shape?: string
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useParticles(config: EngineConfig = {}): UseParticlesResult {
  const { maxParticles = 4096, dtCap = 0.1 } = config

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bufRef = useRef(createBuffer(maxParticles))
  const hooksRef = useRef<FrameHook[]>([])
  const groupsRef = useRef(new Map<string, GroupEntry>())
  const freeListRef = useRef<Array<{ start: number; end: number }>>([])
  const cursorRef = useRef(0)
  const rafRef = useRef(0)
  const startTimeRef = useRef(0)
  const lastTimeRef = useRef(0)
  const dtCapRef = useRef(dtCap)
  dtCapRef.current = dtCap

  const renderConfigLiveRef = useRef<RenderConfig>({ ...DEFAULT_RENDER_CONFIG, ...config.renderConfig })

  const [ready, setReady] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })

  // -------------------------------------------------------------------------
  // Main effect: creates renderer, ResizeObserver, and rAF loop together.
  // Runs once on mount; canvas is guaranteed to be in the DOM at that point.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Create renderer — WebGL2 preferred, Canvas2D as fallback
    let renderer: Renderer
    const mode = config.renderer ?? "auto"
    try {
      renderer = mode === "canvas2d"
        ? new Canvas2DRenderer(canvas)
        : new WebGLRenderer(canvas)
    } catch {
      renderer = new Canvas2DRenderer(canvas)
    }

    // Initial size + ResizeObserver
    const handleResize = () => {
      renderer.resize(canvas.offsetWidth, canvas.offsetHeight)
      setCanvasSize({ w: canvas.offsetWidth, h: canvas.offsetHeight })
    }
    handleResize()
    const observer = new ResizeObserver(handleResize)
    observer.observe(canvas)

    // Start rAF loop
    const t0 = performance.now() / 1000
    startTimeRef.current = t0
    lastTimeRef.current = t0
    setReady(true)

    const tick = (timestamp: number) => {
      const t = timestamp / 1000
      const dt = Math.min(t - lastTimeRef.current, dtCapRef.current)
      lastTimeRef.current = t
      const time = t - startTimeRef.current
      const buf = bufRef.current

      for (const hook of hooksRef.current) {
        hook({ buf, time, dt })
      }

      // Advance age and auto-kill expired particles
      for (const [, group] of groupsRef.current) {
        for (let i = group.start; i < group.end; i++) {
          const b = i * STRIDE
          const age = buf.data[b + F.AGE]
          const lifetime = buf.data[b + F.LIFETIME]
          if (age < lifetime) {
            const newAge = age + dt
            buf.data[b + F.AGE] = newAge
            if (newAge >= lifetime) {
              killParticle(buf, i, group.activeCount)
            }
          }
        }
      }

      renderer.draw(buf, renderConfigLiveRef.current)
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      observer.disconnect()
      renderer.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -------------------------------------------------------------------------
  // Frame hooks
  // -------------------------------------------------------------------------
  const addFrameHook = useCallback((fn: FrameHook) => {
    hooksRef.current.push(fn)
    return () => {
      const idx = hooksRef.current.indexOf(fn)
      if (idx >= 0) hooksRef.current.splice(idx, 1)
    }
  }, [])

  // -------------------------------------------------------------------------
  // Group management
  // -------------------------------------------------------------------------
  const addGroup = useCallback((name: string, groupConfig: GroupConfig) => {
    if (groupsRef.current.has(name)) {
      throw new Error(`Group "${name}" already exists`)
    }
    const needed = groupConfig.maxParticles
    const freeList = freeListRef.current
    const freeIdx = freeList.findIndex(s => s.end - s.start >= needed)
    let start: number, end: number

    if (freeIdx >= 0) {
      const slot = freeList[freeIdx]
      start = slot.start
      end = start + needed
      if (end < slot.end) {
        freeList[freeIdx] = { start: end, end: slot.end }
      } else {
        freeList.splice(freeIdx, 1)
      }
    } else {
      if (cursorRef.current + needed > maxParticles) {
        throw new Error(`Group "${name}" exceeds maxParticles cap (${maxParticles})`)
      }
      start = cursorRef.current
      end = start + needed
      cursorRef.current = end
    }

    groupsRef.current.set(name, { name, start, end, activeCount: { value: 0 } })
  }, [maxParticles])

  const removeGroup = useCallback((name: string) => {
    const group = groupsRef.current.get(name)
    if (!group) return
    const buf = bufRef.current
    for (let i = group.start; i < group.end; i++) {
      killParticle(buf, i, group.activeCount)
    }
    freeListRef.current.push({ start: group.start, end: group.end })
    groupsRef.current.delete(name)
  }, [])

  const setGroupShape = useCallback((name: string, shape: string) => {
    const group = groupsRef.current.get(name)
    if (group) group.shape = shape
  }, [])

  // -------------------------------------------------------------------------
  // Burst — spawn N particles into a named group
  // -------------------------------------------------------------------------
  const setRenderConfig = useCallback((patch: Partial<RenderConfig>) => {
    Object.assign(renderConfigLiveRef.current, patch)
  }, [])

  const spawn = useCallback((groupName: string, props: SpawnProps): number => {
    const group = groupsRef.current.get(groupName)
    if (!group) return -1
    return spawnParticle(bufRef.current, group.start, group.end, group.activeCount, {
      ...props,
      groupId: group.start,
    })
  }, [])

  const kill = useCallback((index: number) => {
    const buf = bufRef.current
    const b = index * STRIDE
    if (buf.data[b + F.AGE] >= buf.data[b + F.LIFETIME]) return
    for (const [, group] of groupsRef.current) {
      if (index >= group.start && index < group.end) {
        killParticle(buf, index, group.activeCount)
        return
      }
    }
  }, [])

  const burst = useCallback((options: BurstOptions) => {
    const group = groupsRef.current.get(options.group)
    if (!group) return
    const buf = bufRef.current
    const canvas = canvasRef.current
    const cx = options.x ?? (canvas ? canvas.offsetWidth / 2 : 0)
    const cy = options.y ?? (canvas ? canvas.offsetHeight / 2 : 0)
    const speed = options.speed ?? 1
    for (let i = 0; i < options.count; i++) {
      const angle = Math.random() * Math.PI * 2
      spawnParticle(buf, group.start, group.end, group.activeCount, {
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: options.r,
        g: options.g,
        b: options.b,
        opacity: options.opacity,
        size: options.size,
        lifetime: options.lifetime,
        groupId: group.start,
      })
    }
  }, [])

  return {
    ready,
    canvasRef,
    buf: bufRef.current,
    canvasSize,
    addFrameHook,
    groups: { addGroup, removeGroup, setGroupShape },
    burst,
    spawn,
    kill,
    setRenderConfig,
  }
}
