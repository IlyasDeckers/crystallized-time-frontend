import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { Navbar } from '@/components/layout/navbar'
import { DraggableCard } from '@/components/ui/draggable-card'
import { OscSendCard } from '@/components/ui/osc-send-card'
import { ParticlesStage } from './components/ui/particles-stage'
import { useMidi, type MidiMessage } from '@/hooks/use-midi'
import { useOsc } from '@/hooks/use-osc'
import { useParticleEffects } from '@/hooks/use-particle-effects'
import { SHAPES, type ShapeName } from '@/hooks/particle-shapes'
import type { UseParticlesResult } from './hooks/use-particles'

const OSC_LOG_VISIBLE = 8

function App() {
  const [debugOpen, setDebugOpen] = useState(true)
  const [sendOpen, setSendOpen] = useState(true)
  const [midiActivity, setMidiActivity] = useState(0)
  const lastMidiRef = useRef<MidiMessage | null>(null)

  // -------------------------------------------------------------------------
  // Particles
  // -------------------------------------------------------------------------
  const [particlesApi, setParticlesApi] = useState<UseParticlesResult | null>(null)

  // -------------------------------------------------------------------------
  // MIDI
  // -------------------------------------------------------------------------
  const midi = useMidi({
    onMessage: useCallback((msg: MidiMessage) => {
      lastMidiRef.current = msg
      setMidiActivity((n) => (n + 1) % 1_000_000)
    }, []),
  })

  // Auto-select ports once connected
  useEffect(() => {
    // console.log(midi.inputs)
    if (midi.status === 'connected') {
      if (!midi.selectedInput && midi.inputs[3]) midi.selectInput(midi.inputs[3])
      if (!midi.selectedOutput && midi.outputs[3]) midi.selectOutput(midi.outputs[3])
    }
  }, [midi.status, midi.inputs, midi.outputs, midi.selectedInput, midi.selectedOutput, midi.selectInput, midi.selectOutput, midi])

  // -------------------------------------------------------------------------
  // OSC
  // -------------------------------------------------------------------------
  const osc = useOsc({ url: 'ws://localhost:8080', logSize: 200 })

  // -------------------------------------------------------------------------
  // Particle effects — wires MIDI + OSC to the particle system
  // -------------------------------------------------------------------------
  const effects = useParticleEffects(particlesApi, osc, {
    noteShapeMap: {
      60: 'circle',
      62: 'spiral',
      64: 'grid',
      65: 'rings',
      67: 'star',
      69: 'lissajous',
      71: 'waveform',
      72: 'scatter',
    },
    pulseChannel: 15,
    pulseFanout: 1,
    speedCC: 74,
    linkDistanceCC: 71,
    oscPulseAddress: '/pulse/fire',
    oscShapeAddress: '/shape/set',
    oscScatterAddress: '/scatter',
  })

  // Forward MIDI messages to the effects system. We do this separately
  // from the useMidi onMessage so we can keep the activity counter above
  // decoupled from the effects ref stability.
  const effectsRef = useRef(effects)
  useEffect(() => { effectsRef.current = effects }, [effects])

  const handleMidiMessage = useCallback((msg: MidiMessage) => {
    lastMidiRef.current = msg
    setMidiActivity((n) => (n + 1) % 1_000_000)
    effectsRef.current.handleMidi(msg)
  }, [])

  // Re-wire the MIDI handler now that we have the effects ref. We need a
  // stable callback passed to useMidi, so we use a ref-forwarding pattern.
  const midiWithEffects = useMidi({ onMessage: handleMidiMessage })

  // Sync port selection from the first midi instance to the second
  useEffect(() => {
    if (midiWithEffects.status === 'connected') {
      if (!midiWithEffects.selectedInput && midiWithEffects.inputs[3]) {
        midiWithEffects.selectInput(midiWithEffects.inputs[3])
      }
      if (!midiWithEffects.selectedOutput && midiWithEffects.outputs[3]) {
        midiWithEffects.selectOutput(midiWithEffects.outputs[3])
      }
    }
  }, [
    midiWithEffects.status,
    midiWithEffects.inputs,
    midiWithEffects.outputs,
    midiWithEffects.selectedInput,
    midiWithEffects.selectedOutput,
    midiWithEffects.selectInput,
    midiWithEffects.selectOutput,
  ])

  const recentOsc = osc.messages.slice(-OSC_LOG_VISIBLE).reverse()
  const last = lastMidiRef.current

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Navbar />
      <main className="flex-1 relative overflow-hidden min-h-0">

        <ParticlesStage
          id="particles-stage"
          config={{
            count: 150,
            speed: 1.5,
            linkedDistance: 130,
            linkedOpacity: 0.35,
            size: 2.5,
            color: '#ffffff',
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

            {/* MIDI status */}
            <div>
              <div className="text-muted-foreground">midi status</div>
              <div className="text-foreground">{midiWithEffects.status}</div>
              {midiWithEffects.status === 'idle' && (
                <button
                  onClick={() => midiWithEffects.connect()}
                  className="mt-1 px-2 py-1 border border-border hover:bg-muted text-xs"
                >
                  connect midi
                </button>
              )}
              {midiWithEffects.status === 'connected' && (
                <>
                  <div className="text-muted-foreground mt-2">
                    in: <span className="text-foreground">{midiWithEffects.selectedInput ?? '—'}</span>
                  </div>
                  <div className="text-muted-foreground">
                    out: <span className="text-foreground">{midiWithEffects.selectedOutput ?? '—'}</span>
                  </div>
                </>
              )}
            </div>

            {/* Last MIDI message */}
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
                  ? `${particlesApi.particles.length} particles · ${particlesApi.canvasSize.w}×${particlesApi.canvasSize.h}`
                  : 'loading…'}
              </div>
            </div>

            {/* Shape picker */}
            <div className="pt-1 border-t border-border/50">
              <div className="text-muted-foreground mb-1">shapes</div>
              <div className="flex flex-wrap gap-1">
                {Object.keys(SHAPES).map((name) => (
                  <button
                    key={name}
                    onClick={() => effects.applyShape(name as ShapeName)}
                    disabled={!particlesApi?.ready}
                    className="px-1.5 py-0.5 border border-border hover:bg-muted text-[10px] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {name}
                  </button>
                ))}
              </div>
              <button
                onClick={() => effects.animator.scatter()}
                disabled={!particlesApi?.ready}
                className="mt-1 px-2 py-1 border border-border hover:bg-muted text-[10px] w-full disabled:opacity-30 disabled:cursor-not-allowed"
              >
                scatter
              </button>
            </div>

            {/* Pulse test */}
            <div className="pt-1 border-t border-border/50">
              <div className="text-muted-foreground mb-1">pulse</div>
              <div className="flex gap-1">
                <button
                  onClick={() => effects.pulse.fire(-1, 1.0)}
                  disabled={!particlesApi?.ready}
                  className="px-2 py-1 border border-border hover:bg-muted text-[10px] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  fire ×1
                </button>
                <button
                  onClick={() => effects.pulse.fireRandom(5, 0.8)}
                  disabled={!particlesApi?.ready}
                  className="px-2 py-1 border border-border hover:bg-muted text-[10px] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  fire ×5
                </button>
              </div>
            </div>

            {/* OSC status */}
            <div className="pt-1 border-t border-border/50">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">osc status</span>
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
                  reconnect osc
                </button>
              )}
              {/*<div className="text-muted-foreground mt-2">recent in</div>*/}
              {/*<div className="mt-0.5 space-y-0.5 max-h-32 overflow-y-auto">*/}
              {/*  {recentOsc.length === 0 ? (*/}
              {/*    <div className="text-muted-foreground/60 text-[10px]">—</div>*/}
              {/*  ) : (*/}
              {/*    recentOsc.map((m) => (*/}
              {/*      <div key={m.id} className="text-[10px] leading-tight truncate">*/}
              {/*        <span className="text-foreground">{m.address}</span>*/}
              {/*        {m.args.length > 0 && (*/}
              {/*          <span className="text-muted-foreground ml-1">*/}
              {/*            {m.args*/}
              {/*              .map((a) =>*/}
              {/*                typeof a === 'number'*/}
              {/*                  ? Number.isInteger(a) ? a.toString() : a.toFixed(3)*/}
              {/*                  : String(a)*/}
              {/*              )*/}
              {/*              .join(' ')}*/}
              {/*          </span>*/}
              {/*        )}*/}
              {/*      </div>*/}
              {/*    ))*/}
              {/*  )}*/}
              {/*</div>*/}
            </div>

          </div>
        </DraggableCard>

        <OscSendCard
          open={sendOpen}
          onClose={() => setSendOpen(false)}
          send={osc.send}
          enabled={osc.status === 'connected'}
        />

      </main>
    </div>
  )
}

export default App