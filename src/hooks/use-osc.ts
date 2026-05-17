import { useCallback, useEffect, useMemo, useRef, useState } from "react"
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import OSC from "osc-js"

export interface OscInboundMessage {
  /** Monotonic id for stable React keys when rendering a log. */
  id: number
  /** OSC address pattern, e.g. "/a/state/magnetization". */
  address: string
  /** Decoded argument list. osc-js gives mixed types (number/string/blob). */
  args: unknown[]
  /** Wall-clock time the message was received (ms since epoch). */
  receivedAt: number
}

export type OscStatus = "idle" | "connecting" | "connected" | "error" | "closed"

export interface OscQuality {
  latencyMs: number
  droppedMessages: number
  reconnectIn: number
  /** Last 20 latency measurements (ms) for sparkline display. */
  latencyHistory: number[]
}

export interface UseOscOptions {
  url?: string
  autoConnect?: boolean
  logSize?: number
}

export interface UseOscResult {
  status: OscStatus
  error: string | null
  messages: OscInboundMessage[]
  quality: OscQuality
  subscribe: (address: string, cb: (args: unknown[]) => void) => () => void
  subscribeAll: (cb: (msg: OscInboundMessage) => void) => () => void
  send: (address: string, ...args: (number | string | boolean)[]) => void
  connect: () => void
  disconnect: () => void
}

const BACKOFF_BASE = 1_000
const BACKOFF_MAX = 30_000
const LATENCY_HISTORY_SIZE = 20
const RATE_LIMIT_WINDOW_MS = 1_000
const RATE_LIMIT_MAX = 100

