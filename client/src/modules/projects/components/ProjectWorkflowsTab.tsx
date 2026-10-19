import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, ChevronRight, Play, Workflow as WorkflowIcon } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import {
    roleAtLeast,
    useProjectWorkflows,
    useWorkflowDetail,
    useWorkflowRuns,
    useWorkflowSignalDeliveries,
    useWorkflowSignalSubscriptions,
} from "../hooks/use-projects";

/**
 * A Project Space's Workflows tab: the workflows registered to the project,
 * each backed by an editable workstream draft with immutable releases and a
 * production deployment. Editors publish releases; operators activate, pause
 * and run them.
 *
 * Draft links go to the workstream editor at /operations/workstreams/:id and
 * run rows to /operations/workstream-executions/:id — both served by the same
 * operations bundle as the project space, so wouter Links are safe.
 */

const workstreamPath = (id: number) => `/operations/workstreams/${id}`;
const executionPath = (id: number) => `/operations/workstream-executions/${id}`;

interface PipelineOption { id: number; name: string }

/** A workflow mutation: call, refresh the workflow queries, toast the result. */
type WorkflowAction = () => Promise<Response>;
type WorkflowToast = (data: any) => string;

function productionDeployment(deployments: any[] | undefined) {
    return (deployments ?? []).find((d) => d.environment === "production") ?? null;
}

function deploymentLabel(deployment: any, releases: any[]): string {
    if (!deployment) return "No deployment";
    const release = releases.find((r) => r.id === deployment.releaseId);
    return release ? `${deployment.status} · v${release.releaseNumber}` : deployment.status;
}

const SIGNAL_SEVERITIES = ["Low", "Medium", "High", "Critical"];

