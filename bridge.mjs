import { WebSocketServer } from 'ws'
import dgram from 'node:dgram'

// Config
const WS_HOST = 'localhost'
const WS_PORT = 8080
const UDP_OUT_HOST = '127.0.0.1'
const UDP_OUT_PORT = 9000  // bridge -> Rust
const UDP_IN_PORT = 9001   // Rust -> bridge
const HEARTBEAT_INTERVAL_MS = 10_000
const HEARTBEAT_TIMEOUT_MS = 5_000
const QUEUE_MAX = 256

// Message queue — buffers OSC messages when no clients are connected
/** @type {Buffer[]} */
const messageQueue = []

// Active WebSocket clients — Map<ws, { lastPong: number, timer: NodeJS.Timeout | null }>
const clients = new Map()

// ---

const udpIn = dgram.createSocket('udp4')
const udpOut = dgram.createSocket('udp4')

/** Forward binary data to all connected clients, queue if none. */
function broadcast(data) {
  if (clients.size === 0) {
    if (messageQueue.length >= QUEUE_MAX) messageQueue.shift()
    messageQueue.push(Buffer.from(data))
    return
  }
  for (const [ws] of clients) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(data, { binary: true }, (err) => {
        if (err) console.warn('[bridge] send error:', err.message)
      })
    }
  }
}

/** Set up per-client heartbeat. */
function startHeartbeat(ws) {
  const state = clients.get(ws)
  if (!state) return

  const timer = setInterval(() => {
    if (ws.readyState !== 1 /* OPEN */) {
      clearInterval(timer)
      return
    }
    const elapsed = Date.now() - state.lastPong
    if (elapsed > HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS) {
      console.log('[bridge] heartbeat timeout, dropping client')
      clearInterval(timer)
      ws.terminate()
      return
    }
    // Send JSON ping frame
    try {
      ws.send(JSON.stringify({ type: 'ping', t: Date.now() }))
    } catch (e) {
      console.warn('[bridge] ping send error:', e.message)
    }
  }, HEARTBEAT_INTERVAL_MS)

  state.timer = timer
}

const wss = new WebSocketServer({ host: WS_HOST, port: WS_PORT })

wss.on('connection', (ws) => {
  console.log('[bridge] client connected')
  clients.set(ws, { lastPong: Date.now(), timer: null })

  // Flush queued messages
  for (const msg of messageQueue) {
    if (ws.readyState === 1) ws.send(msg, { binary: true })
  }
  messageQueue.length = 0

  startHeartbeat(ws)

  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      // JSON control frame
      try {
        const frame = JSON.parse(data.toString())
        if (frame.type === 'pong') {
          const state = clients.get(ws)
          if (state) state.lastPong = Date.now()
        }
      } catch {
        // ignore
      }
      return
    }

    // Forward OSC binary to Rust via UDP
    udpOut.send(data, UDP_OUT_PORT, UDP_OUT_HOST, (err) => {
      if (err) console.warn('[bridge] udp send error:', err.message)
    })
  })

  ws.on('close', () => {
    const state = clients.get(ws)
    if (state?.timer) clearInterval(state.timer)
    clients.delete(ws)
    console.log('[bridge] client disconnected')
  })

  ws.on('error', (err) => {
    console.warn('[bridge] ws client error:', err.message)
  })
})

wss.on('error', (err) => {
  console.error('[bridge] wss error:', err.message)
})

wss.on('listening', () => {
  console.log(`[bridge] ws server listening on ws://${WS_HOST}:${WS_PORT}`)
})

// Receive from Rust → broadcast to WebSocket clients
udpIn.on('message', (data) => {
  broadcast(data)
})

udpIn.on('error', (err) => {
  console.error('[bridge] udp in error:', err.message)
})

udpIn.bind(UDP_IN_PORT, '127.0.0.1', () => {
  console.log(`[bridge] udp in bound on :${UDP_IN_PORT}`)
})

// Graceful shutdown
function shutdown() {
  for (const [ws, state] of clients) {
    if (state.timer) clearInterval(state.timer)
    ws.terminate()
  }
  wss.close()
  udpIn.close()
  udpOut.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

console.log(`osc bridge:
  ws://${WS_HOST}:${WS_PORT}  <->  udp://${UDP_OUT_HOST}:${UDP_OUT_PORT} (out) / :${UDP_IN_PORT} (in)`)
