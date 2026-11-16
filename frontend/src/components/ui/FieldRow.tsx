import type { ReactNode } from 'react';

interface FieldRowProps {
  label: string;
  value: ReactNode;
  mono?: boolean;
  title?: string;
}

export function FieldRow({ label, value, mono = false, title }: FieldRowProps) {
  return (
    <div className="field-row">
      <span className="field-row__label">{label}</span>
      <span className={`field-row__value ${mono ? 'is-mono' : ''}`.trim()} title={title}>
        {value}
      </span>
    </div>
  );
}