export function useOsc({
  url = "ws://localhost:8080",
  autoConnect = true,
  logSize = 200,
}: UseOscOptions = {}): UseOscResult {
  const [status, setStatus] = useState<OscStatus>(autoConnect ? "connecting" : "idle")
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<OscInboundMessage[]>([])
  const [quality, setQuality] = useState<OscQuality>({
    latencyMs: 0,
    droppedMessages: 0,
    reconnectIn: 0,
    latencyHistory: [],
  })

  const oscRef = useRef<OSC | null>(null)
  const idCounter = useRef(0)
  const subscribersRef = useRef<Map<string, Set<(args: unknown[]) => void>>>(new Map())
  const allSubscribersRef = useRef<Set<(msg: OscInboundMessage) => void>>(new Set())

  // Reconnect backoff state
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoConnectRef = useRef(autoConnect)
  autoConnectRef.current = autoConnect
  const manualDisconnectRef = useRef(false)

  // Rate limiting state
  const rateBucketRef = useRef<{ count: number; windowStart: number }>({ count: 0, windowStart: Date.now() })
  const droppedRef = useRef(0)

  // Latency tracking — measured by ping timestamp echo
  const latencyHistoryRef = useRef<number[]>([])
  const statusRef = useRef(status)
  useEffect(() => { statusRef.current = status }, [status])

  function clearReconnectTimers() {
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
    if (reconnectCountdownRef.current) { clearInterval(reconnectCountdownRef.current); reconnectCountdownRef.current = null }
  }

  function scheduleReconnect() {
    if (!autoConnectRef.current || manualDisconnectRef.current) return
    clearReconnectTimers()
    const delay = Math.min(BACKOFF_BASE * 2 ** reconnectAttemptRef.current, BACKOFF_MAX)
    reconnectAttemptRef.current++

    // Countdown timer for the reconnectIn display
    let remaining = delay
    reconnectCountdownRef.current = setInterval(() => {
      remaining -= 500
      setQuality((prev) => ({ ...prev, reconnectIn: Math.max(0, remaining) }))
      if (remaining <= 0 && reconnectCountdownRef.current) {
        clearInterval(reconnectCountdownRef.current)
        reconnectCountdownRef.current = null
      }
    }, 500)

    setQuality((prev) => ({ ...prev, reconnectIn: delay }))
    reconnectTimerRef.current = setTimeout(() => {
      setStatus("connecting")
      openOsc()
    }, delay)
  }

  const openOsc = useCallback(() => {
    if (oscRef.current) {
      try { oscRef.current.close() } catch { /* ignore */ }
      oscRef.current = null
    }

    const u = new URL(url)
    const plugin = new OSC.WebsocketClientPlugin({
      host: u.hostname,
      port: Number(u.port) || 8080,
      secure: u.protocol === "wss:",
    })
    const osc = new OSC({ plugin })
    oscRef.current = osc

    osc.on("open", () => {
      setStatus("connected")
      setError(null)
      reconnectAttemptRef.current = 0
      manualDisconnectRef.current = false
      clearReconnectTimers()
      setQuality((prev) => ({ ...prev, reconnectIn: 0 }))

      // Tap into underlying WebSocket for JSON heartbeat frames
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws = (plugin as any).socket as (WebSocket & { _oscHooked?: boolean }) | undefined
      if (ws && !ws._oscHooked) {
        ws._oscHooked = true
        ws.addEventListener("message", (event: MessageEvent) => {
          if (typeof event.data !== "string") return
          try {
            const frame = JSON.parse(event.data) as Record<string, unknown>
            if (frame.type === "ping") {
              const pongFrame = { type: "pong", t: frame.t }
              ws.send(JSON.stringify(pongFrame))
              // Update latency using round-trip time
              if (typeof frame.t === "number") {
                const latMs = Date.now() - frame.t
                latencyHistoryRef.current = [
                  ...latencyHistoryRef.current.slice(-(LATENCY_HISTORY_SIZE - 1)),
                  latMs,
                ]
                setQuality((prev) => ({
                  ...prev,
                  latencyMs: latMs,
                  latencyHistory: [...latencyHistoryRef.current],
                }))
              }
            }
          } catch { /* ignore */ }
        })
      }
    })

    osc.on("close", () => {
      setStatus("closed")
      scheduleReconnect()
    })

    osc.on("error", (err: unknown) => {
      setStatus("error")
      setError(err instanceof Error ? err.message : String(err))
      scheduleReconnect()
    })

    osc.on("*", (message: { address: string; args: unknown[] }) => {
      // Rate limiting: drop every other message if >100/s
      const now = Date.now()
      const bucket = rateBucketRef.current
      if (now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
        bucket.count = 0
        bucket.windowStart = now
      }
      bucket.count++
      if (bucket.count > RATE_LIMIT_MAX && bucket.count % 2 === 0) {
        droppedRef.current++
        setQuality((prev) => ({ ...prev, droppedMessages: droppedRef.current }))
        return
      }

      const id = ++idCounter.current
      const entry: OscInboundMessage = {
        id,
        address: message.address,
        args: message.args,
        receivedAt: Date.now(),
      }
      setMessages((prev) => {
        const next = prev.length >= logSize ? prev.slice(prev.length - logSize + 1) : prev
        return [...next, entry]
      })

      const subs = subscribersRef.current.get(message.address)
      if (subs) for (const cb of subs) cb(message.args)
      for (const cb of allSubscribersRef.current) cb(entry)
    })

    try {
      osc.open()
    } catch (err) {
      setStatus("error")
      setError(err instanceof Error ? err.message : String(err))
      scheduleReconnect()
    }
  }, [url, logSize])

  const connect = useCallback(() => {
    manualDisconnectRef.current = false
    clearReconnectTimers()
    reconnectAttemptRef.current = 0
    setStatus("connecting")
    setError(null)
    openOsc()
  }, [openOsc])

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true
    clearReconnectTimers()
    const osc = oscRef.current
    if (!osc) return
    try { osc.close() } catch { /* ignore */ }
    setStatus("closed")
  }, [])

  const subscribeAll = useCallback((cb: (msg: OscInboundMessage) => void) => {
    allSubscribersRef.current.add(cb)
    return () => { allSubscribersRef.current.delete(cb) }
  }, [])

  const subscribe = useCallback(
    (address: string, cb: (args: unknown[]) => void) => {
      let set = subscribersRef.current.get(address)
      if (!set) { set = new Set(); subscribersRef.current.set(address, set) }
      set.add(cb)
      return () => {
        const s = subscribersRef.current.get(address)
        if (!s) return
        s.delete(cb)
        if (s.size === 0) subscribersRef.current.delete(address)
      }
    },
    []
  )

  const send = useCallback(
    (address: string, ...args: (number | string | boolean)[]) => {
      const osc = oscRef.current
      if (!osc || statusRef.current !== "connected") return
      try {
        osc.send(new OSC.Message(address, ...args))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    []
  )

  useEffect(() => {
    const id = autoConnect ? setTimeout(openOsc, 0) : undefined
    return () => {
      clearTimeout(id)
      clearReconnectTimers()
      const osc = oscRef.current
      if (osc) {
        try { osc.close() } catch { /* ignore */ }
        oscRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return useMemo(
    () => ({ status, error, messages, quality, subscribe, subscribeAll, send, connect, disconnect }),
    [status, error, messages, quality, subscribe, subscribeAll, send, connect, disconnect]
  )
}
