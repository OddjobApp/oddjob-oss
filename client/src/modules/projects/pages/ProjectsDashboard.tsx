import React, { useState, useMemo } from "react";
import { Link } from "wouter";
import {
    ArrowUpRight,
    Bot,
    FolderKanban,
    Globe,
    Plus,
    ShieldCheck,
    Loader2,
    Lock,
    Search,
    Sparkles,
    Wallet,
    Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useProjects, useCreateProject, formatUsd, type ProjectSummary } from "../hooks/use-projects";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { useOrgContextOptional } from "@domain-ui/core/ui/hooks/use-org-context";

/**
 * Project Spaces Index — The durable bodies of work that own operational cycles,
 * missions, apps, and knowledge retrieval boundaries.
 */

function budgetTone(project: ProjectSummary): string {
    const limit = project.budgetLimitUsd === null ? null : Number(project.budgetLimitUsd);
    if (limit === null || limit <= 0) return "text-muted-foreground";
    const ratio = (project.spendToDateUsd ?? 0) / limit;
    if (ratio >= 1) return "text-red-600 dark:text-red-400";
    if (ratio >= 0.8) return "text-amber-600 dark:text-amber-400";
    return "text-emerald-600 dark:text-emerald-400";
}

function ProjectCard({ project }: { project: ProjectSummary }) {
    const limit = project.budgetLimitUsd === null ? null : Number(project.budgetLimitUsd);
    const spend = project.spendToDateUsd ?? 0;
    const spendPct = limit && limit > 0 ? Math.min(100, (spend / limit) * 100) : null;

    return (
        <Link href={`/projects/${project.key}`}>
            <Card className="group relative flex h-full cursor-pointer flex-col overflow-hidden border-border/80 bg-gradient-to-b from-card via-card to-card/80 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5">
                {/* Decorative Top Accent Line */}
                <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

                <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2.5">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary transition-colors group-hover:border-primary/40 group-hover:bg-primary/20">
                                    <FolderKanban className="h-4.5 w-4.5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <CardTitle data-testid="project-card-title" className="truncate text-base font-bold text-foreground transition-colors group-hover:text-primary">
                                        {project.name}
                                    </CardTitle>
                                    {project.key && project.key.toLowerCase() !== project.name.toLowerCase() && (
                                        <CardDescription className="truncate font-mono text-[11px] text-muted-foreground">
                                            {project.key}
                                        </CardDescription>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Top Badges */}
                        <div className="flex shrink-0 flex-col items-end gap-1">
                            {project.isDefault && (
                                <Badge variant="outline" className="border-primary/30 bg-primary/5 text-[10px] font-semibold text-primary">
                                    <ShieldCheck className="mr-1 h-3 w-3" />
                                    Default
                                </Badge>
                            )}
                            {project.visibility === "private" ? (
                                <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold">
                                    <Lock className="mr-1 h-3 w-3" />
                                    Private
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                    <Globe className="mr-1 h-3 w-3" />
                                    Org
                                </Badge>
                            )}
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col justify-between space-y-4">
                    <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">
                        {project.objective || project.description || "No objective set for this project space."}
                    </p>

                    {/* AI Scope Status Pill */}
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-[11px]">
                        <div className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                            <span className="relative flex h-1.5 w-1.5 shrink-0">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            </span>
                            <Sparkles className="h-3 w-3 text-emerald-500" />
                            <span>AI Scope Active</span>
                        </div>
                        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-opacity group-hover:text-primary" />
                    </div>

                    {/* Spend Progress Bar if budget set */}
                    {spendPct !== null && (
                        <div className="space-y-1">
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                <span>Budget used</span>
                                <span className="font-semibold text-foreground">{spendPct.toFixed(0)}%</span>
                            </div>
                            <Progress value={spendPct} className="h-1.5" />
                        </div>
                    )}

                    {/* Stats Grid Footer */}
                    <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-center">
                        <div className="rounded-lg bg-muted/40 p-1.5">
                            <div className="text-sm font-black text-foreground">{project.cycleCount ?? 0}</div>
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cycles</div>
                        </div>
                        <div className="rounded-lg bg-muted/40 p-1.5">
                            <div className="flex items-center justify-center gap-1 text-sm font-black text-foreground">
                                <Zap className="h-3 w-3 text-amber-500" />
                                {project.activeCycleCount ?? 0}
                            </div>
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Active</div>
                        </div>
                        <div className="rounded-lg bg-muted/40 p-1.5">
                            <div className={cn("text-sm font-black", budgetTone(project))}>
                                {formatUsd(project.spendToDateUsd)}
                            </div>
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
                                {limit === null ? "Spend" : `/ ${formatUsd(limit)}`}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}

function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
    const [name, setName] = useState("");
    const [objective, setObjective] = useState("");
    const [visibility, setVisibility] = useState<"org" | "private">("org");
    const createProject = useCreateProject();
    const { toast } = useToast();
    const orgContext = useOrgContextOptional();

    const submit = async () => {
        if (!name.trim()) return;
        try {
            const result = await createProject.mutateAsync({
                name: name.trim(),
                objective: objective.trim() || undefined,
                visibility,
                organizationId: orgContext?.selectedOrgId,
            });
            toast({
                title: "Project Space Created",
                description: `Successfully created "${name.trim()}".`,
            });
            setName("");
            setObjective("");
            setVisibility("org");
            onOpenChange(false);
        } catch (err: any) {
            toast({
                title: "Failed to create project",
                description: err?.message || "An error occurred while creating the project space.",
                variant: "destructive",
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                        <FolderKanban className="h-5 w-5 text-primary" />
                        New Project Space
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-2">
                        <Label htmlFor="project-name">Project Name</Label>
                        <Input
                            id="project-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Rescue Dispatch"
                            data-testid="project-name-input"
                        />
                        <p className="text-xs text-muted-foreground">
                            The URL key is automatically derived from the name and serves as a unique workspace handle.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="project-objective">Objective & Scope</Label>
                        <Textarea
                            id="project-objective"
                            value={objective}
                            onChange={(e) => setObjective(e.target.value)}
                            placeholder="Describe the primary mission and durable objectives for this project space..."
                            rows={3}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="project-visibility">Visibility & Isolation</Label>
                        <Select value={visibility} onValueChange={(v) => setVisibility(v as "org" | "private")}>
                            <SelectTrigger id="project-visibility" data-testid="project-visibility-select">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="org">
                                    <span className="flex items-center gap-2">
                                        <Globe className="h-3.5 w-3.5 text-muted-foreground" /> Organization (Visible to all members)
                                    </span>
                                </SelectItem>
                                <SelectItem value="private">
                                    <span className="flex items-center gap-2">
                                        <Lock className="h-3.5 w-3.5 text-amber-500" /> Private (Explicit members & admins only)
                                    </span>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            {visibility === "private"
                                ? "Private projects restrict RAG retrieval, copilot boundary, and visibility strictly to explicit members."
                                : "Everyone in the organization can view this project space and query its knowledge."}
                        </p>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={submit} disabled={!name.trim() || createProject.isPending} data-testid="create-project-submit">
                        {createProject.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Create Project Space
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function ProjectsDashboard() {
    const [showArchived, setShowArchived] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [visibilityFilter, setVisibilityFilter] = useState<"all" | "org" | "private">("all");

    const orgContext = useOrgContextOptional();
    const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const urlOrgId = urlParams?.get("orgId") ? parseInt(urlParams.get("orgId")!, 10) : null;
    const effectiveOrgId = urlOrgId || orgContext?.selectedOrgId;

    const { data, isLoading, error } = useProjects(showArchived, effectiveOrgId);
    const projects = data?.projects ?? [];

    const filteredProjects = useMemo(() => {
        return projects.filter((p) => {
            const matchesSearch =
                !searchQuery.trim() ||
                p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                p.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (p.objective && p.objective.toLowerCase().includes(searchQuery.toLowerCase()));

            const matchesVisibility =
                visibilityFilter === "all" || p.visibility === visibilityFilter;

            return matchesSearch && matchesVisibility;
        });
    }, [projects, searchQuery, visibilityFilter]);

    const totalCycles = useMemo(
        () => projects.reduce((acc, p) => acc + (p.cycleCount ?? 0), 0),
        [projects]
    );
    const activeCycles = useMemo(
        () => projects.reduce((acc, p) => acc + (p.activeCycleCount ?? 0), 0),
        [projects]
    );
    const totalSpend = useMemo(
        () => projects.reduce((acc, p) => acc + (p.spendToDateUsd ?? 0), 0),
        [projects]
    );

    return (
        <div className="space-y-4 px-4 pb-6 pt-2 sm:px-6 sm:pb-6 sm:pt-3" data-testid="projects-dashboard">
            {/* Control Tower Header Banner */}
            <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-r from-card via-card/90 to-card/70 p-5 sm:p-6 shadow-md backdrop-blur-md space-y-4">
                <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                                <FolderKanban className="h-5.5 w-5.5" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-black tracking-tight text-foreground">Project Spaces</h1>
                                <p className="text-xs text-muted-foreground">
                                    Durable bodies of work serving as copilot contexts, RAG boundaries, and budget rollups.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowArchived((v) => !v)}
                            className="text-xs font-semibold"
                        >
                            {showArchived ? "Hide Archived" : "Show Archived"}
                        </Button>
                        <Button
                            onClick={() => setDialogOpen(true)}
                            size="sm"
                            className="gap-1.5 font-semibold"
                            data-testid="new-project-button"
                        >
                            <Plus className="h-4 w-4" />
                            New Project
                        </Button>
                    </div>
                </div>

                {/* Rollup Summary Chips */}
                <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-border/60 text-xs">
                    <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5 font-medium text-foreground">
                        <FolderKanban className="h-3.5 w-3.5 text-primary" />
                        <span>Spaces:</span>
                        <span className="font-bold">{projects.length}</span>
                    </div>

                    <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5 font-medium text-foreground">
                        <Zap className="h-3.5 w-3.5 text-amber-500" />
                        <span>Cycles:</span>
                        <span className="font-bold text-foreground">{activeCycles} active</span>
                        <span className="text-muted-foreground">/ {totalCycles} total</span>
                    </div>

                    <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5 font-medium text-foreground">
                        <Wallet className="h-3.5 w-3.5 text-emerald-500" />
                        <span>Total Spend:</span>
                        <span className="font-bold text-foreground">{formatUsd(totalSpend)}</span>
                    </div>

                    <div className="ml-auto hidden md:flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Copilot & RAG Scope Boundary Active</span>
                    </div>
                </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search project spaces..."
                        className="pl-9 h-9 text-xs"
                    />
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Filter:</span>
                    <Select value={visibilityFilter} onValueChange={(v) => setVisibilityFilter(v as any)}>
                        {/*
                          * axe: button-name, critical. The adjacent "Filter:"
                          * text is not associated with the control, so it
                          * announced with no name of its own.
                          */}
                        <SelectTrigger aria-label="Filter projects by visibility" className="h-9 w-36 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Visibility</SelectItem>
                            <SelectItem value="org">Org Wide</SelectItem>
                            <SelectItem value="private">Private</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {isLoading && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {[0, 1, 2].map((i) => <Skeleton key={i} className="h-52 w-full rounded-2xl" />)}
                </div>
            )}

            {error && (
                <Card>
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                        Could not load project spaces. {(error as Error).message}
                    </CardContent>
                </Card>
            )}

            {!isLoading && !error && filteredProjects.length === 0 && (
                <Card>
                    <CardContent className="py-12 text-center">
                        <FolderKanban className="mx-auto h-8 w-8 text-muted-foreground/50" />
                        <p className="mt-3 text-sm text-muted-foreground">
                            {searchQuery || visibilityFilter !== "all"
                                ? "No project spaces match your search filters."
                                : "No project spaces yet. Everything currently lives in the organization default."}
                        </p>
                    </CardContent>
                </Card>
            )}

            {filteredProjects.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredProjects.map((p) => <ProjectCard key={p.id} project={p} />)}
                </div>
            )}

            <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
        </div>
    );
}
