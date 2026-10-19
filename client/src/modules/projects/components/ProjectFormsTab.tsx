import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ClipboardList, Clock, Database, Plus, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { CreateFormDialog, type CreateMode } from "@/modules/forms/CreateFormDialog";
import type { LibraryRow } from "@/modules/forms/pages/FormsLibraryPage";
import { useProjectForms } from "../hooks/use-projects";

/**
 * A Project Space's Forms tab: the project's Form Studio forms, the stages its
 * cycles are waiting on, recent results, and the datasets responses land in.
 *
 * Links into the Studio are plain anchors: the project space is served by
 * operations.html and the Studio by armory.html, and client-side routing cannot
 * cross that bundle boundary. Editors can start a form in the project or add an
 * existing one; in a private project those forms are then visible only to members.
 */

const studioPath = (id: number) => `/armory/forms/builder/${id}`;
const EDIT_ROLES = new Set(["owner", "editor"]);
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function stateLabel(form: LibraryRow): string {
  if (form.state === "draft") return "Draft";
  return form.state === "draft_ahead" ? `v${form.releaseNumber} · edits unpublished` : `v${form.releaseNumber}`;
}

export function ProjectFormsTab({ projectKey, role }: { projectKey: string; role: string | null | undefined }) {
  const canEdit = EDIT_ROLES.has(role ?? "");
  const { data, isLoading } = useProjectForms(projectKey);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [creating, setCreating] = useState<CreateMode | null>(null);
  const [adding, setAdding] = useState("");

  const forms = data?.forms ?? [];
  const library = useQuery<LibraryRow[]>({
    queryKey: ["/api/form-studio", "project-picker"],
    queryFn: async () => (await apiRequest("GET", "/api/form-studio")).json(),
    enabled: canEdit,
  });
  const addable = (library.data ?? []).filter((row) => !forms.some((form) => form.id === row.id));

  const attach = async () => {
    const resourceId = Number(adding);
    if (!resourceId) return;
    try {
      await apiRequest("POST", `/api/projects/${projectKey}/resources`, { resourceType: "form", resourceId });
      setAdding("");
      await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectKey}/forms`] });
      toast({ title: "Form added to the project" });
    } catch (error) {
      toast({ title: "The form was not added", description: (error as Error).message, variant: "destructive" });
    }
  };

  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;

  const waiting = data?.waitingStages ?? [];
  const results = data?.recentResults ?? [];
  const datasets = data?.responseDatasets ?? [];

  return (
    <div className="space-y-6" data-testid="project-forms-tab">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => setCreating("blank")}>
            <Plus className="mr-1 h-4 w-4" aria-hidden />New form
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setCreating("documents")}>
            <Sparkles className="mr-1 h-4 w-4" aria-hidden />New form from documents
          </Button>
          <label htmlFor="project-add-form" className="sr-only">Form to add to this project</label>
          <select
            id="project-add-form"
            className="h-9 min-w-48 rounded-md border border-input bg-background px-2 text-sm"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          >
            <option value="">Add an existing form…</option>
            {addable.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <Button type="button" size="sm" variant="outline" disabled={!adding} onClick={attach}>Add</Button>
        </div>
      )}

      {forms.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No forms belong to this project yet.
          </CardContent>
        </Card>
      ) : (
        <section aria-label="Forms" className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <ClipboardList className="h-4 w-4 text-primary" aria-hidden />
            Forms <span className="text-muted-foreground">({forms.length})</span>
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {forms.map((form) => (
              <a key={form.id} href={studioPath(form.id)} title={`Open ${form.name} in Form Studio`} data-testid={`project-form-link-${form.id}`}>
                <Card className="h-full cursor-pointer transition-colors hover:border-primary/40">
                  <CardContent className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="truncate font-bold text-foreground">{form.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {plural(form.responses, "response")}
                        {form.waitingRequests > 0 && ` · ${plural(form.waitingRequests, "request")} waiting`}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant="secondary">{stateLabel(form)}</Badge>
                      {form.linkAudience && (
                        <Badge variant="outline" className="text-[10px]">{form.linkAudience === "project_members" ? "Members-only link" : "Public link"}</Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </a>
            ))}
          </div>
        </section>
      )}

      {waiting.length > 0 && (
        <section aria-label="Stages waiting" className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Clock className="h-4 w-4 text-primary" aria-hidden />
            Waiting in this project's cycles <span className="text-muted-foreground">({waiting.length})</span>
          </h3>
          <ul className="divide-y rounded-lg border">
            {waiting.map((stage) => (
              <li key={stage.approvalId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{stage.stageTitle}</span>
                  <span className="text-muted-foreground"> · {stage.formName}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {stage.approverEmail}, waiting {formatDistanceToNow(new Date(stage.waitingSince))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results.length > 0 && (
        <section aria-label="Recent results" className="space-y-2">
          <h3 className="text-sm font-bold text-foreground">Recent results</h3>
          <ul className="divide-y rounded-lg border">
            {results.map((result) => (
              <li key={result.responseId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{result.formName}</span>
                  {result.releaseNumber && <span className="text-muted-foreground"> v{result.releaseNumber}</span>}
                </span>
                <span className="flex items-center gap-2">
                  {result.status && <Badge variant="outline" className="font-mono text-[11px]">{result.status}</Badge>}
                  {result.submittedAt && (
                    <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(result.submittedAt), { addSuffix: true })}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {datasets.length > 0 && (
        <section aria-label="Response datasets" className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Database className="h-4 w-4 text-primary" aria-hidden />
            Where responses are recorded
          </h3>
          {datasets.map((dataset) => (
            <Card key={dataset.id}>
              <CardContent className="p-3">
                <div className="truncate text-sm font-bold text-foreground">{dataset.name}</div>
                <div className="truncate text-xs text-muted-foreground">From {dataset.forms.join(", ")}</div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      <CreateFormDialog
        mode={creating ?? "blank"}
        open={creating !== null}
        onOpenChange={(open) => { if (!open) setCreating(null); }}
        projectKey={projectKey}
        onCreated={(form) => {
          setCreating(null);
          window.location.assign(studioPath(form.id));
        }}
      />
    </div>
  );
}
