import {useEffect, useRef} from "react"
import {cn} from "@/lib/utils"
import {useParticles, type ParticlesConfig, type UseParticlesResult} from "../../hooks/use-particles"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParticlesStageProps {
  /** Must be stable across renders — used as the particles.js DOM id. */
  id?: string
  config?: ParticlesConfig
  className?: string
  /**
   * Callback fired once particles.js is ready and the hook result is
   * available. Wire your MIDI/OSC effects here.
   */
  onReady?: (particles: UseParticlesResult) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ParticlesStage({
                                 id = "particles-stage",
                                 config,
                                 className,
                                 onReady,
                               }: ParticlesStageProps) {
  const particles = useParticles(id, config)
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    if (particles.ready) {
      onReadyRef.current?.(particles)
    }
    // We only want this to fire once when ready flips to true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [particles.ready])

  return (
    <div id={id} className={cn("absolute inset-0", className)} style={{background: "transparent"}}/>
  )
}