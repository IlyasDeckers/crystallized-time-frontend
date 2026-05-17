import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { Navbar } from '@/components/layout/navbar'
import { DraggableCard } from '@/components/ui/draggable-card'
import { OscSendCard } from '@/components/ui/osc-send-card'
import { MidiSettingsCard, DEFAULT_MIDI_SETTINGS, type MidiSettings } from '@/components/ui/midi-settings-card'
import { ParticlesStage } from '@/components/ui/particles-stage'
import { PhotoLayer } from '@/components/ui/photo-layer'
import { ScenePresets } from '@/components/ui/scene-presets'
import { ConnectionStatus } from '@/components/ui/connection-status'
import { ChannelStrip } from '@/components/ui/channel-strip'
import { ParameterDashboard } from '@/components/ui/parameter-dashboard'
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
import { sceneStore } from '@/scenes/store'
import { midiLearn } from '@/midi/learn'
import { useNodeGraph } from '@/node-graph/use-node-graph'
import { loadGraph, saveGraph, EMPTY_GRAPH } from '@/node-graph/store'
import type { NodeGraph } from '@/node-graph/types'
import { NodeGraphEditor } from '@/components/ui/node-graph-editor'
import { BottomPanel } from '@/components/ui/bottom-panel'
import type { CardToggle } from '@/components/layout/navbar'

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
  const [debugOpen, setDebugOpen] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [midiOpen, setMidiOpen] = useState(false)
  const [scenesOpen, setScenesOpen] = useState(false)
  const [channelStripOpen, setChannelStripOpen] = useState(false)
  const [paramDashOpen, setParamDashOpen] = useState(false)
  const [midiSettings, setMidiSettings] = useState<MidiSettings>(DEFAULT_MIDI_SETTINGS)
  const [midiActivity, setMidiActivity] = useState(0)
  const [mutedChannels, setMutedChannels] = useState<Set<number>>(new Set())
  const lastMidiRef = useRef<MidiMessage | null>(null)
  const [photoVisible, setPhotoVisible] = useState(false)
  const photoCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [nodeGraph, setNodeGraph] = useState<NodeGraph>(
    () => loadGraph() ?? EMPTY_GRAPH
  )
  const [nodeGraphOpen, setNodeGraphOpen] = useState(false)

  // Keep a ref of the current graph so sceneStore can snapshot it on save
  const nodeGraphRef = useRef(nodeGraph)
  nodeGraphRef.current = nodeGraph

  // Debounced auto-save (500ms) to avoid thrashing localStorage during drag
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedSaveGraph = useCallback((g: NodeGraph) => {
    if (autoSaveTimerRef.current !== null) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      saveGraph(g)
      autoSaveTimerRef.current = null
    }, 500)
  }, [])

  // Debug overlay extras
  const [fps, setFps] = useState(0)
  const fpsFramesRef = useRef<number[]>([])
  const [bpm, setBpm] = useState<number | null>(null)
  const clockTimesRef = useRef<number[]>([])
  const [magnetization, setMagnetization] = useState<number | null>(null)
  const [wallCount, setWallCount] = useState<number | null>(null)

  // FPS counter via rAF
  useEffect(() => {
    let rafId: number
    let last = performance.now()
    function tick() {
      const now = performance.now()
      fpsFramesRef.current.push(now - last)
      last = now
      if (fpsFramesRef.current.length > 60) fpsFramesRef.current.shift()
      const avg = fpsFramesRef.current.reduce((a, b) => a + b, 0) / fpsFramesRef.current.length
      setFps(Math.round(1000 / avg))
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  // MIDI message subscriber for ChannelStrip
  type MidiSubCb = (msg: MidiMessage) => void
  const midiSubsRef = useRef<Set<MidiSubCb>>(new Set())
  const subscribeToMidi = useCallback(
    (cb: (msg: MidiMessage) => void): (() => void) => {
      midiSubsRef.current.add(cb)
      return () => { midiSubsRef.current.delete(cb) }
    },
    []
  )

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

  // Update debug magnetization and wall count from state events
  useEffect(() => {
    return bridge.subscribe((event) => {
      if (event.type === 'state') {
        setMagnetization(event.magnetization)
        setWallCount(event.wallCount)
      }
      if (event.type === 'clock_pulse') {
        const now = performance.now()
        clockTimesRef.current.push(now)
        if (clockTimesRef.current.length > 8) clockTimesRef.current.shift()
        if (clockTimesRef.current.length >= 2) {
          const intervals = clockTimesRef.current.slice(1).map(
            (t, i) => t - clockTimesRef.current[i]
          )
          const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
          // MIDI clock = 24 pulses per quarter note
          setBpm(Math.round(60_000 / (avgInterval * 24)))
        }
      }
    })
  }, [bridge.subscribe])

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
  // Node graph executor (additive layer — runs alongside existing router)
  // -------------------------------------------------------------------------
  useNodeGraph(nodeGraph, {
    particlesApi,
    osc,
    pulse: router.pulse,
    subscribeMidi: subscribeToMidi,
  })

  // Scene integration: provide current node-graph to sceneStore for inclusion in saves
  useEffect(() => {
    sceneStore.setNodeGraphProvider(() => nodeGraphRef.current)
    return () => { sceneStore.setNodeGraphProvider(null) }
  }, [])

  // Restore node-graph when a scene is loaded
  useEffect(() => {
    return sceneStore.onLoad((scene) => {
      if (scene.nodeGraph) {
        setNodeGraph(scene.nodeGraph)
      }
    })
  }, [])

  // -------------------------------------------------------------------------
  // MIDI
  // -------------------------------------------------------------------------
  const bridgeRef = useRef(bridge)
  useEffect(() => { bridgeRef.current = bridge }, [bridge])

  const mutedChannelsRef = useRef(mutedChannels)
  useEffect(() => { mutedChannelsRef.current = mutedChannels }, [mutedChannels])

  const handleMidiMessage = useCallback((msg: MidiMessage) => {
    lastMidiRef.current = msg
    setMidiActivity((n) => (n + 1) % 1_000_000)

    // Notify channel strip subscribers
    for (const sub of midiSubsRef.current) sub(msg)

    // MIDI learn: intercept CC if learning
    if (msg.type === 'cc' && midiLearn.isLearning()) {
      midiLearn.onCC(msg.data1)
      return
    }

    // Program change → load scene by program number
    if (msg.type === 'programChange') {
      const scenes = sceneStore.list()
      const scene = scenes[msg.data1]
      if (scene) sceneStore.load(scene)
      return
    }

    // Skip muted channels for visual effects
    if (mutedChannelsRef.current.has(msg.channel)) return

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

  const cardToggles: CardToggle[] = [
    { key: 'debug', label: 'debug', open: debugOpen, onToggle: () => setDebugOpen(v => !v) },
    { key: 'send', label: 'osc', open: sendOpen, onToggle: () => setSendOpen(v => !v) },
    { key: 'midi', label: 'midi', open: midiOpen, onToggle: () => setMidiOpen(v => !v) },
    { key: 'scenes', label: 'scenes', open: scenesOpen, onToggle: () => setScenesOpen(v => !v) },
    { key: 'channels', label: 'ch', open: channelStripOpen, onToggle: () => setChannelStripOpen(v => !v) },
    { key: 'params', label: 'params', open: paramDashOpen, onToggle: () => setParamDashOpen(v => !v) },
    { key: 'graph', label: 'graph', open: nodeGraphOpen, onToggle: () => setNodeGraphOpen(v => !v) },
  ]

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Navbar cardToggles={cardToggles} />
      <main className="flex-1 relative overflow-hidden min-h-0">

        <PhotoLayer visible={photoVisible} canvasRef={photoCanvasRef} />
        <ParticlesStage
          initialCount={300}
          initialSpeed={60}
          config={{
            maxParticles: 4096,
            renderConfig: { linkDistance: 130, linkOpacity: 0.8 },
          }}
          onReady={setParticlesApi}
        />

        {/* Connection status indicator (top-right) */}
        <ConnectionStatus osc={osc} />

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

            {/* Performance + state metrics */}
            <div className="pt-1 border-t border-border/50 space-y-0.5">
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">fps</span>
                <span className="text-foreground">{fps}</span>
              </div>
              {bpm !== null && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">bpm</span>
                  <span className="text-foreground">{bpm}</span>
                </div>
              )}
              {magnetization !== null && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">magnetization</span>
                  <span className="text-foreground">{magnetization.toFixed(3)}</span>
                </div>
              )}
              {wallCount !== null && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">walls</span>
                  <span className="text-foreground">{wallCount}</span>
                </div>
              )}
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

        {/* Scene presets card */}
        <DraggableCard
          title="scenes"
          open={scenesOpen}
          onClose={() => setScenesOpen(false)}
          defaultPosition={{ x: 320, y: 72 }}
          defaultWidth={240}
        >
          <ScenePresets osc={osc} fadeDuration={2000} />
        </DraggableCard>

        {/* 16-channel MIDI strip */}
        <DraggableCard
          title="midi channels"
          open={channelStripOpen}
          onClose={() => setChannelStripOpen(false)}
          defaultPosition={{ x: 580, y: 72 }}
          defaultWidth={260}
        >
          <ChannelStrip
            subscribe={subscribeToMidi}
            onMuteChange={(ch, muted) => {
              setMutedChannels((prev) => {
                const next = new Set(prev)
                if (muted) next.add(ch)
                else next.delete(ch)
                return next
              })
            }}
          />
        </DraggableCard>

        {/* Parameter dashboard */}
        <DraggableCard
          title="parameters"
          open={paramDashOpen}
          onClose={() => setParamDashOpen(false)}
          defaultPosition={{ x: 860, y: 72 }}
          defaultWidth={280}
        >
          <ParameterDashboard />
        </DraggableCard>

        {/* Node graph editor */}
        <BottomPanel
          title="node graph"
          open={nodeGraphOpen}
          onToggle={() => setNodeGraphOpen(v => !v)}
          defaultHeight={450}
          maxHeight={Math.max(200, Math.min(600, Math.floor(window.innerHeight * 0.6)))}
        >
          <NodeGraphEditor
            graph={nodeGraph}
            onChange={(g) => {
              debouncedSaveGraph(g)
              setNodeGraph(g)
            }}
          />
        </BottomPanel>

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
