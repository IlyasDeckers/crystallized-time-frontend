import { useCallback, useEffect, useRef, useState } from "react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  tx?: number
  ty?: number
  charge?: number
  color?: { rgb: { r: number; g: number; b: number } }
  radius: number
  opacity: number
  [key: string]: unknown
}

export interface PJSInstance {
  particles: {
    array: Particle[]
    number: { value: number }
    move: { speed: number; enable: boolean }
    size: { value: number }
    line_linked: {
      enable: boolean
      distance: number
      opacity: number
      width: number
      color_rgb_line: { r: number; g: number; b: number }
    }
    color: { value: string }
    opacity: { value: number }
  }
  interactivity: {
    modes: {
      repulse: { distance: number }
      bubble: { size: number; distance: number }
      grab: { distance: number }
    }
    events: {
      onhover: { enable: boolean; mode: string }
      onclick: { enable: boolean; mode: string }
    }
  }
  fn: {
    interact: Record<string, unknown>
    modes: {
      pushParticles: (n: number, pos?: { pos_x: number; pos_y: number }) => void
      removeParticles: (n: number) => void
    }
    particlesDraw: () => void
    particlesUpdate: () => void
    vendors: {
      draw: () => void
    }
    drawAnimFrame: number
  }
  canvas: {
    w: number
    h: number
    el: HTMLCanvasElement
    ctx: CanvasRenderingContext2D
  }
  tmp: Record<string, unknown>
}

declare global {
  interface Window {
    particlesJS: ((id: string, config: object) => void) & {
      load: (id: string, path: string, cb?: () => void) => void
    }
    pJSDom: Array<{ pJS: PJSInstance }>
    cancelRequestAnimFrame: (id: number) => void
  }
}

export interface ParticlesConfig {
  count?: number
  speed?: number
  linkedDistance?: number
  linkedOpacity?: number
  size?: number
  color?: string
  background?: string
}

export interface UseParticlesResult {
  ready: boolean
  pjs: PJSInstance | null
  particles: Particle[]
  addFrameHook: (fn: FrameHook) => () => void
  setConfig: (patch: Partial<ParticlesConfig>) => void
  burst: (n: number, x?: number, y?: number) => void
  canvasSize: { w: number; h: number }
}

export type FrameHook = (params: {
  particles: Particle[]
  pjs: PJSInstance
  time: number
  dt: number
}) => void

// ---------------------------------------------------------------------------
// Config builder
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Required<ParticlesConfig> = {
  count: 120,
  speed: 1.5,
  linkedDistance: 130,
  linkedOpacity: 0.35,
  size: 2.5,
  color: "#ffffff",
  background: "transparent",
}

function buildPJSConfig(cfg: Required<ParticlesConfig>) {
  return {
    particles: {
      number: { value: cfg.count, density: { enable: true, value_area: 800 } },
      color: { value: cfg.color },
      shape: { type: "circle", stroke: { width: 0, color: "#000000" } },
      opacity: { value: 0.7, random: true, anim: { enable: false } },
      size: { value: cfg.size, random: true, anim: { enable: false } },
      line_linked: {
        enable: true,
        distance: cfg.linkedDistance,
        color: cfg.color,
        opacity: cfg.linkedOpacity,
        width: 1,
      },
      move: {
        enable: true,
        speed: cfg.speed,
        direction: "none",
        random: true,
        straight: false,
        out_mode: "out",
        bounce: false,
        attract: { enable: false, rotateX: 600, rotateY: 1200 },
      },
    },
    interactivity: {
      detect_on: "canvas",
      events: {
        onhover: { enable: false, mode: "grab" },
        onclick: { enable: false, mode: "push" },
        resize: true,
      },
      modes: {
        grab: { distance: 140, line_linked: { opacity: 1 } },
        repulse: { distance: 200, duration: 0.4 },
        push: { particles_nb: 4 },
        remove: { particles_nb: 2 },
      },
    },
    retina_detect: true,
  }
}

// ---------------------------------------------------------------------------
// Script loader
// ---------------------------------------------------------------------------

let scriptPromise: Promise<void> | null = null

