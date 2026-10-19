import React, { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
    ArrowRight,
    Bot,
    ClipboardCheck,
    Clock,
    Lightbulb,
    MessagesSquare,
    Plus,
    Search,
    ShieldAlert,
    Sparkles,
    Target,
    Users,
    Paperclip,
    LayoutTemplate,
    FileText,
    ClipboardList,
    GitBranch,
    Tag,
    CheckCircle2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectRooms } from "../hooks/use-projects";

interface PrimerTemplate {
    id: string;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    description: string;
    prompt: string;
}

const PRIMER_TEMPLATES: PrimerTemplate[] = [
    {
        id: "milestone-risks",
        icon: Target,
        label: "Audit Milestone Risks",
        description: "Identify potential blockers & schedule risks across project cycles.",
        prompt: "Audit active cycle deliverables and milestone risks for this project space.",
    },
    {
        id: "architecture",
        icon: Lightbulb,
        label: "Brainstorm Architecture",
        description: "Collaborate on system design, APIs, and data models.",
        prompt: "Brainstorm technical architecture and system dependencies for this project space.",
    },
    {
        id: "deliverables",
        icon: ClipboardCheck,
        label: "Review Deliverables",
        description: "Evaluate recent agent outputs, code artifacts, and forge apps.",
        prompt: "Review recent execution step outputs and deliverables for this project space.",
    },
    {
        id: "governance",
        icon: ShieldAlert,
        label: "Governance & Safety Check",
        description: "Verify safety policies, budget limits, and access controls.",
        prompt: "Perform a governance and safety compliance audit on active project agents.",
    },
];

