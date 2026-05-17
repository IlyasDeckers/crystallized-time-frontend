import type { ParticleBuffer } from "./buffer"

export interface RenderConfig {
  linkDistance: number
  linkOpacity: number
  trailMode: boolean
  /** Fraction of accumulated color faded each frame (0 = no fade, 1 = full clear). */
  trailDecay: number
  /** 0 = no glow; 1 = full glow intensity multiplier. */
  glowAmount: number
  bloomThreshold: number
  bloomIntensity: number
}

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  linkDistance: 130,
  linkOpacity: 0.35,
  trailMode: false,
  trailDecay: 0.15,
  glowAmount: 0,
  bloomThreshold: 0.5,
  bloomIntensity: 1.0,
}

export interface Renderer {
  draw(buf: ParticleBuffer, config: RenderConfig): void
  /** CSS pixel dimensions — renderer handles devicePixelRatio internally. */
  resize(cssWidth: number, cssHeight: number): void
  destroy(): void
}
