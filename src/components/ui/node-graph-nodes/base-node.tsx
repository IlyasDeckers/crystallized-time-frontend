import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { cn } from "@/lib/utils"
import { NODE_REGISTRY } from "@/node-graph/nodes"
import type { ConfigField } from "@/node-graph/types"

export interface NodeGraphNodeData {
  nodeType: string
  config: Record<string, number | string | boolean>
  onConfigChange: (id: string, config: Record<string, number | string | boolean>) => void
}

function hasNonDefaultConfig(
  schema: Record<string, ConfigField>,
  config: Record<string, number | string | boolean>,
): boolean {
  return Object.entries(schema).some(
    ([key, field]) => config[key] !== field.default,
  )
}

function NodeGraphNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as NodeGraphNodeData
  const entry = NODE_REGISTRY[nodeData.nodeType]
  const [collapsed, setCollapsed] = useState(false)
  const wasSelected = useRef(false)

  useEffect(() => {
    if (selected && !wasSelected.current) {
      setCollapsed(false)
    }
    wasSelected.current = selected
  }, [selected])

  if (!entry) {
    return (
      <div className="border border-destructive/80 text-[10px] px-2 py-1 bg-background">
        unknown: {nodeData.nodeType}
      </div>
    )
  }

  const { def } = entry
  const cat = def.category

  const categoryBorder = cat === "source"
    ? "border-blue-900/60"
    : cat === "sink"
      ? "border-amber-900/60"
      : "border-border"

  const inputPorts = def.ports.filter(p => p.direction === "input")
  const outputPorts = def.ports.filter(p => p.direction === "output")
  const configSet = hasNonDefaultConfig(def.configSchema, nodeData.config)

  return (
    <div
      className={cn(
        "border text-[10px] font-mono min-w-[120px] bg-background",
        categoryBorder,
        selected && "ring-1 ring-foreground/40"
      )}
    >
      <div
        className={cn(
          "px-2 py-1 border-b flex items-center justify-between gap-1",
          categoryBorder
        )}
        onDoubleClick={() => selected && setCollapsed(v => !v)}
      >
        <span>{def.label}</span>
        {configSet && collapsed && (
          <span className="w-1.5 h-1.5 rounded-full bg-foreground/50 shrink-0" />
        )}
      </div>

      <div className="px-2 py-1.5 space-y-0.5">
        {inputPorts.map(p => (
          <div key={p.id} className="flex items-center gap-1.5 relative">
            <Handle
              type="target"
              position={Position.Left}
              id={p.id}
              className={cn(
                "!w-2 !h-2 !border !border-foreground !bg-background !static",
                p.type === "trigger" ? "!rounded-[1px]" : "!rounded-full"
              )}
            />
            <span className="text-muted-foreground">{p.label}</span>
          </div>
        ))}
      </div>

      <div className="px-2 py-1.5 space-y-0.5">
        {outputPorts.map(p => (
          <div key={p.id} className="flex items-center gap-1.5 justify-end relative">
            <span className="text-muted-foreground">{p.label}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={p.id}
              className={cn(
                "!w-2 !h-2 !border !border-foreground !bg-background !static",
                p.type === "trigger" ? "!rounded-[1px]" : "!rounded-full"
              )}
            />
          </div>
        ))}
      </div>

      {selected && !collapsed && Object.keys(def.configSchema).length > 0 && (
        <ConfigForm
          schema={def.configSchema}
          values={nodeData.config}
          onChange={(changes) => {
            nodeData.onConfigChange(id, { ...nodeData.config, ...changes })
          }}
          onCommit={() => setCollapsed(true)}
        />
      )}
    </div>
  )
}

export default memo(NodeGraphNode)

function ConfigForm({
  schema,
  values,
  onChange,
  onCommit,
}: {
  schema: Record<string, ConfigField>
  values: Record<string, number | string | boolean>
  onChange: (changes: Record<string, number | string | boolean>) => void
  onCommit: () => void
}) {
  const changedRef = useRef(false)

  const handleFieldChange = useCallback(
    (key: string, value: number | string | boolean) => {
      changedRef.current = true
      onChange({ [key]: value })
    },
    [onChange],
  )

  const handleBlur = useCallback(() => {
    if (changedRef.current) {
      onCommit()
      changedRef.current = false
    }
  }, [onCommit])

  return (
    <div className="border-t border-border px-2 py-1 space-y-1">
      {Object.entries(schema).map(([key, field]) => (
        <ConfigFieldInput
          key={key}
          field={field}
          value={values[key] ?? field.default}
          onChange={(v) => handleFieldChange(key, v)}
          onBlur={handleBlur}
        />
      ))}
    </div>
  )
}

function ConfigFieldInput({
  field,
  value,
  onChange,
  onBlur,
}: {
  field: ConfigField
  value: number | string | boolean
  onChange: (v: number | string | boolean) => void
  onBlur: () => void
}) {
  if (field.type === "select") {
    return (
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground shrink-0">{field.label}</span>
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className="ml-auto bg-muted border border-border text-[10px] px-1 py-0 outline-none text-foreground max-w-[80px]"
        >
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (field.type === "boolean") {
    return (
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground shrink-0">{field.label}</span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          onBlur={onBlur}
          className="ml-auto accent-foreground"
        />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground shrink-0">{field.label}</span>
      <input
        type={field.type === "number" ? "number" : "text"}
        value={String(value)}
        onChange={(e) => {
          const v =
            field.type === "number"
              ? Number(e.target.value)
              : e.target.value
          onChange(v)
        }}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") onBlur()
        }}
        min={field.min}
        max={field.max}
        step={field.step}
        className="ml-auto w-16 bg-muted border border-border text-[10px] px-1 py-0 outline-none text-foreground"
      />
    </div>
  )
}
