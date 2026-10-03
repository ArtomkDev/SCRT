export function DataLoading({ label }: { label: string }) {
  return <div className="data-loading" role="status" aria-busy="true"><p className="muted">{label}</p><div className="skeleton skeleton-card" aria-hidden="true" /></div>;
}
