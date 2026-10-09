export default function MediaLoading() {
  return <section className="media-loading" aria-busy="true" aria-label="Завантаження Медіа">
    <p role="status">Завантаження Медіа…</p>
    <div className="media-loading-rows" aria-hidden="true">{[0, 1, 2].map((row) => <div key={row}><span /><div><i /><i /></div></div>)}</div>
  </section>;
}
