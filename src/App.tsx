import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { Navbar } from '@/components/layout/navbar'
import { DraggableCard } from '@/components/ui/draggable-card'
import { OscSendCard } from '@/components/ui/osc-send-card'
import { MidiSettingsCard, DEFAULT_MIDI_SETTINGS, type MidiSettings } from '@/components/ui/midi-settings-card'
import { ParticlesStage } from '@/components/ui/particles-stage'
import { PhotoLayer } from '@/components/ui/photo-layer'
import { useMidi, type MidiMessage } from '@/hooks/use-midi'
import { useOsc } from '@/hooks/use-osc'
import { useShapes3D, SHAPE_3D_NAMES, type Shape3DName } from '@/hooks/use-shapes3d'
import { SHAPES, type ShapeName } from '@/hooks/particle-shapes'
import type { UseParticlesResult } from '@/particles/engine'
import { STRIDE, F } from '@/particles/buffer'
import { useBackendBridge } from '@/backend/bridge'
import { useVisualMappings } from '@/visual-mappings'
import { useMidiRouter } from '@/midi/use-midi-router'
import { setupMidiThru } from '@/midi/thru'
import { useParamOscBridge } from '@/particles/param-osc-bridge'

const OSC_LOG_VISIBLE = 8

function countAlive(api: UseParticlesResult): number {
  let n = 0
  const { buf } = api
  for (let i = 0; i < buf.capacity; i++) {
    const b = i * STRIDE
    if (buf.data[b + F.AGE] < buf.data[b + F.LIFETIME]) n++
  }
  return n
}