export function ProjectRoomsTab({ projectKey }: { projectKey: string }) {
    const [, setLocation] = useLocation();
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived" | "apps" | "breakouts">("all");
    const { data, isLoading } = useProjectRooms(projectKey);
    const rooms = data?.rooms ?? [];

    const counts = useMemo(() => {
        return {
            all: rooms.length,
            active: rooms.filter((r) => r.status !== "archived").length,
            archived: rooms.filter((r) => r.status === "archived").length,
            apps: rooms.filter((r) => (r.resourceCounts?.apps ?? 0) > 0).length,
            breakouts: rooms.filter((r) => r.isBreakout || (r.resourceCounts?.breakouts ?? 0) > 0).length,
        };
    }, [rooms]);

    const filteredRooms = useMemo(() => {
        return rooms.filter((r) => {
            // 1. Status / deliverable filter
            if (statusFilter === "active" && r.status === "archived") return false;
            if (statusFilter === "archived" && r.status !== "archived") return false;
            if (statusFilter === "apps" && (!r.resourceCounts || r.resourceCounts.apps === 0)) return false;
            if (statusFilter === "breakouts" && !r.isBreakout && (!r.resourceCounts || r.resourceCounts.breakouts === 0)) return false;

            // 2. Search query filter
            if (!searchQuery.trim()) return true;
            const q = searchQuery.toLowerCase();
            return (
                (r.title && r.title.toLowerCase().includes(q)) ||
                (r.activeTopic && r.activeTopic.toLowerCase().includes(q))
            );
        });
    }, [rooms, searchQuery, statusFilter]);

    const handleLaunchPrimer = (primer: PrimerTemplate) => {
        const url = `/workspace/chat?projectKey=${encodeURIComponent(projectKey)}&initialPrompt=${encodeURIComponent(primer.prompt)}`;
        setLocation(url);
    };

    if (isLoading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-24 w-full rounded-2xl" />
                <div className="grid gap-3 sm:grid-cols-2">
                    <Skeleton className="h-40 w-full rounded-xl" />
                    <Skeleton className="h-40 w-full rounded-xl" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6" data-testid="project-rooms-tab">
            {/* Quick-Start Discussion Primers Bar */}
            <div className="rounded-2xl border border-border/80 bg-gradient-to-r from-card via-card/90 to-card/70 p-4 shadow-sm backdrop-blur-md space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <span>Meeting Starters</span>
                        <span className="text-[11px] font-normal text-muted-foreground hidden sm:inline">
                            — Launch pre-seeded multi-agent meetings with project context
                        </span>
                    </div>
                    <Button asChild size="sm" className="gap-1.5 font-semibold shrink-0" data-testid="project-new-room">
                        <Link href={`/workspace/chat?projectKey=${encodeURIComponent(projectKey)}`}>
                            <Plus className="h-3.5 w-3.5" />
                            New Meeting
                        </Link>
                    </Button>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {PRIMER_TEMPLATES.map((primer) => {
                        const Icon = primer.icon;
                        return (
                            <button
                                key={primer.id}
                                onClick={() => handleLaunchPrimer(primer)}
                                className="group flex flex-col items-start gap-1 rounded-xl border border-border/60 bg-muted/30 p-3 text-left transition-all hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm"
                                data-testid={`primer-${primer.id}`}
                            >
                                <div className="flex items-center gap-2 text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                                    <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                                    <span>{primer.label}</span>
                                </div>
                                <p className="line-clamp-2 text-[11px] text-muted-foreground leading-tight">
                                    {primer.description}
                                </p>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Filter Tabs & Search Header */}
            <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-1.5 border-b border-border/40 pb-2.5" data-testid="room-filter-tabs">
                    {[
                        { id: "all", label: "All Meetings", count: counts.all },
                        { id: "active", label: "Active", count: counts.active },
                        { id: "archived", label: "Concluded", count: counts.archived },
                        { id: "apps", label: "With Apps", count: counts.apps },
                        { id: "breakouts", label: "Breakouts", count: counts.breakouts },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setStatusFilter(tab.id as any)}
                            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                                statusFilter === tab.id
                                    ? "bg-primary text-primary-foreground shadow-sm"
                                    : "bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                            }`}
                            data-testid={`filter-tab-${tab.id}`}
                        >
                            <span>{tab.label}</span>
                            <span
                                className={`rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
                                    statusFilter === tab.id
                                        ? "bg-primary-foreground/20 text-primary-foreground"
                                        : "bg-foreground/10 text-muted-foreground"
                                }`}
                            >
                                {tab.count}
                            </span>
                        </button>
                    ))}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search meetings by title or topic..."
                            className="pl-9 h-8.5 text-xs"
                        />
                    </div>
                    <div className="text-xs text-muted-foreground font-medium">
                        Showing <span className="font-bold text-foreground">{filteredRooms.length}</span> of{" "}
                        <span className="font-bold text-foreground">{rooms.length}</span> meetings
                    </div>
                </div>
            </div>


            {/* Empty State */}
            {filteredRooms.length === 0 && (
                <Card className="border-dashed">
                    <CardContent className="py-12 text-center space-y-3">
                        <MessagesSquare className="mx-auto h-8 w-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">
                            {searchQuery
                                ? "No meetings match your search query."
                                : "No meetings have taken place in this project yet."}
                        </p>
                        {!searchQuery && (
                            <Button
                                asChild
                                size="sm"
                                variant="outline"
                                className="gap-1.5 border-primary/30 text-primary hover:bg-primary/5 font-semibold"
                            >
                                <Link href={`/workspace/chat?projectKey=${encodeURIComponent(projectKey)}`}>
                                    <Plus className="h-4 w-4" />
                                    Start First Discussion
                                </Link>
                            </Button>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Room Cards Grid */}
            {filteredRooms.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2" data-testid="project-rooms-list">
                    {filteredRooms.map((room: any) => {
                        const dateFormatted = room.updatedAt
                            ? new Date(room.updatedAt).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                              })
                            : null;

                        return (
                            <Link key={room.sessionKey} href={`/workspace/chat/${room.sessionKey}`}>
                                <Card className="group relative flex h-full cursor-pointer flex-col overflow-hidden border-border/80 bg-gradient-to-b from-card via-card to-card/85 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md">
                                    {/* Accent Top Line on Hover */}
                                    <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

                                    <CardContent className="flex flex-1 flex-col justify-between p-4 space-y-3">
                                        <div className="space-y-1.5 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                                                        <MessagesSquare className="h-3.5 w-3.5" />
                                                    </div>
                                                    <h3 className="truncate text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                                                        {room.title || "Untitled discussion"}
                                                    </h3>
                                                </div>

                                                <Badge
                                                    variant="secondary"
                                                    className="shrink-0 text-[10px] font-semibold flex items-center gap-1 bg-muted/60"
                                                >
                                                    <Users className="h-3 w-3 text-primary" />
                                                    {room.participantCount || 1}{" "}
                                                    {room.participantCount === 1 ? "person" : "people"}
                                                </Badge>
                                            </div>

                                            {room.activeTopic && (
                                                <p className="line-clamp-2 text-xs text-muted-foreground leading-relaxed pl-9">
                                                    {room.activeTopic}
                                                </p>
                                            )}

                                            {/* Resource, Topic & Attachment Badges */}
                                            <div className="flex flex-wrap items-center gap-1.5 pt-1 pl-9" data-testid="room-badges">
                                                {room.status === "archived" && (
                                                    <Badge
                                                        variant="outline"
                                                        className="border-amber-500/40 bg-amber-500/10 text-amber-300 text-[10px] font-semibold flex items-center gap-1"
                                                        data-testid="badge-concluded"
                                                    >
                                                        <CheckCircle2 className="h-2.5 w-2.5" />
                                                        <span>Concluded</span>
                                                    </Badge>
                                                )}

                                                {room.isBreakout && (
                                                    <Badge
                                                        variant="outline"
                                                        className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-[10px] font-semibold flex items-center gap-1"
                                                        data-testid="badge-breakout"
                                                    >
                                                        <GitBranch className="h-2.5 w-2.5" />
                                                        <span>Breakout</span>
                                                    </Badge>
                                                )}

                                                {room.activeTopic && (
                                                    <Badge
                                                        variant="outline"
                                                        className="border-primary/30 bg-primary/10 text-primary text-[10px] font-semibold flex items-center gap-1 max-w-[200px] truncate"
                                                        data-testid="badge-topic"
                                                    >
                                                        <Tag className="h-2.5 w-2.5 shrink-0" />
                                                        <span className="truncate">{room.activeTopic}</span>
                                                    </Badge>
                                                )}

                                                {room.resourceCounts?.apps > 0 && (
                                                    <Badge
                                                        variant="outline"
                                                        className="border-indigo-500/30 bg-indigo-500/10 text-indigo-400 text-[10px] font-medium flex items-center gap-1"
                                                        data-testid="badge-apps"
                                                    >
                                                        <LayoutTemplate className="h-2.5 w-2.5" />
                                                        <span>{room.resourceCounts.apps} {room.resourceCounts.apps === 1 ? "App" : "Apps"}</span>
                                                    </Badge>
                                                )}

                                                {room.resourceCounts?.documents > 0 && (
                                                    <Badge
                                                        variant="outline"
                                                        className="border-sky-500/30 bg-sky-500/10 text-sky-400 text-[10px] font-medium flex items-center gap-1"
                                                        data-testid="badge-documents"
                                                    >
                                                        <FileText className="h-2.5 w-2.5" />
                                                        <span>{room.resourceCounts.documents} {room.resourceCounts.documents === 1 ? "Report" : "Reports"}</span>
                                                    </Badge>
                                                )}

                                                {room.resourceCounts?.forms > 0 && (
                                                    <Badge
                                                        variant="outline"
                                                        className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px] font-medium flex items-center gap-1"
                                                        data-testid="badge-forms"
                                                    >
                                                        <ClipboardList className="h-2.5 w-2.5" />
                                                        <span>{room.resourceCounts.forms} {room.resourceCounts.forms === 1 ? "Form" : "Forms"}</span>
                                                    </Badge>
                                                )}

                                                {room.resourceCounts?.breakouts > 0 && !room.isBreakout && (
                                                    <Badge
                                                        variant="outline"
                                                        className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px] font-medium flex items-center gap-1"
                                                        data-testid="badge-child-breakouts"
                                                    >
                                                        <GitBranch className="h-2.5 w-2.5" />
                                                        <span>{room.resourceCounts.breakouts} {room.resourceCounts.breakouts === 1 ? "Breakout" : "Breakouts"}</span>
                                                    </Badge>
                                                )}

                                                {room.attachmentCount > 0 && (
                                                    <Badge
                                                        variant="outline"
                                                        className="border-violet-500/30 bg-violet-500/10 text-violet-400 text-[10px] font-medium flex items-center gap-1"
                                                        data-testid="badge-attachments"
                                                    >
                                                        <Paperclip className="h-2.5 w-2.5" />
                                                        <span>{room.attachmentCount} {room.attachmentCount === 1 ? "File" : "Files"}</span>
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>

                                        {/* Card Footer Info */}
                                        <div className="flex items-center justify-between border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                                            {room.status === "archived" ? (
                                                <div className="flex items-center gap-1.5 text-amber-400">
                                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                                    <span className="font-medium">Concluded & Archived</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1.5">
                                                    <span className="relative flex h-1.5 w-1.5">
                                                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                                    </span>
                                                    <span className="font-medium text-foreground">Active Discussion</span>
                                                </div>
                                            )}

                                            <div className="flex items-center gap-2">
                                                {dateFormatted && (
                                                    <span className="flex items-center gap-1">
                                                        <Clock className="h-3 w-3" />
                                                        {dateFormatted}
                                                    </span>
                                                )}
                                                <ArrowRight className="h-3.5 w-3.5 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
