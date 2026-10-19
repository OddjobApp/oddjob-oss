import React, { Suspense } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const DocumentPresentationViewer = React.lazy(() =>
  import('@domain-ui/knowledge/ui/modules/knowledge/components/DocumentPresentationViewer').then(m => ({ default: m.DocumentPresentationViewer }))
);

export interface ExecutivePresentationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ast: any;
}

export function ExecutivePresentationModal({
  open,
  onOpenChange,
  ast,
}: ExecutivePresentationModalProps) {
  if (!open || !ast) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl w-[96vw] h-[92vh] p-0 overflow-hidden bg-background border-border shadow-2xl flex flex-col">
        <DialogHeader className="px-6 py-3 border-b border-border/60 bg-muted/40 flex flex-row items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300 text-xs">
              Executive Briefing
            </Badge>
            <DialogTitle className="text-sm font-semibold truncate max-w-xl">
              {ast.title || "Executive Closing Deliverables"}
            </DialogTitle>
          </div>
        </DialogHeader>
        <div className="flex-1 min-h-0 w-full overflow-y-auto">
          <Suspense fallback={<div className="p-8 text-center text-xs text-muted-foreground animate-pulse">Loading presentation viewer...</div>}>
            <DocumentPresentationViewer ast={ast} />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
}
