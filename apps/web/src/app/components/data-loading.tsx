import { Fragment } from 'react';

export function LoadingValue({ width = '6ch' }: { width?: string }) {
  return <span className="skeleton loading-value" style={{ width }} aria-hidden="true">&nbsp;</span>;
}

export function MetricsLoading({ labels, label = 'Завантаження статистики…', className = 'activity-summary' }: { labels: readonly string[]; label?: string; className?: string }) {
  return <dl className={`voice-summary ${className}`} aria-label={label} aria-busy="true">{labels.map((name) => <div key={name}><dt>{name}</dt><dd><LoadingValue /></dd></div>)}</dl>;
}

export function RowsLoading({ label, rows = 3 }: { label: string; rows?: number }) {
  return <ul className="activity-ranking" aria-label={label} aria-busy="true">{Array.from({ length: rows }, (_, index) => <li key={index}><span className="activity-identity"><span className="activity-avatar" aria-hidden="true" /><LoadingValue width="16ch" /></span><strong><LoadingValue /></strong></li>)}</ul>;
}

export function TableLoading({ label, columns, rows = 3, className = 'activity-table', wrapperClassName = 'activity-table-scroll' }: { label: string; columns: readonly string[]; rows?: number; className?: string; wrapperClassName?: string }) {
  return <div className={wrapperClassName}><table className={className} aria-label={label} aria-busy="true"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{Array.from({ length: rows }, (_, index) => <tr key={index}>{columns.map((column) => <td key={column} data-label={column}><LoadingValue width={column === columns[0] ? '14ch' : '6ch'} /></td>)}</tr>)}</tbody></table></div>;
}

export function SettingsLoading({ title, sections, label }: { title: string; sections: ReadonlyArray<{ title: string; fields: readonly string[]; control?: 'switch' | 'checkbox' }>; label: string }) {
  return <section className="settings-page" aria-label={label} aria-busy="true">
    <div className="section-intro"><h2>{title}</h2></div>
    <div className="voice-form settings-sections">{sections.map((section) => <fieldset key={section.title} className="settings-card settings-section">
      <legend>{section.title}</legend>
      <div className={section.control === 'checkbox' ? 'toggle-grid' : 'form-grid'}>{section.fields.map((field) => section.control === 'switch'
        ? <div key={field} className="voice-switch"><span><strong>{field}</strong></span><span className="loading-switch"><LoadingValue width="2ch" /></span></div>
        : section.control === 'checkbox'
          ? <div key={field} className="voice-check"><span className="loading-checkbox"><LoadingValue width="1ch" /></span><span>{field}</span></div>
          : <div key={field} className="loading-field"><span>{field}</span><div className="loading-control"><LoadingValue width="12ch" /></div></div>)}</div>
    </fieldset>)}</div>
  </section>;
}

export function StatusLoading({ labels, label }: { labels: readonly string[]; label: string }) {
  return <dl className="activity-health" aria-label={label} aria-busy="true">{labels.map((name) => <Fragment key={name}><dt>{name}</dt><dd><LoadingValue width="18ch" /></dd></Fragment>)}</dl>;
}
