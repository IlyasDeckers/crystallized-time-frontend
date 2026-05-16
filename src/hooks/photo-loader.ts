import type { CellValue, ValueType } from "./world-state"

/**
 * Decoded source photo. Pixel data is stored in the configured value
 * type's representation so the runtime never has to convert per-hit.
 *
 * - grayscale: 1 byte per pixel, row-major
 * - tinted:    1 byte per pixel + a single `hue` for the whole photo
 * - color:     3 bytes per pixel (R, G, B), row-major
 */
export interface PhotoData {
  width: number
  height: number
  values: Uint8Array
  /** Only set when valueType === 'tinted'. Hue in degrees. */
  hue?: number
}

/**
 * Distinct hues per photo for the 'tinted' mode. We sample around the
 * color wheel using the golden angle so consecutive photos get visually
 * distant hues regardless of how many photos there are.
 */
const GOLDEN_ANGLE = 137.50776405

function hueForIndex(i: number): number {
  return (i * GOLDEN_ANGLE) % 360
}

/**
 * Load an image URL and decode it into the configured representation.
 *
 * Decoding is synchronous after the image loads: draw to a hidden
 * canvas, read back ImageData, then walk the buffer once converting
 * each pixel to its target shape.
 */
export async function loadPhoto(
  url: string,
  valueType: ValueType,
  index: number,
  colorDesaturation = 0.5,
): Promise<PhotoData> {
  const img = await loadImage(url)
  const w = img.naturalWidth
  const h = img.naturalHeight

  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("Could not get 2D context for photo decode")
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, w, h)

  if (valueType === "grayscale") {
    const out = new Uint8Array(w * h)
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      // ITU-R BT.601 luma — perceptually weighted.
      out[p] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    }
    return { width: w, height: h, values: out }
  }

  if (valueType === "tinted") {
    const out = new Uint8Array(w * h)
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      out[p] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    }
    return { width: w, height: h, values: out, hue: hueForIndex(index) }
  }

  // color: desaturate by mixing each channel toward the luma.
  const out = new Uint8Array(w * h * 3)
  const k = clamp01(colorDesaturation) // 0 = full saturation, 1 = grayscale
  for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    out[p] = Math.round(r * (1 - k) + luma * k)
    out[p + 1] = Math.round(g * (1 - k) + luma * k)
    out[p + 2] = Math.round(b * (1 - k) + luma * k)
  }
  return { width: w, height: h, values: out }
}

/** Load every URL in parallel. */
export async function loadPhotos(
  urls: string[],
  valueType: ValueType,
  colorDesaturation = 0.5,
): Promise<PhotoData[]> {
  return Promise.all(
    urls.map((url, i) => loadPhoto(url, valueType, i, colorDesaturation)),
  )
}

/**
 * Sample a single cell value from a photo, given source coordinates.
 * Returns undefined when (sx, sy) is outside the photo's footprint —
 * the caller decides whether to tile or skip.
 */
export function samplePhoto(
  photo: PhotoData,
  sx: number,
  sy: number,
  valueType: ValueType,
): CellValue | undefined {
  if (sx < 0 || sy < 0 || sx >= photo.width || sy >= photo.height) return undefined
  const idx = sy * photo.width + sx
  if (valueType === "grayscale") return photo.values[idx]
  if (valueType === "tinted") return { v: photo.values[idx], h: photo.hue ?? 0 }
  const o = idx * 3
  return { r: photo.values[o], g: photo.values[o + 1], b: photo.values[o + 2] }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}