import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { useParticles, type EngineConfig, type UseParticlesResult } from "@/particles/engine"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParticlesStageProps {
  config?: EngineConfig
  /** Number of immortal ambient particles to spawn on mount. */
  initialCount?: number
  /** Speed for initial ambient particles. */
  initialSpeed?: number
  className?: string
  onReady?: (particles: UseParticlesResult) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ParticlesStage({
  config = {},
  initialCount = 0,
  initialSpeed = 1.5,
  className,
  onReady,
}: ParticlesStageProps) {
  const particles = useParticles(config)
  const onReadyRef = useRef(onReady)
  const ambientSetupDoneRef = useRef(false)

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    if (!particles.ready || ambientSetupDoneRef.current) return
    ambientSetupDoneRef.current = true

    if (initialCount > 0) {
      try {
        particles.groups.addGroup("ambient", { maxParticles: initialCount })
      } catch { /* already exists on hot-reload */ }

      const w = particles.canvasSize.w || window.innerWidth
      const h = particles.canvasSize.h || window.innerHeight
      for (let i = 0; i < initialCount; i++) {
        particles.burst({
          group: "ambient",
          count: 1,
          x: Math.random() * w,
          y: Math.random() * h,
          speed: initialSpeed,
          r: 1, g: 1, b: 1,
          opacity: 0.7,
          size: 2.5,
        })
      }
    }

    onReadyRef.current?.(particles)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [particles.ready])

  return (
    <canvas
      ref={particles.canvasRef}
      className={cn("absolute inset-0 w-full h-full", className)}
      style={{ display: "block" }}
    />
  )
}
