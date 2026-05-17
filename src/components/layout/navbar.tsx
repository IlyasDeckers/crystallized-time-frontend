export interface CardToggle {
  key: string
  label: string
  open: boolean
  onToggle: () => void
}

export interface NavbarProps {
  cardToggles?: CardToggle[]
}

export function Navbar({ cardToggles }: NavbarProps) {
  return (
    <header className="border-b border-border bg-background sticky top-0 z-50">
      <div className="flex items-center justify-between h-8 px-4">
        <div className="flex items-center gap-4">
          <span className="text-foreground tracking-widest text-xs font-mono">
            crystallized_time
          </span>
          <nav className="flex items-center gap-0.5">
            {cardToggles?.map((item) => (
              <button
                key={item.key}
                onClick={item.onToggle}
                className={
                  item.open
                    ? "text-foreground px-1.5 py-0.5 text-[10px] font-mono border border-foreground/30"
                    : "text-muted-foreground hover:text-foreground px-1.5 py-0.5 text-[10px] font-mono border border-transparent hover:border-border/40 transition-colors"
                }
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="text-muted-foreground text-[10px] font-mono">
          status:<span className="text-foreground ml-1">live</span>
        </div>
      </div>
    </header>
  )
}
