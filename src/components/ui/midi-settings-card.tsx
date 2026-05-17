import { DraggableCard } from "@/components/ui/draggable-card"
import { cn } from "@/lib/utils"
import { buildRoutes } from "@/midi/use-midi-router"

export interface MidiSettings {
  spawnChannels: number[] | null
  pulseChannels: number[] | null
  speedCC: number
  speedChannels: number[] | null
  linkDistanceCC: number
  linkDistanceChannels: number[] | null
  rotationSpeedCC: number
  rotationSpeedChannels: number[] | null
  /** Name of MIDI output port to forward all incoming messages to, or null. */
  thruOutput: string | null
}

export const DEFAULT_MIDI_SETTINGS: MidiSettings = {
  spawnChannels: [],
  pulseChannels: [15],
  speedCC: 74,
  speedChannels: [],
  linkDistanceCC: 71,
  linkDistanceChannels: [],
  rotationSpeedCC: 1,
  rotationSpeedChannels: [],
  thruOutput: null,
}

function ChannelSelect({
  channels,
  onChange,
}: {
  channels: number[] | null
  onChange: (ch: number[] | null) => void
}) {
  const isOff = channels === null
  const isAll = !isOff && channels.length === 0

  function toggle(i: number) {
    if (channels === null) return
    const next = channels.includes(i)
      ? channels.filter(c => c !== i)
      : [...channels, i].sort((a, b) => a - b)
    onChange(next)
  }

  return (
    <div className="flex flex-wrap gap-0.5">
      <button
        onClick={() => onChange(null)}
        className={cn(
          "px-1.5 py-0.5 border text-[10px]",
          isOff
            ? "bg-white text-black border-white"
            : "border-border hover:bg-muted text-muted-foreground",
        )}
      >
        off
      </button>
      <button
        onClick={() => onChange([])}
        className={cn(
          "px-1.5 py-0.5 border text-[10px]",
          isAll
            ? "bg-white text-black border-white"
            : "border-border hover:bg-muted text-muted-foreground",
        )}
      >
        all
      </button>
      {Array.from({ length: 16 }, (_, i) => (
        <button
          key={i}
          onClick={() => (isOff || isAll) ? onChange([i]) : toggle(i)}
          className={cn(
            "w-5 py-0.5 border text-[10px] text-center",
            channels !== null && channels.includes(i)
              ? "bg-white text-black border-white"
              : "border-border hover:bg-muted text-muted-foreground",
          )}
        >
          {i + 1}
        </button>
      ))}
    </div>
  )
}

function EffectRow({
  label,
  cc,
  channels,
  onCcChange,
  onChannelsChange,
}: {
  label: string
  cc?: number
  channels: number[] | null
  onCcChange?: (cc: number) => void
  onChannelsChange: (ch: number[] | null) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground w-16 shrink-0">{label}</span>
        {cc !== undefined && onCcChange && (
          <>
            <span className="text-muted-foreground">cc</span>
            <input
              type="number"
              min={0}
              max={127}
              value={cc}
              onChange={e => {
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v) && v >= 0 && v <= 127) onCcChange(v)
              }}
              className="w-10 bg-transparent border border-border px-1 py-0.5 text-[10px] text-center text-foreground"
            />
          </>
        )}
      </div>
      <ChannelSelect channels={channels} onChange={onChannelsChange} />
    </div>
  )
}

function describeChannel(ch: number | number[] | undefined): string {
  if (ch === undefined) return "any"
  if (Array.isArray(ch)) {
    if (ch.length === 0) return "any"
    return ch.map(c => `ch${c + 1}`).join(",")
  }
  return `ch${ch + 1}`
}

