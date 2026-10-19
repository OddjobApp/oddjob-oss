import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ExternalLink, FilePlus2, FilePen, FileX2, GitBranch } from "lucide-react";
import type { PRResult, FileOperation } from "../types/index.js";

type PRStatus = "open" | "merged" | "closed";

const OP_META: Record<FileOperation["type"], { label: string; Icon: typeof FilePlus2; className: string }> = {
  create: { label: "Created", Icon: FilePlus2, className: "text-green-600" },
  modify: { label: "Modified", Icon: FilePen, className: "text-amber-600" },
  delete: { label: "Deleted", Icon: FileX2, className: "text-red-600" },
};

const PR_STATUS_VARIANT: Record<PRStatus, "info" | "success" | "secondary"> = {
  open: "info",
  merged: "success",
  closed: "secondary",
};

export interface DeliverablePanelProps {
  pr?: PRResult;
  fileOperations?: FileOperation[];
  prStatus?: PRStatus;
  linesChanged?: number;
  noDeliverableReason?: string;
}

export function DeliverablePanel({ pr, fileOperations, prStatus, linesChanged, noDeliverableReason }: DeliverablePanelProps) {
  if (!pr) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Deliverable</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {noDeliverableReason ?? "No deliverable produced for this session."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const grouped: Record<FileOperation["type"], FileOperation[]> = { create: [], modify: [], delete: [] };
  for (const op of fileOperations ?? []) grouped[op.type]?.push(op);
  const fileCount = fileOperations?.length ?? 0;

  return (
    <Card data-testid="deliverable-panel">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Deliverable</CardTitle>
        {prStatus && <Badge variant={PR_STATUS_VARIANT[prStatus]}>{prStatus}</Badge>}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <code className="text-xs">{pr.branchName}</code>
        </div>
        <a href={pr.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
          PR #{pr.prNumber} <ExternalLink className="h-3 w-3" />
        </a>
        <p className="text-xs text-muted-foreground">
          SHA <code>{pr.commitSha.slice(0, 12)}</code> · {fileCount} file{fileCount === 1 ? "" : "s"}
          {linesChanged !== undefined && ` · ${linesChanged} lines changed`}
        </p>

        {(["create", "modify", "delete"] as const).map((type) =>
          grouped[type].length > 0 ? (
            <div key={type}>
              <p className={`flex items-center gap-1 text-xs font-semibold ${OP_META[type].className}`}>
                {(() => { const I = OP_META[type].Icon; return <I className="h-3 w-3" />; })()}
                {OP_META[type].label} ({grouped[type].length})
              </p>
              <ul className="list-inside list-disc pl-2 text-xs text-muted-foreground">
                {grouped[type].map((op) => <li key={op.id}><code>{op.filePath}</code></li>)}
              </ul>
            </div>
          ) : null
        )}

        <div className="rounded-md border p-2">
          <p className="text-xs font-medium">Test evidence</p>
          <p className="text-xs text-muted-foreground">
            {pr.testEvidence.passingTests}/{pr.testEvidence.totalTests} passing · {pr.testEvidence.fixAttempts} fix attempt(s)
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
