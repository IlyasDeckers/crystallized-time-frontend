import { STRIDE, F, type ParticleBuffer } from "./buffer"
import type { Renderer, RenderConfig } from "./renderer"

// ---- Shader sources (inline GLSL, no Vite plugin needed) ----

// Explicit attribute locations let a single blitVao work across all blit programs.
const PARTICLE_VERT = /* glsl */`#version 300 es
precision highp float;

layout(location = 0) in vec2 a_quad;      // per-vertex corner [-0.5..0.5]
layout(location = 1) in vec2 a_position;  // per-instance center (CSS px)
layout(location = 2) in vec3 a_color;     // per-instance RGB 0..1
layout(location = 3) in float a_opacity;  // per-instance
layout(location = 4) in float a_size;     // per-instance radius (CSS px)

uniform vec2 u_resolution;  // canvas CSS dimensions

out vec2 v_uv;
out vec3 v_color;
out float v_opacity;

void main() {
  vec2 pixel = a_position + a_quad * a_size * 2.0;
  vec2 clip  = (pixel / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
  v_uv     = a_quad + 0.5;
  v_color  = a_color;
  v_opacity = a_opacity;
}
`

const PARTICLE_FRAG = /* glsl */`#version 300 es
precision highp float;

in vec2 v_uv;
in vec3 v_color;
in float v_opacity;

out vec4 fragColor;

void main() {
  float dist  = length(v_uv - 0.5) * 2.0;  // 0 at center, 1 at edge
  float alpha = smoothstep(1.0, 0.75, dist);
  fragColor   = vec4(v_color, alpha * v_opacity);
}
`

// Full-screen quad, used for all blit/post-process passes.
const BLIT_VERT = /* glsl */`#version 300 es
precision highp float;

layout(location = 0) in vec2 a_pos;

out vec2 v_uv;

void main() {
  v_uv        = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

// Plain texture blit.
const BLIT_FRAG = /* glsl */`#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;

out vec4 fragColor;

void main() {
  fragColor = texture(u_tex, v_uv);
}
`

// Trail fade: copy previous-frame texture, dimmed by trailDecay.
const TRAIL_FRAG = /* glsl */`#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_decay;  // fraction to fade each frame

out vec4 fragColor;

void main() {
  vec4 c    = texture(u_tex, v_uv);
  float keep = 1.0 - u_decay;
  fragColor = vec4(c.rgb * keep, c.a * keep);
}
`

// Separable 9-tap Gaussian blur.
const BLUR_FRAG = /* glsl */`#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_direction;  // (1,0) horizontal or (0,1) vertical
uniform vec2 u_texSize;    // dimensions of the source texture

out vec4 fragColor;

void main() {
  vec2 texel = u_direction / u_texSize;
  // Gaussian weights for taps 0..4
  const float w0 = 0.2270270270;
  const float w1 = 0.1945945946;
  const float w2 = 0.1216216216;
  const float w3 = 0.0540540541;
  const float w4 = 0.0162162162;

  vec4 c = texture(u_tex, v_uv) * w0;
  c += texture(u_tex, v_uv + texel * 1.0) * w1;
  c += texture(u_tex, v_uv - texel * 1.0) * w1;
  c += texture(u_tex, v_uv + texel * 2.0) * w2;
  c += texture(u_tex, v_uv - texel * 2.0) * w2;
  c += texture(u_tex, v_uv + texel * 3.0) * w3;
  c += texture(u_tex, v_uv - texel * 3.0) * w3;
  c += texture(u_tex, v_uv + texel * 4.0) * w4;
  c += texture(u_tex, v_uv - texel * 4.0) * w4;
  fragColor = c;
}
`

// Link (line segment) vertex + fragment shaders.
const LINK_VERT = /* glsl */`#version 300 es
precision highp float;

layout(location=0) in vec2 a_pos;
layout(location=1) in vec3 a_color;
layout(location=2) in float a_alpha;

uniform vec2 u_resolution;

out vec3 v_color;
out float v_alpha;

