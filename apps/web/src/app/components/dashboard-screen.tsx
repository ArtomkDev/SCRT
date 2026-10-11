import { createElement, type DetailsHTMLAttributes, type FieldsetHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';

type ScreenProps = HTMLAttributes<HTMLElement> & {
  header: ReactNode;
  width?: 'standard' | 'wide' | 'compact';
  contentClassName?: string;
};

export function DashboardScreen({ header, width = 'standard', className = '', contentClassName = '', children, ...props }: ScreenProps) {
  return <main {...props} className={`content-page dashboard-screen ${className}`} data-width={width}>
    {header}
    <div className="dashboard-screen-sheet"><div className={`dashboard-screen-content ${contentClassName}`}>{children}</div></div>
  </main>;
}

export function ScreenHeader({ title, description, navigation, actions, status }: {
  title: ReactNode; description?: ReactNode; navigation?: ReactNode; actions?: ReactNode; status?: ReactNode;
}) {
  return <header className="dashboard-screen-header">
    <div className="dashboard-screen-title"><h1>{title}</h1>{description && <p>{description}</p>}<div className="dashboard-screen-status">{status}</div></div>
    {(navigation || actions) && <div className="dashboard-screen-actions">{navigation}{actions && <div className="dashboard-screen-toolbar">{actions}</div>}</div>}
  </header>;
}

type PanelProps = HTMLAttributes<HTMLElement> & Pick<FieldsetHTMLAttributes<HTMLFieldSetElement>, 'disabled' | 'name'> & Pick<DetailsHTMLAttributes<HTMLDetailsElement>, 'open'> & {
  as?: 'section' | 'article' | 'div' | 'li' | 'ul' | 'fieldset' | 'details';
};

// Feature classes own layout and behavior; this primitive owns the surface.
export function Panel({ as = 'section', className = '', children, ...props }: PanelProps) {
  return createElement(as, { ...props, className: `dashboard-panel ${className}` }, children);
}

export function PanelHeader({ title, description, actions, level = 2, className = '' }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; level?: 2 | 3; className?: string;
}) {
  return <header className={`dashboard-panel-header ${className}`}><div>{createElement(`h${level}`, null, title)}{description && <p>{description}</p>}</div>{actions}</header>;
}

export function MetricCard({ label, value }: { label: string; value: ReactNode }) {
  return <Panel as="div"><dt>{label}</dt><dd>{value}</dd></Panel>;
}
