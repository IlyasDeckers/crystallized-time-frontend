import type { MidiMessage } from "@/hooks/use-midi"

export type MidiAction =
  | { type: "spawn_particle" }
  | { type: "apply_shape"; shape: string }
  | { type: "apply_shape3d"; shape: string }
  | { type: "set_param"; param: string }
  | { type: "pulse"; bright: boolean; fanout: number }
  | { type: "scatter" }
  | { type: "release_targets" }
  | { type: "ignore" }

export interface MidiRoute {
  /** Matches if msg.channel is in this set. Empty array = any channel. Omit = any. */
  channel?: number | number[]
  /** Matches noteOn/noteOff where note is in [min, max]. */
  noteRange?: [number, number]
  /** Matches noteOn where velocity is in [min, max]. */
  velocityRange?: [number, number]
  /** Matches cc messages where CC number equals this. */
  ccNumber?: number
  /** Constrain by message type. Omit to match any. */
  msgType?: MidiMessage["type"] | MidiMessage["type"][]
  action: MidiAction
}

export interface MidiRouterConfig {
  routes: MidiRoute[]
}

export class MidiRouter {
  private config: MidiRouterConfig

  constructor(config: MidiRouterConfig) {
    this.config = config
  }

  /** Returns the first matching route's action, or null if no route matches. */
  route(msg: MidiMessage): MidiAction | null {
    for (const route of this.config.routes) {
      if (this.matches(route, msg)) return route.action
    }
    return null
  }

  updateConfig(config: MidiRouterConfig): void {
    this.config = config
  }

  get routes(): readonly MidiRoute[] {
    return this.config.routes
  }

  private matches(route: MidiRoute, msg: MidiMessage): boolean {
    if (route.msgType !== undefined) {
      const types = Array.isArray(route.msgType) ? route.msgType : [route.msgType]
      if (!types.includes(msg.type)) return false
    }

    if (route.channel !== undefined) {
      const ch = route.channel
      if (Array.isArray(ch)) {
        if (ch.length > 0 && !ch.includes(msg.channel)) return false
      } else if (msg.channel !== ch) {
        return false
      }
    }

    if (route.ccNumber !== undefined) {
      if (msg.type !== "cc" || msg.data1 !== route.ccNumber) return false
    }

    if (route.noteRange !== undefined) {
      if (msg.type !== "noteOn" && msg.type !== "noteOff") return false
      if (msg.data1 < route.noteRange[0] || msg.data1 > route.noteRange[1]) return false
    }

    if (route.velocityRange !== undefined) {
      if (msg.type !== "noteOn") return false
      if (msg.data2 < route.velocityRange[0] || msg.data2 > route.velocityRange[1]) return false
    }

    return true
  }
}
