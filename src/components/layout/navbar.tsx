const navItems = [
  { label: "about", href: "#" },
  { label: "debug", href: "#" },
  { label: "help", href: "#" },
]

export function Navbar() {
  return (
    <header className="border-b border-border bg-background sticky top-0 z-50">
      <div className="flex items-center justify-between h-8 px-4">
        <div className="flex items-center gap-4">
          <span className="text-foreground tracking-widest">
            crystallized_time
          </span>
          <nav className="flex items-center">
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="text-muted-foreground hover:text-foreground px-2 py-1 transition-colors"
              >
                [{item.label}]
              </a>
            ))}
          </nav>
        </div>
        <div className="text-muted-foreground">
          status:<span className="text-foreground ml-1">connected</span>
        </div>
      </div>
    </header>
  )
}
