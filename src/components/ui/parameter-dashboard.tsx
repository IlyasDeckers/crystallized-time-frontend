import { useCallback, useEffect, useState } from "react"
import { paramStore, PARAM_DEFS, type ParamKey } from "@/particles/param-store"
import { registerCC } from "@/midi/cc-registry"
import { midiLearn } from "@/midi/learn"

interface ParamGroup {
  label: string
  keys: ParamKey[]
}

const PARAM_GROUPS: ParamGroup[] = [
  {
    label: "Particles",
    keys: ["speed", "particleSize", "maxCount", "morphSpeed", "pulseFanout", "pulseDecay"],
  },
  {
    label: "Rendering",
    keys: ["linkDistance", "linkOpacity", "trailDecay", "glowAmount"],
  },
  {
    label: "Post-processing",
    keys: ["bloomThreshold", "bloomIntensity"],
  },
  {
    label: "Rotation",
    keys: ["rotationX", "rotationY", "rotationZ"],
  },
  {
    label: "Background",
    keys: ["backgroundR", "backgroundG", "backgroundB"],
  },
]

export function ParameterDashboard() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [values, setValues] = useState<Record<string, number | string>>(() => {
    const v: Record<string, number | string> = {}
    for (const key of Object.keys(PARAM_DEFS) as ParamKey[]) {
      v[key] = paramStore.get(key)
    }
    return v
  })
  const [learnTarget, setLearnTarget] = useState<string | null>(null)

  // Subscribe to all param changes
  useEffect(() => {
    const unsubs = (Object.keys(PARAM_DEFS) as ParamKey[]).map((key) =>
      paramStore.subscribe(key, (v) => {
        setValues((prev) => ({ ...prev, [key]: v }))
      })
    )
    return () => unsubs.forEach((u) => u())
  }, [])

  // Escape key cancels learn mode
  useEffect(() => {
    if (!learnTarget) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        midiLearn.cancel()
        setLearnTarget(null)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [learnTarget])

  function startLearn(param: string) {
    if (learnTarget === param) {
      midiLearn.cancel()
      setLearnTarget(null)
      return
    }
    midiLearn.start(param, (cc) => {
      const def = PARAM_DEFS[param as ParamKey]
      if (def) {
        registerCC({
          cc,
          param,
          range: [
            typeof def.min === "number" ? def.min : 0,
            typeof def.max === "number" ? def.max : 1,
          ],
        })
      }
      setLearnTarget(null)
    })
    setLearnTarget(param)
  }

  const handleSlider = useCallback((key: ParamKey, raw: number) => {
    const def = PARAM_DEFS[key]
    const min = def.min ?? 0
    const max = def.max ?? 1
    const value = min + (raw / 100) * (max - min)
    paramStore.set(key, value)
  }, [])

  function sliderPercent(key: ParamKey): number {
    const v = values[key]
    if (typeof v !== "number") return 0
    const def = PARAM_DEFS[key]
    const min = def.min ?? 0
    const max = def.max ?? 1
    return Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))
  }

  function toggleCollapse(label: string) {
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }))
  }

  return (
    <div className="space-y-1 font-mono text-xs">
      {learnTarget && (
        <div className="px-2 py-1 border border-yellow-400/50 bg-yellow-400/10 text-yellow-400 text-[10px]">
          move a CC knob to bind to <strong>{learnTarget}</strong> — Esc to cancel
        </div>
      )}

      {PARAM_GROUPS.map((group) => (
        <div key={group.label}>
          <button
            onClick={() => toggleCollapse(group.label)}
            className="w-full flex items-center justify-between py-0.5 text-muted-foreground hover:text-foreground"
          >
            <span>{group.label}</span>
            <span>{collapsed[group.label] ? "+" : "−"}</span>
          </button>

          {!collapsed[group.label] && (
            <div className="space-y-1.5 pl-1 pt-1">
              {group.keys.map((key) => {
                const def = PARAM_DEFS[key]
                const isString = typeof def.default === "string"
                const isLearning = learnTarget === key

                return (
                  <div key={key} className="space-y-0.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-muted-foreground truncate flex-1">{key}</span>
                      <span className="text-foreground tabular-nums text-[10px] w-14 text-right">
                        {isString
                          ? String(values[key])
                          : typeof values[key] === "number"
                            ? (values[key] as number).toFixed(2)
                            : "—"}
                      </span>
                      <button
                        onClick={() => startLearn(key)}
                        className={`px-1 py-0 border text-[9px] flex-shrink-0 ${
                          isLearning
                            ? "border-yellow-400 text-yellow-400 animate-pulse"
                            : "border-border text-muted-foreground/50 hover:bg-muted"
                        }`}
                        title="MIDI learn"
                      >
                        L
                      </button>
                    </div>

                    {!isString && (
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={0.1}
                        value={sliderPercent(key)}
                        onChange={(e) => handleSlider(key, parseFloat(e.target.value))}
                        className="w-full h-1 accent-foreground cursor-pointer"
                      />
                    )}

                    {isString && (
                      <div className="flex gap-1">
                        {["on", "off"].map((v) => (
                          <button
                            key={v}
                            onClick={() => paramStore.set(key, v)}
                            className={`px-1.5 py-0 border text-[9px] ${
                              values[key] === v
                                ? "border-foreground text-foreground"
                                : "border-border text-muted-foreground/50 hover:bg-muted"
                            }`}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
