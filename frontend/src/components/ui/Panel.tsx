import type { ReactNode } from 'react';

interface PanelProps {
  eyebrow?: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}

export function Panel({ title, actions, children, className = '', id }: PanelProps) {
  return (
    <section className={`panel ${className}`.trim()} id={id}>
      <header className="panel__header">
        <div>
          <h2 className="panel__title">{title}</h2>
        </div>
        {actions && <div className="panel__actions">{actions}</div>}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}
