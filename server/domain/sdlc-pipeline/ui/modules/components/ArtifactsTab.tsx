import { useState } from "react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import type { ArtifactLineage, ArtifactRecord } from "../types/index.js";

export interface ArtifactsTabProps {
  lineage?: ArtifactLineage;
}

/** Groups a phase's artifacts by name so multi-version artifacts get a version selector. */
function groupByName(artifacts: ArtifactRecord[]): Map<string, ArtifactRecord[]> {
  const map = new Map<string, ArtifactRecord[]>();
  for (const a of artifacts) {
    const list = map.get(a.name) ?? [];
    list.push(a);
    map.set(a.name, list);
  }
  for (const list of map.values()) list.sort((x, y) => y.version - x.version); // newest first
  return map;
}

function ArtifactView({ versions }: { versions: ArtifactRecord[] }) {
  const [version, setVersion] = useState(versions[0]?.version);
  const current = versions.find((v) => v.version === version) ?? versions[0];
  if (!current) return null;

  return (
    <div className="rounded-md border p-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{current.name}</span>
        <Badge variant="secondary" className="text-[10px]">{current.mimeType}</Badge>
        {versions.length > 1 && (
          <Select value={String(version)} onValueChange={(v) => setVersion(Number(v))}>
            <SelectTrigger className="ml-auto h-6 w-24 text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {versions.map((v) => <SelectItem key={v.version} value={String(v.version)}>v{v.version}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          View content (v{current.version}, validated {new Date(current.validatedAt).toLocaleString()})
        </summary>
        <pre className="mt-1 max-h-80 overflow-auto rounded bg-muted p-2 text-[11px]">
          {typeof current.content === "string" ? current.content : JSON.stringify(current.content, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export function ArtifactsTab({ lineage }: ArtifactsTabProps) {
  if (!lineage || lineage.phases.length === 0) {
    return <p className="text-sm text-muted-foreground">No artifacts have been produced yet.</p>;
  }

  return (
    <div className="space-y-4" data-testid="artifacts-tab">
      {lineage.phases.map((phase) => {
        const grouped = groupByName(phase.artifacts);
        return (
          <div key={phase.phase}>
            <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              {phase.phase.replace(/_/g, " ")} ({phase.artifacts.length})
            </p>
            <div className="space-y-2">
              {[...grouped.entries()].map(([name, versions]) => (
                <ArtifactView key={name} versions={versions} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
