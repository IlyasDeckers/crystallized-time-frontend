import { useState } from "react"
import type { UseOscResult, OscQuality } from "@/hooks/use-osc"

interface Props {
  osc: UseOscResult
}

function dotColor(status: UseOscResult["status"], quality: OscQuality): string {
  if (status !== "connected") return "bg-destructive"
  if (quality.droppedMessages > 0 || quality.latencyMs > 200) return "bg-yellow-400"
  if (quality.latencyMs > 50) return "bg-yellow-400"
  return "bg-green-400"
}

export function ConnectionStatus({ osc }: Props) {
  const [open, setOpen] = useState(false)
  const color = dotColor(osc.status, osc.quality)

  return (
    <div className="fixed top-2 right-2 z-50 font-mono text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 border border-border bg-background/80 backdrop-blur hover:bg-muted"
        title="OSC connection status"
      >
        <span className={`w-2 h-2 rounded-full ${color} inline-block`} />
        <span className="text-muted-foreground">osc</span>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-52 border border-border bg-background/95 backdrop-blur p-2 space-y-1.5">
          <div className="flex justify-between">
            <span className="text-muted-foreground">status</span>
            <span className="text-foreground">{osc.status}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">latency</span>
            <span className="text-foreground">
              {osc.quality.latencyMs > 0 ? `${osc.quality.latencyMs}ms` : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">dropped</span>
            <span className="text-foreground">{osc.quality.droppedMessages}</span>
          </div>
          {osc.quality.reconnectIn > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">reconnect in</span>
              <span className="text-foreground">{Math.ceil(osc.quality.reconnectIn / 1000)}s</span>
            </div>
          )}
          {osc.error && (
            <div className="text-destructive/80 text-[10px] break-all">{osc.error}</div>
          )}
          {osc.status !== "connected" && (
            <button
              onClick={() => { osc.connect(); setOpen(false) }}
              className="w-full px-2 py-0.5 border border-border hover:bg-muted"
            >
              reconnect now
            </button>
          )}

          {/* Latency sparkline — last 20 values */}
          <LatencySparkline history={osc.quality.latencyHistory} />
        </div>
      )}
    </div>
  )
}

function LatencySparkline({ history }: { history: number[] }) {
  if (history.length < 2) return null
  const max = Math.max(...history, 100)
  const w = 192
  const h = 24
  const pts = history.map((v, i) => {
    const x = (i / (history.length - 1)) * w
    const y = h - (v / max) * h
    return `${x},${y}`
  }).join(" ")

  return (
    <div>
      <div className="text-muted-foreground/60 text-[10px] mb-0.5">latency history</div>
      <svg width={w} height={h} className="overflow-visible">
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1" className="text-muted-foreground/50" />
      </svg>
    </div>
  )
}
