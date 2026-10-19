import React from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface RevisionRow {
  seq: number;
  formRevision: number;
  name: string;
  summary: string;
  discardedAt: string | null;
  createdBy: string | null;
  createdByName: string | null;
  updatedAt: string;
}

/** Every saved revision; any of them, including undone ones, can be restored as a new revision. */
export function HistorySheet({ formId, revision, open, onOpenChange, onRestore, busy }: { formId: number; revision: number; open: boolean; onOpenChange: (open: boolean) => void; onRestore: (seq: number) => void; busy: boolean }) {
  const { data, isLoading, error } = useQuery<{ headSeq: number | null; revisions: RevisionRow[] }>({
    queryKey: ["/api/form-studio", formId, "revisions", revision],
    queryFn: async () => (await apiRequest("GET", `/api/form-studio/${formId}/revisions`)).json(),
    enabled: open,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>History</SheetTitle>
          <SheetDescription>Restoring a revision saves it as a new one, so nothing after it is lost.</SheetDescription>
        </SheetHeader>
        {isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading…</p> : error ? <p className="mt-4 text-sm text-destructive">{(error as Error).message}</p> : (
          <ol className="mt-4 grid gap-2">
            {data?.revisions.map((row) => {
              const current = row.seq === data.headSeq;
              return (
                <li key={row.seq} className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div className="grid gap-0.5 text-sm">
                    <span className="font-medium">{row.summary || "Saved"}</span>
                    <span className="text-xs text-muted-foreground">
                      Revision {row.seq} · {formatDistanceToNow(new Date(row.updatedAt), { addSuffix: true })}
                      {row.createdByName ? ` · ${row.createdByName}` : ""}
                    </span>
                    {current && <span className="text-xs font-medium text-primary">Shown now</span>}
                    {row.discardedAt && <span className="text-xs text-muted-foreground">Undone, then edited past</span>}
                  </div>
                  {!current && (
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onRestore(row.seq)}>Restore</Button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </SheetContent>
    </Sheet>
  );
}
