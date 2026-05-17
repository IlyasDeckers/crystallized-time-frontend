export interface Rect { x: number; y: number; w: number; h: number }

export interface ChainZones {
  sites: Rect
  walls: Rect
}

export interface ChainConfig {
  zones: ChainZones
  hue: number
}

export interface VisualMappingConfig {
  chainA: ChainConfig
  chainB: ChainConfig
  siteCount: number
}

/**
 * Build config from current canvas pixel dimensions.
 * Layout (top → bottom):
 *   0–20%   chain A walls
 *   25–50%  chain A sites
 *   50–70%  chain B walls
 *   70–100% chain B sites
 */
export function makeConfig(cw: number, ch: number): VisualMappingConfig {
  return {
    chainA: {
      zones: {
        walls: { x: 0, y: 0,         w: cw, h: ch * 0.20 },
        sites: { x: 0, y: ch * 0.25, w: cw, h: ch * 0.25 },
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
  }
}
