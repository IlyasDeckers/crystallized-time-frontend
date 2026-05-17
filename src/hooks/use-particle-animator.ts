import { useCallback, useEffect, useRef } from "react"
import type { FrameHook, UseParticlesResult } from "@/particles/engine"
import { STRIDE, F } from "@/particles/buffer"

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
  const savedVxRef = useRef<Float32Array>(new Float32Array(0))
  const savedVyRef = useRef<Float32Array>(new Float32Array(0))
  const hasSavedRef = useRef<Uint8Array>(new Uint8Array(0))
  const isAnimatingRef = useRef(false)
  const particlesApiRef = useRef(particlesApi)
  useEffect(() => { particlesApiRef.current = particlesApi }, [particlesApi])

  const frameHook = useCallback<FrameHook>(({ buf, dt }) => {
    const targets = targetsRef.current
    if (!targets || targets.length === 0) return

    const capacity = buf.capacity

    if (savedVxRef.current.length !== capacity) {
      savedVxRef.current = new Float32Array(capacity)
      savedVyRef.current = new Float32Array(capacity)
      hasSavedRef.current = new Uint8Array(capacity)
    }

    let anyMoving = false
    let aliveIdx = 0

    for (let i = 0; i < capacity; i++) {
      const b = i * STRIDE
      if (buf.data[b + F.AGE] >= buf.data[b + F.LIFETIME]) continue

      const target = targets[aliveIdx % targets.length]
      aliveIdx++

      if (!hasSavedRef.current[i]) {
        savedVxRef.current[i] = buf.data[b + F.VX]
        savedVyRef.current[i] = buf.data[b + F.VY]
        hasSavedRef.current[i] = 1
      }

      const dx = target.x - buf.data[b + F.X]
      const dy = target.y - buf.data[b + F.Y]
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist > arrivalThreshold) {
        anyMoving = true
        const factor = 1 - Math.exp(-lerpSpeed * dt)
        buf.data[b + F.X] += dx * factor
        buf.data[b + F.Y] += dy * factor
        buf.data[b + F.VX] = 0
        buf.data[b + F.VY] = 0
      } else {
        buf.data[b + F.X] = target.x
        buf.data[b + F.Y] = target.y
        buf.data[b + F.VX] = 0
        buf.data[b + F.VY] = 0
      }
    }

    isAnimatingRef.current = anyMoving
  }, [lerpSpeed, arrivalThreshold])

  useEffect(() => {
    if (!particlesApi?.ready) return
    return particlesApi.addFrameHook(frameHook)
  }, [particlesApi?.ready, particlesApi, frameHook])

  const setTargets = useCallback((targets: Point[] | null) => {
    targetsRef.current = targets

    if (targets === null || targets.length === 0) {
      const buf = particlesApiRef.current?.buf
      if (restoreVelocityOnRelease && buf) {
        const capacity = buf.capacity
        for (let i = 0; i < capacity; i++) {
          if (!hasSavedRef.current[i]) continue
          const b = i * STRIDE
          if (buf.data[b + F.AGE] < buf.data[b + F.LIFETIME]) {
            buf.data[b + F.VX] = savedVxRef.current[i]
            buf.data[b + F.VY] = savedVyRef.current[i]
          }
        }
      }
      savedVxRef.current.fill(0)
      savedVyRef.current.fill(0)
      hasSavedRef.current.fill(0)
      isAnimatingRef.current = false
    }
  }, [restoreVelocityOnRelease])

  const scatter = useCallback((strength = 5) => {
    const buf = particlesApiRef.current?.buf
    if (!buf) return
    targetsRef.current = null
    savedVxRef.current.fill(0)
    savedVyRef.current.fill(0)
    hasSavedRef.current.fill(0)

    for (let i = 0; i < buf.capacity; i++) {
      const b = i * STRIDE
      if (buf.data[b + F.AGE] < buf.data[b + F.LIFETIME]) {
        const angle = Math.random() * Math.PI * 2
        buf.data[b + F.VX] = Math.cos(angle) * strength * (0.5 + Math.random())
        buf.data[b + F.VY] = Math.sin(angle) * strength * (0.5 + Math.random())
      }
    }
  }, [])

  return {
    setTargets,
    scatter,
    get isAnimating() { return isAnimatingRef.current },
  }
}
