import type { UseParticlesResult } from "@/particles/engine"
import type { BackendEvent } from "@/backend/event-types"
import type { VisualMappingConfig } from "./config"
import { hslToRgb } from "./color"

function velocityToCount(vel: number): number {
  return Math.max(2, Math.round((vel / 127) * 12))
}

export function handleGatePulse(
  engine: UseParticlesResult,
  config: VisualMappingConfig,
  event: Extract<BackendEvent, { type: "gate" }>,
): void {
  const { chain, site, velocity } = event
  const chainCfg = chain === "a" ? config.chainA : config.chainB
  const zone = chainCfg.zones.sites
  const { siteCount } = config

  const x = zone.x + ((site + 0.5) / siteCount) * zone.w + (Math.random() - 0.5) * zone.w * 0.3
  const y = zone.y + zone.h * 0.5 + (Math.random() - 0.5) * zone.h * 0.3

  const speed = 20 + (velocity / 127) * 80
  const [r, g, b] = hslToRgb(chainCfg.hue, 0.9, 0.6)
  const group = chain === "a" ? "chain_a_sites" : "chain_b_sites"

  engine.burst({
    group,
    count: velocityToCount(velocity),
    x,
    y,
    speed,
    spread: 10,
    r,
    g,
    b,
    opacity: 0.7 + (velocity / 127) * 0.3,
    size: 2 + (velocity / 127) * 3,
    lifetime: 2 + (velocity / 127) * 3,
  })
}
