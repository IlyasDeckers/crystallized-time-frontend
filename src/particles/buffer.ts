/** Number of Float32 values stored per particle in the flat buffer. */
export const STRIDE = 15

/** Field offsets within each particle's STRIDE block. */
export const F = {
  X: 0, Y: 1,         // position
  VX: 2, VY: 3,       // velocity
  TX: 4, TY: 5,       // lerp target (NaN = no target)
  R: 6, G: 7, B: 8,   // color 0..1
  OPACITY: 9,
  SIZE: 10,
  AGE: 11,
  LIFETIME: 12,        // Infinity = immortal
  GROUP: 13,           // integer group id for renderer batching
  CHARGE: 14,          // pulse propagation 0..1
} as const

export interface ParticleBuffer {
  data: Float32Array
  capacity: number
}

/** Allocate a buffer where all slots start dead (age=Inf, lifetime=0). */
export function createBuffer(capacity: number): ParticleBuffer {
  const data = new Float32Array(capacity * STRIDE)
  for (let i = 0; i < capacity; i++) {
    const b = i * STRIDE
    data[b + F.TX] = NaN
    data[b + F.TY] = NaN
    data[b + F.AGE] = Infinity
    data[b + F.LIFETIME] = 0
  }
  return { data, capacity }
}

export interface SpawnProps {
  x?: number
  y?: number
  vx?: number
  vy?: number
  r?: number
  g?: number
  b?: number
  opacity?: number
  size?: number
  /** Seconds to live. Omit or pass Infinity for immortal. */
  lifetime?: number
  /** Integer group id written into the GROUP field. */
  groupId?: number
}

/**
 * Write a particle into the first dead slot in [groupStart, groupEnd).
 * Returns the slot index, or -1 if the group is full.
 * Dead = age >= lifetime (initial state: age=Inf, lifetime=0).
 */
export function spawnParticle(
  buf: ParticleBuffer,
  groupStart: number,
  groupEnd: number,
  activeRef: { value: number },
  props: SpawnProps,
): number {
  const { data } = buf
  for (let i = groupStart; i < groupEnd; i++) {
    const b = i * STRIDE
    if (data[b + F.AGE] >= data[b + F.LIFETIME]) {
      data[b + F.X] = props.x ?? 0
      data[b + F.Y] = props.y ?? 0
      data[b + F.VX] = props.vx ?? 0
      data[b + F.VY] = props.vy ?? 0
      data[b + F.TX] = NaN
      data[b + F.TY] = NaN
      data[b + F.R] = props.r ?? 1
      data[b + F.G] = props.g ?? 1
      data[b + F.B] = props.b ?? 1
      data[b + F.OPACITY] = props.opacity ?? 1
      data[b + F.SIZE] = props.size ?? 2
      data[b + F.AGE] = 0
      data[b + F.LIFETIME] = props.lifetime ?? Infinity
      data[b + F.GROUP] = props.groupId ?? 0
      data[b + F.CHARGE] = 0
      activeRef.value++
      return i
    }
  }
  return -1
}

/** Mark a slot dead and decrement the active count. */
export function killParticle(
  buf: ParticleBuffer,
  index: number,
  activeRef: { value: number },
): void {
  const b = index * STRIDE
  buf.data[b + F.AGE] = Infinity
  buf.data[b + F.LIFETIME] = 0
  activeRef.value = Math.max(0, activeRef.value - 1)
}
