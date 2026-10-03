export function AppMark({ development = false }: { development?: boolean }) {
  return <span className="app-mark" aria-hidden="true">S<span className="app-mark-notch" />{development && <span className="app-mark-dev">D</span>}</span>;
}

export function AppBrand({ development = false }: { development?: boolean }) {
  return <span className="brand-copy">SCRT <span className="brand-control">CONTROL</span>{development && <span className="environment-badge" aria-label="Середовище розробки">DEV</span>}</span>;
}
