import type { UseParticlesResult } from "@/particles/engine"

export function applyChainIdentity(engine: UseParticlesResult): void {
  const { addGroup } = engine.groups
  addGroup("chain_a_sites", { maxParticles: 512 })
  addGroup("chain_a_walls", { maxParticles: 128 })
  addGroup("chain_b_sites", { maxParticles: 512 })
  addGroup("chain_b_walls", { maxParticles: 128 })
  addGroup("clock",         { maxParticles: 256 })
}
