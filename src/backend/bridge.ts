import { useCallback, useEffect, useRef, useState } from "react"
import type { UseOscResult } from "@/hooks/use-osc"
import type { MidiMessage } from "@/hooks/use-midi"
import type { BackendEvent, Chain } from "./event-types"
import { OSC } from "./osc-addresses"

export interface BridgeConfig {
  /** 0-indexed MIDI channel for clock (default 15 = MIDI ch 16). */
  clockChannel: number
  /** 0-indexed MIDI channels for wall held notes (default [4,5,6,7] = MIDI ch 5-8). */
  wallChannels: number[]
  /** 0-indexed MIDI channels for gate pulses (default [0,1,2,3] = MIDI ch 1-4). */
  gateChannels: number[]
  /** CC number that carries wall position (default 1 = mod wheel). */
  wallCC: number
}

const DEFAULT_CONFIG: BridgeConfig = {
  clockChannel: 15,
  wallChannels: [4, 5, 6, 7],
  gateChannels: [0, 1, 2, 3],
  wallCC: 1,
}

const LOG_SIZE = 100

export interface UseBackendBridgeResult {
  /** Rolling buffer of recent events, newest last. */
  events: BackendEvent[]
  /** Subscribe to all emitted events. Returns a cleanup function. */
  subscribe: (handler: (event: BackendEvent) => void) => () => void
  /**
   * Feed a MIDI message into the bridge.
   * Wire this up as the `onMessage` callback for `useMidi` in Stage 6.
   */
  handleMidi: (msg: MidiMessage) => void
}

function guardNum(args: unknown[], idx: number, ctx: string): number | null {
  const v = args[idx]
  if (typeof v !== "number" || !isFinite(v)) {
    console.warn(`[bridge] ${ctx}: arg[${idx}] expected number, got`, v)
    return null
  }
  return v
}

function mergeConfig(partial: Partial<BridgeConfig>): BridgeConfig {
  return { ...DEFAULT_CONFIG, ...partial }
}

