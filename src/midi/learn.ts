/** Singleton for MIDI learn mode. One param can be in learn state at a time. */

type BoundHandler = (cc: number) => void

let learnParam: string | null = null
let onBound: BoundHandler | null = null

export const midiLearn = {
  start(param: string, handler: BoundHandler): void {
    learnParam = param
    onBound = handler
  },

  cancel(): void {
    learnParam = null
    onBound = null
  },

  isLearning(): boolean {
    return learnParam !== null
  },

  getTarget(): string | null {
    return learnParam
  },

  /** Call from MIDI message handler when a CC arrives. */
  onCC(cc: number): boolean {
    if (!onBound) return false
    onBound(cc)
    learnParam = null
    onBound = null
    return true
  },
}
