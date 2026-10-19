import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal, Plus, Sparkles } from "lucide-react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CreateFormDialog, type CreateMode } from "../CreateFormDialog";
import { selectClassName } from "../studio/editor-controls";
import { describeUse, publishStateLabel, type FormUse } from "../studio/types";

export interface LibraryRow {
  id: number;
  name: string;
  description: string | null;
  isArchived: boolean;
  legacy: boolean;
  revision: number;
  state: "draft" | "published" | "draft_ahead";
  releaseNumber: number | null;
  updatedAt: string;
  lastEditedBy: string | null;
  sources: Array<{ id: number; title: string }>;
  responses: number;
  waitingRequests: number;
  issueCount: number;
  testCount: number;
  failingTests: number;
  usedBy: FormUse[];
  templateUpdate: boolean;
}

interface Filters {
  q: string;
  state: "" | "draft" | "published" | "draft_ahead" | "legacy" | "archived";
  issues: "" | "open" | "clear";
  use: "" | "used" | "unused";
}

const studioPath = (id: number, tab?: string) => `/armory/forms/builder/${id}${tab ? `?tab=${tab}` : ""}`;

function problemsLabel(row: LibraryRow): string {
  const parts = [
    row.issueCount && `${row.issueCount} ${row.issueCount === 1 ? "issue" : "issues"}`,
    row.failingTests && `${row.failingTests} failing ${row.failingTests === 1 ? "test" : "tests"}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "None";
}

/** The Forms library: every authored form, its state, problems, responses and what uses it. */
export default function FormsLibraryPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filters, setFilters] = useState<Filters>({ q: "", state: "", issues: "", use: "" });
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState<CreateMode | null>(null);
  const [pendingArchive, setPendingArchive] = useState<LibraryRow | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => ({ ...f, q: search.trim() })), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    // The standalone Studio sends "/armory/forms/builder" without an id here.
    if (new URLSearchParams(window.location.search).get("create") === "blank") setCreating("blank");
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    const text = params.toString();
    return `/api/form-studio${text ? `?${text}` : ""}`;
  }, [filters]);

  const { data: rows = [], isLoading, error } = useQuery<LibraryRow[]>({
    queryKey: ["/api/form-studio", filters],
    queryFn: async () => (await apiRequest("GET", query)).json(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/form-studio"] });
  const act = async (label: string, request: () => Promise<Response>, success: string) => {
    try {
      await request();
      toast({ title: success });
      await refresh();
    } catch (err) {
      toast({ title: `Could not ${label}`, description: (err as Error).message, variant: "destructive" });
    }
  };

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <div className="grid gap-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Forms</h1>
          <p className="text-sm text-muted-foreground">Forms people fill in, with their scoring, decisions and results. Open one to edit it in Form Studio.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setCreating("documents")}><Sparkles className="mr-2 h-4 w-4" />New from documents</Button>
          <Button type="button" onClick={() => setCreating("blank")}><Plus className="mr-2 h-4 w-4" />New form</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label htmlFor="forms-search" className="text-xs font-medium text-muted-foreground">Search</label>
          <Input id="forms-search" type="search" className="w-64" placeholder="Name or description" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="forms-state" className="text-xs font-medium text-muted-foreground">State</label>
          <select id="forms-state" className={cn(selectClassName, "w-44")} value={filters.state} onChange={(e) => setFilter("state", e.target.value as Filters["state"])}>
            <option value="">All current forms</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="draft_ahead">Draft ahead of release</option>
            <option value="legacy">Legacy</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="forms-issues" className="text-xs font-medium text-muted-foreground">Problems</label>
          <select id="forms-issues" className={cn(selectClassName, "w-40")} value={filters.issues} onChange={(e) => setFilter("issues", e.target.value as Filters["issues"])}>
            <option value="">Any</option>
            <option value="open">Has problems</option>
            <option value="clear">No problems</option>
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="forms-use" className="text-xs font-medium text-muted-foreground">Use</label>
          <select id="forms-use" className={cn(selectClassName, "w-40")} value={filters.use} onChange={(e) => setFilter("use", e.target.value as Filters["use"])}>
            <option value="">Any</option>
            <option value="used">In use</option>
            <option value="unused">Not used</option>
          </select>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">{(error as Error).message}</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">Loading forms…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {Object.values(filters).some(Boolean) ? "No forms match these filters." : "No forms yet. Start one blank or from documents."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Form</th>
                <th scope="col" className="px-4 py-2 font-medium">State</th>
                <th scope="col" className="px-4 py-2 font-medium">Problems</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Responses</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Waiting</th>
                <th scope="col" className="px-4 py-2 font-medium">Used by</th>
                <th scope="col" className="px-4 py-2 font-medium">Updated</th>
                <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id} className="align-top" data-testid={`form-row-${row.id}`}>
                  <td className="max-w-md px-4 py-3">
                    <button type="button" className="text-left font-medium text-foreground hover:underline" onClick={() => setLocation(studioPath(row.id))}>
                      {row.name}
                    </button>
                    {row.description && <p className="line-clamp-1 text-xs text-muted-foreground">{row.description}</p>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {row.legacy && <Badge variant="outline">Legacy</Badge>}
                      {row.templateUpdate && <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">Template changes to review</Badge>}
                      {row.sources.length > 0 && <span className="text-xs text-muted-foreground">From {row.sources.map((s) => s.title).join(", ")}</span>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {row.isArchived ? <Badge variant="secondary">Archived</Badge> : (
                      <Badge variant={row.state === "draft" ? "secondary" : "default"}>
                        {publishStateLabel(row.releaseNumber ? { releaseNumber: row.releaseNumber, revision: row.revision, href: "", draftAhead: row.state === "draft_ahead" } : null)}
                      </Badge>
                    )}
                  </td>
                  <td className={cn("whitespace-nowrap px-4 py-3", row.issueCount + row.failingTests > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                    {problemsLabel(row)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.responses}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.waitingRequests}</td>
                  <td className="px-4 py-3">
                    {row.usedBy.length ? (
                      <details>
                        <summary className="cursor-pointer whitespace-nowrap">{row.usedBy.length} {row.usedBy.length === 1 ? "place" : "places"}</summary>
                        <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">{row.usedBy.map((use, i) => <li key={i}>{describeUse(use)}</li>)}</ul>
                      </details>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(row.updatedAt), { addSuffix: true })}
                    {row.lastEditedBy && <div>by {row.lastEditedBy}</div>}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" aria-label={`Actions for ${row.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!row.isArchived && <DropdownMenuItem onSelect={() => setLocation(studioPath(row.id))}>Open in Form Studio</DropdownMenuItem>}
                        {!row.isArchived && <DropdownMenuItem onSelect={() => setLocation(studioPath(row.id, "publish"))}>View responses</DropdownMenuItem>}
                        {!row.isArchived && (
                          <DropdownMenuItem onSelect={() => act("duplicate the form", () => apiRequest("POST", `/api/form-studio/${row.id}/duplicate`, {}), `Duplicated “${row.name}”`)}>
                            Duplicate
                          </DropdownMenuItem>
                        )}
                        {row.isArchived ? (
                          <DropdownMenuItem onSelect={() => act("restore the form", () => apiRequest("PUT", `/api/forms/${row.id}`, { isArchived: false }), `Restored “${row.name}”`)}>
                            Restore
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem className="text-destructive" onSelect={() => setPendingArchive(row)}>Archive</DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateFormDialog
        mode={creating ?? "blank"}
        open={creating !== null}
        onOpenChange={(open) => !open && setCreating(null)}
        onCreated={(form) => { setCreating(null); void refresh(); setLocation(studioPath(form.id)); }}
      />

      <AlertDialog open={pendingArchive !== null} onOpenChange={(open) => !open && setPendingArchive(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{pendingArchive?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It leaves the library and can be restored from the Archived filter.
              {pendingArchive?.usedBy.length ? ` It is still used by ${pendingArchive.usedBy.map(describeUse).join("; ")}, which keep working.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const row = pendingArchive; setPendingArchive(null); if (row) void act("archive the form", () => apiRequest("DELETE", `/api/forms/${row.id}`), `Archived “${row.name}”`); }}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
