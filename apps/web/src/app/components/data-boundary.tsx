'use client';

import { catchError, type ErrorInfo } from 'next/error';
import type { ReactNode } from 'react';

function DataUnavailable({ title, fallback, compact = false, className }: { title: string; fallback?: ReactNode; compact?: boolean; className?: string }, { retry }: ErrorInfo) {
  return <div className={className}>{fallback}<div className={`data-unavailable${compact ? ' data-unavailable-compact' : ''}`} role="status">
    <p>{title}</p>{!compact && <p className="muted">Дані тимчасово недоступні. Інші розділи можна використовувати.</p>}
    <button type="button" className="secondary-button" onClick={retry}>Повторити завантаження</button>
  </div></div>;
}

/** Keep a failed data read inside its widget; Next redirects and notFound still propagate. */
export const DataBoundary = catchError(DataUnavailable);
