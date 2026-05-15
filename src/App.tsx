import { useEffect, useRef, useState } from 'react'
import './App.css'
import { Navbar } from '@/components/layout/navbar'
import {
  InteractiveGridPattern,
  cellKey,
  type CellCoord,
} from '@/components/ui/interactive-grid-pattern'

// A little marker at the origin so you can see scroll working
const MARKERS: Record<string, string> = {
  [cellKey(0, 0)]: 'var(--primary)',
  [cellKey(1, 0)]: 'var(--primary)',
  [cellKey(0, 1)]: 'var(--primary)',
  [cellKey(5, 3)]: 'var(--destructive)',
  [cellKey(-3, -2)]: 'var(--destructive)',
}

const SCROLL_SPEED = 8 // cells per second

function App() {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [hovered, setHovered] = useState<CellCoord | null>(null)
  const keys = useRef<Set<string>>(new Set())

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
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const k = keys.current
      let dx = 0
      let dy = 0
      if (k.has('arrowleft') || k.has('a')) dx -= 1
      if (k.has('arrowright') || k.has('d')) dx += 1
      if (k.has('arrowup') || k.has('w')) dy -= 1
      if (k.has('arrowdown') || k.has('s')) dy += 1
      if (dx || dy) {
        setOffset((o) => ({
          x: o.x + dx * SCROLL_SPEED * dt,
          y: o.y + dy * SCROLL_SPEED * dt,
        }))
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
          <InteractiveGridPattern
              cellSize={40}
              cellColors={MARKERS}
              offsetX={offset.x}
              offsetY={offset.y}
              onCellHover={setHovered}
          />
          <div className="relative flex-1 px-6 py-8 pointer-events-none">
            <div className="pointer-events-auto inline-block bg-background/80 border border-border px-3 py-2 text-xs">
              <div>offset: ({offset.x.toFixed(1)}, {offset.y.toFixed(1)})</div>
              <div>hover: {hovered ? `(${hovered.x}, ${hovered.y})` : '—'}</div>
              <div className="text-muted-foreground mt-1">wasd / arrow keys</div>
            </div>
          </div>
        </main>
      </div>
  )
}

export default App