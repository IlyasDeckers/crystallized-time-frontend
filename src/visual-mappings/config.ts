export interface Rect { x: number; y: number; w: number; h: number }

export interface ChainZones {
  sites: Rect
  walls: Rect
}

export interface ChainConfig {
  zones: ChainZones
  hue: number
}

export interface Band {
  name: string
  /** Fraction of canvas height where this band starts (0–1). */
  yStart: number
  /** Fraction of canvas height where this band ends (0–1). */
  yEnd: number
}

export interface VisualMappingConfig {
  chainA: ChainConfig
  chainB: ChainConfig
  siteCount: number
  /** Four horizontal bands dividing the viewport, reconfigurable without code changes. */
  bands: Band[]
}

/**
 * Build config from current canvas pixel dimensions.
 * Layout (top → bottom):
 *   0–20%   chain A walls
 *   20–50%  chain A sites/gates
 *   50–70%  chain B walls
 *   70–100% chain B sites/gates
 */
export function makeConfig(cw: number, ch: number): VisualMappingConfig {
  return {
    chainA: {
      zones: {
        walls: { x: 0, y: 0,         w: cw, h: ch * 0.20 },
        sites: { x: 0, y: ch * 0.20, w: cw, h: ch * 0.30 },
      },
      hue: 30,
    },
    chainB: {
      zones: {
        walls: { x: 0, y: ch * 0.50, w: cw, h: ch * 0.20 },
        sites: { x: 0, y: ch * 0.70, w: cw, h: ch * 0.30 },
      },
      hue: 210,
    },
    siteCount: 8,
    bands: [
      { name: "chain_a_walls", yStart: 0.00, yEnd: 0.20 },
      { name: "chain_a_gates", yStart: 0.20, yEnd: 0.50 },
      { name: "chain_b_walls", yStart: 0.50, yEnd: 0.70 },
      { name: "chain_b_gates", yStart: 0.70, yEnd: 1.00 },
    ],
  }
}
