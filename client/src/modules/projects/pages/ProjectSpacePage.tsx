import React, { useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import {
    Activity,
    ArrowLeft,
    Bot,
    BookOpen,
    MessagesSquare,
    CalendarClock,
    CircleAlert,
    Clapperboard,
    ClipboardList,
    Database,
    FileText,
    FolderKanban,
    Gauge,
    Globe,
    LayoutGrid,
    Loader2,
    Lock,
    Network,
    Settings,
    ShieldCheck,
    Paperclip,
    Plug,
    Sparkles,
    Trash2,
    UserPlus,
    Users,
    Wallet,
    Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
    useProject,
    useProjectCycles,
    useProjectMissions,
    useProjectApps,
    useProjectKnowledge,
    useProjectRooms,
    useProjectActivity,
    useProjectEvents,
    useCreateProjectEvent,
    useDeleteProjectEvent,
    useProjectMembers,
    useProjectMemberCandidates,
    useAddProjectMember,
    useRemoveProjectMember,
    useUpdateProject,
    useArchiveProject,
    formatUsd,
    roleAtLeast,
    PROJECT_ROLES,
    ROLE_BLURB,
    type ProjectRole,
    type ProjectSpend,
    type ProjectSummary,
    type ProjectEvent,
} from "../hooks/use-projects";
import { ProjectTimeline, relativeDay, type TimelineView } from "../components/ProjectTimeline";
import { ProjectSpaceHeader } from "../components/ProjectSpaceHeader";
import { ProjectRoomsTab } from "../components/ProjectRoomsTab";
import { ProjectIntegrationsTab } from "../components/ProjectIntegrationsTab";
import { ProjectFilesTab } from "../components/ProjectFilesTab";
import { ProjectFormsTab } from "../components/ProjectFormsTab";
import { ProjectMediaTab } from "../components/ProjectMediaTab";
import { ProjectWorkflowsTab } from "../components/ProjectWorkflowsTab";
import CronExpressionBuilder from "@domain-ui/core/ui/components/shared/CronExpressionBuilder";
import cronstrue from "cronstrue";

/**
 * A single Project Space (docs/PROJECT_SPACES_DESIGN.md §7).
 *
 * The project key is a URL namespace: the tab is a path segment
 * (`/projects/rescue-dispatch/cycles`) and resources reached through the project keep
 * it in their path (`/projects/rescue-dispatch/cycles/95`). The spec's §7 warning
 * about `:rest*` matching only one trailing segment applies to routes delegated
 * through CoreRouting — these are registered directly in OperationsRouting, which is
 * mounted at the SPA root and already serves 6-segment routes.
 *
 * `?tab=` is still honoured so links minted before the switch keep working.
 */

const TABS = [
    { id: "overview", label: "Overview", icon: Gauge },
    { id: "timeline", label: "Timeline", icon: CalendarClock },
    { id: "cycles", label: "Cycles", icon: CalendarClock },
    { id: "work", label: "Work", icon: Network },
    { id: "workflows", label: "Workflows", icon: Workflow },
    { id: "apps", label: "Apps", icon: LayoutGrid },
    { id: "knowledge", label: "Knowledge", icon: BookOpen },
    { id: "forms", label: "Forms", icon: ClipboardList },
    { id: "media", label: "Media", icon: Clapperboard },
    { id: "files", label: "Files", icon: Paperclip },
    { id: "integrations", label: "Integrations", icon: Plug },
    { id: "rooms", label: "Rooms", icon: MessagesSquare },
    { id: "activity", label: "Activity", icon: Activity },
    { id: "members", label: "Members", icon: Users },
    { id: "settings", label: "Settings", icon: Settings },
] as const;

type TabId = typeof TABS[number]["id"];

function useTab(projectKey: string | undefined): [TabId, (tab: TabId) => void] {
    const search = useSearch();
    const params = useParams();
    const [, setLocation] = useLocation();

    // Path segment wins; the legacy ?tab= form is the fallback.
    const fromPath = TABS.find((t) => t.id === params?.tab)?.id;
    const fromQuery = TABS.find((t) => t.id === new URLSearchParams(search).get("tab"))?.id;
    const tab = (fromPath ?? fromQuery ?? "overview") as TabId;

    const setTab = (next: TabId) => {
        const base = `/projects/${projectKey}`;
        setLocation(next === "overview" ? base : `${base}/${next}`);
    };

    return [tab, setTab];
}

function StatTile({
    label,
    value,
    hint,
    tone,
}: {
    label: string;
    value: React.ReactNode;
    hint?: string;
    tone?: string;
}) {
    return (
        <Card>
            <CardContent className="p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
                <div className={cn("mt-1 text-2xl font-black text-foreground", tone)}>{value}</div>
                {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
            </CardContent>
        </Card>
    );
}

function BudgetCard({ spend }: { spend: ProjectSpend }) {
    const { budgetLimitUsd, spendToDateUsd } = spend;
    const pct = budgetLimitUsd && budgetLimitUsd > 0
        ? Math.min(100, (spendToDateUsd / budgetLimitUsd) * 100)
        : null;

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                    <Wallet className="h-4 w-4 text-primary" />
                    Spend to date
                </CardTitle>
                <CardDescription>
                    Rolled up from this project's cycles. Cycle budgets remain the execution guardrail.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-black text-foreground">{formatUsd(spendToDateUsd)}</span>
                    <span className="text-sm text-muted-foreground">
                        {budgetLimitUsd === null ? "No project limit — inherits org policy" : `of ${formatUsd(budgetLimitUsd)}`}
                    </span>
                </div>
                {pct !== null && (
                    <>
                        <Progress value={pct} className="h-2" />
                        <div className="text-xs text-muted-foreground">
                            {spend.remainingUsd !== null && spend.remainingUsd >= 0
                                ? `${formatUsd(spend.remainingUsd)} remaining`
                                : `Over budget by ${formatUsd(Math.abs(spend.remainingUsd ?? 0))}`}
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function OverviewTab({ project, spend }: { project: ProjectSummary; spend: ProjectSpend }) {
    return (
        <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
                <StatTile label="Cycles" value={spend.cycleCount} hint="Iterations in this project" />
                <StatTile label="Active now" value={spend.activeCycleCount} hint="Currently executing" />
                <StatTile
                    label="Status"
                    value={<span className="capitalize">{project.status}</span>}
                    hint={project.visibility === "private" ? "Visible to members only" : "Visible org-wide"}
                />
            </div>

            <BudgetCard spend={spend} />

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Objective</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <p>{project.objective || "No objective set for this project."}</p>
                    {project.description && (
                        <p className="border-t border-border pt-3">{project.description}</p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

/**
 * Plain-English rendering of a cron rule, via cronstrue — the same library the
 * scheduler pages use, so "Every Monday at 09:00" reads identically wherever a
 * recurrence appears.
 */
function describeRecurrence(expression: string): string {
    try {
        return cronstrue.toString(expression, { verbose: false });
    } catch {
        // The builder can hold a half-typed expression mid-edit; saying so beats
        // showing a raw parser error under an input someone is still using.
        return "Not a valid schedule yet";
    }
}

/**
 * The authored half of the project's timeline — deadlines, launches, milestones
 * that the platform cannot observe for itself.
 *
 * Anything added here is immediately referenceable by agents through the
 * ontology and used to prime a cold crew room in this project, so the composer
 * is deliberately at the top: adding is the primary action, not an afterthought
 * behind a dialog.
 */
function TimelineTab({ projectKey }: { projectKey: string }) {
    const { toast } = useToast();
    const { data, isLoading } = useProjectEvents(projectKey);
    const createEvent = useCreateProjectEvent(projectKey);
    const deleteEvent = useDeleteProjectEvent(projectKey);

    const [view, setView] = useState<TimelineView>("agenda");
    const [selected, setSelected] = useState<ProjectEvent | null>(null);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [kind, setKind] = useState<ProjectEvent["kind"]>("milestone");
    const [severity, setSeverity] = useState<ProjectEvent["severity"]>("Medium");
    const [startsAt, setStartsAt] = useState("");
    const [repeats, setRepeats] = useState(false);
    const [recurrence, setRecurrence] = useState("0 9 * * 1");

    const events = data?.events ?? [];

    const submit = async () => {
        if (!title.trim() || !startsAt) return;
        try {
            await createEvent.mutateAsync({
                title: title.trim(),
                description: description.trim() || null,
                kind,
                severity,
                // The input is local wall-clock; the API takes an instant.
                startsAt: new Date(startsAt).toISOString(),
                recurrence: repeats ? recurrence : null,
            });
            setTitle("");
            setDescription("");
            setStartsAt("");
            setRepeats(false);
            toast({ title: "Added to the timeline", description: "The crew can now refer to it." });
        } catch (e) {
            toast({
                title: "That didn't work",
                description: e instanceof Error ? e.message : String(e),
                variant: "destructive",
            });
        }
    };

    const remove = async (event: ProjectEvent) => {
        try {
            await deleteEvent.mutateAsync(event.id);
            setSelected(null);
        } catch (e) {
            toast({
                title: "Could not remove it",
                description: e instanceof Error ? e.message : String(e),
                variant: "destructive",
            });
        }
    };

    if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Add to the timeline</CardTitle>
                    <CardDescription className="text-xs">
                        Deadlines, launches and commitments the platform cannot see for itself. Agents in
                        this project can refer to anything you add.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="event-title" className="text-xs">What is happening</Label>
                            <Input
                                id="event-title"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="EU AI Act compliance deadline"
                                data-testid="event-title"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="event-date" className="text-xs">When</Label>
                            <Input
                                id="event-date"
                                type="datetime-local"
                                value={startsAt}
                                onChange={(e) => setStartsAt(e.target.value)}
                                data-testid="event-date"
                            />
                        </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Kind</Label>
                            <Select value={kind} onValueChange={(v) => setKind(v as ProjectEvent["kind"])}>
                                <SelectTrigger data-testid="event-kind"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {["deadline", "milestone", "launch", "incident", "note"].map((k) => (
                                        <SelectItem key={k} value={k} className="capitalize">{k}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs">Severity</Label>
                            <Select value={severity} onValueChange={(v) => setSeverity(v as ProjectEvent["severity"])}>
                                <SelectTrigger data-testid="event-severity"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {["Low", "Medium", "High", "Critical"].map((s) => (
                                        <SelectItem key={s} value={s}>{s}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="event-notes" className="text-xs">Context for the crew (optional)</Label>
                        <Textarea
                            id="event-notes"
                            rows={2}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="What has to be true by then, and who depends on it."
                            data-testid="event-description"
                        />
                    </div>

                    <div className="space-y-2 rounded-lg border border-border/60 p-3">
                        <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                            <input
                                type="checkbox"
                                checked={repeats}
                                onChange={(e) => setRepeats(e.target.checked)}
                                className="h-3.5 w-3.5 accent-primary"
                                data-testid="event-repeats"
                            />
                            Repeats
                        </label>

                        {repeats && (
                            <div className="space-y-2">
                                {/* The platform's existing cron builder rather than a raw
                                    text field — it already handles presets, validation and
                                    the awkward parts of cron, and reusing it means one
                                    recurrence vocabulary across schedules and timelines. */}
                                <CronExpressionBuilder
                                    value={recurrence}
                                    onChange={setRecurrence}
                                    testIdPrefix="event-cron"
                                />
                                <p className="text-[11px] text-muted-foreground" data-testid="event-cron-summary">
                                    {describeRecurrence(recurrence)}
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end">
                        <Button
                            onClick={submit}
                            disabled={!title.trim() || !startsAt || createEvent.isPending}
                            size="sm"
                            data-testid="event-submit"
                        >
                            Add event
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <ProjectTimeline
                events={events}
                view={view}
                onViewChange={setView}
                onSelect={setSelected}
            />

            {selected && (
                <Card data-testid="event-detail">
                    <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <CardTitle className="text-sm">{selected.title}</CardTitle>
                                <CardDescription className="text-xs">
                                    <span className="capitalize">{selected.kind}</span>
                                    {" · "}{selected.severity}
                                    {" · "}{relativeDay(new Date(selected.startsAt))}
                                </CardDescription>
                            </div>
                            <div className="flex shrink-0 gap-1">
                                <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                                    Close
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive"
                                    onClick={() => remove(selected)}
                                    data-testid="event-delete"
                                >
                                    Remove
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    {selected.description && (
                        <CardContent className="pt-0 text-xs text-muted-foreground">
                            {selected.description}
                        </CardContent>
                    )}
                </Card>
            )}
        </div>
    );
}

function CyclesTab({ projectKey }: { projectKey: string }) {
    const { data, isLoading } = useProjectCycles(projectKey);
    const cycles = data?.cycles ?? [];

    if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;

    if (cycles.length === 0) {
        return (
            <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    No cycles in this project yet.
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-2" data-testid="project-cycles-list">
            {cycles.map((cycle: any) => (
                <Link key={cycle.id} href={`/projects/${projectKey}/cycles/${cycle.id}`}>
                    <Card className="cursor-pointer transition-colors hover:border-primary/40">
                        <CardContent className="flex items-center justify-between gap-4 p-4">
                            <div className="min-w-0">
                                <div className="truncate font-bold text-foreground">{cycle.name}</div>
                                <div className="truncate text-xs text-muted-foreground">
                                    {cycle.objective || "No objective"}
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                                <span className="text-xs text-muted-foreground">
                                    {formatUsd(cycle.currentSpendUsd)}
                                </span>
                                <Badge variant="secondary" className="capitalize">
                                    {String(cycle.status ?? "").replace(/_/g, " ")}
                                </Badge>
                            </div>
                        </CardContent>
                    </Card>
                </Link>
            ))}
        </div>
    );
}

function WorkTab({ projectKey }: { projectKey: string }) {
    const { data, isLoading } = useProjectMissions(projectKey);
    const missions = data?.missions ?? [];

    if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;

    if (missions.length === 0) {
        return (
            <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    No missions attached to this project yet.
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-2" data-testid="project-missions-list">
            {missions.map((mission: any) => (
                <Link key={mission.id} href={`/projects/${projectKey}/missions/${mission.id}`}>
                    <Card className="cursor-pointer transition-colors hover:border-primary/40">
                        <CardContent className="flex items-center justify-between gap-4 p-4">
                            <div className="min-w-0">
                                <div className="truncate font-bold text-foreground">{mission.name}</div>
                                <div className="truncate text-xs text-muted-foreground">
                                    {mission.description || mission.type}
                                </div>
                            </div>
                            <Badge variant="secondary" className="shrink-0 capitalize">
                                {String(mission.status ?? "").replace(/_/g, " ")}
                            </Badge>
                        </CardContent>
                    </Card>
                </Link>
            ))}
        </div>
    );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
    return (
        <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">{children}</CardContent>
        </Card>
    );
}

/**
 * Apps produced by this project. Clicking a card opens that app's detail page, which
 * is where its deployments, publish state and launch actions live. This matches what
 * App Marketplace and App Forge already do when an app is clicked.
 *
 * These are plain anchors rather than wouter <Link>s because the jump crosses an SPA
 * boundary: the project space is served by operations.html and /armory/* by
 * armory.html. Client-side routing cannot cross a bundle boundary — OperationsRouting
 * only catches the miss with a window.location.reload() failsafe — so a real
 * navigation is both correct and more direct.
 */
export function AppsTab({ projectKey }: { projectKey: string }) {
    const { data, isLoading } = useProjectApps(projectKey);
    const apps = data?.apps ?? [];

    if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;
    if (apps.length === 0) return <EmptyCard>No apps have been produced by this project yet.</EmptyCard>;

    return (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="project-apps-list">
            {apps.map((app: any) => (
                <a
                    key={app.id}
                    href={`/armory/apps/${app.id}`}
                    title={`Open ${app.name}`}
                    data-testid={`project-app-link-${app.id}`}
                >
                    <Card className="h-full cursor-pointer transition-colors hover:border-primary/40">
                        <CardContent className="flex items-start justify-between gap-3 p-4">
                            <div className="min-w-0">
                                <div className="truncate font-bold text-foreground">{app.name}</div>
                                <div className="truncate font-mono text-[11px] text-muted-foreground">{app.slug}</div>
                                {app.description && (
                                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{app.description}</p>
                                )}
                            </div>
                            <Badge variant="secondary" className="shrink-0 capitalize">{app.status}</Badge>
                        </CardContent>
                    </Card>
                </a>
            ))}
        </div>
    );
}

/**
 * Crew discussion rooms scoped to this Project Space.
 *
 * A room binds to its project the first time a round runs inside it, so this
 * lists what the project has actually discussed. Opening a room from here keeps
 * the project context — knowledge written back from the discussion stays scoped
 * to this space.
 */
function RoomsTab({ projectKey }: { projectKey: string }) {
    return <ProjectRoomsTab projectKey={projectKey} />;
}

function KnowledgeTab({ projectKey }: { projectKey: string }) {
    const { data, isLoading } = useProjectKnowledge(projectKey);
    const datasets = data?.datasets ?? [];
    const documents = data?.documents ?? [];

    if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;
    if (datasets.length === 0 && documents.length === 0) {
        return <EmptyCard>No datasets or documents are scoped to this project yet.</EmptyCard>;
    }

    return (
        <div className="space-y-6" data-testid="project-knowledge-list">
            <p className="text-xs text-muted-foreground">
                This is also the retrieval boundary — the copilot answers from this set while the project is active.
            </p>

            {datasets.length > 0 && (
                <div className="space-y-2">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                        <Database className="h-4 w-4 text-primary" />
                        Datasets <span className="text-muted-foreground">({datasets.length})</span>
                    </h3>
                    {datasets.map((ds: any) => (
                        <Card key={ds.id}>
                            <CardContent className="p-3">
                                <div className="truncate text-sm font-bold text-foreground">{ds.name}</div>
                                {ds.description && (
                                    <div className="truncate text-xs text-muted-foreground">{ds.description}</div>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {documents.length > 0 && (
                <div className="space-y-2">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                        <FileText className="h-4 w-4 text-primary" />
                        Documents <span className="text-muted-foreground">({documents.length})</span>
                    </h3>
                    {documents.slice(0, 50).map((doc: any) => (
                        <Card key={doc.id}>
                            <CardContent className="p-3">
                                <div className="truncate text-sm font-bold text-foreground">{doc.title}</div>
                                {doc.summary && (
                                    <div className="truncate text-xs text-muted-foreground">{doc.summary}</div>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}

function ActivityTab({ projectKey }: { projectKey: string }) {
    const { data, isLoading } = useProjectActivity(projectKey);
    const events = data?.events ?? [];

    if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;
    if (events.length === 0) return <EmptyCard>No execution activity recorded for this project's cycles yet.</EmptyCard>;

    return (
        <div className="space-y-2" data-testid="project-activity-list">
            {events.map((evt: any) => {
                const failed = /FAIL|ERROR/i.test(String(evt.eventType ?? "")) || !!evt.error;
                return (
                    <Card key={evt.id}>
                        <CardContent className="flex items-start justify-between gap-3 p-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    {failed && <CircleAlert className="h-3.5 w-3.5 shrink-0 text-red-500" />}
                                    <span className="truncate text-sm font-bold text-foreground">
                                        {String(evt.eventType ?? "").replace(/_/g, " ")}
                                    </span>
                                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                                        {evt.stepCode}
                                    </span>
                                </div>
                                <div className="truncate text-xs text-muted-foreground">
                                    {evt.cycleName}
                                    {evt.agentId ? ` · ${evt.agentId}` : ""}
                                    {evt.error ? ` · ${evt.error}` : ""}
                                </div>
                            </div>
                            <div className="shrink-0 text-right">
                                <div className="text-[11px] text-muted-foreground">
                                    {evt.timestamp ? new Date(evt.timestamp).toLocaleString() : ""}
                                </div>
                                {typeof evt.durationMs === "number" && (
                                    <div className="text-[10px] text-muted-foreground">{evt.durationMs} ms</div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}

function RoleSelect({
    value,
    onChange,
    disabled,
    testId,
}: {
    value: ProjectRole;
    onChange: (role: ProjectRole) => void;
    disabled?: boolean;
    testId?: string;
}) {
    return (
        <Select value={value} onValueChange={(v) => onChange(v as ProjectRole)} disabled={disabled}>
            <SelectTrigger className="h-8 w-32 text-xs" data-testid={testId}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {[...PROJECT_ROLES].reverse().map((r) => (
                    <SelectItem key={r} value={r}>
                        <span className="capitalize">{r}</span>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

/**
 * Members — §8's roles, which until now existed only as tables and an API. Roles are
 * ADDITIVE: everyone in the org can already read an `org`-visible project, so this
 * grants the ability to change things, and on a `private` project it grants the
 * ability to see it at all.
 */
function MembersTab({ projectKey, project }: { projectKey: string; project: ProjectSummary }) {
    const { toast } = useToast();
    const { data, isLoading } = useProjectMembers(projectKey);
    const members = data?.members ?? [];
    const canManage = roleAtLeast(data?.role, "owner");

    const { data: candidates } = useProjectMemberCandidates(projectKey, canManage);
    const addMember = useAddProjectMember(projectKey);
    const removeMember = useRemoveProjectMember(projectKey);

    const [principalType, setPrincipalType] = useState<"user" | "agent">("user");
    const [principalId, setPrincipalId] = useState<string>("");
    const [role, setRole] = useState<ProjectRole>("editor");

    const pool = principalType === "user" ? candidates?.users ?? [] : candidates?.agents ?? [];

    const fail = (e: unknown) =>
        toast({
            title: "That didn't work",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
        });

    const submit = async () => {
        if (!principalId) return;
        try {
            await addMember.mutateAsync({ principalType, principalId, role });
            setPrincipalId("");
            toast({ title: `Added to ${project.name}`, description: `Granted the ${role} role.` });
        } catch (e) {
            fail(e);
        }
    };

    const changeRole = async (member: typeof members[number], next: ProjectRole) => {
        try {
            // The server upserts on (project, principal), so a re-add IS a role change.
            await addMember.mutateAsync({
                principalType: member.principalType,
                principalId: member.principalId,
                role: next,
            });
        } catch (e) {
            fail(e);
        }
    };

    const remove = async (member: typeof members[number]) => {
        try {
            await removeMember.mutateAsync({
                principalType: member.principalType,
                principalId: member.principalId,
            });
        } catch (e) {
            fail(e);
        }
    };

    if (isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;

    return (
        <div className="space-y-4" data-testid="project-members">
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Access</CardTitle>
                    <CardDescription>
                        {project.visibility === "private"
                            ? "This project is private — only the people and agents listed here can see it. Org admins always can."
                            : "Everyone in the organization can already read this project. A role here grants the ability to change it."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {members.length === 0 && (
                        <p className="py-4 text-center text-sm text-muted-foreground">
                            No explicit members. Org admins retain full access.
                        </p>
                    )}
                    {members.map((member) => {
                        const Icon = member.principalType === "agent" ? Bot : Users;
                        return (
                            <div
                                key={`${member.principalType}:${member.principalId}`}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                                data-testid={`project-member-${member.principalType}`}
                            >
                                <div className="flex min-w-0 items-center gap-3">
                                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-sm font-bold text-foreground">
                                                {member.displayName}
                                            </span>
                                            {member.isProjectOwner && (
                                                <Badge variant="outline" className="text-[10px]">Creator</Badge>
                                            )}
                                            {member.principalType === "agent" && (
                                                <Badge variant="secondary" className="text-[10px]">Agent</Badge>
                                            )}
                                        </div>
                                        {member.secondary && (
                                            <div className="truncate text-xs text-muted-foreground">{member.secondary}</div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    {canManage && !member.implicit ? (
                                        <RoleSelect
                                            value={member.role}
                                            onChange={(next) => changeRole(member, next)}
                                            disabled={addMember.isPending}
                                        />
                                    ) : (
                                        <Badge variant="secondary" className="capitalize">{member.role}</Badge>
                                    )}
                                    {canManage && !member.implicit && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => remove(member)}
                                            disabled={removeMember.isPending}
                                            aria-label={`Remove ${member.displayName}`}
                                            data-testid="project-member-remove"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </CardContent>
            </Card>

            {canManage && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-sm">
                            <UserPlus className="h-4 w-4 text-primary" />
                            Grant access
                        </CardTitle>
                        <CardDescription>{ROLE_BLURB[role]}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1">
                            <Label className="text-xs">Principal</Label>
                            <Select
                                value={principalType}
                                onValueChange={(v) => {
                                    setPrincipalType(v as "user" | "agent");
                                    setPrincipalId("");
                                }}
                            >
                                <SelectTrigger className="h-9 w-28 text-xs" data-testid="member-principal-type">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="user">Person</SelectItem>
                                    <SelectItem value="agent">Agent</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="min-w-[14rem] flex-1 space-y-1">
                            <Label className="text-xs">
                                {principalType === "user" ? "Who" : "Which agent"}
                            </Label>
                            <Select value={principalId} onValueChange={setPrincipalId} disabled={pool.length === 0}>
                                <SelectTrigger className="h-9 text-xs" data-testid="member-principal-select">
                                    <SelectValue
                                        placeholder={
                                            pool.length === 0
                                                ? principalType === "user"
                                                    ? "Everyone in this org is already a member"
                                                    : "No agents available in this org"
                                                : "Select…"
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    {pool.map((c) => (
                                        <SelectItem key={c.principalId} value={c.principalId}>
                                            {c.displayName}
                                            {c.secondary ? ` — ${c.secondary}` : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1">
                            <Label className="text-xs">Role</Label>
                            <RoleSelect value={role} onChange={setRole} testId="member-role-select" />
                        </div>

                        <Button onClick={submit} disabled={!principalId || addMember.isPending} data-testid="member-add-submit">
                            {addMember.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Add
                        </Button>
                    </CardContent>
                    {principalType === "agent" && (
                        <CardContent className="pt-0">
                            <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                                Giving an agent a role also <span className="font-bold">confines</span> it: an agent with no
                                grants anywhere reaches the whole org as it does today, but the moment it holds one, it can
                                only work inside the projects it was granted — and never above the role it was given, even
                                when an admin asks.
                            </p>
                        </CardContent>
                    )}
                </Card>
            )}
        </div>
    );
}

/**
 * Settings — the project fields the API has always accepted and nothing could set.
 * Visibility is the load-bearing one: until it can be turned to `private`, every role
 * on the Members tab is decorative.
 */
function SettingsTab({
    projectKey,
    project,
    role,
}: {
    projectKey: string;
    project: ProjectSummary;
    role: string | null;
}) {
    const { toast } = useToast();
    const canEdit = roleAtLeast(role, "editor");
    const canOwn = roleAtLeast(role, "owner");

    const update = useUpdateProject(projectKey);
    const archive = useArchiveProject(projectKey);

    const [name, setName] = useState(project.name);
    const [objective, setObjective] = useState(project.objective ?? "");
    const [description, setDescription] = useState(project.description ?? "");
    const [visibility, setVisibility] = useState(project.visibility);
    const [status, setStatus] = useState(project.status);
    const [budget, setBudget] = useState(project.budgetLimitUsd ?? "");

    const fail = (e: unknown) =>
        toast({
            title: "That didn't work",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
        });

    const save = async () => {
        const trimmed = String(budget).trim();
        // JSON.stringify turns NaN into null, so unvalidated junk here would silently
        // CLEAR the budget instead of failing.
        if (trimmed !== "" && !Number.isFinite(Number(trimmed))) {
            toast({
                title: "Budget must be a number",
                description: "Leave it empty to inherit the org policy.",
                variant: "destructive",
            });
            return;
        }
        try {
            await update.mutateAsync({
                name: name.trim(),
                objective: objective.trim() || null,
                description: description.trim() || null,
                visibility,
                // Reopening an archived project is an owner action with its own button;
                // sending an unchanged status here would demand that role to save a name.
                ...(status !== project.status && status !== "archived"
                    ? { status: status as "active" | "paused" }
                    : {}),
                budgetLimitUsd: trimmed === "" ? null : Number(trimmed),
            });
            toast({ title: "Project updated" });
        } catch (e) {
            fail(e);
        }
    };

    const doArchive = async () => {
        try {
            await archive.mutateAsync();
            toast({ title: `${project.name} archived` });
        } catch (e) {
            fail(e);
        }
    };

    const restore = async () => {
        try {
            await update.mutateAsync({ status: "active" });
            toast({ title: `${project.name} restored` });
        } catch (e) {
            fail(e);
        }
    };

    return (
        <div className="space-y-4" data-testid="project-settings">
            {!canEdit && (
                <Card>
                    <CardContent className="p-4 text-sm text-muted-foreground">
                        You have read access to this project. Changing it needs the editor role — ask an owner or an org
                        admin.
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Identity</CardTitle>
                    <CardDescription>
                        The URL key (<span className="font-mono">{project.key}</span>) is fixed once links exist.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="settings-name">Name</Label>
                        <Input
                            id="settings-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={!canEdit}
                            data-testid="settings-name-input"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="settings-objective">Objective</Label>
                        <Textarea
                            id="settings-objective"
                            value={objective}
                            onChange={(e) => setObjective(e.target.value)}
                            rows={2}
                            disabled={!canEdit}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="settings-description">Description</Label>
                        <Textarea
                            id="settings-description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                            disabled={!canEdit}
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Visibility and budget</CardTitle>
                    <CardDescription>
                        A private project is invisible to non-members — that is what makes the Members tab load-bearing.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label>Visibility</Label>
                        <Select
                            value={visibility}
                            onValueChange={(v) => setVisibility(v as "org" | "private")}
                            disabled={!canOwn || project.isDefault}
                        >
                            <SelectTrigger data-testid="settings-visibility">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="org">
                                    <span className="flex items-center gap-2"><Globe className="h-3.5 w-3.5" /> Organization</span>
                                </SelectItem>
                                <SelectItem value="private">
                                    <span className="flex items-center gap-2"><Lock className="h-3.5 w-3.5" /> Private</span>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            {project.isDefault
                                ? "The org default holds everything unassigned, so it stays org-visible."
                                : canOwn
                                    ? "Owners only."
                                    : "Changing visibility needs the owner role."}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="settings-budget">Budget limit (USD)</Label>
                        <Input
                            id="settings-budget"
                            inputMode="decimal"
                            value={budget}
                            placeholder="Inherit org policy"
                            onChange={(e) => setBudget(e.target.value)}
                            disabled={!canEdit}
                            data-testid="settings-budget-input"
                        />
                        <p className="text-xs text-muted-foreground">
                            Empty inherits the org policy. Cycle budgets remain the execution guardrail.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>Status</Label>
                        <Select
                            value={status === "archived" ? "active" : status}
                            onValueChange={(v) => setStatus(v as ProjectSummary["status"])}
                            disabled={!canEdit || project.status === "archived"}
                        >
                            <SelectTrigger data-testid="settings-status">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="paused">Paused</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
                <CardContent className="pt-0">
                    <Button onClick={save} disabled={!canEdit || update.isPending} data-testid="settings-save">
                        {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save changes
                    </Button>
                </CardContent>
            </Card>

            {!project.isDefault && canOwn && (
                <Card className="border-destructive/40">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm">
                            {project.status === "archived" ? "Archived" : "Archive"}
                        </CardTitle>
                        <CardDescription>
                            {project.status === "archived"
                                ? "This project is archived. Its cycles and knowledge are intact."
                                : "Archiving hides the project from listings. It refuses while any cycle is still open, so nothing is stranded mid-run."}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {project.status === "archived" ? (
                            <Button variant="outline" onClick={restore} disabled={update.isPending} data-testid="settings-restore">
                                Restore project
                            </Button>
                        ) : (
                            <Button
                                variant="destructive"
                                onClick={doArchive}
                                disabled={archive.isPending}
                                data-testid="settings-archive"
                            >
                                {archive.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Archive project
                            </Button>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

export default function ProjectSpacePage() {
    const routeParams = useParams();
    const projectKey = routeParams?.key;
    const [tab, setTab] = useTab(projectKey);
    const { data, isLoading, error } = useProject(projectKey);

    if (isLoading) {
        return (
            <div className="space-y-4 p-4 sm:p-6">
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-64 w-full rounded-xl" />
            </div>
        );
    }

    if (error || !data?.project) {
        return (
            <div className="p-4 sm:p-6">
                <Card>
                    <CardContent className="py-12 text-center">
                        <p className="text-sm text-muted-foreground">
                            Project not found{error ? `: ${(error as Error).message}` : "."}
                        </p>
                        <Link href="/projects">
                            <Button variant="ghost" className="mt-4">
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                All projects
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const { project, spend, role } = data;

    return (
        <div className="space-y-4 px-4 pb-6 pt-2 sm:px-6 sm:pb-6 sm:pt-3 relative" data-testid="project-space-page">
            <ProjectSpaceHeader
                project={project}
                spend={spend}
                // The API returns the role as a plain string; narrow it against
                // the known roles so an unrecognised value reads as "no role"
                // rather than being asserted into the union.
                role={PROJECT_ROLES.find((r) => r === role)}
                projectKey={projectKey}
            />

            <div className="flex gap-1 border-b border-border overflow-x-auto pb-0.5" role="tablist">
                {TABS.map((t) => {
                    const Icon = t.icon;
                    const isActive = tab === t.id;
                    return (
                        <button
                            key={t.id}
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => setTab(t.id)}
                            data-testid={`project-tab-${t.id}`}
                            className={cn(
                                "flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-bold transition-colors shrink-0",
                                isActive
                                    ? "border-primary text-foreground"
                                    : "border-transparent text-muted-foreground hover:text-foreground",
                            )}
                        >
                            <Icon className="h-4 w-4" />
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {tab === "overview" && <OverviewTab project={project} spend={spend} />}
            {tab === "timeline" && projectKey && <TimelineTab projectKey={projectKey} />}
            {tab === "cycles" && projectKey && <CyclesTab projectKey={projectKey} />}
            {tab === "work" && projectKey && <WorkTab projectKey={projectKey} />}
            {tab === "workflows" && projectKey && project && <ProjectWorkflowsTab projectKey={projectKey} projectId={project.id} role={role} />}
            {tab === "apps" && projectKey && <AppsTab projectKey={projectKey} />}
            {tab === "knowledge" && projectKey && <KnowledgeTab projectKey={projectKey} />}
            {tab === "forms" && projectKey && <ProjectFormsTab projectKey={projectKey} role={role} />}
            {tab === "media" && projectKey && <ProjectMediaTab projectKey={projectKey} />}
            {tab === "rooms" && projectKey && <RoomsTab projectKey={projectKey} />}
            {tab === "files" && projectKey && <ProjectFilesTab projectKey={projectKey} />}
            {tab === "integrations" && projectKey && <ProjectIntegrationsTab projectKey={projectKey} />}
            {tab === "activity" && projectKey && <ActivityTab projectKey={projectKey} />}
            {tab === "members" && projectKey && <MembersTab projectKey={projectKey} project={project} />}
            {tab === "settings" && projectKey && (
                <SettingsTab projectKey={projectKey} project={project} role={role} />
            )}
        </div>
    );
}
