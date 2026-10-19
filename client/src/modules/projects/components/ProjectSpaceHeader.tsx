import React, { useState, useMemo } from "react";
import {
    Bot,
    FolderKanban,
    Radio,
    Sparkles,
    Users,
    Wallet,
    Zap,
} from "lucide-react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@domain-ui/auth/ui/modules/auth/hooks/use-auth";
import { formatUsd, useProjectMembers, type ProjectRole, type ProjectSpend, type ProjectSummary } from "../hooks/use-projects";

export interface ProjectSpaceHeaderProps {
    project: ProjectSummary;
    spend: ProjectSpend;
    role?: ProjectRole;
    projectKey?: string;
}

export function ProjectSpaceHeader({
    project,
    spend,
    role,
    projectKey,
}: ProjectSpaceHeaderProps) {
    const activeCycles = spend.activeCycleCount ?? 0;
    const totalCycles = spend.cycleCount ?? 0;

    const [popoverOpen, setPopoverOpen] = useState(false);
    const { user } = useAuth();
    const { data: membersData } = useProjectMembers(projectKey ?? project.key);

    // Dynamic Hybrid Presence Members for this Project Space from real data
    const presenceMembers = useMemo(() => {
        const rawMembers = membersData?.members ?? [];
        if (rawMembers.length > 0) {
            return rawMembers.map((m, idx) => ({
                id: `${m.principalType}_${m.principalId}`,
                name: m.displayName || m.principalId,
                role: m.role ? (m.role.charAt(0).toUpperCase() + m.role.slice(1)) : "Member",
                type: m.principalType,
                status: m.principalType === "agent" ? "active" : "online",
                currentTask: m.principalType === "agent" ? (m.secondary || `Active in ${project.name}`) : undefined,
                color: idx % 2 === 0 ? "bg-blue-600" : "bg-purple-600",
            }));
        }

        // Fallback to active logged-in user + project copilot agent when no explicit members are mapped
        // The user record has no `displayName` — it carries firstName/lastName and
        // username, so this always fell through to username. Composed here the same
        // way the ontology user adapter does it.
        const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
        const currentUserDisplayName = fullName || user?.username || "Admin";
        return [
            {
                id: `usr_${user?.id || "current"}`,
                name: currentUserDisplayName,
                role: role ? (role.charAt(0).toUpperCase() + role.slice(1)) : "Owner",
                type: "human" as const,
                status: "online",
                color: "bg-blue-600",
            },
            {
                id: `agt_copilot`,
                name: `${project.name} Copilot`,
                role: "In-Space AI Assistant",
                type: "agent" as const,
                status: activeCycles > 0 ? ("active" as const) : ("thinking" as const),
                currentTask: activeCycles > 0 ? `Monitoring ${activeCycles} active cycle(s)` : `Ready in ${project.name} Space`,
                squad: "Project Squad",
                color: "bg-cyan-600",
            },
        ];
    }, [membersData, user, role, project.name, activeCycles]);

    const activeAgentCount = presenceMembers.filter(m => m.type === "agent" && (m.status === "active" || m.status === "thinking")).length;
    const activeHumanCount = presenceMembers.filter(m => m.type === "human").length;

    return (
        <div
            className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-r from-card via-card/90 to-card/70 p-5 sm:p-6 shadow-md backdrop-blur-md space-y-4"
            data-testid="project-space-header"
        >
            {/* Ambient Decorative Glow */}
            <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
            <div className="pointer-events-none absolute -left-20 -bottom-20 h-48 w-48 rounded-full bg-emerald-500/5 blur-3xl" />

            {/* Main Header Content */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                            <FolderKanban className="h-5.5 w-5.5" />
                        </div>
                        <div>
                            <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-foreground">
                                <span className="truncate">{project.name}</span>
                            </h1>
                            {project.key && project.key.toLowerCase() !== project.name.toLowerCase() && (
                                <p className="font-mono text-xs text-muted-foreground">{project.key}</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Hybrid Presence Stack & Thinking Beacon */}
                <div className="flex items-center gap-3">
                    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                className="flex items-center gap-2 rounded-xl border border-border/80 bg-background/60 hover:bg-background/90 px-3 py-1.5 transition-all shadow-sm group cursor-pointer"
                                aria-label="View Hybrid Space Presence"
                            >
                                {/* Avatars overlap stack */}
                                <div className="flex -space-x-2 overflow-hidden items-center">
                                    {presenceMembers.slice(0, 3).map((m) => (
                                        <div
                                            key={m.id}
                                            className={`inline-flex h-6 w-6 rounded-full ${m.type === "agent" ? "bg-cyan-600" : (m.color || "bg-blue-600")} ring-2 ring-background items-center justify-center text-[10px] font-bold text-white relative`}
                                        >
                                            {m.type === "agent" ? (
                                                <>
                                                    <Bot className="h-3.5 w-3.5" />
                                                    <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
                                                </>
                                            ) : (
                                                (m.name || "U")[0].toUpperCase()
                                            )}
                                        </div>
                                    ))}
                                </div>

                                <div className="flex flex-col text-left text-xs">
                                    <span className="font-bold text-foreground group-hover:text-primary transition-colors flex items-center gap-1">
                                        <Radio className="h-3 w-3 text-emerald-400 animate-pulse" />
                                        {activeHumanCount} Humans · {activeAgentCount} Agents
                                    </span>
                                    <span className="text-[10px] text-cyan-400 font-medium flex items-center gap-1">
                                        <Sparkles className="h-2.5 w-2.5 animate-spin" /> AI Thinking...
                                    </span>
                                </div>
                            </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-4 space-y-3 bg-popover border border-border text-popover-foreground rounded-2xl shadow-2xl backdrop-blur-xl" align="end">
                            <div className="flex items-center justify-between border-b border-border pb-2">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                    <Users className="h-3.5 w-3.5 text-primary" /> Active Space Presence
                                </h4>
                                <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                                    Live Hybrid Sync
                                </Badge>
                            </div>

                            <div className="space-y-2.5">
                                {presenceMembers.map((member) => (
                                    <div key={member.id} className="flex items-start gap-2.5 p-2 rounded-xl bg-muted/40 border border-border/60 text-xs">
                                        <div className={`h-7 w-7 rounded-full flex items-center justify-center font-bold text-white shrink-0 ${member.type === "agent" ? "bg-cyan-600" : member.color}`}>
                                            {member.type === "agent" ? <Bot className="h-4 w-4" /> : member.name[0]}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold truncate">{member.name}</span>
                                                <span className="text-[10px] text-muted-foreground">{member.role}</span>
                                            </div>
                                            {member.currentTask ? (
                                                <p className="text-[11px] text-cyan-300 font-mono truncate mt-0.5">
                                                    ⚡ {member.currentTask}
                                                </p>
                                            ) : (
                                                <p className="text-[10px] text-emerald-400 flex items-center gap-1 mt-0.5">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active in Space
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>
            </div>

            {/* Telemetry Radar Strip */}
            <div className="flex items-center gap-3 pt-2 border-t border-border/60">
                <div className="flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1 text-xs font-medium text-foreground">
                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                    <span>Cycles:</span>
                    <span className="font-bold text-foreground">{activeCycles} active</span>
                    <span className="text-muted-foreground">/ {totalCycles} total</span>
                </div>

                <div className="flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1 text-xs font-medium text-foreground">
                    <Wallet className="h-3.5 w-3.5 text-primary" />
                    <span>Spend:</span>
                    <span className="font-bold text-foreground">{formatUsd(spend.spendToDateUsd)}</span>
                    {spend.budgetLimitUsd !== null && (
                        <span className="text-muted-foreground">/ {formatUsd(spend.budgetLimitUsd)}</span>
                    )}
                </div>
            </div>
        </div>
    );
}
