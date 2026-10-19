import React from "react";
import { MermaidRenderer } from "../../../../admin/ui/modules/admin/components/MermaidRenderer";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Network, Activity } from "lucide-react";

export interface PlatformWorkflowDiagramBlockProps {
  title?: string;
  chart?: string;
  scope?: string;
  stageName?: string;
  badge?: string;
}

const DEFAULT_CHART = `graph TD
  A[1. Ingestion] --> B[2. Processing]
  B --> C[3. Decision Gate]
  C --> D[4. Execution]
`;

export function PlatformWorkflowDiagramBlock({
  title = "Workflow Dependency Graph",
  chart = DEFAULT_CHART,
  scope,
  stageName,
  badge = "Active Blueprint",
}: PlatformWorkflowDiagramBlockProps) {
  return (
    <Card className="overflow-hidden border border-border/80 bg-card/60 shadow-lg backdrop-blur-md">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-indigo-400" />
          <CardTitle className="text-sm font-bold text-foreground">{title}</CardTitle>
          {stageName && (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-400">
              Stage: {stageName}
            </Badge>
          )}
        </div>
        <Badge variant="outline" className="border-indigo-500/30 bg-indigo-500/10 text-[10px] text-indigo-300">
          <Activity className="mr-1 h-3 w-3" />
          {badge}
        </Badge>
      </CardHeader>
      <CardContent className="p-2">
        <MermaidRenderer chart={chart} scope={scope} />
      </CardContent>
    </Card>
  );
}

export default PlatformWorkflowDiagramBlock;
