/**
 * Shadow Diff: side-by-side JSON diff viewer.
 * Aligned with docs/specs/HIL_2_ACCOUNTABILITY_SPEC.md
 */

import { useMemo } from 'react';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { computeLineDiff, type DiffLine, type DiffLineType } from '@shared/utils/json-diff.js';
import { cn } from '@/lib/utils';

interface JsonDiffViewerProps {
  original: string;
  modified: string;
  className?: string;
}

export function JsonDiffViewer({ original, modified, className }: JsonDiffViewerProps) {
  const lines = useMemo(() => computeLineDiff(original, modified), [original, modified]);

  return (
    <ScrollArea className={cn('h-full rounded-md border', className)}>
      <div className="font-mono text-xs p-4">
        {lines.map((line, idx) => (
          <div
            key={idx}
            className={cn(
              'flex w-full min-w-0',
              line.type === 'add' && 'bg-emerald-500/15',
              line.type === 'remove' && 'bg-rose-500/15',
              line.type === 'same' && 'text-muted-foreground'
            )}
          >
            <div className="flex shrink-0 w-14 text-right pr-3 text-muted-foreground select-none">
              {line.type === 'remove' ? line.oldLineNum : line.type === 'add' ? '' : line.oldLineNum ?? ''}
            </div>
            <div className="flex shrink-0 w-14 text-right pr-3 text-muted-foreground select-none border-l border-border/50 pl-2">
              {line.type === 'add' ? line.newLineNum : line.type === 'remove' ? '' : line.newLineNum ?? ''}
            </div>
            <div
              className={cn(
                'flex-1 pl-2 break-all whitespace-pre',
                line.type === 'add' && 'text-emerald-700 dark:text-emerald-300',
                line.type === 'remove' && 'text-rose-700 dark:text-rose-300'
              )}
            >
              {line.type === 'remove' && <span className="text-rose-500 mr-1">−</span>}
              {line.type === 'add' && <span className="text-emerald-500 mr-1">+</span>}
              {line.content || ' '}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