void main() {
  vec2 clip = (a_pos / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
  v_color  = a_color;
  v_alpha  = a_alpha;
}
`

const LINK_FRAG = /* glsl */`#version 300 es
precision highp float;

in vec3 v_color;
in float v_alpha;

out vec4 fragColor;

void main() {
  fragColor = vec4(v_color, v_alpha);
}
`

// Bloom composite: scene + blurred bloom * intensity.
const BLOOM_FRAG = /* glsl */`#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_intensity;

out vec4 fragColor;

void main() {
  vec4 scene = texture(u_scene, v_uv);
  vec4 bloom = texture(u_bloom, v_uv);
  fragColor  = scene + bloom * u_intensity;
}
`

// ---- Internal types ----

interface FBO {
  fbo: WebGLFramebuffer
  tex: WebGLTexture
  w: number
  h: number
}

// Floats per particle in the instance buffer: x, y, r, g, b, opacity, size
const INST_FLOATS = 7

// ---- WebGL helpers ----

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compile error:\n${log}`)
  }
  return shader
}

function buildProgram(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vert)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, frag)
  const prog = gl.createProgram()!
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog)
    gl.deleteProgram(prog)
    throw new Error(`Program link error:\n${log}`)
  }
  return prog
}

function makeFBO(gl: WebGL2RenderingContext, w: number, h: number): FBO {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  const fbo = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.bindTexture(gl.TEXTURE_2D, null)
  return { fbo, tex, w, h }
}

