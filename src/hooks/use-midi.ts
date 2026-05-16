import { useCallback, useEffect, useRef, useState } from "react"

export interface MidiMessage {
  /** 0-15 (channel 1 in UI = 0 here) */
  channel: number
  /** "noteOn" | "noteOff" | "cc" | "other" */
  type: "noteOn" | "noteOff" | "cc" | "other"
  /** Note number for noteOn/noteOff, CC number for cc */
  data1: number
  /** Velocity for noteOn/noteOff, value for cc */
  data2: number
  /** High-precision timestamp from the Web MIDI API */
  timestamp: number
}

export interface UseMidiOptions {
  /** Called for each incoming MIDI message. Stable reference recommended. */
  onMessage?: (msg: MidiMessage) => void
}

export interface UseMidiResult {
  status: "idle" | "requesting" | "connected" | "denied" | "unsupported"
  inputs: string[]
  outputs: string[]
  selectedInput: string | null
  selectedOutput: string | null
  selectInput: (name: string | null) => void
  selectOutput: (name: string | null) => void
  /** Send a note-on. channel is 0-15. */
  sendNoteOn: (channel: number, note: number, velocity?: number) => void
  /** Send a note-off. channel is 0-15. */
  sendNoteOff: (channel: number, note: number) => void
  /** Request MIDI access. Must be called from a user gesture. */
  connect: () => Promise<void>
}

function parseMessage(data: Uint8Array, timestamp: number): MidiMessage {
  const status = data[0]
  const channel = status & 0x0f
  const high = status & 0xf0
  let type: MidiMessage["type"] = "other"
  if (high === 0x90 && data[2] > 0) type = "noteOn"
  else if (high === 0x80 || (high === 0x90 && data[2] === 0)) type = "noteOff"
  else if (high === 0xb0) type = "cc"
  return { channel, type, data1: data[1] ?? 0, data2: data[2] ?? 0, timestamp }
}

export function useMidi({ onMessage }: UseMidiOptions = {}): UseMidiResult {
  const [status, setStatus] = useState<UseMidiResult["status"]>("idle")
  const [inputs, setInputs] = useState<string[]>([])
  const [outputs, setOutputs] = useState<string[]>([])
  const [selectedInput, setSelectedInputState] = useState<string | null>(null)
  const [selectedOutput, setSelectedOutputState] = useState<string | null>(null)

  const accessRef = useRef<MIDIAccess | null>(null)
  const onMessageRef = useRef(onMessage)
  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  const refreshPorts = useCallback(() => {
    const access = accessRef.current
    if (!access) return
    setInputs(Array.from(access.inputs.values()).map((i) => i.name ?? "(unnamed)"))
    setOutputs(Array.from(access.outputs.values()).map((o) => o.name ?? "(unnamed)"))
  }, [])

  const connect = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
      setStatus("unsupported")
      return
    }
    setStatus("requesting")
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false })
      accessRef.current = access
      access.onstatechange = refreshPorts
      refreshPorts()
      setStatus("connected")
    } catch {
      setStatus("denied")
    }
  }, [refreshPorts])

  // Wire up the selected input's message handler
  useEffect(() => {
    const access = accessRef.current
    if (!access) return
    const handler = (event: MIDIMessageEvent) => {
      const msg = parseMessage(event.data!, event.timeStamp)
      onMessageRef.current?.(msg)
    }

    for (const input of access.inputs.values()) {
      input.onmidimessage = null
    }
    if (selectedInput) {
      for (const input of access.inputs.values()) {
        if (input.name === selectedInput) {
          input.onmidimessage = handler
        }
      }
    }
  }, [selectedInput, status])

  const selectInput = useCallback((name: string | null) => {
    setSelectedInputState(name)
  }, [])

  const selectOutput = useCallback((name: string | null) => {
    setSelectedOutputState(name)
  }, [])

  const sendBytes = useCallback((bytes: number[]) => {
    const access = accessRef.current
    if (!access || !selectedOutput) return
    for (const output of access.outputs.values()) {
      if (output.name === selectedOutput) {
        output.send(bytes)
        return
      }
    }
  }, [selectedOutput])

  const sendNoteOn = useCallback((channel: number, note: number, velocity = 100) => {
    sendBytes([0x90 | (channel & 0x0f), note & 0x7f, velocity & 0x7f])
  }, [sendBytes])

  const sendNoteOff = useCallback((channel: number, note: number) => {
    sendBytes([0x80 | (channel & 0x0f), note & 0x7f, 0])
  }, [sendBytes])

  return {
    status,
    inputs,
    outputs,
    selectedInput,
    selectedOutput,
    selectInput,
    selectOutput,
    sendNoteOn,
    sendNoteOff,
    connect,
  }
}