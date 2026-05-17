import type { Vec3 } from "@/particles/math/math3d"

// ---------------------------------------------------------------------------
// All generators return Vec3[] — unit-scale, centred at origin.
// Scale by multiplying x/y/z before projection.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cube
// ---------------------------------------------------------------------------

export function cubeVerts(n = 40): Vec3[] {
  const verts: Vec3[] = []
  const perEdge = Math.max(2, Math.floor(n / 12))

  const edges: [Vec3, Vec3][] = [
    // bottom face
    [{ x: -1, y: -1, z: -1 }, { x:  1, y: -1, z: -1 }],
    [{ x:  1, y: -1, z: -1 }, { x:  1, y: -1, z:  1 }],
    [{ x:  1, y: -1, z:  1 }, { x: -1, y: -1, z:  1 }],
    [{ x: -1, y: -1, z:  1 }, { x: -1, y: -1, z: -1 }],
    // top face
    [{ x: -1, y:  1, z: -1 }, { x:  1, y:  1, z: -1 }],
    [{ x:  1, y:  1, z: -1 }, { x:  1, y:  1, z:  1 }],
    [{ x:  1, y:  1, z:  1 }, { x: -1, y:  1, z:  1 }],
    [{ x: -1, y:  1, z:  1 }, { x: -1, y:  1, z: -1 }],
    // verticals
    [{ x: -1, y: -1, z: -1 }, { x: -1, y:  1, z: -1 }],
    [{ x:  1, y: -1, z: -1 }, { x:  1, y:  1, z: -1 }],
    [{ x:  1, y: -1, z:  1 }, { x:  1, y:  1, z:  1 }],
    [{ x: -1, y: -1, z:  1 }, { x: -1, y:  1, z:  1 }],
  ]

  for (const [a, b] of edges) {
    for (let i = 0; i < perEdge; i++) {
      const t = i / (perEdge - 1)
      verts.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
      })
    }
  }
  return verts
}

// ---------------------------------------------------------------------------
// Sphere (Fibonacci distribution)
// ---------------------------------------------------------------------------

export function sphereVerts(n = 80): Vec3[] {
  const verts: Vec3[] = []
  const phi = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = n <= 1 ? 0 : 1 - (i / (n - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const theta = phi * i
    verts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r })
  }
  return verts
}

// ---------------------------------------------------------------------------
// Torus
// ---------------------------------------------------------------------------

export function torusVerts(n = 100, R = 1, r = 0.35): Vec3[] {
  const verts: Vec3[] = []
  const uSteps = Math.ceil(Math.sqrt(n * (R / r)))
  const vSteps = Math.ceil(n / uSteps)
  for (let i = 0; i < uSteps; i++) {
    for (let j = 0; j < vSteps; j++) {
      const u = (i / uSteps) * Math.PI * 2
      const v = (j / vSteps) * Math.PI * 2
      verts.push({
        x: (R + r * Math.cos(v)) * Math.cos(u),
        y: r * Math.sin(v),
        z: (R + r * Math.cos(v)) * Math.sin(u),
      })
    }
  }
  return verts.slice(0, n)
}

// ---------------------------------------------------------------------------
// Icosphere (subdivided icosahedron)
// ---------------------------------------------------------------------------

const ICO_PHI = (1 + Math.sqrt(5)) / 2

function icoNorm(v: Vec3): Vec3 {
  const l = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z)
  return { x: v.x/l, y: v.y/l, z: v.z/l }
}

function icoMid(a: Vec3, b: Vec3): Vec3 {
  return icoNorm({ x: (a.x+b.x)/2, y: (a.y+b.y)/2, z: (a.z+b.z)/2 })
}

