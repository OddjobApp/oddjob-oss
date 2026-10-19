/**
 * Knowledge Graph Toolbar
 * View mode toggles, search, and export controls
 */

import React from "react";
import { Network, Search, Filter, MessageSquare, Box, Columns, Activity, GitCompare, LayoutTemplate, TableProperties } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@domain-ui/core/ui/components/ui/toggle-group";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Slider } from "@domain-ui/core/ui/components/ui/slider";
import { ExportButton } from "@domain-ui/core/ui/components/shared/ExportButton";
import { formatDateForExport } from "@/lib/export-utils";
import type { KnowledgeNode } from "@shared/schema/knowledge/graph";
import type { ViewMode } from "@domain-ui/knowledge/ui/modules/knowledge/hooks/useKnowledgeFilters";

export interface KnowledgeGraphToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSearch: () => void;
  onFilterClick: () => void;
  isChatOpen: boolean;
  onChatToggle: () => void;
  exportData: KnowledgeNode[];
  maxNodes?: number;
  onMaxNodesChange?: (value: number) => void;
}

export function KnowledgeGraphToolbar({
  viewMode,
  onViewModeChange,
  searchQuery,
  onSearchQueryChange,
  onSearch,
  onFilterClick,
  isChatOpen,
  onChatToggle,
  exportData,
  maxNodes = 500,
  onMaxNodesChange,
}: KnowledgeGraphToolbarProps) {
  const viewModes = [
    { value: "3d", label: "3D", desktopLabel: "3D Graph", aria: "3D View", icon: Box },
    { value: "matrix", label: "Matrix", desktopLabel: "Matrix", aria: "Matrix View", icon: Columns },
    { value: "timeline", label: "Timeline", desktopLabel: "Timeline", aria: "Timeline View", icon: Activity },
    { value: "flow", label: "Flow", desktopLabel: "Flow", aria: "Flow Analysis", icon: GitCompare },
    { value: "tree", label: "Map", desktopLabel: "Map", aria: "Tree Map", icon: LayoutTemplate },
    { value: "pivot", label: "Pivot", desktopLabel: "Pivot", aria: "Pivot Table", icon: TableProperties },
  ] as const;

  return (
    <div className="flex-none border-b bg-background px-3 py-2 sm:px-4">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center justify-between gap-2 xl:justify-start">
          <h1 className="flex min-w-0 items-center gap-2 text-base font-bold text-foreground sm:text-xl">
            <Network className="h-5 w-5 shrink-0 text-primary sm:h-6 sm:w-6" />
            <span className="truncate">Knowledge Explorer</span>
          </h1>
          <div className="flex shrink-0 items-center gap-2 xl:hidden">
            <Button variant="outline" size="icon" onClick={onFilterClick} title="Filters" aria-label="Filters">
              <Filter className="w-4 h-4" />
            </Button>
            <Button variant={isChatOpen ? "default" : "outline"} size="icon" onClick={onChatToggle} title="Graph Chat" aria-label="Graph Chat">
              <MessageSquare className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(v) => v && onViewModeChange(v as ViewMode)}
          className="max-w-full justify-start overflow-x-auto rounded-xl border border-border/60 bg-muted/30 p-1"
        >
          {viewModes.map(({ value, label, desktopLabel, aria, icon: Icon }) => (
            <ToggleGroupItem key={value} value={value} aria-label={aria} className="h-9 shrink-0 gap-1.5 px-3 text-xs sm:text-sm">
              <Icon className="h-4 w-4 shrink-0" />
              <span className="lg:hidden">{label}</span>
              <span className="hidden lg:inline">{desktopLabel}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {viewMode === '3d' && onMaxNodesChange && (
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 lg:ml-2 lg:w-48">
            <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground whitespace-nowrap">Limit: {maxNodes}</span>
            <Slider
              value={[maxNodes]}
              min={50}
              max={2000}
              step={50}
              onValueChange={(vals) => onMaxNodesChange(vals[0])}
              className="w-full"
            />
          </div>
        )}
        </div>

      <div className="flex min-w-0 items-center gap-2">
        <div className="relative min-w-0 flex-1 xl:flex-none">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search concepts..."
            className="w-full pl-9 xl:w-64"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          />
        </div>
        <Button className="shrink-0" variant="outline" size="icon" onClick={onSearch} title="Search" aria-label="Search">
          <Search className="w-4 h-4" />
        </Button>
        <Button className="hidden xl:inline-flex" variant="outline" size="icon" onClick={onFilterClick} title="Filters" aria-label="Filters"><Filter className="w-4 h-4" /></Button>
        <Button variant={isChatOpen ? "default" : "outline"} size="sm" onClick={onChatToggle} className="hidden gap-2 xl:inline-flex">
          <MessageSquare className="w-4 h-4" />Graph Chat
        </Button>
        <div className="hidden h-6 w-px bg-border mx-1 xl:block" />
        <div className="hidden xl:block">
          <ExportButton
            data={exportData}
            columns={[
              { key: 'id', header: 'ID' },
              { key: 'name', header: 'Name' },
              { key: 'label', header: 'Label' },
              { key: 'externalId', header: 'External ID' },
              { key: 'properties', header: 'Properties', formatter: (v) => JSON.stringify(v) }
            ]}
            filename={`knowledge_graph_export_${formatDateForExport(new Date())}`}
          />
        </div>
      </div>
      </div>
    </div>
  );
}

