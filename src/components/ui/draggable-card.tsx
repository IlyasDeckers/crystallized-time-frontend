import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface DraggableCardProps {
  title: string
  children: ReactNode
  /** Initial position in pixels from the top-left of the viewport. */
  defaultPosition?: { x: number; y: number }
  /** Initial width. Height is content-driven by default. */
  defaultWidth?: number
  /** When true, the card is rendered. When false, it's not in the DOM. */
  open?: boolean
  onClose?: () => void
  /** Optional className for the card container. */
  className?: string
}

export function DraggableCard({
  title,
  children,
  defaultPosition = { x: 24, y: 24 },
  defaultWidth = 320,
  open = true,
  onClose,
  className,
}: DraggableCardProps) {
  const [position, setPosition] = useState(defaultPosition)
  const [minimized, setMinimized] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const dragOffset = useRef<{ x: number; y: number } | null>(null)

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return
    const card = cardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffset.current) return
    setPosition({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y })
  }, [])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragOffset.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  useEffect(() => {
    const clamp = () => {
      const card = cardRef.current
      if (!card) return
      const rect = card.getBoundingClientRect()
      setPosition((p) => ({
        x: Math.min(Math.max(0, p.x), window.innerWidth - rect.width),
        y: Math.min(Math.max(0, p.y), window.innerHeight - rect.height),
      }))
    }
    window.addEventListener("resize", clamp)
    return () => window.removeEventListener("resize", clamp)
  }, [])

  if (!open) return null

  return (
    <div
      ref={cardRef}
      className={cn(
        "fixed border border-border bg-background text-xs select-none z-40",
        className
      )}
      style={{ left: position.x, top: position.y, width: defaultWidth }}
    >
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="flex items-center justify-between h-7 px-2 border-b border-border cursor-move"
      >
        <span className="text-foreground tracking-wide">&gt; {title}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMinimized((m) => !m)}
            className="px-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={minimized ? "Expand" : "Minimize"}
          >
            [-]
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="px-1 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              [x]
            </button>
          )}
        </div>
      </div>
      {!minimized && <div className="p-3">{children}</div>}
    </div>
  )
}