function App() {
  const [debugOpen, setDebugOpen] = useState(true)
  const [sendOpen, setSendOpen] = useState(true)
  const [midiOpen, setMidiOpen] = useState(true)
  const [midiSettings, setMidiSettings] = useState<MidiSettings>(DEFAULT_MIDI_SETTINGS)
  const [midiActivity, setMidiActivity] = useState(0)
  const lastMidiRef = useRef<MidiMessage | null>(null)
  const [photoVisible, setPhotoVisible] = useState(false)
  const photoCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // -------------------------------------------------------------------------
  // Particles
  // -------------------------------------------------------------------------
  const [particlesApi, setParticlesApi] = useState<UseParticlesResult | null>(null)

  // -------------------------------------------------------------------------
  // 3D shapes
  // -------------------------------------------------------------------------
  const shapes3d = useShapes3D(particlesApi, {
    scale: 0.5,
    focalLength: 600,
    depth: 0.5,
    rotationSpeed: [0.15, 0.28, 0.06],
    autoRotate: true,
  })

  // -------------------------------------------------------------------------
  // OSC
  // -------------------------------------------------------------------------
  const osc = useOsc({ url: 'ws://localhost:8080', logSize: 200 })

  // -------------------------------------------------------------------------
  // Backend bridge + visual mappings
  // -------------------------------------------------------------------------
  const bridge = useBackendBridge(osc)
  useVisualMappings(particlesApi, bridge, osc)

  // OSC: photo layer toggle
  useEffect(() => {
    return osc.subscribe('/photo/enable', (args) => {
      setPhotoVisible(Boolean(args[0]))
    })
  }, [osc.subscribe])

  // -------------------------------------------------------------------------
  // Parameter system: OSC ↔ paramStore ↔ engine effects
  // -------------------------------------------------------------------------
  useParamOscBridge(osc, particlesApi, shapes3d)

  // -------------------------------------------------------------------------
  // MIDI router (replaces useParticleEffects)
  // -------------------------------------------------------------------------
  const router = useMidiRouter(particlesApi, osc, shapes3d, midiSettings, {
    pulseFanout: 1,
    particleLifetime: 10,
    fadeOutDuration: 2,
    maxParticles: 400,
  })

  const routerRef = useRef(router)
  useEffect(() => { routerRef.current = router }, [router])

  // -------------------------------------------------------------------------
  // MIDI
  // -------------------------------------------------------------------------
  const bridgeRef = useRef(bridge)
  useEffect(() => { bridgeRef.current = bridge }, [bridge])

  const handleMidiMessage = useCallback((msg: MidiMessage) => {
    lastMidiRef.current = msg
    setMidiActivity((n) => (n + 1) % 1_000_000)
    routerRef.current.handleMidi(msg)
    bridgeRef.current.handleMidi(msg)
  }, [])

  const midi = useMidi({ onMessage: handleMidiMessage })

  useEffect(() => {
    if (midi.status === 'connected') {
      if (!midi.selectedInput && midi.inputs[3]) midi.selectInput(midi.inputs[3])
      if (!midi.selectedOutput && midi.outputs[3]) midi.selectOutput(midi.outputs[3])
    }
  }, [midi.status, midi.inputs, midi.outputs, midi.selectedInput, midi.selectedOutput,
    midi.selectInput, midi.selectOutput])

  // MIDI thru — forward raw bytes when a thru output port is selected
  useEffect(() => {
    if (midi.status !== 'connected') return
    if (!midi.selectedInput || !midiSettings.thruOutput) return
    const inputPort = midi.getRawInput(midi.selectedInput)
    const outputPort = midi.getRawOutput(midiSettings.thruOutput)
    if (!inputPort || !outputPort) return
    return setupMidiThru(inputPort, outputPort)
  }, [midi.status, midi.selectedInput, midiSettings.thruOutput,
    midi.getRawInput, midi.getRawOutput])

  const recentOsc = osc.messages.slice(-OSC_LOG_VISIBLE).reverse()
  const last = lastMidiRef.current

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Navbar />
      <main className="flex-1 relative overflow-hidden min-h-0">

        <PhotoLayer visible={photoVisible} canvasRef={photoCanvasRef} />
        <ParticlesStage
          initialCount={300}
          initialSpeed={60}
          config={{
            maxParticles: 4096,
            renderConfig: { linkDistance: 130, linkOpacity: 0.35 },
          }}
          onReady={setParticlesApi}
        />

        {/* Debug card */}
        <DraggableCard
          title="debug"
          open={debugOpen}
          onClose={() => setDebugOpen(false)}
          defaultPosition={{ x: 24, y: 72 }}
          defaultWidth={280}
        >
          <div className="space-y-2 font-mono">

            {/* MIDI */}
            <div>
              <div className="flex items-center justify-between">
                <div className="text-muted-foreground">midi status</div>
                {!midiOpen && (
                  <button
                    onClick={() => setMidiOpen(true)}
                    className="px-1.5 py-0.5 border border-border hover:bg-muted text-[10px]"
                  >
                    midi settings
                  </button>
                )}
              </div>
              <div className="text-foreground">{midi.status}</div>
              {midi.status === 'idle' && (
                <button
                  onClick={() => midi.connect()}
                  className="mt-1 px-2 py-1 border border-border hover:bg-muted text-xs"
                >
                  connect midi
                </button>
              )}
              {midi.status === 'connected' && (
                <>
                  <div className="text-muted-foreground mt-2">
                    in: <span className="text-foreground">{midi.selectedInput ?? '—'}</span>
                  </div>
                  <div className="text-muted-foreground">
                    out: <span className="text-foreground">{midi.selectedOutput ?? '—'}</span>
                  </div>
                </>
              )}
            </div>

            {last && (
              <div>
                <div className="text-muted-foreground">last msg</div>
                <div className="text-foreground">
                  ch{last.channel + 1} {last.type} {last.data1} {last.data2}
                  <span className="text-muted-foreground/60 ml-1">#{midiActivity}</span>
                </div>
              </div>
            )}

            {/* Particles status */}
            <div className="pt-1 border-t border-border/50">
              <div className="text-muted-foreground">particles</div>
              <div className="text-foreground">
                {particlesApi?.ready
                  ? `${countAlive(particlesApi)} / ${particlesApi.buf.capacity}`
                  : 'loading…'}
              </div>
            </div>

            {/* 3D shape picker */}
            <div className="pt-1 border-t border-border/50">
              <div className="text-muted-foreground mb-1">3d shapes</div>
              <div className="flex flex-wrap gap-1">
                {SHAPE_3D_NAMES.map((name) => (
                  <button
                    key={name}
                    onClick={() => router.applyShape3D(name as Shape3DName)}
                    disabled={!particlesApi?.ready}
                    className="px-1.5 py-0.5 border border-border hover:bg-muted text-[10px] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {/* 2D shape picker */}
            <div className="pt-1 border-t border-border/50">
              <div className="text-muted-foreground mb-1">2d shapes</div>
              <div className="flex flex-wrap gap-1">
                {Object.keys(SHAPES).map((name) => (
                  <button
                    key={name}
                    onClick={() => router.applyShape(name as ShapeName)}
                    disabled={!particlesApi?.ready}
                    className="px-1.5 py-0.5 border border-border hover:bg-muted text-[10px] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {name}
                  </button>
                ))}
                <button
                  onClick={() => router.animator.scatter()}
                  disabled={!particlesApi?.ready}
                  className="px-1.5 py-0.5 border border-border hover:bg-muted text-[10px] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  scatter
                </button>
              </div>
            </div>

            {/* Rotation controls */}
            <div className="pt-1 border-t border-border/50">
              <div className="text-muted-foreground mb-1">rotation</div>
              <div className="flex gap-1">
                <button
                  onClick={() => shapes3d.impulse(0, 0.8, 0)}
                  disabled={!particlesApi?.ready}
                  className="px-1.5 py-0.5 border border-border hover:bg-muted text-[10px] disabled:opacity-30"
                >
                  kick Y
                </button>
                <button
                  onClick={() => shapes3d.impulse(0.5, 0, 0)}
                  disabled={!particlesApi?.ready}
                  className="px-1.5 py-0.5 border border-border hover:bg-muted text-[10px] disabled:opacity-30"
                >
                  kick X
                </button>
                <button
                  onClick={() => shapes3d.setRotationSpeed(0, 0, 0)}
                  disabled={!particlesApi?.ready}
                  className="px-1.5 py-0.5 border border-border hover:bg-muted text-[10px] disabled:opacity-30"
                >
                  stop
                </button>
                <button
                  onClick={() => shapes3d.setRotationSpeed(0.15, 0.28, 0.06)}
                  disabled={!particlesApi?.ready}
                  className="px-1.5 py-0.5 border border-border hover:bg-muted text-[10px] disabled:opacity-30"
                >
                  reset
                </button>
              </div>
            </div>

            {/* Pulse test */}
            <div className="pt-1 border-t border-border/50">
              <div className="text-muted-foreground mb-1">pulse</div>
              <div className="flex gap-1">
                <button
                  onClick={() => router.pulse.fire(-1, 1.0, false)}
                  disabled={!particlesApi?.ready}
                  className="px-2 py-1 border border-border hover:bg-muted text-[10px] disabled:opacity-30"
                >
                  dim ×1
                </button>
                <button
                  onClick={() => router.pulse.fireRandom(3, 1.0, true)}
                  disabled={!particlesApi?.ready}
                  className="px-2 py-1 border border-border hover:bg-muted text-[10px] disabled:opacity-30"
                >
                  bright ×3
                </button>
              </div>
            </div>

            {/* Photo layer */}
            <div className="pt-1 border-t border-border/50">
              <div className="text-muted-foreground mb-1">photo layer</div>
              <button
                onClick={() => setPhotoVisible((v) => !v)}
                className="px-2 py-1 border border-border hover:bg-muted text-xs"
              >
                {photoVisible ? 'hide' : 'show'}
              </button>
            </div>

            {/* OSC */}
            <div className="pt-1 border-t border-border/50">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">osc</span>
                <span className="text-foreground">{osc.status}</span>
              </div>
              {osc.error && (
                <div className="text-destructive/80 text-[10px] truncate" title={osc.error}>
                  {osc.error}
                </div>
              )}
              {osc.status !== 'connected' && (
                <button
                  onClick={() => osc.connect()}
                  className="mt-1 px-2 py-1 border border-border hover:bg-muted text-xs"
                >
                  reconnect
                </button>
              )}
              <div className="text-muted-foreground mt-2">recent in</div>
              <div className="mt-0.5 space-y-0.5 max-h-32 overflow-y-auto">
                {recentOsc.length === 0 ? (
                  <div className="text-muted-foreground/60 text-[10px]">—</div>
                ) : (
                  recentOsc.map((m) => (
                    <div key={m.id} className="text-[10px] leading-tight truncate">
                      <span className="text-foreground">{m.address}</span>
                      {m.args.length > 0 && (
                        <span className="text-muted-foreground ml-1">
                          {m.args.map((a) =>
                            typeof a === 'number'
                              ? Number.isInteger(a) ? a.toString() : a.toFixed(3)
                              : String(a)
                          ).join(' ')}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </DraggableCard>

        <OscSendCard
          open={sendOpen}
          onClose={() => setSendOpen(false)}
          send={osc.send}
          enabled={osc.status === 'connected'}
        />

        <MidiSettingsCard
          open={midiOpen}
          onClose={() => setMidiOpen(false)}
          settings={midiSettings}
          onChange={setMidiSettings}
          outputs={midi.outputs}
        />

      </main>
    </div>
  )
}

export default App
