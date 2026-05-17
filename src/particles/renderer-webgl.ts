// WebGL renderer scaffold — Stage 2+ implementation lives here.
//
// SHADER DECISION (Stage 1 doc):
//   All GLSL shader source is inlined as TypeScript template-literal strings.
//   No Vite plugin (vite-plugin-glsl or similar) is required.
//   Rationale: easier iteration in early stages; a Vite plugin can be added
//   later if shader files grow large enough to warrant separate editing.
//
// Example pattern:
//
//   const VERT = /* glsl */`
//     attribute vec2 a_position;
//     void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
//   `
//   const FRAG = /* glsl */`
//     precision mediump float;
//     void main() { gl_FragColor = vec4(1.0); }
//   `

export {}
