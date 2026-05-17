import { STRIDE, F, type ParticleBuffer } from "./buffer"
import type { Renderer, RenderConfig } from "./renderer"

export class Canvas2DRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D
  private cssW = 0
  private cssH = 0

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas2D context unavailable")
    this.ctx = ctx
  }

  resize(cssWidth: number, cssHeight: number) {
    const dpr = window.devicePixelRatio || 1
    this.cssW = cssWidth
    this.cssH = cssHeight
    const canvas = this.ctx.canvas
    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(cssHeight * dpr)
  }

  draw(buf: ParticleBuffer, config: RenderConfig) {
    const { ctx, cssW, cssH } = this
    const { data, capacity } = buf
    const { linkDistance, linkOpacity, trailMode, trailDecay } = config
    const dpr = window.devicePixelRatio || 1

    ctx.save()
    ctx.scale(dpr, dpr)

    if (trailMode) {
      ctx.fillStyle = `rgba(0,0,0,${trailDecay.toFixed(3)})`
      ctx.fillRect(0, 0, cssW, cssH)
    } else {
      ctx.clearRect(0, 0, cssW, cssH)
    }

    // Collect alive particle indices
    const alive: number[] = []
    for (let i = 0; i < capacity; i++) {
      const b = i * STRIDE
      if (data[b + F.AGE] < data[b + F.LIFETIME]) alive.push(i)
    }

    // Links
    if (linkDistance > 0 && alive.length > 1) {
      const d2max = linkDistance * linkDistance
      for (let ai = 0; ai < alive.length; ai++) {
        const i = alive[ai]
        const bi = i * STRIDE
        const xi = data[bi + F.X]
        const yi = data[bi + F.Y]
        for (let aj = ai + 1; aj < alive.length; aj++) {
          const j = alive[aj]
          const bj = j * STRIDE
          const dx = xi - data[bj + F.X]
          const dy = yi - data[bj + F.Y]
          const d2 = dx * dx + dy * dy
          if (d2 < d2max) {
            const t = 1 - Math.sqrt(d2) / linkDistance
            const r = Math.round(data[bi + F.R] * 255)
            const g = Math.round(data[bi + F.G] * 255)
            const b2 = Math.round(data[bi + F.B] * 255)
            ctx.strokeStyle = `rgba(${r},${g},${b2},${(t * linkOpacity).toFixed(3)})`
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(xi, yi)
            ctx.lineTo(data[bj + F.X], data[bj + F.Y])
            ctx.stroke()
          }
        }
      }
    }

    // Particles
    for (const i of alive) {
      const b = i * STRIDE
      const r = Math.round(data[b + F.R] * 255)
      const g = Math.round(data[b + F.G] * 255)
      const bl = Math.round(data[b + F.B] * 255)
      ctx.beginPath()
      ctx.arc(data[b + F.X], data[b + F.Y], data[b + F.SIZE], 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${r},${g},${bl},${data[b + F.OPACITY].toFixed(3)})`
      ctx.fill()
    }

    ctx.restore()
  }

  destroy() {}
}
