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

export interface UseOscOptions {
  /**
   * URL of the osc-js bridge's WebSocket endpoint.
   * The bridge ships in osc-js and runs as a Node process.
   * Default matches osc-js's `BridgePlugin` default.
   */
  url?: string
  /** Auto-connect on mount. Default true. */
  autoConnect?: boolean
  /** How many inbound messages to keep in the rolling log. Default 200. */
  logSize?: number
}

export interface UseOscResult {
  status: OscStatus
  /** Last error message, if any. */
  error: string | null
  /** Rolling buffer of recent inbound messages, newest last. */
  messages: OscInboundMessage[]
  /** Subscribe to a single address (or pattern). Returns an unsubscribe fn. */
  subscribe: (address: string, cb: (args: unknown[]) => void) => () => void
  /** Send an OSC message. Args may be number, int, float, string, or boolean. */
  send: (address: string, ...args: (number | string | boolean)[]) => void
  /** Manually (re)connect to the bridge. */
  connect: () => void
  /** Close the connection. */
  disconnect: () => void
}

export function useOsc({
                         url = "ws://localhost:8080",
                         autoConnect = true,
                         logSize = 200,
                       }: UseOscOptions = {}): UseOscResult {
  const [status, setStatus] = useState<OscStatus>(autoConnect ? "connecting" : "idle")
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<OscInboundMessage[]>([])

  // Single OSC instance, kept across renders.
  const oscRef = useRef<OSC | null>(null)
  const idCounter = useRef(0)
  // Subscribers indexed by address pattern.
  const subscribersRef = useRef<Map<string, Set<(args: unknown[]) => void>>>(
    new Map()
  )

  // Opens the OSC connection without touching React state synchronously.
  // All state updates happen inside event callbacks, which is the pattern
  // that avoids cascading renders when called from a useEffect body.
  const openOsc = useCallback(() => {
    if (oscRef.current) {
      try {
        oscRef.current.close()
      } catch {
        /* ignore */
      }
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
    })
    osc.on("close", () => setStatus("closed"))
    osc.on("error", (err: unknown) => {
      setStatus("error")
      setError(err instanceof Error ? err.message : String(err))
    })

    // Global listener: every inbound message hits this, plus we dispatch
    // to per-address subscribers ourselves so multiple subscribers on
    // the same pattern are supported.
    osc.on("*", (message: { address: string; args: unknown[] }) => {
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
    })

    try {
      osc.open()
    } catch (err) {
      setStatus("error")
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [url, logSize])

  // Public connect: sets optimistic "connecting" state then opens the socket.
  // Safe to call from user events; not called from effects.
  const connect = useCallback(() => {
    setStatus("connecting")
    setError(null)
    openOsc()
  }, [openOsc])

  const disconnect = useCallback(() => {
    const osc = oscRef.current
    if (!osc) return
    try {
      osc.close()
    } catch {
      /* ignore */
    }
    setStatus("closed")
  }, [])

  const subscribe = useCallback(
    (address: string, cb: (args: unknown[]) => void) => {
      let set = subscribersRef.current.get(address)
      if (!set) {
        set = new Set()
        subscribersRef.current.set(address, set)
      }
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
      if (!osc || status !== "connected") return
      try {
        osc.send(new OSC.Message(address, ...args))
      } catch (err) {
        // Don't escalate to status="error" — a single bad send shouldn't
        // tear down the whole connection. Just record it.
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [status]
  )

  useEffect(() => {
    // Defer to a macrotask so no setState runs synchronously inside this effect,
    // even via the catch block in openOsc. Status is pre-set to "connecting"
    // by the lazy useState initializer so the UI shows the right state immediately.
    const id = autoConnect ? setTimeout(openOsc, 0) : undefined
    return () => {
      clearTimeout(id)
      const osc = oscRef.current
      if (osc) {
        try {
          osc.close()
        } catch {
          /* ignore */
        }
        oscRef.current = null
      }
    }
    // Only auto-connect on mount; manual reconnects go through connect().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return useMemo(
    () => ({ status, error, messages, subscribe, send, connect, disconnect }),
    [status, error, messages, subscribe, send, connect, disconnect]
  )
}