function SignalTriggersSection({
    workflow,
    canEdit,
    onAction,
}: {
    workflow: any;
    canEdit: boolean;
    onAction: (fn: WorkflowAction, success: WorkflowToast) => Promise<void>;
}) {
    const subscriptions = useWorkflowSignalSubscriptions(workflow.id);
    const deliveries = useWorkflowSignalDeliveries(workflow.id);
    const [name, setName] = useState("");
    const [eventTypes, setEventTypes] = useState("");
    const [minimumSeverity, setMinimumSeverity] = useState("");
    const [cooldown, setCooldown] = useState("0");

    const subs = subscriptions.data ?? [];
    const lastDeliveries = (deliveries.data ?? []).slice(0, 5);

    const add = () => {
        const filters: Record<string, unknown> = {};
        const types = eventTypes.split(",").map((t) => t.trim()).filter(Boolean);
        if (types.length) filters.eventTypes = types;
        if (minimumSeverity) filters.minimumSeverity = minimumSeverity;
        void onAction(
            () => apiRequest("POST", `/api/workflows/${workflow.id}/signal-subscriptions`, {
                name,
                filters,
                cooldownMinutes: Math.max(0, Number(cooldown) || 0),
            }),
            () => `Signal subscription '${name}' added`,
        ).then(() => {
            setName("");
            setEventTypes("");
            setMinimumSeverity("");
            setCooldown("0");
        });
    };

    return (
        <section aria-label={`Signal triggers for ${workflow.title}`} className="space-y-2" data-testid={`signal-triggers-${workflow.id}`}>
            <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Signal triggers</h4>
            {subs.length === 0 ? (
                <p className="text-xs text-muted-foreground">No signal triggers — a matching signal starts nothing yet.</p>
            ) : (
                <ul className="divide-y rounded-md border">
                    {subs.map((sub: any) => (
                        <li key={sub.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                            <span>
                                <span className="font-medium">{sub.name}</span>
                                <span className="text-xs text-muted-foreground">
                                    {sub.filters?.eventTypes?.length ? ` · ${sub.filters.eventTypes.join(", ")}` : " · any event"}
                                    {sub.filters?.minimumSeverity ? ` · ≥ ${sub.filters.minimumSeverity}` : ""}
                                </span>
                            </span>
                            {canEdit && (
                                <span className="flex items-center gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-xs"
                                        onClick={() =>
                                            onAction(
                                                () => apiRequest("PATCH", `/api/workflows/${workflow.id}/signal-subscriptions/${sub.id}`, { enabled: !sub.enabled }),
                                                () => sub.enabled ? `'${sub.name}' disabled` : `'${sub.name}' enabled`,
                                            )
                                        }
                                    >
                                        {sub.enabled ? "Disable" : "Enable"}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-xs text-destructive"
                                        onClick={() =>
                                            onAction(
                                                () => apiRequest("DELETE", `/api/workflows/${workflow.id}/signal-subscriptions/${sub.id}`),
                                                () => `'${sub.name}' removed`,
                                            )
                                        }
                                    >
                                        Delete
                                    </Button>
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {canEdit && (
                <div className="flex flex-wrap items-end gap-2 rounded-md border p-3" data-testid={`signal-subscription-form-${workflow.id}`}>
                    <label className="text-xs">
                        <span className="sr-only">Subscription name</span>
                        <input
                            className="h-8 w-40 rounded-md border border-input bg-background px-2 text-sm"
                            placeholder="Name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </label>
                    <label className="text-xs">
                        <span className="sr-only">Event types, comma-separated</span>
                        <input
                            className="h-8 w-44 rounded-md border border-input bg-background px-2 text-sm"
                            placeholder="event.type, other.type"
                            value={eventTypes}
                            onChange={(e) => setEventTypes(e.target.value)}
                        />
                    </label>
                    <label className="text-xs">
                        <span className="sr-only">Minimum severity</span>
                        <select
                            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                            value={minimumSeverity}
                            onChange={(e) => setMinimumSeverity(e.target.value)}
                        >
                            <option value="">Any severity</option>
                            {SIGNAL_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </label>
                    <label className="text-xs">
                        <span className="sr-only">Cooldown minutes</span>
                        <input
                            className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm"
                            type="number"
                            min={0}
                            placeholder="Cooldown"
                            value={cooldown}
                            onChange={(e) => setCooldown(e.target.value)}
                        />
                    </label>
                    <Button type="button" size="sm" variant="outline" disabled={!name.trim()} onClick={add}>
                        Add trigger
                    </Button>
                </div>
            )}

            {lastDeliveries.length > 0 && (
                <ul className="divide-y rounded-md border">
                    {lastDeliveries.map((d: any) => (
                        <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                            <span className="text-xs text-muted-foreground">
                                {d.payload?.eventType ?? "signal"}
                                {d.deliveredAt && ` · ${formatDistanceToNow(new Date(d.deliveredAt), { addSuffix: true })}`}
                            </span>
                            <span className="flex items-center gap-2">
                                <Badge variant="outline" className="font-mono text-[11px]">{d.disposition}</Badge>
                                {d.pipelineExecutionId != null && (
                                    <Link href={executionPath(d.pipelineExecutionId)} className="text-xs text-primary hover:underline">
                                        run #{d.pipelineExecutionId}
                                    </Link>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function WorkflowCard({
    workflow,
    pipelineNames,
    canEdit,
    canOperate,
    onAction,
}: {
    workflow: any;
    pipelineNames: Map<number, string>;
    canEdit: boolean;
    canOperate: boolean;
    onAction: (fn: WorkflowAction, success: WorkflowToast) => Promise<void>;
}) {
    const [expanded, setExpanded] = useState(false);
    const detail = useWorkflowDetail(workflow.id);
    const runs = useWorkflowRuns(expanded ? workflow.id : null);

    const releases = detail.data?.releases ?? [];
    const deployments = detail.data?.deployments ?? [];
    const latest = releases[0] ?? null;
    const production = productionDeployment(deployments);
    const latestIsActive = production?.status === "active" && production.releaseId === latest?.id;
    const releaseById = new Map(releases.map((r: any) => [r.id, r]));

    return (
        <Card data-testid={`project-workflow-${workflow.id}`}>
            <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-foreground">{workflow.title}</div>
                        {workflow.description && (
                            <div className="truncate text-xs text-muted-foreground">{workflow.description}</div>
                        )}
                        <Link
                            href={workstreamPath(workflow.draftPipelineId)}
                            className="text-xs text-primary hover:underline"
                            data-testid={`workflow-draft-link-${workflow.id}`}
                        >
                            Draft: {pipelineNames.get(workflow.draftPipelineId) ?? `workstream #${workflow.draftPipelineId}`}
                        </Link>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                        {latest
                            ? <Badge variant="secondary">v{latest.releaseNumber}</Badge>
                            : <Badge variant="outline">No release</Badge>}
                        <Badge
                            variant={production?.status === "active" ? "default" : "outline"}
                            className="text-[10px]"
                        >
                            {deploymentLabel(production, releases)}
                        </Badge>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {canEdit && (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                                onAction(
                                    () => apiRequest("POST", `/api/workflows/${workflow.id}/releases`, {}),
                                    (data) => data?.unchanged
                                        ? `Nothing changed since v${data?.release?.releaseNumber ?? latest?.releaseNumber ?? "?"}`
                                        : `Release v${data?.release?.releaseNumber ?? "?"} published`,
                                )
                            }
                        >
                            Publish release
                        </Button>
                    )}
                    {canOperate && (
                        <>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={!latest || latestIsActive}
                                onClick={() =>
                                    onAction(
                                        () => apiRequest("POST", `/api/workflows/${workflow.id}/deployments/activate`, { releaseId: latest.id }),
                                        () => `v${latest?.releaseNumber} is live in production`,
                                    )
                                }
                            >
                                Activate latest
                            </Button>
                            {production?.status === "active" && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                        onAction(
                                            () => apiRequest("POST", `/api/workflows/${workflow.id}/deployments/${production.id}/pause`, {}),
                                            () => "Production deployment paused",
                                        )
                                    }
                                >
                                    Pause
                                </Button>
                            )}
                            {production?.status === "paused" && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                        onAction(
                                            () => apiRequest("POST", `/api/workflows/${workflow.id}/deployments/${production.id}/resume`, {}),
                                            () => "Production deployment resumed",
                                        )
                                    }
                                >
                                    Resume
                                </Button>
                            )}
                            <Button
                                type="button"
                                size="sm"
                                disabled={production?.status !== "active"}
                                title={production?.status === "active" ? "Run the production release now" : "Activate a release before running"}
                                onClick={() =>
                                    onAction(
                                        () => apiRequest("POST", `/api/workflows/${workflow.id}/runs`, {}),
                                        (data) => `Run ${data?.executionId ?? "?"} started`,
                                    )
                                }
                            >
                                <Play className="mr-1 h-3.5 w-3.5" aria-hidden />Run now
                            </Button>
                        </>
                    )}
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-expanded={expanded}
                        aria-label={`Releases and runs for ${workflow.title}`}
                        onClick={() => setExpanded((v) => !v)}
                    >
                        {expanded ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                    </Button>
                </div>

                {expanded && (
                    <div className="space-y-3 border-t pt-3">
                        <section aria-label={`Releases for ${workflow.title}`} className="space-y-1">
                            <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Releases</h4>
                            {releases.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No releases yet — publish one to snapshot the draft.</p>
                            ) : (
                                <ul className="divide-y rounded-md border">
                                    {releases.map((release: any) => (
                                        <li key={release.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                                            <span>
                                                <span className="font-medium">v{release.releaseNumber}</span>
                                                <span className="font-mono text-xs text-muted-foreground"> · {String(release.digest ?? "").slice(0, 8)}</span>
                                                {release.description && <span className="text-muted-foreground"> · {release.description}</span>}
                                            </span>
                                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                                {formatDistanceToNow(new Date(release.createdAt), { addSuffix: true })}
                                                {canOperate && release.id !== production?.releaseId && (
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-7 px-2 text-xs"
                                                        onClick={() =>
                                                            onAction(
                                                                () => apiRequest("POST", `/api/workflows/${workflow.id}/deployments/activate`, { releaseId: release.id }),
                                                                () => `v${release.releaseNumber} is live in production`,
                                                            )
                                                        }
                                                    >
                                                        Activate this
                                                    </Button>
                                                )}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        <section aria-label={`Recent runs for ${workflow.title}`} className="space-y-1">
                            <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Recent runs</h4>
                            {(runs.data ?? []).length === 0 ? (
                                <p className="text-xs text-muted-foreground">No runs yet.</p>
                            ) : (
                                <ul className="divide-y rounded-md border">
                                    {(runs.data ?? []).map((run: any) => {
                                        const release = run.workflowReleaseId != null ? releaseById.get(run.workflowReleaseId) : null;
                                        return (
                                            <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                                                <Link href={executionPath(run.id)} className="text-primary hover:underline" data-testid={`workflow-run-link-${run.id}`}>
                                                    Run #{run.id}
                                                </Link>
                                                <span className="flex items-center gap-2">
                                                    <Badge variant="outline" className="font-mono text-[11px]">{run.status}</Badge>
                                                    <span className="text-xs text-muted-foreground">
                                                        {release ? `v${release.releaseNumber}` : "draft"}
                                                        {run.startedAt && ` · ${formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}`}
                                                    </span>
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </section>

                        <SignalTriggersSection
                            workflow={workflow}
                            canEdit={canEdit}
                            onAction={onAction}
                        />
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export function ProjectWorkflowsTab({
    projectKey,
    projectId,
    role,
}: {
    projectKey: string;
    projectId: number;
    role: string | null | undefined;
}) {
    const canEdit = roleAtLeast(role, "editor");
    const canOperate = roleAtLeast(role, "operator");
    const { data: workflows, isLoading } = useProjectWorkflows(projectId);
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const [adding, setAdding] = useState("");

    const pipelines = useQuery<PipelineOption[]>({
        queryKey: ["/api/pipelines", "workflow-picker"],
        queryFn: async () => (await apiRequest("GET", "/api/pipelines")).json(),
        enabled: canEdit,
    });

    const pipelineNames = new Map<number, string>((pipelines.data ?? []).map((p) => [p.id, p.name]));
    const registered = new Set((workflows ?? []).map((w: any) => w.draftPipelineId));
    const addable = (pipelines.data ?? []).filter((p) => !registered.has(p.id));

    const refresh = () =>
        queryClient.invalidateQueries({
            predicate: (query) => String(query.queryKey[0] ?? "").startsWith("/api/workflows"),
        });

    const runAction = async (fn: WorkflowAction, success: WorkflowToast) => {
        try {
            const res = await fn();
            const data = await res.json().catch(() => null);
            await refresh();
            toast({ title: success(data) });
        } catch (error) {
            toast({ title: "Workflow action failed", description: (error as Error).message, variant: "destructive" });
        }
    };

    const add = async () => {
        const pipelineId = Number(adding);
        if (!pipelineId) return;
        try {
            await apiRequest("POST", "/api/workflows", { pipelineId, projectId });
            setAdding("");
            await refresh();
            toast({ title: "Workflow added to the project" });
        } catch (error) {
            toast({ title: "The workflow was not added", description: (error as Error).message, variant: "destructive" });
        }
    };

    if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;

    return (
        <div className="space-y-6" data-testid="project-workflows-tab">
            {canEdit && (
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <label htmlFor="project-add-workflow" className="sr-only">Workstream to register as a workflow</label>
                        <select
                            id="project-add-workflow"
                            className="h-9 min-w-48 rounded-md border border-input bg-background px-2 text-sm"
                            value={adding}
                            onChange={(e) => setAdding(e.target.value)}
                        >
                            <option value="">Add workflow from workstream…</option>
                            {addable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <Button type="button" size="sm" variant="outline" disabled={!adding} onClick={add}>Add</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        A workflow is a workstream published as immutable releases. Create the workstream in Flow Studio
                        (or from a CREW room), then publish and activate it here.
                    </p>
                </div>
            )}

            {(workflows ?? []).length === 0 ? (
                <Card>
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">
                        No workflows belong to this project yet.
                    </CardContent>
                </Card>
            ) : (
                <section aria-label="Workflows" className="space-y-2">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                        <WorkflowIcon className="h-4 w-4 text-primary" aria-hidden />
                        Workflows <span className="text-muted-foreground">({workflows!.length})</span>
                    </h3>
                    <div className="space-y-3">
                        {workflows!.map((workflow: any) => (
                            <WorkflowCard
                                key={workflow.id}
                                workflow={workflow}
                                pipelineNames={pipelineNames}
                                canEdit={canEdit}
                                canOperate={canOperate}
                                onAction={runAction}
                            />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
