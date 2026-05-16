import { useCallback, useEffect, useRef } from "react"
import type { FrameHook, UseParticlesResult } from "@/hooks/use-particles"

export interface Point {
  x: number
  y: number
}

export interface AnimatorConfig {
  lerpSpeed?: number
  arrivalThreshold?: number
  restoreVelocityOnRelease?: boolean
}

export interface UseParticleAnimatorResult {
  setTargets: (targets: Point[] | null) => void
  scatter: (strength?: number) => void
  isAnimating: boolean
}

export function useParticleAnimator(
  particlesApi: UseParticlesResult | null,
  config: AnimatorConfig = {},
): UseParticleAnimatorResult {
  const {
    lerpSpeed = 3.0,
    arrivalThreshold = 2,
    restoreVelocityOnRelease = true,
  } = config

  const targetsRef = useRef<Point[] | null>(null)
  const savedVelocitiesRef = useRef<Map<number, { vx: number; vy: number }>>(new Map())
  const isAnimatingRef = useRef(false)

  const frameHook = useCallback<FrameHook>(({ particles, dt }) => {
    const targets = targetsRef.current
    if (!targets || targets.length === 0) return

    let anyMoving = false

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      const target = targets[i % targets.length]

      if (!savedVelocitiesRef.current.has(i)) {
        savedVelocitiesRef.current.set(i, {
          vx: p.vx as number,
          vy: p.vy as number,
        })
      }

      const dx = target.x - p.x
      const dy = target.y - p.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist > arrivalThreshold) {
        anyMoving = true
        const factor = 1 - Math.exp(-lerpSpeed * dt)
        p.x += dx * factor
        p.y += dy * factor
        p.vx = 0
        p.vy = 0
      } else {
        p.x = target.x
        p.y = target.y
        p.vx = 0
        p.vy = 0
      }
    }

    isAnimatingRef.current = anyMoving
  }, [lerpSpeed, arrivalThreshold])

  // Register the frame hook eagerly as soon as particlesApi is ready
  useEffect(() => {
    if (!particlesApi?.ready) return
    const cleanup = particlesApi.addFrameHook(frameHook)
    return cleanup
  }, [particlesApi?.ready, particlesApi, frameHook])

  const setTargets = useCallback((targets: Point[] | null) => {
    targetsRef.current = targets

    if (targets === null || targets.length === 0) {
      if (restoreVelocityOnRelease && particlesApi?.particles) {
        for (let i = 0; i < particlesApi.particles.length; i++) {
          const saved = savedVelocitiesRef.current.get(i)
          if (saved) {
            particlesApi.particles[i].vx = saved.vx
            particlesApi.particles[i].vy = saved.vy
          }
        }
      }
      savedVelocitiesRef.current.clear()
      isAnimatingRef.current = false
    }
  }, [particlesApi, restoreVelocityOnRelease])

  const scatter = useCallback((strength = 5) => {
    if (!particlesApi?.particles) return
    targetsRef.current = null
    savedVelocitiesRef.current.clear()

    for (const p of particlesApi.particles) {
      const angle = Math.random() * Math.PI * 2
      p.vx = Math.cos(angle) * strength * (0.5 + Math.random())
      p.vy = Math.sin(angle) * strength * (0.5 + Math.random())
    }
  }, [particlesApi])

  return {
    setTargets,
    scatter,
    get isAnimating() { return isAnimatingRef.current },
  }
}