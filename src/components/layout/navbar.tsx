const navItems = [
  {label: "About", href: "#"},
  {label: "Debug", href: "#"},
  {label: "Help", href: "#"},
]

export function Navbar() {
  return (
    <header className="border-b border-b-gray-500 divide-dashed bg-background sticky top-0 z-50">
      <div className="flex items-center justify-between h-8 px-6">
        <div className="flex items-center gap-8">
          {/*<a href="#" className="font-heading text-sm font-medium tracking-tight">*/}
          {/*  C*/}
          {/*</a>*/}
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (

              <a key={item.label}
                 href={item.href}
                 className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {/*<span className="relative flex size-2">*/}
          {/*  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60"/>*/}
          {/*  <span className="relative inline-flex size-2 rounded-full bg-red-500"/>*/}
          {/*</span>*/}
          {/*<span className="text-muted-foreground">*/}
          {/*  <span className="text-foreground">offline</span>*/}
          {/*</span>*/}

          <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60"/>
              <span className="relative inline-flex size-2 rounded-full bg-green-500"/>
            </span>
          <span className="text-muted-foreground">
              <span className="text-foreground">
                connected
                <span className="text-gray-600 text-xs"> 12 kb/s</span>
              </span>
            </span>
        </div>
      </div>
    </header>
  )
}