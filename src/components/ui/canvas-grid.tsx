import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react"

import { cn } from "@/lib/utils"

export interface CellCoord {
  x: number
  y: number
}

export interface CellRenderContext {
  /** Canvas 2D context, already translated so (0,0) is this cell's top-left in screen space. */
  ctx: CanvasRenderingContext2D
  /** Cell's grid coordinates (can be negative). */
  cell: CellCoord
  /** Cell size in CSS pixels. */
  size: number
  /** Seconds since the grid mounted. Use for animation. */
  time: number
  /** Whether this cell is currently hovered. */
  hovered: boolean
}

export type CellRenderer = (ctx: CellRenderContext) => void

export interface CanvasGridHandle {
  setOffset: (x: number, y: number) => void
  getOffset: () => CellCoord
  invalidate: () => void
}

interface CanvasGridProps {
  cellSize?: number
  className?: string
  renderCell?: CellRenderer
  gridColor?: string | null
  backgroundColor?: string | null
  onCellHover?: (cell: CellCoord | null) => void
  onCellClick?: (cell: CellCoord) => void
}

export const cellKey = (x: number, y: number) => `${x},${y}`

export const CanvasGrid = forwardRef<CanvasGridHandle, CanvasGridProps>(
  function CanvasGrid(
    {
      cellSize = 40,
      className,
      renderCell,
      gridColor = "rgba(156, 163, 175, 0.3)",
      backgroundColor = null,
      onCellHover,
      onCellClick,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const offsetRef = useRef({ x: 0, y: 0 })
    const sizeRef = useRef({ width: 0, height: 0, dpr: 1 })
    const hoverRef = useRef<CellCoord | null>(null)
    const startTimeRef = useRef(performance.now())

    const rendererRef = useRef<CellRenderer | undefined>(renderCell)
    useEffect(() => { rendererRef.current = renderCell }, [renderCell])

    const styleRef = useRef({ gridColor, backgroundColor })
    useEffect(() => { styleRef.current = { gridColor, backgroundColor } }, [gridColor, backgroundColor])

    const callbacksRef = useRef({ onCellHover, onCellClick })
    useEffect(() => { callbacksRef.current = { onCellHover, onCellClick } }, [onCellHover, onCellClick])

    useImperativeHandle(ref, () => ({
      setOffset: (x, y) => { offsetRef.current = { x, y } },
      getOffset: () => ({ ...offsetRef.current }),
      invalidate: () => {},
    }), [])

    useEffect(() => {
      const el = containerRef.current
      const canvas = canvasRef.current
      if (!el || !canvas) return

      const resize = () => {
        const rect = el.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        sizeRef.current = { width: rect.width, height: rect.height, dpr }
        canvas.width = Math.round(rect.width * dpr)
        canvas.height = Math.round(rect.height * dpr)
        canvas.style.width = `${rect.width}px`
        canvas.style.height = `${rect.height}px`
      }

      resize()
      const ro = new ResizeObserver(resize)
      ro.observe(el)
      window.addEventListener("resize", resize)
      return () => {
        ro.disconnect()
        window.removeEventListener("resize", resize)
      }
    }, [])

    const cellFromPointer = useCallback(
      (clientX: number, clientY: number): CellCoord | null => {
        const canvas = canvasRef.current
        if (!canvas) return null
        const rect = canvas.getBoundingClientRect()
        const localX = clientX - rect.left
        const localY = clientY - rect.top
        if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) return null
        const offset = offsetRef.current
        return {
          x: Math.floor(localX / cellSize + offset.x),
          y: Math.floor(localY / cellSize + offset.y),
        }
      },
      [cellSize]
    )

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        const cell = cellFromPointer(e.clientX, e.clientY)
        const prev = hoverRef.current
        if (
          cell?.x !== prev?.x ||
          cell?.y !== prev?.y ||
          (cell === null) !== (prev === null)
        ) {
          hoverRef.current = cell
          callbacksRef.current.onCellHover?.(cell)
        }
      },
      [cellFromPointer]
    )

    const handlePointerLeave = useCallback(() => {
      if (hoverRef.current !== null) {
        hoverRef.current = null
        callbacksRef.current.onCellHover?.(null)
      }
    }, [])

    const handleClick = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        const cell = cellFromPointer(e.clientX, e.clientY)
        if (cell) callbacksRef.current.onCellClick?.(cell)
      },
      [cellFromPointer]
    )

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext("2d", { alpha: true })
      if (!ctx) return

      let raf = 0
      const loop = (now: number) => {
        const { width, height, dpr } = sizeRef.current
        const offset = offsetRef.current
        const hover = hoverRef.current
        const { gridColor: gc, backgroundColor: bg } = styleRef.current
        const time = (now - startTimeRef.current) / 1000

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        if (bg) {
          ctx.fillStyle = bg
          ctx.fillRect(0, 0, width, height)
        } else {
          ctx.clearRect(0, 0, width, height)
        }

        const startCol = Math.floor(offset.x) - 1
        const startRow = Math.floor(offset.y) - 1
        const cols = Math.ceil(width / cellSize) + 2
        const rows = Math.ceil(height / cellSize) + 2
        const subX = (offset.x - Math.floor(offset.x)) * cellSize
        const subY = (offset.y - Math.floor(offset.y)) * cellSize

        const renderer = rendererRef.current

        if (renderer) {
          for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
              const gridX = startCol + col
              const gridY = startRow + row
              const screenX = col * cellSize - subX - cellSize
              const screenY = row * cellSize - subY - cellSize
              ctx.save()
              ctx.translate(screenX, screenY)
              ctx.beginPath()
              ctx.rect(0, 0, cellSize, cellSize)
              ctx.clip()
              renderer({
                ctx,
                cell: { x: gridX, y: gridY },
                size: cellSize,
                time,
                hovered: hover?.x === gridX && hover?.y === gridY,
              })
              ctx.restore()
            }
          }
        }

        if (gc) {
          ctx.beginPath()
          for (let col = 0; col <= cols; col++) {
            const x = Math.round(col * cellSize - subX - cellSize) + 0.5
            ctx.moveTo(x, 0)
            ctx.lineTo(x, height)
          }
          for (let row = 0; row <= rows; row++) {
            const y = Math.round(row * cellSize - subY - cellSize) + 0.5
            ctx.moveTo(0, y)
            ctx.lineTo(width, y)
          }
          ctx.strokeStyle = gc
          ctx.lineWidth = 1
          ctx.stroke()
        }

        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
      return () => cancelAnimationFrame(raf)
    }, [cellSize])

    return (
      <div ref={containerRef} className={cn("absolute inset-0 overflow-hidden", className)}>
        <canvas
          ref={canvasRef}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onClick={handleClick}
          style={{ display: "block", touchAction: "none" }}
        />
      </div>
    )
  }
)