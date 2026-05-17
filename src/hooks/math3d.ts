// ---------------------------------------------------------------------------
// Core 3D types
// ---------------------------------------------------------------------------

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Vec2 {
  x: number
  y: number
}

// 3x3 rotation matrix stored row-major
export type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number,
]

// ---------------------------------------------------------------------------
// Matrix construction
// ---------------------------------------------------------------------------

export function rotX(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [1, 0, 0, 0, c, -s, 0, s, c]
}

export function rotY(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [c, 0, s, 0, 1, 0, -s, 0, c]
}

export function rotZ(a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}

export function mulMat3(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0]*b[0] + a[1]*b[3] + a[2]*b[6],
    a[0]*b[1] + a[1]*b[4] + a[2]*b[7],
    a[0]*b[2] + a[1]*b[5] + a[2]*b[8],
    a[3]*b[0] + a[4]*b[3] + a[5]*b[6],
    a[3]*b[1] + a[4]*b[4] + a[5]*b[7],
    a[3]*b[2] + a[4]*b[5] + a[5]*b[8],
    a[6]*b[0] + a[7]*b[3] + a[8]*b[6],
    a[6]*b[1] + a[7]*b[4] + a[8]*b[7],
    a[6]*b[2] + a[7]*b[5] + a[8]*b[8],
  ]
}

export function applyMat3(m: Mat3, v: Vec3): Vec3 {
  return {
    x: m[0]*v.x + m[1]*v.y + m[2]*v.z,
    y: m[3]*v.x + m[4]*v.y + m[5]*v.z,
    z: m[6]*v.x + m[7]*v.y + m[8]*v.z,
  }
}

// Compose rotation from Euler angles (applied X → Y → Z)
export function eulerMat3(rx: number, ry: number, rz: number): Mat3 {
  return mulMat3(mulMat3(rotX(rx), rotY(ry)), rotZ(rz))
}

// ---------------------------------------------------------------------------
// Perspective projection
// ---------------------------------------------------------------------------

export interface ProjectionParams {
  cx: number        // screen centre x
  cy: number        // screen centre y
  focalLength?: number  // default 400
  depth?: number    // z offset pushing geometry away from camera, default 3
}

export function project(v: Vec3, p: ProjectionParams): Vec2 {
  const fl = p.focalLength ?? 400
  const d  = p.depth ?? 3
  const w  = fl / (v.z + d)
  return { x: p.cx + v.x * w, y: p.cy + v.y * w }
}

// Project an array of Vec3 to Vec2 using the same params
export function projectAll(verts: Vec3[], p: ProjectionParams): Vec2[] {
  return verts.map(v => project(v, p))
}

// ---------------------------------------------------------------------------
// Rotation state — accumulates angular velocity each frame
// ---------------------------------------------------------------------------

export interface RotationState {
  rx: number
  ry: number
  rz: number
  vx: number   // angular velocity rad/s
  vy: number
  vz: number
}

export function makeRotationState(
  vx = 0.2,
  vy = 0.35,
  vz = 0.05,
): RotationState {
  return { rx: 0, ry: 0, rz: 0, vx, vy, vz }
}

export function stepRotation(state: RotationState, dt: number): RotationState {
  return {
    ...state,
    rx: state.rx + state.vx * dt,
    ry: state.ry + state.vy * dt,
    rz: state.rz + state.vz * dt,
  }
}

export function rotationMatrix(state: RotationState): Mat3 {
  return eulerMat3(state.rx, state.ry, state.rz)
}