import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface BottomPanelProps {
  title: string
  children: ReactNode
  open?: boolean
  onToggle?: () => void
  className?: string
  minHeight?: number
  maxHeight?: number
  defaultHeight?: number
}

const TAB_HEIGHT = 32
const RESIZE_HANDLE = 6

export function BottomPanel({
  title,
  children,
  open = false,
  onToggle,
  className,
  minHeight = 80,
  maxHeight = 600,
  defaultHeight = 450,
}: BottomPanelProps) {
  const [height, setHeight] = useState(defaultHeight)
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const startYRef = useRef(0)
  const startHeightRef = useRef(0)
  const minHRef = useRef(minHeight)
  minHRef.current = minHeight
  const maxHRef = useRef(maxHeight)
  maxHRef.current = maxHeight

  const handleResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      setIsResizing(true)
      startYRef.current = e.clientY
      startHeightRef.current = height
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [height],
  )

  const handleResizeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isResizing) return
      const delta = startYRef.current - e.clientY
      const next = Math.min(
        maxHRef.current,
        Math.max(minHRef.current, startHeightRef.current + delta),
      )
      setHeight(next)
    },
    [isResizing],
  )

  const handleResizeEnd = useCallback(
    (e: React.PointerEvent) => {
      setIsResizing(false)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    },
    [],
  )

  useEffect(() => {
    const clamp = () => {
      setHeight((h) =>
        Math.min(maxHRef.current, Math.max(minHRef.current, h)),
      )
    }
    window.addEventListener("resize", clamp)
    return () => window.removeEventListener("resize", clamp)
  }, [])

  return (
    <div
      ref={panelRef}
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40 text-xs font-mono select-none",
        className,
      )}
      style={{ height: open ? height + RESIZE_HANDLE + TAB_HEIGHT : TAB_HEIGHT }}
    >
      <div
        className={cn(
          "border-t border-x border-border/40 bg-background/50 backdrop-blur-sm",
          open && "rounded-t-md",
        )}
      >
        {open && (
          <div
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            className={cn(
              "transition-colors",
              isResizing
                ? "h-1.5 bg-foreground/15 cursor-n-resize"
                : "h-1.5 cursor-n-resize hover:bg-foreground/10",
            )}
          />
        )}

        <div className="flex items-center justify-between h-7 px-3 border-b border-border/30 bg-background/30">
          <div className="flex items-center gap-2">
            <span className="text-foreground tracking-wide">
              &gt; {title}
            </span>
            {open && (
              <span className="text-muted-foreground/50">
                {height}px
              </span>
            )}
          </div>
          <button
            onClick={onToggle}
            className="px-1.5 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={open ? "Collapse panel" : "Expand panel"}
          >
            {open ? '[_]' : '[^]'}
          </button>
        </div>

        {open && (
          <div
            className="overflow-auto"
            style={{ height: height - TAB_HEIGHT + RESIZE_HANDLE }}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
