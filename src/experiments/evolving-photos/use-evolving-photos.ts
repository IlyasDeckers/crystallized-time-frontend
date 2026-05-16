import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { CellRenderer } from "@/components/ui/canvas-grid"
import type { MidiMessage } from "@/hooks/use-midi"

import { loadPhotos, samplePhoto, type PhotoData } from "@/hooks/photo-loader"
import {
  drainPending,
  regionSizeFromPitch,
  scheduleRegion,
  type PendingUpdate,
} from "@/hooks/region-reveal"
import { applySmear, type SmearConfig, type CursorState } from "@/hooks/smear"
import {
  WorldState,
  type ColorValue,
  type TintedValue,
  type ValueType,
} from "@/hooks/world-state"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EvolvingPhotosConfig {
  photoUrls: string[]
  valueType: ValueType

  /** Region sizing. */
  minRegionSize?: number
  maxRegionSize?: number
  lowNote?: number
  highNote?: number

  /** Reveal. */
  revealDurationSecs?: number

  /** Smear. */
  smearRadius?: number
  smearLength?: number
  smearStrength?: number
  minSmearSpeed?: number

  /** Photo cycling. */
  wrapPhotos?: boolean

  /** Invert. Channel is 0..15. Default 15 (= MIDI channel 16). */
  invertChannel?: number
  invertDebounceMs?: number

  /** Color desaturation factor at load time (0..1). Only applies to 'color' type. */
  colorDesaturation?: number
}

export interface EvolvingPhotosStatus {
  photosLoaded: number
  photosTotal: number
  nextPhotoIndex: number
  pendingUpdates: number
  inverted: boolean
  worldCells: number
}

export interface ViewportInfo {
  minX: number
  maxX: number
  minY: number
  maxY: number
  cellSize: number
}

