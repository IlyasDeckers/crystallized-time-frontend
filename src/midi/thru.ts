/**
 * Forwards all raw MIDI bytes from inputPort to outputPort.
 * Returns a cleanup function that removes the listener.
 */
export function setupMidiThru(
  inputPort: MIDIInput,
  outputPort: MIDIOutput,
): () => void {
  const handler = (event: MIDIMessageEvent) => {
    if (event.data) outputPort.send(event.data)
  }
  inputPort.addEventListener("midimessage", handler as EventListener)
  return () => inputPort.removeEventListener("midimessage", handler as EventListener)
}
