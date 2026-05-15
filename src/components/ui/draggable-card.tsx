import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { X, Minus } from "@phosphor-icons/react"

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
    // Don't initiate drag if the click landed on a button (close, minimize)
    if ((e.target as HTMLElement).closest("button")) return

    const card = cardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
    // Capture the pointer so we keep getting moves even if the cursor
    // leaves the header (e.g. drags fast)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffset.current) return
    setPosition({
      x: e.clientX - dragOffset.current.x,
      y: e.clientY - dragOffset.current.y,
    })
  }, [])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragOffset.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  // Clamp position to viewport when window resizes so the card doesn't
  // get stranded off-screen
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
        "fixed  border border-border text-xs select-none z-40 shadow-lg",
        className
      )}
      style={{
        left: position.x,
        top: position.y,
        width: defaultWidth,
      }}
    >
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="flex items-center justify-between h-7 px-2 border-b border-border cursor-move bg-muted/30"
      >
        <span className="font-heading text-xs tracking-tight">{title}</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setMinimized((m) => !m)}
            className="size-5 flex items-center justify-center hover:bg-muted transition-colors"
            aria-label={minimized ? "Expand" : "Minimize"}
          >
            <Minus className="size-3" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="size-5 flex items-center justify-center hover:bg-muted transition-colors"
              aria-label="Close"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>
      {!minimized && <div className="p-3">{children}</div>}
    </div>
  )
}