export function icosphereVerts(n = 80, subdivisions = 2): Vec3[] {
  let verts: Vec3[] = [
    icoNorm({ x: -1,       y:  ICO_PHI, z: 0 }),
    icoNorm({ x:  1,       y:  ICO_PHI, z: 0 }),
    icoNorm({ x: -1,       y: -ICO_PHI, z: 0 }),
    icoNorm({ x:  1,       y: -ICO_PHI, z: 0 }),
    icoNorm({ x: 0,        y: -1,       z:  ICO_PHI }),
    icoNorm({ x: 0,        y:  1,       z:  ICO_PHI }),
    icoNorm({ x: 0,        y: -1,       z: -ICO_PHI }),
    icoNorm({ x: 0,        y:  1,       z: -ICO_PHI }),
    icoNorm({ x:  ICO_PHI, y: 0,        z: -1 }),
    icoNorm({ x:  ICO_PHI, y: 0,        z:  1 }),
    icoNorm({ x: -ICO_PHI, y: 0,        z: -1 }),
    icoNorm({ x: -ICO_PHI, y: 0,        z:  1 }),
  ]

  let faces: [number, number, number][] = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
  ]

  for (let s = 0; s < subdivisions; s++) {
    const newFaces: [number, number, number][] = []
    for (const [a, b, c] of faces) {
      const ab = verts.length; verts.push(icoMid(verts[a], verts[b]))
      const bc = verts.length; verts.push(icoMid(verts[b], verts[c]))
      const ca = verts.length; verts.push(icoMid(verts[c], verts[a]))
      newFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
    }
    faces = newFaces
    const seen = new Map<string, number>()
    const remap: number[] = []
    const deduped: Vec3[] = []
    for (let i = 0; i < verts.length; i++) {
      const key = `${verts[i].x.toFixed(6)},${verts[i].y.toFixed(6)},${verts[i].z.toFixed(6)}`
      if (!seen.has(key)) { seen.set(key, deduped.length); deduped.push(verts[i]) }
      remap[i] = seen.get(key)!
    }
    verts = deduped
    faces = newFaces.map(([a, b, c]) => [remap[a], remap[b], remap[c]])
  }

  if (verts.length <= n) return verts
  const step = verts.length / n
  return Array.from({ length: n }, (_, i) => verts[Math.floor(i * step)])
}

// ---------------------------------------------------------------------------
// DNA double helix
// ---------------------------------------------------------------------------

export function helixVerts(n = 80, turns = 4): Vec3[] {
  const verts: Vec3[] = []
  const half = Math.floor(n / 2)
  for (let i = 0; i < half; i++) {
    const t = i / half
    const angle = t * turns * Math.PI * 2
    const y = t * 2 - 1
    verts.push({ x: Math.cos(angle) * 0.6, y, z: Math.sin(angle) * 0.6 })
    verts.push({ x: Math.cos(angle + Math.PI) * 0.6, y, z: Math.sin(angle + Math.PI) * 0.6 })
  }
  const linkEvery = Math.floor(half / (turns * 4))
  for (let i = 0; i < half; i += linkEvery) {
    const t = i / half
    const angle = t * turns * Math.PI * 2
    const y = t * 2 - 1
    const steps = 3
    for (let s = 1; s < steps; s++) {
      const lt = s / steps
      verts.push({
        x: Math.cos(angle) * 0.6 * (1 - lt) + Math.cos(angle + Math.PI) * 0.6 * lt,
        y,
        z: Math.sin(angle) * 0.6 * (1 - lt) + Math.sin(angle + Math.PI) * 0.6 * lt,
      })
    }
  }
  return verts
}

// ---------------------------------------------------------------------------
// Mobius strip
// ---------------------------------------------------------------------------

export function mobiusVerts(n = 100): Vec3[] {
  const verts: Vec3[] = []
  const uSteps = Math.ceil(n * 0.7)
  const vSteps = Math.ceil(n / uSteps)
  for (let i = 0; i < uSteps; i++) {
    for (let j = 0; j < vSteps; j++) {
      const u = (i / uSteps) * Math.PI * 2
      const v = (j / vSteps) * 2 - 1
      const w = 0.3
      verts.push({
        x: (1 + w * v * Math.cos(u / 2)) * Math.cos(u),
        y: w * v * Math.sin(u / 2),
        z: (1 + w * v * Math.cos(u / 2)) * Math.sin(u),
      })
    }
  }
  return verts.slice(0, n)
}

// ---------------------------------------------------------------------------
// Klein bottle (immersed in 3D)
// ---------------------------------------------------------------------------

