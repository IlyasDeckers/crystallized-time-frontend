import type { RefObject } from "react"

interface PhotoLayerProps {
  visible: boolean
  canvasRef: RefObject<HTMLCanvasElement | null>
}

/**
 * Background canvas layer that sits below the particle canvas.
 * External code draws to canvasRef for photo/evolving-photos content.
 */
export function PhotoLayer({ visible, canvasRef }: PhotoLayerProps) {
  if (!visible) return null
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  )
}