function RouteTable({ settings }: { settings: MidiSettings }) {
  const routes = buildRoutes(settings)
  if (routes.length === 0) return <div className="text-muted-foreground/60">no routes</div>

  return (
    <div className="space-y-0.5">
      {routes.map((r, i) => {
        const chStr = describeChannel(r.channel)
        let matchStr = ""
        if (r.msgType) {
          const types = Array.isArray(r.msgType) ? r.msgType : [r.msgType]
          matchStr += types.join("/")
        }
        if (r.noteRange) {
          const [lo, hi] = r.noteRange
          matchStr += ` note${lo === hi ? lo : `${lo}-${hi}`}`
        }
        if (r.ccNumber !== undefined) matchStr += ` cc${r.ccNumber}`
        if (r.velocityRange) matchStr += ` vel${r.velocityRange[0]}-${r.velocityRange[1]}`

        const { action } = r
        let actionStr = action.type
        if (action.type === "apply_shape" || action.type === "apply_shape3d") {
          actionStr += ` ${action.shape}`
        } else if (action.type === "set_param") {
          actionStr += ` ${action.param}`
        } else if (action.type === "pulse") {
          actionStr += action.bright ? " bright" : " dim"
        }

        return (
          <div key={i} className="flex gap-1.5 text-[9px] leading-relaxed">
            <span className="text-muted-foreground/60 w-14 shrink-0">{chStr}</span>
            <span className="text-muted-foreground w-40 shrink-0 truncate">{matchStr.trim()}</span>
            <span className="text-foreground/70">{actionStr}</span>
          </div>
        )
      })}
    </div>
  )
}

interface MidiSettingsCardProps {
  settings: MidiSettings
  onChange: (s: MidiSettings) => void
  open: boolean
  onClose: () => void
  /** Available MIDI output port names, for MIDI Thru selection. */
  outputs?: string[]
}

export function MidiSettingsCard({ settings, onChange, open, onClose, outputs = [] }: MidiSettingsCardProps) {
  function update(partial: Partial<MidiSettings>) {
    onChange({ ...settings, ...partial })
  }

  return (
    <DraggableCard
      title="midi settings"
      open={open}
      onClose={onClose}
      defaultPosition={{ x: 600, y: 72 }}
      defaultWidth={390}
    >
      <div className="space-y-3 font-mono text-[10px]">

        <EffectRow
          label="spawn"
          channels={settings.spawnChannels}
          onChannelsChange={ch => update({ spawnChannels: ch })}
        />

        <div className="border-t border-border/50 pt-2">
          <EffectRow
            label="bright pulse"
            channels={settings.pulseChannels}
            onChannelsChange={ch => update({ pulseChannels: ch })}
          />
        </div>

        <div className="border-t border-border/50 pt-2 space-y-3">
          <div className="text-muted-foreground">cc effects</div>

          <EffectRow
            label="speed"
            cc={settings.speedCC}
            channels={settings.speedChannels}
            onCcChange={v => update({ speedCC: v })}
            onChannelsChange={ch => update({ speedChannels: ch })}
          />

          <EffectRow
            label="link dist"
            cc={settings.linkDistanceCC}
            channels={settings.linkDistanceChannels}
            onCcChange={v => update({ linkDistanceCC: v })}
            onChannelsChange={ch => update({ linkDistanceChannels: ch })}
          />

          <EffectRow
            label="rotation"
            cc={settings.rotationSpeedCC}
            channels={settings.rotationSpeedChannels}
            onCcChange={v => update({ rotationSpeedCC: v })}
            onChannelsChange={ch => update({ rotationSpeedChannels: ch })}
          />
        </div>

        <div className="border-t border-border/50 pt-2 space-y-1">
          <div className="text-muted-foreground">midi thru</div>
          <select
            value={settings.thruOutput ?? ""}
            onChange={e => update({ thruOutput: e.target.value || null })}
            className="w-full bg-transparent border border-border px-1 py-0.5 text-[10px] text-foreground"
          >
            <option value="">off</option>
            {outputs.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

        <div className="border-t border-border/50 pt-2 space-y-1">
          <div className="text-muted-foreground">route table</div>
          <RouteTable settings={settings} />
        </div>

      </div>
    </DraggableCard>
  )
}
