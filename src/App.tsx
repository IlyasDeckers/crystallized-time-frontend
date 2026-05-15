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

const SCROLL_SPEED = 8

const STATIC_CELLS = new Map<string, string>([
  ['0,0', '#e5e5e5'],
  ['5,3', '#fb6415'],
  ['-3,-2', '#fb6415'],
])

const cellKeyOf = (x: number, y: number) => `${x},${y}`

function App() {
  const gridRef = useRef<CanvasGridHandle>(null)
  const offsetRef = useRef({ x: 0, y: 0 })
  const keys = useRef<Set<string>>(new Set())
  const [hovered, setHovered] = useState<CellCoord | null>(null)
  const [displayOffset, setDisplayOffset] = useState({ x: 0, y: 0 })
  const [debugOpen, setDebugOpen] = useState(true)

  const renderCell = useCallback<CellRenderer>(({ ctx, cell, size, hovered }) => {
    const staticFill = STATIC_CELLS.get(cellKeyOf(cell.x, cell.y))
    if (staticFill) {
      ctx.fillStyle = staticFill
      ctx.fillRect(0, 0, size, size)
    }
    if (hovered) {
      ctx.fillStyle = 'rgba(229, 229, 229, 0.15)'
      ctx.fillRect(0, 0, size, size)
    }
  }, [])

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

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Navbar />
      <main className="flex-1 relative overflow-hidden min-h-0">
        <CanvasGrid
          ref={gridRef}
          cellSize={40}
          renderCell={renderCell}
          onCellHover={setHovered}
        />
        <DraggableCard
          title="debug"
          open={debugOpen}
          onClose={() => setDebugOpen(false)}
          defaultPosition={{ x: 24, y: 72 }}
          defaultWidth={260}
        >
          <div className="space-y-1 font-mono">
            <div className="text-muted-foreground">
              offset: <span className="text-foreground">
                ({displayOffset.x.toFixed(1)}, {displayOffset.y.toFixed(1)})
              </span>
            </div>
            <div className="text-muted-foreground">
              hover: <span className="text-foreground">
                {hovered ? `(${hovered.x}, ${hovered.y})` : '—'}
              </span>
            </div>
            <div className="text-muted-foreground/60 pt-1 text-[10px]">
              wasd / arrow keys
            </div>
          </div>
        </DraggableCard>
      </main>
    </div>
  )
}

export default App