export function useBackendBridge(
  osc: UseOscResult,
  config: Partial<BridgeConfig> = {}
): UseBackendBridgeResult {
  const [events, setEvents] = useState<BackendEvent[]>([])
  const subscribersRef = useRef<Set<(event: BackendEvent) => void>>(new Set())
  const cfgRef = useRef<BridgeConfig>(mergeConfig(config))

  // Keep config ref current each render without triggering effects.
  cfgRef.current = mergeConfig(config)

  const emit = useCallback((event: BackendEvent) => {
    setEvents((prev) => {
      const next = prev.length >= LOG_SIZE ? prev.slice(prev.length - LOG_SIZE + 1) : prev
      return [...next, event]
    })
    for (const sub of subscribersRef.current) sub(event)
  }, [])

  const subscribe = useCallback(
    (handler: (event: BackendEvent) => void): (() => void) => {
      subscribersRef.current.add(handler)
      return () => { subscribersRef.current.delete(handler) }
    },
    []
  )

  // OSC subscriptions — parse by argument position with type guards.
  // Bundle timetag scheduling is not exposed by use-osc.ts; messages are
  // processed on receipt. Backend-side throttling on state messages is assumed.
  useEffect(() => {
    const { subscribe: oscSub } = osc

    function siteEvent(chain: Chain, args: unknown[]) {
      const site      = guardNum(args, 0, `/${chain}/site/event site`)
      const voice     = guardNum(args, 1, `/${chain}/site/event voice`)
      const intensity = guardNum(args, 2, `/${chain}/site/event intensity`)
      if (site === null || voice === null || intensity === null) return
      emit({ type: "site_event", chain, site, voice, intensity })
    }

    function clockPulse(chain: Chain, args: unknown[]) {
      const magnetization = guardNum(args, 0, `/${chain}/clock/pulse magnetization`)
      if (magnetization === null) return
      emit({ type: "clock_pulse", chain, magnetization })
    }

    function state(chain: Chain, args: unknown[]) {
      // arg 0: magnetization, arg 1: wallCount, args 2+: per-site spins
      const magnetization = guardNum(args, 0, `/${chain}/state magnetization`)
      const wallCount     = guardNum(args, 1, `/${chain}/state wallCount`)
      if (magnetization === null || wallCount === null) return
      const spins: number[] = []
      for (let i = 2; i < args.length; i++) {
        const s = guardNum(args, i, `/${chain}/state spins[${i - 2}]`)
        if (s !== null) spins.push(s)
      }
      emit({ type: "state", chain, magnetization, wallCount, spins })
    }

    function wallCreated(chain: Chain, args: unknown[]) {
      const id       = guardNum(args, 0, `/${chain}/wall/created id`)
      const position = guardNum(args, 1, `/${chain}/wall/created position`)
      const channel  = guardNum(args, 2, `/${chain}/wall/created channel`)
      if (id === null || position === null || channel === null) return
      emit({ type: "wall_created", chain, id, position, channel })
    }

    function wallDestroyed(chain: Chain, args: unknown[]) {
      const id           = guardNum(args, 0, `/${chain}/wall/destroyed id`)
      const lastPosition = guardNum(args, 1, `/${chain}/wall/destroyed lastPosition`)
      const lifetime     = guardNum(args, 2, `/${chain}/wall/destroyed lifetime`)
      if (id === null || lastPosition === null || lifetime === null) return
      emit({ type: "wall_destroyed", chain, id, lastPosition, lifetime })
    }

    function wallMoved(chain: Chain, args: unknown[]) {
      const id       = guardNum(args, 0, `/${chain}/wall/moved id`)
      const from     = guardNum(args, 1, `/${chain}/wall/moved from`)
      const to       = guardNum(args, 2, `/${chain}/wall/moved to`)
      const velocity = guardNum(args, 3, `/${chain}/wall/moved velocity`)
      if (id === null || from === null || to === null || velocity === null) return
      emit({ type: "wall_moved", chain, id, from, to, velocity })
    }

    const unsubs = [
      oscSub(OSC.A_SITE_EVENT,     (args) => siteEvent("a", args)),
      oscSub(OSC.B_SITE_EVENT,     (args) => siteEvent("b", args)),
      oscSub(OSC.A_CLOCK_PULSE,    (args) => clockPulse("a", args)),
      oscSub(OSC.B_CLOCK_PULSE,    (args) => clockPulse("b", args)),
      oscSub(OSC.A_STATE,          (args) => state("a", args)),
      oscSub(OSC.B_STATE,          (args) => state("b", args)),
      oscSub(OSC.A_WALL_CREATED,   (args) => wallCreated("a", args)),
      oscSub(OSC.B_WALL_CREATED,   (args) => wallCreated("b", args)),
      oscSub(OSC.A_WALL_DESTROYED, (args) => wallDestroyed("a", args)),
      oscSub(OSC.B_WALL_DESTROYED, (args) => wallDestroyed("b", args)),
      oscSub(OSC.A_WALL_MOVED,     (args) => wallMoved("a", args)),
      oscSub(OSC.B_WALL_MOVED,     (args) => wallMoved("b", args)),
    ]

    return () => { unsubs.forEach((u) => u()) }
  }, [osc.subscribe, emit])

  const handleMidi = useCallback(
    (msg: MidiMessage) => {
      const { channel, type, data1: pitch, data2: vel } = msg
      const { clockChannel, wallChannels, gateChannels, wallCC } = cfgRef.current

      if (type === "noteOn") {
        // Clock channel: noteOn used purely as timing marker, OSC carries the data
        if (channel === clockChannel) return
        if (wallChannels.includes(channel)) {
          emit({ type: "wall_note_on", chain: "a", channel, pitch })
          return
        }
        if (gateChannels.includes(channel)) {
          const site = gateChannels.indexOf(channel)
          emit({ type: "gate", chain: "a", site, pitch, velocity: vel, channel })
          return
        }
        emit({ type: "noteOn", channel, pitch, velocity: vel })
      } else if (type === "noteOff") {
        if (wallChannels.includes(channel)) {
          emit({ type: "wall_note_off", chain: "a", channel, pitch })
          return
        }
        emit({ type: "noteOff", channel, pitch })
      } else if (type === "cc") {
        if (wallChannels.includes(channel) && pitch === wallCC) {
          emit({ type: "wall_motion", chain: "a", cc: pitch, value: vel, channel })
          return
        }
        emit({ type: "cc", channel, cc: pitch, value: vel })
      }
    },
    [emit]
  )

  return { events, subscribe, handleMidi }
}
