// OSC address schema for the Crystallized Time backend.
//
// Naming convention:
//   /a/* /b/*        backend-originated messages (received by frontend)
//   /physics/*       physics parameter changes (sent to backend)
//   /coupling/*      coupling parameter changes (sent to backend)
//   /pulse/* /shape/* /scatter /rotation/*  frontend-internal particle control

export const OSC = {
  // Received from backend — site events
  A_SITE_EVENT:     "/a/site/event",
  B_SITE_EVENT:     "/b/site/event",

  // Received from backend — clock
  A_CLOCK_PULSE:    "/a/clock/pulse",
  B_CLOCK_PULSE:    "/b/clock/pulse",

  // Received from backend — chain state (throttled)
  A_STATE:          "/a/state",
  B_STATE:          "/b/state",

  // Received from backend — wall lifecycle
  A_WALL_CREATED:   "/a/wall/created",
  A_WALL_DESTROYED: "/a/wall/destroyed",
  A_WALL_MOVED:     "/a/wall/moved",
  B_WALL_CREATED:   "/b/wall/created",
  B_WALL_DESTROYED: "/b/wall/destroyed",
  B_WALL_MOVED:     "/b/wall/moved",

  // Sent to backend — shared physics
  PHYSICS_KT:       "/physics/kt",
  PHYSICS_EPS:      "/physics/eps",
  PHYSICS_J:        "/physics/j",
  PHYSICS_W:        "/physics/w",

  // Sent to backend — chain A physics
  A_PHYSICS_KT:     "/a/physics/kt",
  A_PHYSICS_EPS:    "/a/physics/eps",
  A_PHYSICS_J:      "/a/physics/j",
  A_PHYSICS_W:      "/a/physics/w",

  // Sent to backend — chain B physics
  B_PHYSICS_KT:     "/b/physics/kt",
  B_PHYSICS_EPS:    "/b/physics/eps",
  B_PHYSICS_J:      "/b/physics/j",
  B_PHYSICS_W:      "/b/physics/w",

  // Sent to backend — coupling
  COUPLING:         "/coupling/strength",
  COUPLING_AB:      "/coupling/strength_ab",
  COUPLING_BA:      "/coupling/strength_ba",

  // Frontend-internal — particle control
  PULSE_FIRE:       "/pulse/fire",
  SHAPE_SET:        "/shape/set",
  SHAPE3D_SET:      "/shape3d/set",
  SCATTER:          "/scatter",
  ROTATION_IMPULSE: "/rotation/impulse",
} as const

export type OscAddress = typeof OSC[keyof typeof OSC]
