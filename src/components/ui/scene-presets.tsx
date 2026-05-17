import { useEffect, useRef, useState } from "react"
import { sceneStore } from "@/scenes/store"
import { crossfade } from "@/scenes/transition"
import type { Scene } from "@/scenes/types"
import type { UseOscResult } from "@/hooks/use-osc"

interface Props {
  osc: UseOscResult
  /** Crossfade duration in ms. Default 2000. */
  fadeDuration?: number
}

export function ScenePresets({ osc, fadeDuration = 2000 }: Props) {
  const [scenes, setScenes] = useState<string[]>([])
  const [selected, setSelected] = useState<string>("")
  const [saveName, setSaveName] = useState("")
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function refresh() {
    const list = sceneStore.list()
    setScenes(list)
    if (list.length > 0 && !list.includes(selected)) setSelected(list[0])
  }

  useEffect(() => {
    refresh()
    // Handle OSC /scene/load "name" and /scene/save "name"
    const unsubs = [
      osc.subscribe("/scene/load", (args) => {
        if (typeof args[0] === "string") sceneStore.load(args[0])
      }),
      osc.subscribe("/scene/save", (args) => {
        if (typeof args[0] === "string") {
          sceneStore.save(args[0])
          refresh()
        }
      }),
    ]
    return () => unsubs.forEach((u) => u())
  }, [osc.subscribe])

  // Subscribe to load events to apply crossfade
  useEffect(() => {
    return sceneStore.onLoad((scene: Scene) => {
      crossfade(scene, fadeDuration)
    })
  }, [fadeDuration])

  function handleLoad() {
    if (!selected) return
    sceneStore.load(selected)
  }

  function handleSave() {
    const name = saveName.trim()
    if (!name) return
    sceneStore.save(name)
    setSaveName("")
    setSaving(false)
    refresh()
    setSelected(name)
  }

  function handleDelete() {
    if (!selected) return
    sceneStore.delete(selected)
    refresh()
  }

  function handleExport() {
    const json = sceneStore.export()
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "scenes.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result
      if (typeof text === "string") {
        sceneStore.import(text)
        refresh()
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  return (
    <div className="space-y-2 font-mono text-xs">
      {/* Scene list + load */}
      <div className="flex gap-1 items-center">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="flex-1 bg-background border border-border px-1 py-0.5 text-xs text-foreground min-w-0"
        >
          {scenes.length === 0 && (
            <option value="" disabled>no scenes</option>
          )}
          {scenes.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button
          onClick={handleLoad}
          disabled={!selected}
          className="px-2 py-0.5 border border-border hover:bg-muted disabled:opacity-30"
        >
          load
        </button>
        <button
          onClick={handleDelete}
          disabled={!selected}
          className="px-2 py-0.5 border border-border hover:bg-muted disabled:opacity-30 text-destructive/70"
        >
          del
        </button>
      </div>

      {/* Save */}
      {saving ? (
        <div className="flex gap-1">
          <input
            autoFocus
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave()
              if (e.key === "Escape") setSaving(false)
            }}
            placeholder="scene name"
            className="flex-1 bg-background border border-border px-1 py-0.5 text-xs text-foreground"
          />
          <button
            onClick={handleSave}
            className="px-2 py-0.5 border border-border hover:bg-muted"
          >
            ok
          </button>
          <button
            onClick={() => setSaving(false)}
            className="px-2 py-0.5 border border-border hover:bg-muted"
          >
            x
          </button>
        </div>
      ) : (
        <button
          onClick={() => setSaving(true)}
          className="w-full px-2 py-0.5 border border-border hover:bg-muted"
        >
          save current
        </button>
      )}

      {/* Export / Import */}
      <div className="flex gap-1">
        <button
          onClick={handleExport}
          className="flex-1 px-2 py-0.5 border border-border hover:bg-muted"
        >
          export
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex-1 px-2 py-0.5 border border-border hover:bg-muted"
        >
          import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImport}
        />
      </div>

      <div className="text-muted-foreground/60 text-[10px]">
        fade: {fadeDuration}ms | osc: /scene/load, /scene/save
      </div>
    </div>
  )
}
