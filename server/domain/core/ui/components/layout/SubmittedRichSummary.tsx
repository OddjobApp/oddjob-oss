import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { humanizeFieldKey, formatSubmittedValue } from './copilot-response-parser';

export interface SubmittedRichSummaryProps {
  title: string;
  values?: Record<string, any>;
  /** Schema fields, when known, so rows are labelled the way the form was. */
  fields?: Array<{ key: string; label?: string }>;
  /**
   * "card" — a standalone emerald confirmation on the agent side.
   * "inline" — inherits the indigo user bubble it sits inside, so the echo of
   * what you just submitted doesn't look like a second, differently-coloured
   * message nested in your own.
   */
  variant?: 'card' | 'inline';
}

export function SubmittedRichSummary({
  title,
  values,
  fields,
  variant = 'card',
}: SubmittedRichSummaryProps) {
  const labelFor = (key: string) =>
    fields?.find(f => f.key === key)?.label || humanizeFieldKey(key);
  const entries = values ? Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== '') : [];
  const inline = variant === 'inline';

  return (
    <div
      className={cn(
        'text-sm',
        inline
          ? 'text-indigo-50'
          : 'rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-emerald-100',
      )}
    >
      <div className={cn('flex items-center gap-2 font-bold', inline && 'text-xs uppercase tracking-wider text-indigo-100/80')}>
        <CheckCircle2 className={inline ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        {title}
      </div>
      {entries.length > 0 && (
        <div
          className={cn(
            'mt-3 grid gap-2 border-t pt-3',
            inline ? 'border-indigo-300/25' : 'border-emerald-300/15',
          )}
        >
          {/* Stacked, not two columns: the copilot sheet is ~420px, so a
              label column truncated real field names ("Monthly Paym…").
              Label above value always fits and stays scannable. */}
          {entries.slice(0, 6).map(([key, value]) => (
            <div key={key} className="min-w-0">
              <span
                className={cn(
                  'block text-[10px] font-semibold uppercase tracking-wider',
                  inline ? 'text-indigo-100/60' : 'text-emerald-700 dark:text-emerald-200/60',
                )}
              >
                {labelFor(key)}
              </span>
              <span
                className={cn(
                  'block min-w-0 break-words text-xs font-medium tabular-nums',
                  inline ? 'text-indigo-50' : 'text-emerald-50/90',
                )}
              >
                {formatSubmittedValue(value)}
              </span>
            </div>
          ))}
          {entries.length > 6 && (
            <p className={cn('text-xs', inline ? 'text-indigo-100/70' : 'text-emerald-700 dark:text-emerald-200/70')}>
              {entries.length - 6} more fields submitted.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
