import { DraggableCard } from "@/components/ui/draggable-card"
import { cn } from "@/lib/utils"

export interface MidiSettings {
  spawnChannels: number[] | null
  pulseChannels: number[] | null
  speedCC: number
  speedChannels: number[] | null
  linkDistanceCC: number
  linkDistanceChannels: number[] | null
  rotationSpeedCC: number
  rotationSpeedChannels: number[] | null
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

interface MidiSettingsCardProps {
  settings: MidiSettings
  onChange: (s: MidiSettings) => void
  open: boolean
  onClose: () => void
}

export function MidiSettingsCard({ settings, onChange, open, onClose }: MidiSettingsCardProps) {
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

      </div>
    </DraggableCard>
  )
}