export interface UseEvolvingPhotosResult {
  /** CellRenderer for the CanvasGrid. */
  renderCell: CellRenderer
  /** Forward incoming MIDI messages here. */
  onMidiMessage: (msg: MidiMessage) => void
  /** Forward cell clicks here (for parity with the existing click-to-flash). */
  onCellClick: (cell: { x: number; y: number }) => void
  /**
   * Forward continuous pointer positions here. `null` when the pointer
   * leaves the canvas. `clientX/Y` are screen pixels for the speed
   * gate; `gridX/Y` are fractional grid coords for the smear position.
   */
  onPointerPosition: (info: {
    clientX: number
    clientY: number
    gridX: number
    gridY: number
  } | null) => void
  /** Status for the debug HUD. */
  status: EvolvingPhotosStatus
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS = {
  minRegionSize: 3,
  maxRegionSize: 30,
  lowNote: 24,
  highNote: 108,
  revealDurationSecs: 1.0,
  smearRadius: 4,
  smearLength: 1.5,
  smearStrength: 0.3,
  minSmearSpeed: 50,
  wrapPhotos: true,
  invertChannel: 15,
  invertDebounceMs: 50,
  colorDesaturation: 0.5,
} satisfies Required<Omit<EvolvingPhotosConfig, "photoUrls" | "valueType">>

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useEvolvingPhotos(config: EvolvingPhotosConfig): UseEvolvingPhotosResult {
  const cfg = useMemo(() => ({ ...DEFAULTS, ...config }), [config])

  // One world, one queue, one cursor. Refs because none of this should
  // trigger React re-renders — the canvas reads them every frame.
  const worldRef = useRef<WorldState>(new WorldState())
  const queueRef = useRef<PendingUpdate[]>([])
  const photosRef = useRef<PhotoData[]>([])
  const nextPhotoIndexRef = useRef(1)
  const invertedRef = useRef(false)
  const lastInvertToggleRef = useRef(0)

  // Cursor tracking. We update these on every pointer move and read
  // them in the per-frame smear loop.
  const cursorRef = useRef<{
    gridX: number
    gridY: number
    clientX: number
    clientY: number
    lastClientX: number
    lastClientY: number
    lastTime: number
    /** Smoothed velocity (grid units / sec). */
    vGridX: number
    vGridY: number
    /** Smoothed speed (px / sec). */
    speedPx: number
    inside: boolean
  }>({
    gridX: 0, gridY: 0,
    clientX: 0, clientY: 0,
    lastClientX: 0, lastClientY: 0,
    lastTime: 0,
    vGridX: 0, vGridY: 0,
    speedPx: 0,
    inside: false,
  })

  // Visible viewport range, written by the renderer each frame so MIDI
  // hits can pick random positions inside what's currently on screen.
  const viewportRef = useRef<ViewportInfo>({
    minX: 0, maxX: 0, minY: 0, maxY: 0, cellSize: 1,
  })
  // The renderer detects frame boundaries to commit accumulated
  // viewport bounds. Since CanvasGrid iterates row-major from
  // (startCol, startRow), the first cell of every frame has the
  // smallest cell.x and cell.y of that frame. We notice the boundary
  // by tracking the previous call's coords: when both coordinates
  // decrease, a new frame has started.
  const accumRef = useRef<{
    minX: number; maxX: number; minY: number; maxY: number
    prevX: number; prevY: number
    started: boolean
  }>({
    minX: 0, maxX: 0, minY: 0, maxY: 0,
    prevX: 0, prevY: 0,
    started: false,
  })

  // Status state surfaced to React for the HUD. Updated at ~10 Hz so
  // we don't re-render the tree on every MIDI tick.
  const [status, setStatus] = useState<EvolvingPhotosStatus>({
    photosLoaded: 0,
    photosTotal: cfg.photoUrls.length,
    nextPhotoIndex: 1,
    pendingUpdates: 0,
    inverted: false,
    worldCells: 0,
  })

  // -------------------------------------------------------------------------
  // Photo loading + anchor placement
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    // Reset state on config change (or StrictMode remount). World gets
    // cleared so re-anchoring photo 0 doesn't leave stale data behind.
    worldRef.current.clear()
    queueRef.current.length = 0
    photosRef.current = []
    nextPhotoIndexRef.current = 1
    setStatus((s) => ({
      ...s,
      photosLoaded: 0,
      photosTotal: cfg.photoUrls.length,
      nextPhotoIndex: 1,
      pendingUpdates: 0,
      worldCells: 0,
    }))

    void (async () => {
      try {
        const photos = await loadPhotos(cfg.photoUrls, cfg.valueType, cfg.colorDesaturation)
        if (cancelled) return
        photosRef.current = photos

        // Anchor photo 0 at native coordinates. This is the only photo
        // that's written instantly and at its native footprint; all
        // others arrive via MIDI region hits with tiling.
        const anchor = photos[0]
        if (anchor) {
          const world = worldRef.current
          for (let y = 0; y < anchor.height; y++) {
            for (let x = 0; x < anchor.width; x++) {
              const v = samplePhoto(anchor, x, y, cfg.valueType)
              if (v !== undefined) world.set(x, y, v)
            }
          }
        }
        setStatus((s) => ({
          ...s,
          photosLoaded: photos.length,
          worldCells: worldRef.current.size,
        }))
      } catch (err) {
        console.error("[evolving-photos] photo load failed", err)
      }
    })()

    return () => { cancelled = true }
  }, [cfg.photoUrls, cfg.valueType, cfg.colorDesaturation])

  // -------------------------------------------------------------------------
  // Frame loop: drain pending queue, apply smear
  // -------------------------------------------------------------------------
  useEffect(() => {
    let raf = 0
    let lastStatusUpdate = 0

    const smearConfig: SmearConfig = {
      smearRadius: cfg.smearRadius,
      smearLength: cfg.smearLength,
      smearStrength: cfg.smearStrength,
      minSmearSpeed: cfg.minSmearSpeed,
    }

    const tick = (nowMs: number) => {
      const now = nowMs / 1000
      drainPending(worldRef.current, queueRef.current, now)

      const c = cursorRef.current
      if (c.inside) {
        const cursorState: CursorState = {
          gridX: c.gridX,
          gridY: c.gridY,
          vGridX: c.vGridX,
          vGridY: c.vGridY,
          speedPx: c.speedPx,
        }
        applySmear(worldRef.current, cursorState, smearConfig, cfg.valueType)
      }

      // Throttle HUD updates to ~10 Hz.
      if (nowMs - lastStatusUpdate > 100) {
        lastStatusUpdate = nowMs
        setStatus((s) => {
          const next = {
            photosLoaded: photosRef.current.length,
            photosTotal: cfg.photoUrls.length,
            nextPhotoIndex: nextPhotoIndexRef.current,
            pendingUpdates: queueRef.current.length,
            inverted: invertedRef.current,
            worldCells: worldRef.current.size,
          }
          // Only commit a new object when something changed, so the HUD
          // doesn't re-render every 100 ms unconditionally.
          if (
            s.photosLoaded === next.photosLoaded &&
            s.photosTotal === next.photosTotal &&
            s.nextPhotoIndex === next.nextPhotoIndex &&
            s.pendingUpdates === next.pendingUpdates &&
            s.inverted === next.inverted &&
            s.worldCells === next.worldCells
          ) {
            return s
          }
          return next
        })
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [
    cfg.photoUrls.length,
    cfg.valueType,
    cfg.smearRadius,
    cfg.smearLength,
    cfg.smearStrength,
    cfg.minSmearSpeed,
  ])

  // -------------------------------------------------------------------------
  // MIDI handler
  // -------------------------------------------------------------------------
  const onMidiMessage = useCallback((msg: MidiMessage) => {
    if (msg.type !== "noteOn") return

    // Channel-16 invert toggle.
    if (msg.channel === cfg.invertChannel) {
      const nowMs = performance.now()
      if (nowMs - lastInvertToggleRef.current >= cfg.invertDebounceMs) {
        lastInvertToggleRef.current = nowMs
        invertedRef.current = !invertedRef.current
      }
      return
    }

    const photos = photosRef.current
    if (photos.length < 2) return // need at least one non-anchor photo

    const photo = photos[nextPhotoIndexRef.current]
    if (!photo) return

    // Advance the cursor. Index 0 is reserved as the anchor and never
    // re-enters the cycle (per the spec).
    if (cfg.wrapPhotos) {
      nextPhotoIndexRef.current = nextPhotoIndexRef.current + 1
      if (nextPhotoIndexRef.current >= photos.length) {
        nextPhotoIndexRef.current = 1
      }
    } else {
      if (nextPhotoIndexRef.current < photos.length - 1) {
        nextPhotoIndexRef.current += 1
      }
    }

    const size = regionSizeFromPitch(
      msg.data1,
      cfg.lowNote,
      cfg.highNote,
      cfg.minRegionSize,
      cfg.maxRegionSize,
    )

    // Random cell in the current viewport. The region is centered on
    // that cell, so the top-left is (cx - size/2, cy - size/2).
    const vp = viewportRef.current
    const w = vp.maxX - vp.minX
    const h = vp.maxY - vp.minY
    if (w <= 0 || h <= 0) return
    const cx = Math.floor(vp.minX + Math.random() * w)
    const cy = Math.floor(vp.minY + Math.random() * h)
    const half = Math.floor(size / 2)

    scheduleRegion(
      photo,
      { x: cx - half, y: cy - half, size },
      cfg.valueType,
      cfg.revealDurationSecs,
      queueRef.current,
      performance.now() / 1000,
    )
  }, [
    cfg.invertChannel,
    cfg.invertDebounceMs,
    cfg.lowNote,
    cfg.highNote,
    cfg.minRegionSize,
    cfg.maxRegionSize,
    cfg.revealDurationSecs,
    cfg.valueType,
    cfg.wrapPhotos,
  ])

  const onCellClick = useCallback(() => {
    // Click is a no-op for the experiment itself. The App may still
    // wire it to MIDI output if desired.
  }, [])

  // -------------------------------------------------------------------------
  // Pointer tracking (for smear)
  // -------------------------------------------------------------------------
  const onPointerPosition = useCallback<UseEvolvingPhotosResult["onPointerPosition"]>(
    (info) => {
      const c = cursorRef.current
      if (info === null) {
        c.inside = false
        c.speedPx = 0
        c.vGridX = 0
        c.vGridY = 0
        return
      }
      const now = performance.now() / 1000
      if (!c.inside) {
        // Re-entering — reset velocity baseline so we don't get a huge
        // spurious jump from wherever the cursor last left.
        c.lastClientX = info.clientX
        c.lastClientY = info.clientY
        c.lastTime = now
        c.inside = true
        c.speedPx = 0
        c.vGridX = 0
        c.vGridY = 0
      }
      const dt = Math.max(1e-3, now - c.lastTime)
      const dxPx = info.clientX - c.lastClientX
      const dyPx = info.clientY - c.lastClientY
      const speedPx = Math.hypot(dxPx, dyPx) / dt

      const cellSize = viewportRef.current.cellSize || 1
      const vGridX = dxPx / cellSize / dt
      const vGridY = dyPx / cellSize / dt

      // Exponential smoothing — approximates a moving average over ~5
      // frames at 60 Hz with alpha 0.3. Cheap and stable.
      const alpha = 0.3
      c.speedPx = c.speedPx * (1 - alpha) + speedPx * alpha
      c.vGridX = c.vGridX * (1 - alpha) + vGridX * alpha
      c.vGridY = c.vGridY * (1 - alpha) + vGridY * alpha

      c.gridX = info.gridX
      c.gridY = info.gridY
      c.lastClientX = info.clientX
      c.lastClientY = info.clientY
      c.lastTime = now
    },
    [],
  )

  // -------------------------------------------------------------------------
  // Per-cell renderer
  // -------------------------------------------------------------------------
  const renderCell = useCallback<CellRenderer>(({ ctx, cell, size }) => {
    // Detect a new render frame: row-major iteration means cell.y is
    // non-decreasing within a frame, so a decrease of cell.y signals a
    // new frame. Commit the previous frame's accumulated bounds and
    // start a fresh accumulation.
    const a = accumRef.current
    const newFrame = !a.started || cell.y < a.prevY
    if (newFrame) {
      if (a.started) {
        viewportRef.current.minX = a.minX
        viewportRef.current.maxX = a.maxX
        viewportRef.current.minY = a.minY
        viewportRef.current.maxY = a.maxY
      }
      a.minX = cell.x
      a.maxX = cell.x + 1
      a.minY = cell.y
      a.maxY = cell.y + 1
      a.started = true
    } else {
      if (cell.x < a.minX) a.minX = cell.x
      if (cell.x + 1 > a.maxX) a.maxX = cell.x + 1
      if (cell.y < a.minY) a.minY = cell.y
      if (cell.y + 1 > a.maxY) a.maxY = cell.y + 1
    }
    a.prevX = cell.x
    a.prevY = cell.y
    viewportRef.current.cellSize = size

    const value = worldRef.current.get(cell.x, cell.y)
    if (value === undefined) return

    const inverted = invertedRef.current
    let fill: string
    switch (cfg.valueType) {
      case "grayscale": {
        const v = inverted ? 255 - (value as number) : (value as number)
        fill = `rgb(${v},${v},${v})`
        break
      }
      case "tinted": {
        const t = value as TintedValue
        const v = inverted ? 255 - t.v : t.v
        // Map 0..255 to lightness 0..100, holding saturation at a
        // moderate value so the tint reads without overpowering the
        // underlying brightness.
        const l = (v / 255) * 100
        fill = `hsl(${t.h}, 55%, ${l.toFixed(1)}%)`
        break
      }
      case "color": {
        const c = value as ColorValue
        const r = inverted ? 255 - c.r : c.r
        const g = inverted ? 255 - c.g : c.g
        const b = inverted ? 255 - c.b : c.b
        fill = `rgb(${r},${g},${b})`
        break
      }
    }
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, size, size)
  }, [cfg.valueType])

  // Note: viewport bounds are accumulated inside renderCell and
  // committed on the boundary between render frames. No separate rAF
  // needed.

  return {
    renderCell,
    onMidiMessage,
    onCellClick,
    onPointerPosition,
    status,
  }
}