export function kleinVerts(n = 120): Vec3[] {
  const verts: Vec3[] = []
  const uSteps = Math.ceil(Math.sqrt(n * 1.5))
  const vSteps = Math.ceil(n / uSteps)
  for (let i = 0; i < uSteps; i++) {
    for (let j = 0; j < vSteps; j++) {
      const u = (i / uSteps) * Math.PI * 2
      const v = (j / vSteps) * Math.PI * 2
      let x: number, y: number, z: number
      if (u < Math.PI) {
        x = 3 * Math.cos(u) * (1 + Math.sin(u)) + (2 * (1 - Math.cos(u) / 2)) * Math.cos(u) * Math.cos(v)
        y = 8 * Math.sin(u) + (2 * (1 - Math.cos(u) / 2)) * Math.sin(u) * Math.cos(v)
      } else {
        x = 3 * Math.cos(u) * (1 + Math.sin(u)) + (2 * (1 - Math.cos(u) / 2)) * Math.cos(v + Math.PI)
        y = 8 * Math.sin(u)
      }
      z = (2 * (1 - Math.cos(u) / 2)) * Math.sin(v)
      verts.push({ x: x / 12, y: y / 12, z: z / 4 })
    }
  }
  return verts.slice(0, n)
}

// ---------------------------------------------------------------------------
// Trefoil knot
// ---------------------------------------------------------------------------

export function trefoilVerts(n = 80, tube = 0.2): Vec3[] {
  const verts: Vec3[] = []
  const uSteps = Math.ceil(n * 0.6)
  const vSteps = Math.ceil(n / uSteps)

  for (let i = 0; i < uSteps; i++) {
    const u = (i / uSteps) * Math.PI * 2
    const cx = Math.sin(u) + 2 * Math.sin(2 * u)
    const cy = Math.cos(u) - 2 * Math.cos(2 * u)
    const cz = -Math.sin(3 * u)

    for (let j = 0; j < vSteps; j++) {
      const v = (j / vSteps) * Math.PI * 2
      const tx = Math.cos(u) + 4 * Math.cos(2 * u)
      const ty = -Math.sin(u) + 4 * Math.sin(2 * u)
      const tz = -3 * Math.cos(3 * u)
      const tl = Math.sqrt(tx*tx + ty*ty + tz*tz)
      const tNx = tx / tl, tNy = ty / tl, tNz = tz / tl

      // Gram-Schmidt: choose up vector not parallel to tangent
      let ux = 0, uy = 1, uz = 0
      if (Math.abs(tNy) > 0.9) { ux = 1; uy = 0; uz = 0 }
      const dot = ux * tNx + uy * tNy + uz * tNz
      const nRx = ux - dot * tNx, nRy = uy - dot * tNy, nRz = uz - dot * tNz
      const nl = Math.sqrt(nRx*nRx + nRy*nRy + nRz*nRz)
      const nx = nRx / nl, ny = nRy / nl, nz = nRz / nl

      // Binormal: B = T × N
      const bx = tNy * nz - tNz * ny
      const by = tNz * nx - tNx * nz
      const bz = tNx * ny - tNy * nx
      verts.push({
        x: (cx + tube * (nx * Math.cos(v) + bx * Math.sin(v))) / 3.5,
        y: (cy + tube * (ny * Math.cos(v) + by * Math.sin(v))) / 3.5,
        z: (cz + tube * (nz * Math.cos(v) + bz * Math.sin(v))) / 3.5,
      })
    }
  }
  return verts.slice(0, n)
}

// ---------------------------------------------------------------------------
// Octahedron
// ---------------------------------------------------------------------------

export function octahedronVerts(n = 60): Vec3[] {
  const apexes: Vec3[] = [
    { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
    { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
  ]
  const edges: [Vec3, Vec3][] = [
    [apexes[0], apexes[2]], [apexes[0], apexes[3]],
    [apexes[0], apexes[4]], [apexes[0], apexes[5]],
    [apexes[1], apexes[2]], [apexes[1], apexes[3]],
    [apexes[1], apexes[4]], [apexes[1], apexes[5]],
    [apexes[2], apexes[4]], [apexes[4], apexes[3]],
    [apexes[3], apexes[5]], [apexes[5], apexes[2]],
  ]
  const perEdge = Math.max(2, Math.floor(n / edges.length))
  const verts: Vec3[] = []
  for (const [a, b] of edges) {
    for (let i = 0; i < perEdge; i++) {
      const t = i / (perEdge - 1)
      verts.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
      })
    }
  }
  return verts.slice(0, n)
}
