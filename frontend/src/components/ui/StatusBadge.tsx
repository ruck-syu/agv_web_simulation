import type { ReactNode } from 'react';

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

interface StatusBadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}

export function StatusBadge({
  tone = 'neutral',
  children,
  className = '',
  dot = false,
}: StatusBadgeProps) {
  return (
    <span className={`status-badge status-badge--${tone} ${className}`.trim()}>
      {dot && <span className="status-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
