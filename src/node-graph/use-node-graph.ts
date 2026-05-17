import { useEffect, useRef } from "react"
import type { NodeGraph } from "./types"
import { NodeGraphExecutor } from "./executor"
import type { UseParticlesResult } from "@/particles/engine"
import type { UseOscResult } from "@/hooks/use-osc"
import type { UseParticlePulseResult } from "@/hooks/use-particle-pulse"
import type { MidiMessage } from "@/hooks/use-midi"
import { paramStore } from "@/particles/param-store"
import { isParamKey } from "@/particles/param-store"

export interface UseNodeGraphDeps {
  particlesApi: UseParticlesResult | null
  osc: UseOscResult
  pulse: UseParticlePulseResult
  subscribeMidi: (cb: (msg: MidiMessage) => void) => () => void
}

export function useNodeGraph(
  graph: NodeGraph,
  deps: UseNodeGraphDeps,
): void {
  const executorRef = useRef<NodeGraphExecutor | null>(null)
  const graphRef = useRef(graph)
  graphRef.current = graph

  const { particlesApi, osc, pulse, subscribeMidi } = deps

  useEffect(() => {
    if (!particlesApi?.ready) return

    const executor = new NodeGraphExecutor(graphRef.current, {
      paramStoreSet: (key: string, value: number) => {
        if (isParamKey(key)) {
          paramStore.set(key, value)
        }
      },
      engineBurst: particlesApi.burst,
      pulseFire: (particleIndex, charge, bright) => {
        pulse.fire(particleIndex, charge, bright)
      },
      oscSubscribe: osc.subscribe,
      canvasSize: particlesApi.canvasSize,
    })
    executorRef.current = executor

    const unsubMidi = subscribeMidi((msg: MidiMessage) => {
      const exec = executorRef.current
      if (!exec) return
      if (msg.type === "cc") {
        exec.handleMidiCC(msg.data1, msg.data2, msg.channel)
      } else if (msg.type === "noteOn") {
        exec.handleMidiNote(msg.data1, msg.data2, true, msg.channel)
      } else if (msg.type === "noteOff") {
        exec.handleMidiNote(msg.data1, msg.data2, false, msg.channel)
      }
    })

    const unsubFrame = particlesApi.addFrameHook(({ time, dt }) => {
      executorRef.current?.evaluateFrame(time, dt)
    })

    return () => {
      unsubMidi()
      unsubFrame()
      executor.destroy()
      executorRef.current = null
    }
  }, [particlesApi?.ready])

  // Recompile when graph changes
  useEffect(() => {
    if (!executorRef.current) return
    executorRef.current.recompile(graph)
  }, [graph])
}
