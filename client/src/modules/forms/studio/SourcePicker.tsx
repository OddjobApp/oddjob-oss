import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export interface KnowledgeSource {
  id: number;
  title: string;
  summary: string | null;
  updatedAt: string;
  /** In the form's Project Space, or the project a new form is started in. */
  inProject?: boolean;
}

export const MAX_SOURCES = 10;

/**
 * Search the organization's knowledge documents and pick up to ten. For a form in a
 * Project Space, or a new form started in one, that project's documents come first.
 */
export function SourcePicker({ selected, onChange, idPrefix, formId, projectKey }: {
  selected: number[];
  onChange: (ids: number[]) => void;
  idPrefix: string;
  formId?: number;
  projectKey?: string;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const scope = formId ? `&formId=${formId}` : projectKey ? `&projectKey=${encodeURIComponent(projectKey)}` : "";
  const { data: sources = [], isLoading, error } = useQuery<KnowledgeSource[]>({
    queryKey: ["/api/form-studio/sources", debounced, formId ?? null, projectKey ?? null],
    queryFn: async () => (await apiRequest("GET", `/api/form-studio/sources?q=${encodeURIComponent(debounced)}${scope}`)).json(),
  });

  return (
    <div className="grid gap-2">
      <label htmlFor={`${idPrefix}-search`} className="text-xs font-medium text-muted-foreground">Knowledge documents</label>
      <Input id={`${idPrefix}-search`} type="search" placeholder="Search by title" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="max-h-56 overflow-y-auto rounded-md border">
        {isLoading ? (
          <p className="p-3 text-sm text-muted-foreground">Searching…</p>
        ) : error ? (
          <p className="p-3 text-sm text-destructive">{(error as Error).message}</p>
        ) : sources.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No documents match.</p>
        ) : (
          <ul className="divide-y">
            {sources.map((source) => {
              const checked = selected.includes(source.id);
              const id = `${idPrefix}-source-${source.id}`;
              return (
                <li key={source.id} className="flex items-start gap-2 p-2">
                  <Checkbox
                    id={id} checked={checked} disabled={!checked && selected.length >= MAX_SOURCES} className="mt-0.5"
                    onCheckedChange={(on) => onChange(on === true ? [...selected, source.id] : selected.filter((s) => s !== source.id))}
                  />
                  <label htmlFor={id} className="grid gap-0.5 text-sm">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {source.title}
                      {source.inProject && <Badge variant="secondary" className="text-[10px]">In this project</Badge>}
                    </span>
                    {source.summary && <span className="line-clamp-2 text-xs text-muted-foreground">{source.summary}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{selected.length} of {MAX_SOURCES} selected.</p>
    </div>
  );
}
