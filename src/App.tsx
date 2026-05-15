import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { Navbar } from '@/components/layout/navbar'
import { DraggableCard } from '@/components/ui/draggable-card'
import {
  CanvasGrid,
  type CanvasGridHandle,
  type CellCoord,
  type CellRenderer,
} from '@/components/ui/canvas-grid'
import { useMidi, type MidiMessage } from '@/hooks/use-midi'

const SCROLL_SPEED = 8
const FLASH_DURATION = 0.5 // seconds

interface CellFlash {
  startTime: number
  color: string
}

const cellKeyOf = (x: number, y: number) => `${x},${y}`

// HSL hue per channel — 16 distinct hues around the wheel
const channelColor = (_channel: number) => '#ffffff'

function App() {
  const gridRef = useRef<CanvasGridHandle>(null)
  const offsetRef = useRef({ x: 0, y: 0 })
  const keys = useRef<Set<string>>(new Set())
  const [hovered, setHovered] = useState<CellCoord | null>(null)
  const [displayOffset, setDisplayOffset] = useState({ x: 0, y: 0 })
  const [debugOpen, setDebugOpen] = useState(true)

  // Active flashes, keyed by "x,y". Stored in a ref so updates don't
  // re-render React on every MIDI message.
  const flashesRef = useRef<Map<string, CellFlash>>(new Map())
  // Visible cell range, updated by the renderer each frame so the MIDI
  // handler can pick a random one without needing to recompute it.
  const visibleRangeRef = useRef({ minX: 0, maxX: 0, minY: 0, maxY: 0 })
  // Counter to force HUD redraws when MIDI activity changes.
  const [midiActivity, setMidiActivity] = useState(0)
  const lastMidiRef = useRef<MidiMessage | null>(null)

  // Handle incoming MIDI: pick a random visible cell, flash it in the
  // channel's color.
  const handleMidiMessage = useCallback((msg: MidiMessage) => {
    lastMidiRef.current = msg
    setMidiActivity((n) => (n + 1) % 1_000_000)

    const { minX, maxX, minY, maxY } = visibleRangeRef.current
    if (maxX <= minX || maxY <= minY) return
    const x = Math.floor(minX + Math.random() * (maxX - minX))
    const y = Math.floor(minY + Math.random() * (maxY - minY))
    flashesRef.current.set(cellKeyOf(x, y), {
      startTime: performance.now() / 1000,
      color: channelColor(msg.channel),
    })
  }, [])

  const midi = useMidi({ onMessage: handleMidiMessage })

  // Auto-select the first input/output once connected
  useEffect(() => {
    if (midi.status === 'connected') {
      if (!midi.selectedInput && midi.inputs[0]) midi.selectInput(midi.inputs[3])
      if (!midi.selectedOutput && midi.outputs[0]) midi.selectOutput(midi.outputs[3])
    }
  }, [midi.status, midi.inputs, midi.outputs, midi.selectedInput, midi.selectedOutput, midi.selectInput, midi.selectOutput, midi])

  const renderCell = useCallback<CellRenderer>(({ ctx, cell, size, time, hovered }) => {
    // Track visible range so MIDI handler can pick random cells
    const r = visibleRangeRef.current
    if (cell.x < r.minX || r.maxX === r.minX) r.minX = cell.x
    if (cell.x >= r.maxX) r.maxX = cell.x + 1
    if (cell.y < r.minY || r.maxY === r.minY) r.minY = cell.y
    if (cell.y >= r.maxY) r.maxY = cell.y + 1

    const flash = flashesRef.current.get(cellKeyOf(cell.x, cell.y))
    if (flash) {
      const age = time - flash.startTime
      if (age > FLASH_DURATION) {
        flashesRef.current.delete(cellKeyOf(cell.x, cell.y))
      } else {
        const alpha = 1 - age / FLASH_DURATION
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.shadowColor = flash.color
        ctx.shadowBlur = 50
        ctx.fillStyle = flash.color
        ctx.fillRect(0, 0, size, size)
        ctx.restore()
      }
    }

    if (hovered) {
      ctx.fillStyle = 'rgba(229, 229, 229, 0.15)'
      ctx.fillRect(0, 0, size, size)
    }
  }, [])

  const handleCellClick = useCallback((cell: CellCoord) => {
    midi.sendNoteOn(0, 60, 100) // channel 0 = MIDI channel 1
    // Schedule note-off 200ms later
    setTimeout(() => midi.sendNoteOff(0, 60), 200)
    // Also flash the clicked cell locally so there's visual feedback
    flashesRef.current.set(cellKeyOf(cell.x, cell.y), {
      startTime: performance.now() / 1000,
      color: 'var(--primary)',
    })
  }, [midi])

  // Keyboard pan
  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current.add(e.key.toLowerCase())
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase())
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let displayTimer = 0
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const k = keys.current
      let dx = 0, dy = 0
      if (k.has('arrowleft') || k.has('a')) dx -= 1
      if (k.has('arrowright') || k.has('d')) dx += 1
      if (k.has('arrowup') || k.has('w')) dy -= 1
      if (k.has('arrowdown') || k.has('s')) dy += 1
      if (dx || dy) {
        offsetRef.current.x += dx * SCROLL_SPEED * dt
        offsetRef.current.y += dy * SCROLL_SPEED * dt
        gridRef.current?.setOffset(offsetRef.current.x, offsetRef.current.y)
      }
      displayTimer += dt
      if (displayTimer > 0.1) {
        displayTimer = 0
        setDisplayOffset({ ...offsetRef.current })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const last = lastMidiRef.current

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Navbar />
      <main className="flex-1 relative overflow-hidden min-h-0">
        <CanvasGrid
          ref={gridRef}
          cellSize={2.5}
          renderCell={renderCell}
          onCellHover={setHovered}
          onCellClick={handleCellClick}
        />
        <DraggableCard
          title="debug"
          open={debugOpen}
          onClose={() => setDebugOpen(false)}
          defaultPosition={{ x: 24, y: 72 }}
          defaultWidth={280}
        >
          <div className="space-y-2 font-mono">
            <div>
              <div className="text-muted-foreground">midi status</div>
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
                  <div className="text-muted-foreground mt-2">in: <span className="text-foreground">{midi.selectedInput ?? '—'}</span></div>
                  <div className="text-muted-foreground">out: <span className="text-foreground">{midi.selectedOutput ?? '—'}</span></div>
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
            <div className="pt-1 border-t border-border/50">
              <div className="text-muted-foreground">offset</div>
              <div className="text-foreground">
                ({displayOffset.x.toFixed(1)}, {displayOffset.y.toFixed(1)})
              </div>
              <div className="text-muted-foreground mt-1">hover</div>
              <div className="text-foreground">
                {hovered ? `(${hovered.x}, ${hovered.y})` : '—'}
              </div>
            </div>
            <div className="text-muted-foreground/60 text-[10px]">
              wasd / arrows · click cells to send note 60 ch1
            </div>
          </div>
        </DraggableCard>
      </main>
    </div>
  )
}

export default App