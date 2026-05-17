export type Chain = "a" | "b"

export type BackendEvent =
  // MIDI gate pulse — per-site zero-crossing from the backend
  | { type: "gate"; chain: Chain; site: number; pitch: number; velocity: number; channel: number }
  // MIDI wall notes
  | { type: "wall_note_on"; chain: Chain; channel: number; pitch: number }
  | { type: "wall_note_off"; chain: Chain; channel: number; pitch: number }
  // MIDI CC wall motion
  | { type: "wall_motion"; chain: Chain; cc: number; value: number; channel: number }
  // OSC /a|b/site/event
  | { type: "site_event"; chain: Chain; site: number; voice: number; intensity: number }
  // OSC /a|b/clock/pulse
  | { type: "clock_pulse"; chain: Chain; magnetization: number }
  // OSC wall lifecycle
  | { type: "wall_created"; chain: Chain; id: number; position: number; channel: number }
  | { type: "wall_destroyed"; chain: Chain; id: number; lastPosition: number; lifetime: number }
  | { type: "wall_moved"; chain: Chain; id: number; from: number; to: number; velocity: number }
  // OSC /a|b/state (throttled by backend)
  | { type: "state"; chain: Chain; spins: number[]; magnetization: number; wallCount: number }
  // MIDI passthrough — unmatched messages forwarded as-is
  | { type: "noteOn"; channel: number; pitch: number; velocity: number }
  | { type: "noteOff"; channel: number; pitch: number }
  | { type: "cc"; channel: number; cc: number; value: number }
