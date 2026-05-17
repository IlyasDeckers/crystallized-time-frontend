import { useEffect, useRef, useState } from "react"
import type { MidiMessage } from "@/hooks/use-midi"

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
function noteName(n: number): string {
  return NOTE_NAMES[n % 12] + Math.floor(n / 12 - 1)
}

interface ChannelState {
  active: boolean
  lastNote: number | null
  lastVelocity: number
  muted: boolean
}

interface Props {
  /** Subscribe to raw MIDI messages */
  subscribe: (cb: (msg: MidiMessage) => void) => () => void
  onMuteChange?: (channel: number, muted: boolean) => void
}

const FADE_MS = 500

export function ChannelStrip({ subscribe, onMuteChange }: Props) {
  const [channels, setChannels] = useState<ChannelState[]>(() =>
    Array.from({ length: 16 }, () => ({
      active: false,
      lastNote: null,
      lastVelocity: 0,
      muted: false,
    }))
  )
  const timersRef = useRef<(ReturnType<typeof setTimeout> | null)[]>(
    Array.from({ length: 16 }, () => null)
  )

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type !== "noteOn" && msg.type !== "noteOff" && msg.type !== "cc") return
      const ch = msg.channel
      if (ch < 0 || ch > 15) return

      if (msg.type === "noteOn") {
        setChannels((prev) => {
          const next = [...prev]
          next[ch] = { ...next[ch], active: true, lastNote: msg.data1, lastVelocity: msg.data2 }
          return next
        })
        // Schedule LED fade-out
        if (timersRef.current[ch]) clearTimeout(timersRef.current[ch]!)
        timersRef.current[ch] = setTimeout(() => {
          setChannels((prev) => {
            const next = [...prev]
            next[ch] = { ...next[ch], active: false }
            return next
          })
          timersRef.current[ch] = null
        }, FADE_MS)
      }
    })
  }, [subscribe])

  function toggleMute(ch: number) {
    setChannels((prev) => {
      const next = [...prev]
      const muted = !next[ch].muted
      next[ch] = { ...next[ch], muted }
      onMuteChange?.(ch, muted)
      return next
    })
  }

  return (
    <div className="space-y-0.5 font-mono text-[10px]">
      {channels.map((state, i) => (
        <div key={i} className="flex items-center gap-1 h-5">
          {/* LED */}
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors duration-150 ${
              state.active
                ? "bg-green-400"
                : "bg-muted-foreground/20"
            }`}
          />
          {/* Channel number */}
          <span className="text-muted-foreground w-5 text-right flex-shrink-0">
            {i + 1}
          </span>
          {/* Note name */}
          <span className="text-foreground w-8 flex-shrink-0 truncate">
            {state.lastNote !== null ? noteName(state.lastNote) : "—"}
          </span>
          {/* Velocity bar */}
          <div className="flex-1 h-1.5 bg-muted rounded-none overflow-hidden min-w-0">
            <div
              className="h-full bg-foreground/60 transition-all duration-150"
              style={{ width: `${(state.lastVelocity / 127) * 100}%` }}
            />
          </div>
          {/* Mute toggle */}
          <button
            onClick={() => toggleMute(i)}
            className={`flex-shrink-0 px-1 py-0 border text-[9px] ${
              state.muted
                ? "border-destructive/60 text-destructive/70 bg-destructive/10"
                : "border-border text-muted-foreground/50 hover:bg-muted"
            }`}
          >
            M
          </button>
        </div>
      ))}
    </div>
  )
}
