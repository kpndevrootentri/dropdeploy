'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

const COPIED_FEEDBACK_MS = 1500;

/** A value you are meant to paste somewhere else: click to copy, with brief feedback. */
export function CopyValue({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // No clipboard outside a secure context. The value is selectable on
      // screen, so there is nothing useful to report here.
    }
  };

  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
      </div>
      <button
        type="button"
        onClick={copy}
        title={`Copy ${label.toLowerCase()}`}
        className={cn(
          'group mt-1 flex w-full items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-left',
          'hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
          emphasis && 'border-foreground/20',
        )}
      >
        <code
          className={cn(
            'min-w-0 flex-1 truncate font-mono text-[13px]',
            emphasis ? 'font-semibold' : 'font-medium',
          )}
        >
          {value}
        </code>
        {copied ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 group-hover:text-foreground" />
        )}
      </button>
    </div>
  );
}
