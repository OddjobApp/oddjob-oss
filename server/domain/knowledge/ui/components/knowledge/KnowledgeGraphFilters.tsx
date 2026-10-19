/**
 * Knowledge Graph Filters
 * Context selector bar (global/run/dataset) and run/dataset selects
 */

import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import type { ViewContext } from "@domain-ui/knowledge/ui/modules/knowledge/hooks/useKnowledgeFilters";

export interface KnowledgeGraphFiltersProps {
  viewContext: ViewContext;
  onViewContextChange: (context: ViewContext) => void;
  selectedRunId: number | null;
  onSelectedRunIdChange: (id: number | null) => void;
  selectedDatasets: string[];
  onSelectedDatasetsChange: (datasets: string[]) => void;
  executions: Array<{ id: number; pipelineName?: string; startTime?: string }>;
  datasets: Array<{ id: number; name: string }>;
}

export function KnowledgeGraphFilters({
  viewContext,
  onViewContextChange,
  selectedRunId,
  onSelectedRunIdChange,
  selectedDatasets,
  onSelectedDatasetsChange,
  executions,
  datasets,
}: KnowledgeGraphFiltersProps) {
  return (
    <div className="flex-none border-b bg-card px-3 py-2 sm:px-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={viewContext} onValueChange={(v) => onViewContextChange(v as ViewContext)}>
          <SelectTrigger className="w-full border-border sm:w-40"><SelectValue placeholder="Context" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="global">Global Graph</SelectItem>
            <SelectItem value="run">Pipeline Run</SelectItem>
            <SelectItem value="dataset">Dataset View</SelectItem>
          </SelectContent>
        </Select>

        {viewContext === 'run' && (
          <Select
            value={selectedRunId?.toString()}
            onValueChange={(v) => onSelectedRunIdChange(parseInt(v))}
          >
            <SelectTrigger className="w-full border-border sm:w-64"><SelectValue placeholder="Select Run" /></SelectTrigger>
            <SelectContent>
              {executions.map((ex) => (
                <SelectItem key={ex.id} value={ex.id.toString()}>
                  Run #{ex.id} - {ex.pipelineName} ({new Date(ex.startTime || 0).toLocaleString()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {viewContext === 'dataset' && (
          <Select
            value={selectedDatasets[0]}
            onValueChange={(v) => onSelectedDatasetsChange([v])}
          >
            <SelectTrigger className="w-full border-border sm:w-64"><SelectValue placeholder="Select Dataset" /></SelectTrigger>
            <SelectContent>
              {datasets.map((ds) => (
                <SelectItem key={ds.id} value={ds.id.toString()}>{ds.name} (#{ds.id})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