function loadParticlesScript(): Promise<void> {
  if (scriptPromise) return scriptPromise
  if (typeof window !== "undefined" && window.particlesJS) {
    scriptPromise = Promise.resolve()
    return scriptPromise
  }
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "https://cdn.jsdelivr.net/npm/particles.js@2.0.0/particles.min.js"
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Failed to load particles.js"))
    document.head.appendChild(script)
  })
  return scriptPromise
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useParticles(
  containerId: string,
  config: ParticlesConfig = {},
): UseParticlesResult {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config } as Required<ParticlesConfig>

  const [ready, setReady] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })
  const pjsRef = useRef<PJSInstance | null>(null)
  const frameHooksRef = useRef<Set<FrameHook>>(new Set())
  const rafRef = useRef<number>(0)
  const startTimeRef = useRef(performance.now())
  const lastTimeRef = useRef(performance.now())

  // -------------------------------------------------------------------------
  // Our draw loop — runs INSTEAD of particles.js's own loop
  // -------------------------------------------------------------------------
  const runLoop = useCallback((pjs: PJSInstance) => {
    // Cancel particles.js's own rAF loop so it stops fighting us
    if (pjs.fn.drawAnimFrame) {
      ;(window.cancelRequestAnimFrame ?? cancelAnimationFrame)(pjs.fn.drawAnimFrame)
    }

    const tick = () => {
      const now = performance.now()
      const time = (now - startTimeRef.current) / 1000
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.1)
      lastTimeRef.current = now

      // 1. Run our hooks first — they mutate p.x/p.y
      for (const hook of frameHooksRef.current) {
        hook({ particles: pjs.particles.array, pjs, time, dt })
      }

      // 2. Tell pJS to draw the current state (clear + draw particles + links)
      //    We call particlesDraw directly — it does NOT call particlesUpdate,
      //    so pJS physics won't overwrite our positions.
      //    However particles.js's particlesDraw() calls particlesUpdate() internally!
      //    So we need to call the canvas clear + draw loop manually instead.
      drawManually(pjs)

      // Sync canvas size
      if (pjs.canvas.w !== canvasSize.w || pjs.canvas.h !== canvasSize.h) {
        setCanvasSize({ w: pjs.canvas.w, h: pjs.canvas.h })
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [canvasSize.w, canvasSize.h])

  // -------------------------------------------------------------------------
  // Mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false

    loadParticlesScript().then(() => {
      if (cancelled) return
      setTimeout(() => {
        if (cancelled) return

        window.particlesJS(containerId, buildPJSConfig(mergedConfig))

        const poll = setInterval(() => {
          if (cancelled) { clearInterval(poll); return }
          const instance = window.pJSDom?.[0]?.pJS
          if (instance?.particles?.array?.length > 0) {
            clearInterval(poll)
            pjsRef.current = instance

            // Give pJS one frame to finish its own init draw, then take over
            requestAnimationFrame(() => {
              if (cancelled) return
              // Cancel pJS's loop
              if (instance.fn.drawAnimFrame) {
                ;(window.cancelRequestAnimFrame ?? cancelAnimationFrame)(instance.fn.drawAnimFrame)
              }
              setReady(true)
              setCanvasSize({ w: instance.canvas.w, h: instance.canvas.h })
              runLoop(instance)
            })
          }
        }, 50)
      }, 0)
    }).catch(console.error)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      const el = document.getElementById(containerId)
      if (el) {
        const canvas = el.querySelector(".particles-js-canvas-el")
        if (canvas) el.removeChild(canvas)
      }
      if (window.pJSDom) window.pJSDom = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId])

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------
  const addFrameHook = useCallback((fn: FrameHook) => {
    frameHooksRef.current.add(fn)
    return () => frameHooksRef.current.delete(fn)
  }, [])

  const setConfig = useCallback((patch: Partial<ParticlesConfig>) => {
    const pjs = pjsRef.current
    if (!pjs) return
    if (patch.speed !== undefined) pjs.particles.move.speed = patch.speed
    if (patch.linkedDistance !== undefined) pjs.particles.line_linked.distance = patch.linkedDistance
    if (patch.linkedOpacity !== undefined) pjs.particles.line_linked.opacity = patch.linkedOpacity
    if (patch.size !== undefined) pjs.particles.size.value = patch.size
  }, [])

  const burst = useCallback((n: number, x?: number, y?: number) => {
    const pjs = pjsRef.current
    if (!pjs) return
    if (x !== undefined && y !== undefined) {
      pjs.fn.modes.pushParticles(n, { pos_x: x, pos_y: y })
    } else {
      pjs.fn.modes.pushParticles(n)
    }
  }, [])

  return {
    ready,
    pjs: pjsRef.current,
    particles: pjsRef.current?.particles.array ?? [],
    addFrameHook,
    setConfig,
    burst,
    canvasSize,
  }
}

// ---------------------------------------------------------------------------
// Manual draw — replicates what pJS.fn.particlesDraw does but WITHOUT
// calling particlesUpdate(), so our position mutations are preserved.
// ---------------------------------------------------------------------------

function drawManually(pjs: PJSInstance) {
  const ctx = pjs.canvas.ctx
  const w = pjs.canvas.w
  const h = pjs.canvas.h

  // Clear
  ctx.clearRect(0, 0, w, h)

  // Update physics (move, bounce, out-of-bounds) but NOT position override —
  // we want pJS to handle velocity/bounce for free-floating particles,
  // but our animator zeroes vx/vy for targeted ones so they stay put.
  pjs.fn.particlesUpdate()

  // Draw each particle
  const array = pjs.particles.array
  for (let i = 0; i < array.length; i++) {
    array[i].draw()
  }
}