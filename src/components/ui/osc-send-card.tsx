import { useCallback, useEffect, useRef, useState } from "react"

import { DraggableCard } from "@/components/ui/draggable-card"

export interface OscControlRoute {
  /** OSC address to send to. */
  address: string
  /** Display label shown next to the slider. */
  label: string
  min: number
  max: number
  step: number
  /** Initial slider value. */
  defaultValue: number
}

export interface OscControlGroup {
  /** Section heading. */
  title: string
  routes: OscControlRoute[]
}

// Defaults derived from the README's OSC reference table. Per-chain
// addresses share the same ranges as their shared counterparts.
export const DEFAULT_OSC_CONTROL_GROUPS: OscControlGroup[] = [
  {
    title: "physics (shared)",
    routes: [
      { address: "/physics/kt", label: "kt", min: 0, max: 2, step: 0.01, defaultValue: 0.1 },
      { address: "/physics/eps", label: "eps", min: 0, max: 0.5, step: 0.001, defaultValue: 0.01 },
      { address: "/physics/j", label: "j", min: 0, max: 3, step: 0.01, defaultValue: 1.2 },
      { address: "/physics/w", label: "w", min: 0, max: 5, step: 0.01, defaultValue: 2.0 },
    ],
  },
  {
    title: "physics (chain a)",
    routes: [
      { address: "/a/physics/kt", label: "a.kt", min: 0, max: 2, step: 0.01, defaultValue: 0.01 },
      { address: "/a/physics/eps", label: "a.eps", min: 0, max: 0.5, step: 0.001, defaultValue: 0.01 },
      { address: "/a/physics/j", label: "a.j", min: 0, max: 3, step: 0.01, defaultValue: 1.2 },
      { address: "/a/physics/w", label: "a.w", min: 0, max: 5, step: 0.01, defaultValue: 2.0 },
    ],
  },
  {
    title: "physics (chain b)",
    routes: [
      { address: "/b/physics/kt", label: "b.kt", min: 0, max: 2, step: 0.01, defaultValue: 0.1 },
      { address: "/b/physics/eps", label: "b.eps", min: 0, max: 0.5, step: 0.001, defaultValue: 0.01 },
      { address: "/b/physics/j", label: "b.j", min: 0, max: 3, step: 0.01, defaultValue: 1.2 },
      { address: "/b/physics/w", label: "b.w", min: 0, max: 5, step: 0.01, defaultValue: 2.0 },
    ],
  },
  {
    title: "coupling",
    routes: [
      { address: "/coupling/strength", label: "a↔b", min: 0, max: 2, step: 0.01, defaultValue: 0.1 },
      { address: "/coupling/strength_ab", label: "a→b", min: 0, max: 2, step: 0.01, defaultValue: 0.1 },
      { address: "/coupling/strength_ba", label: "b→a", min: 0, max: 2, step: 0.01, defaultValue: 0.05 },
    ],
  },
]

interface OscSendCardProps {
  open: boolean
  onClose: () => void
  send: (address: string, ...args: (number | string | boolean)[]) => void
  /** Whether the underlying OSC connection is live. Disables sliders when false. */
  enabled: boolean
  groups?: OscControlGroup[]
  /** Min ms between sends per slider while dragging. Default 33ms (~30Hz). */
  throttleMs?: number
}

interface SliderRowProps {
  route: OscControlRoute
  enabled: boolean
  throttleMs: number
  send: (address: string, ...args: (number | string | boolean)[]) => void
}

function SliderRow({ route, enabled, throttleMs, send }: SliderRowProps) {
  const [value, setValue] = useState(route.defaultValue)
  // Throttle state per-row so a fast drag doesn't flood the bridge.
  const lastSentAt = useRef(0)
  const pendingTimer = useRef<number | null>(null)
  const pendingValue = useRef<number | null>(null)

  const dispatch = useCallback(
    (v: number) => {
      lastSentAt.current = performance.now()
      pendingValue.current = null
      send(route.address, v)
    },
    [route.address, send]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value)
      setValue(v)
      if (!enabled) return

      const now = performance.now()
      const sinceLast = now - lastSentAt.current
      if (sinceLast >= throttleMs) {
        dispatch(v)
        return
      }
      // Schedule a trailing send so the final value isn't dropped.
      pendingValue.current = v
      if (pendingTimer.current !== null) return
      pendingTimer.current = window.setTimeout(() => {
        pendingTimer.current = null
        const pv = pendingValue.current
        if (pv !== null) dispatch(pv)
      }, throttleMs - sinceLast)
    },
    [enabled, throttleMs, dispatch]
  )

  // Flush pending sends on unmount.
  useEffect(() => {
    return () => {
      if (pendingTimer.current !== null) {
        window.clearTimeout(pendingTimer.current)
        pendingTimer.current = null
      }
    }
  }, [])

  // Decimal places for display: derive from step so 0.001 shows 3dp, etc.
  const decimals = route.step >= 1 ? 0 : Math.min(4, -Math.floor(Math.log10(route.step)))

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{route.label}</span>
        <span className="text-foreground tabular-nums">{value.toFixed(decimals)}</span>
      </div>
      <input
        type="range"
        min={route.min}
        max={route.max}
        step={route.step}
        value={value}
        disabled={!enabled}
        onChange={handleChange}
        className="w-full h-1 accent-foreground disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
      />
    </div>
  )
}

export function OscSendCard({
                              open,
                              onClose,
                              send,
                              enabled,
                              groups = DEFAULT_OSC_CONTROL_GROUPS,
                              throttleMs = 33,
                            }: OscSendCardProps) {
  return (
    <DraggableCard
      title="osc send"
      open={open}
      onClose={onClose}
      defaultPosition={{ x: 320, y: 72 }}
      defaultWidth={260}
    >
      <div className="space-y-3 font-mono">
        {!enabled && (
          <div className="text-muted-foreground/60 text-[10px]">
            not connected — sliders disabled
          </div>
        )}
        {groups.map((group) => (
          <div key={group.title} className="space-y-2">
            <div className="text-muted-foreground/80 text-[10px] uppercase tracking-wider">
              {group.title}
            </div>
            <div className="space-y-2">
              {group.routes.map((route) => (
                <SliderRow
                  key={route.address}
                  route={route}
                  enabled={enabled}
                  throttleMs={throttleMs}
                  send={send}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </DraggableCard>
  )
}