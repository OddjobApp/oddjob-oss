import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import type { EditPlan, FileOperation } from "../types/index.js";

const OP_VARIANT: Record<FileOperation["type"], "success" | "warning" | "destructive"> = {
  create: "success",
  modify: "warning",
  delete: "destructive",
};

export interface DesignTabProps {
  editPlan?: EditPlan;
}

export function DesignTab({ editPlan }: DesignTabProps) {
  if (!editPlan) {
    return <p className="text-sm text-muted-foreground">No edit plan has been generated yet.</p>;
  }

  return (
    <div className="space-y-4" data-testid="design-tab">
      <Card>
        <CardHeader><CardTitle className="text-sm">Objective</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm">{editPlan.objective}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {editPlan.totalFileCount} file{editPlan.totalFileCount === 1 ? "" : "s"} affected
            {editPlan.requiresHumanReview && " · requires human review"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Planned Operations</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {editPlan.operations.map((op) => (
            <div key={op.id} className="rounded-md border p-2">
              <div className="flex items-center gap-2">
                <Badge variant={OP_VARIANT[op.type]} className="text-[10px] uppercase">{op.type}</Badge>
                <code className="text-xs">{op.filePath}</code>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{op.rationale}</p>
              {op.dependsOn.length > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">Depends on: {op.dependsOn.join(", ")}</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {editPlan.dependencyOrder.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Execution Order</CardTitle></CardHeader>
          <CardContent>
            <ol className="list-inside list-decimal text-xs text-muted-foreground">
              {editPlan.dependencyOrder.map((id) => <li key={id}><code>{id}</code></li>)}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