function resizeFBOTexture(gl: WebGL2RenderingContext, fb: FBO, w: number, h: number) {
  if (fb.w === w && fb.h === h) return
  fb.w = w
  fb.h = h
  gl.bindTexture(gl.TEXTURE_2D, fb.tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.bindTexture(gl.TEXTURE_2D, null)
}

function dropFBO(gl: WebGL2RenderingContext, fb: FBO) {
  gl.deleteTexture(fb.tex)
  gl.deleteFramebuffer(fb.fbo)
}

// ---- Renderer ----

export class WebGLRenderer implements Renderer {
  private gl: WebGL2RenderingContext
  private cssW = 0
  private cssH = 0
  private physW = 0
  private physH = 0

  // Particle instanced draw
  private particleProg: WebGLProgram
  private uParticleRes: WebGLUniformLocation
  private particleVao: WebGLVertexArrayObject
  private instVbo: WebGLBuffer
  private instData: Float32Array

  // Blit quad (shared across all post-process passes)
  private blitVao: WebGLVertexArrayObject
  private blitVbo: WebGLBuffer

  // Plain blit program + uniform
  private blitProg: WebGLProgram
  private uBlitTex: WebGLUniformLocation

  // Trail mode programs + FBOs (lazy-init)
  private trailProg: WebGLProgram | null = null
  private uTrailTex: WebGLUniformLocation | null = null
  private uTrailDecay: WebGLUniformLocation | null = null
  private trailFbos: [FBO, FBO] | null = null
  private trailReadIdx = 0

  // Link rendering
  private linkProg: WebGLProgram
  private uLinkRes: WebGLUniformLocation
  private linkVao: WebGLVertexArrayObject
  private linkVbo: WebGLBuffer
  // 6 floats per vertex × 2 vertices per link
  private linkData: Float32Array = new Float32Array(8192 * 12)

  // Glow mode programs + FBOs (lazy-init)
  private blurProg: WebGLProgram | null = null
  private uBlurTex: WebGLUniformLocation | null = null
  private uBlurDir: WebGLUniformLocation | null = null
  private uBlurSize: WebGLUniformLocation | null = null
  private bloomProg: WebGLProgram | null = null
  private uBloomScene: WebGLUniformLocation | null = null
  private uBloomBloom: WebGLUniformLocation | null = null
  private uBloomIntensity: WebGLUniformLocation | null = null
  private sceneFbo: FBO | null = null
  private blurFbos: [FBO, FBO] | null = null  // [blurH, blurV]

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false })
    if (!gl) throw new Error("WebGL2 not available")
    this.gl = gl

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    // ---- Particle program ----
    this.particleProg = buildProgram(gl, PARTICLE_VERT, PARTICLE_FRAG)
    this.uParticleRes = gl.getUniformLocation(this.particleProg, "u_resolution")!

    // Quad corners for TRIANGLE_STRIP (4 vertices)
    const quadCorners = new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5])
    const quadVbo = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo)
    gl.bufferData(gl.ARRAY_BUFFER, quadCorners, gl.STATIC_DRAW)

    // Instance buffer (grows on demand)
    this.instData = new Float32Array(1024 * INST_FLOATS)
    this.instVbo = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo)
    gl.bufferData(gl.ARRAY_BUFFER, this.instData, gl.DYNAMIC_DRAW)

    // Particle VAO
    this.particleVao = gl.createVertexArray()!
    gl.bindVertexArray(this.particleVao)

    // location 0 — a_quad (per-vertex)
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.vertexAttribDivisor(0, 0)

    // locations 1..4 — per-instance fields from instVbo
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo)
    const stride = INST_FLOATS * 4

    gl.enableVertexAttribArray(1)                                   // a_position (x,y)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0)
    gl.vertexAttribDivisor(1, 1)

    gl.enableVertexAttribArray(2)                                   // a_color (r,g,b)
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 2 * 4)
    gl.vertexAttribDivisor(2, 1)

    gl.enableVertexAttribArray(3)                                   // a_opacity
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 5 * 4)
    gl.vertexAttribDivisor(3, 1)

    gl.enableVertexAttribArray(4)                                   // a_size
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 6 * 4)
    gl.vertexAttribDivisor(4, 1)

    gl.bindVertexArray(null)
    // quadVbo is captured in the VAO; we don't need to keep a ref to it.

    // ---- Blit quad (shared for post-process passes) ----
    this.blitProg = buildProgram(gl, BLIT_VERT, BLIT_FRAG)
    this.uBlitTex = gl.getUniformLocation(this.blitProg, "u_tex")!

    const blitCorners = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
    this.blitVbo = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.blitVbo)
    gl.bufferData(gl.ARRAY_BUFFER, blitCorners, gl.STATIC_DRAW)

    // Blit VAO — location 0 maps to a_pos in all blit/post-process shaders
    this.blitVao = gl.createVertexArray()!
    gl.bindVertexArray(this.blitVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.blitVbo)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    // ---- Link program + VBO ----
    this.linkProg = buildProgram(gl, LINK_VERT, LINK_FRAG)
    this.uLinkRes = gl.getUniformLocation(this.linkProg, "u_resolution")!

    this.linkVbo = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linkVbo)
    gl.bufferData(gl.ARRAY_BUFFER, this.linkData, gl.DYNAMIC_DRAW)

    const linkStride = 6 * 4  // 6 floats × 4 bytes
    this.linkVao = gl.createVertexArray()!
    gl.bindVertexArray(this.linkVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linkVbo)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, linkStride, 0)       // a_pos
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, linkStride, 2 * 4)   // a_color
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, linkStride, 5 * 4)   // a_alpha
    gl.bindVertexArray(null)
  }

  resize(cssWidth: number, cssHeight: number) {
    const dpr = window.devicePixelRatio || 1
    this.cssW = cssWidth
    this.cssH = cssHeight
    this.physW = Math.round(cssWidth * dpr)
    this.physH = Math.round(cssHeight * dpr)
    const canvas = this.gl.canvas as HTMLCanvasElement
    canvas.width = this.physW
    canvas.height = this.physH
    // FBO textures are lazily resized inside draw().
  }

  // ---- Lazy-init helpers ----

  private initTrail(w: number, h: number) {
    const gl = this.gl
    if (!this.trailProg) {
      this.trailProg = buildProgram(gl, BLIT_VERT, TRAIL_FRAG)
      this.uTrailTex   = gl.getUniformLocation(this.trailProg, "u_tex")!
      this.uTrailDecay = gl.getUniformLocation(this.trailProg, "u_decay")!
    }
    if (!this.trailFbos) {
      this.trailFbos = [makeFBO(gl, w, h), makeFBO(gl, w, h)]
    } else {
      resizeFBOTexture(gl, this.trailFbos[0], w, h)
      resizeFBOTexture(gl, this.trailFbos[1], w, h)
    }
  }

  private initGlow(w: number, h: number) {
    const gl = this.gl
    const hw = Math.max(1, w >> 1)
    const hh = Math.max(1, h >> 1)
    if (!this.blurProg) {
      this.blurProg = buildProgram(gl, BLIT_VERT, BLUR_FRAG)
      this.uBlurTex  = gl.getUniformLocation(this.blurProg, "u_tex")!
      this.uBlurDir  = gl.getUniformLocation(this.blurProg, "u_direction")!
      this.uBlurSize = gl.getUniformLocation(this.blurProg, "u_texSize")!

      this.bloomProg      = buildProgram(gl, BLIT_VERT, BLOOM_FRAG)
      this.uBloomScene    = gl.getUniformLocation(this.bloomProg, "u_scene")!
      this.uBloomBloom    = gl.getUniformLocation(this.bloomProg, "u_bloom")!
      this.uBloomIntensity = gl.getUniformLocation(this.bloomProg, "u_intensity")!
    }
    if (!this.sceneFbo) {
      this.sceneFbo = makeFBO(gl, w, h)
      this.blurFbos = [makeFBO(gl, hw, hh), makeFBO(gl, hw, hh)]
    } else {
      resizeFBOTexture(gl, this.sceneFbo, w, h)
      resizeFBOTexture(gl, this.blurFbos![0], hw, hh)
      resizeFBOTexture(gl, this.blurFbos![1], hw, hh)
    }
  }

  // ---- Draw helpers ----

  private packInstances(buf: ParticleBuffer): number {
    const { data, capacity } = buf
    let count = 0
    for (let i = 0; i < capacity; i++) {
      const b = i * STRIDE
      if (data[b + F.AGE] >= data[b + F.LIFETIME]) continue

      // Grow instance buffer if needed
      if (count * INST_FLOATS >= this.instData.length) {
        const grown = new Float32Array(this.instData.length * 2)
        grown.set(this.instData)
        this.instData = grown
        const gl = this.gl
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo)
        gl.bufferData(gl.ARRAY_BUFFER, this.instData, gl.DYNAMIC_DRAW)
      }

      const off = count * INST_FLOATS
      this.instData[off + 0] = data[b + F.X]
      this.instData[off + 1] = data[b + F.Y]
      this.instData[off + 2] = data[b + F.R]
      this.instData[off + 3] = data[b + F.G]
      this.instData[off + 4] = data[b + F.B]
      this.instData[off + 5] = data[b + F.OPACITY]
      this.instData[off + 6] = data[b + F.SIZE]
      count++
    }
    return count
  }

  private uploadAndDrawParticles(count: number) {
    if (count === 0) return
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instData, 0, count * INST_FLOATS)
    gl.useProgram(this.particleProg)
    gl.uniform2f(this.uParticleRes, this.cssW, this.cssH)
    gl.bindVertexArray(this.particleVao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
    gl.bindVertexArray(null)
  }

  private blitTex(tex: WebGLTexture) {
    const gl = this.gl
    gl.useProgram(this.blitProg)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(this.uBlitTex, 0)
    gl.bindVertexArray(this.blitVao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  // ---- Link draw ----

  private packAndDrawLinks(buf: ParticleBuffer, linkDistance: number, linkOpacity: number): void {
    if (linkDistance <= 0 || linkOpacity <= 0) return
    const { data, capacity } = buf
    const d2max = linkDistance * linkDistance

    const alive: number[] = []
    for (let i = 0; i < capacity; i++) {
      const b = i * STRIDE
      if (data[b + F.AGE] < data[b + F.LIFETIME]) alive.push(i)
    }
    if (alive.length < 2) return

    const maxLinks = (this.linkData.length / 12) | 0
    let linkCount = 0

    outer:
    for (let ai = 0; ai < alive.length; ai++) {
      const i = alive[ai]
      const bi = i * STRIDE
      const xi = data[bi + F.X], yi = data[bi + F.Y]
      const ri = data[bi + F.R], gi = data[bi + F.G], bli = data[bi + F.B]
      for (let aj = ai + 1; aj < alive.length; aj++) {
        if (linkCount >= maxLinks) break outer
        const j = alive[aj]
        const bj = j * STRIDE
        const dx = xi - data[bj + F.X], dy = yi - data[bj + F.Y]
        const d2 = dx * dx + dy * dy
        if (d2 >= d2max) continue
        const alpha = (1 - Math.sqrt(d2) / linkDistance) * linkOpacity
        const off = linkCount * 12
        this.linkData[off]     = xi;              this.linkData[off + 1] = yi
        this.linkData[off + 2] = ri;              this.linkData[off + 3] = gi; this.linkData[off + 4] = bli
        this.linkData[off + 5] = alpha
        this.linkData[off + 6] = data[bj + F.X]; this.linkData[off + 7] = data[bj + F.Y]
        this.linkData[off + 8] = ri;              this.linkData[off + 9] = gi; this.linkData[off + 10] = bli
        this.linkData[off + 11] = alpha
        linkCount++
      }
    }
    if (linkCount === 0) return

    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linkVbo)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.linkData, 0, linkCount * 12)
    gl.useProgram(this.linkProg)
    gl.uniform2f(this.uLinkRes, this.cssW, this.cssH)
    gl.bindVertexArray(this.linkVao)
    gl.drawArrays(gl.LINES, 0, linkCount * 2)
    gl.bindVertexArray(null)
  }

  // ---- Main draw ----

  draw(buf: ParticleBuffer, config: RenderConfig) {
    const gl = this.gl
    const { trailMode, trailDecay, glowAmount, bloomIntensity } = config
    const w = this.physW
    const h = this.physH
    if (w === 0 || h === 0) return

    const count = this.packInstances(buf)

    gl.viewport(0, 0, w, h)

    if (trailMode) {
      this.initTrail(w, h)
      const fbos = this.trailFbos!
      const read  = fbos[this.trailReadIdx]
      const write = fbos[1 - this.trailReadIdx]

      // Fade previous frame into write FBO
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(this.trailProg!)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, read.tex)
      gl.uniform1i(this.uTrailTex!, 0)
      gl.uniform1f(this.uTrailDecay!, trailDecay)
      gl.bindVertexArray(this.blitVao)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      gl.bindVertexArray(null)

      // Draw links + new particles on top
      this.packAndDrawLinks(buf, config.linkDistance, config.linkOpacity)
      this.uploadAndDrawParticles(count)

      // Blit accumulated frame to screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.blitTex(write.tex)

      this.trailReadIdx = 1 - this.trailReadIdx

    } else if (glowAmount > 0) {
      this.initGlow(w, h)
      const scene = this.sceneFbo!
      const [blurH, blurV] = this.blurFbos!
      const hw = blurH.w
      const hh = blurH.h

      // Particles → scene FBO
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.packAndDrawLinks(buf, config.linkDistance, config.linkOpacity)
      this.uploadAndDrawParticles(count)

      // Horizontal blur: scene → blurH
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurH.fbo)
      gl.viewport(0, 0, hw, hh)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(this.blurProg!)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, scene.tex)
      gl.uniform1i(this.uBlurTex!, 0)
      gl.uniform2f(this.uBlurDir!, 1, 0)
      gl.uniform2f(this.uBlurSize!, w, h)
      gl.bindVertexArray(this.blitVao)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      // Vertical blur: blurH → blurV
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurV.fbo)
      gl.viewport(0, 0, hw, hh)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.bindTexture(gl.TEXTURE_2D, blurH.tex)
      gl.uniform2f(this.uBlurDir!, 0, 1)
      gl.uniform2f(this.uBlurSize!, hw, hh)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      gl.bindVertexArray(null)

      // Composite: scene + bloom → screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, w, h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(this.bloomProg!)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, scene.tex)
      gl.uniform1i(this.uBloomScene!, 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, blurV.tex)
      gl.uniform1i(this.uBloomBloom!, 1)
      gl.uniform1f(this.uBloomIntensity!, bloomIntensity * glowAmount)
      gl.bindVertexArray(this.blitVao)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      gl.bindVertexArray(null)

    } else {
      // Direct render to screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.packAndDrawLinks(buf, config.linkDistance, config.linkOpacity)
      this.uploadAndDrawParticles(count)
    }
  }

  destroy() {
    const gl = this.gl
    gl.deleteProgram(this.particleProg)
    gl.deleteProgram(this.blitProg)
    gl.deleteBuffer(this.instVbo)
    gl.deleteBuffer(this.blitVbo)
    gl.deleteVertexArray(this.particleVao)
    gl.deleteVertexArray(this.blitVao)

    gl.deleteProgram(this.linkProg)
    gl.deleteBuffer(this.linkVbo)
    gl.deleteVertexArray(this.linkVao)

    if (this.trailProg)  gl.deleteProgram(this.trailProg)
    if (this.trailFbos) { dropFBO(gl, this.trailFbos[0]); dropFBO(gl, this.trailFbos[1]) }

    if (this.blurProg)   gl.deleteProgram(this.blurProg)
    if (this.bloomProg)  gl.deleteProgram(this.bloomProg)
    if (this.sceneFbo)   dropFBO(gl, this.sceneFbo)
    if (this.blurFbos)  { dropFBO(gl, this.blurFbos[0]); dropFBO(gl, this.blurFbos[1]) }
  }
}
