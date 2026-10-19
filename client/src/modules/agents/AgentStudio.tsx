import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Brain, Coins, Gauge, Loader2, Maximize2, MessageSquare, Minimize2, ShieldAlert, Sparkles, Wrench, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AGENT_STUDIO_VIEWS, isConsequentialTool, type AgentStudioView } from "@shared/agent-studio";
import { ComputerUseStudio } from "@/modules/computer-studio/ComputerUseStudio";
import { resolveActiveOrgId } from "@/lib/queryClient";

/**
 * Agent Studio: what an agent is, what it may do, what it costs, and how it has done.
 *
 * Every other first-class thing on this platform has a studio — a film, a form, an app,
 * a document, a project — and the agent, the thing that does the work, had a settings
 * page. This is the studio: read-only for now, because an agent is CHANGED through a
 * proposal card a person applies, and a surface that also wrote directly would be a
 * second way to grant a permission without the diff that makes it reviewable.
 *
 * The zones follow the film screen's: what it is, what it runs on, what it can reach,
 * what it reads, and what has actually happened.
 */

interface AgentCard {
    id: number;
    name: string;
    description: string;
    personaType: string;
    legend?: string | null;
    soulArchetype?: string | null;
    capabilities?: string[];
    tools?: string[];
    topicAffinities?: string[];
    intentAffinities?: string[];
    enabled?: boolean;
    isDefault?: boolean;
    modelBindingProviderId?: number | null;
    modelBindingModelId?: number | null;
    oceanTraits?: { o: number; c: number; e: number; a: number; n: number };
}

const fetchJson = async <T,>(url: string): Promise<T> => {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
    return res.json() as Promise<T>;
};

const VIEW_LABEL: Record<AgentStudioView, string> = {
    identity: "Identity",
    brain: "Brain",
    reach: "Reach",
    knowledge: "Knowledge",
    governance: "Governance",
    try: "Try it",
    evidence: "Evidence",
};

function Empty({ children }: { children: React.ReactNode }) {
    return <p className="text-xs text-muted-foreground">{children}</p>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 border-b border-border/40 py-2 text-xs last:border-0">
            <span className="text-muted-foreground">{label}</span>
            <span className="min-w-0 text-foreground">{children}</span>
        </div>
    );
}

/** What the studio hands the room when someone asks about part of an agent. */
export interface AgentStudioSelection {
    agentId: number;
    kind: "agent" | "tool" | "knowledge" | "governance";
    label: string;
}

export function AgentStudio({
    agentId,
    view: initialView = "identity",
    isFocusMode,
    onToggleFocusMode,
    onClose,
    onFocusInChat,
    className,
}: {
    agentId?: number;
    view?: AgentStudioView;
    /** The chat is collapsed; the studio has the width. */
    isFocusMode?: boolean;
    onToggleFocusMode?: () => void;
    /** Hand the rail back. Without it the studio cannot be dismissed, like the others. */
    onClose?: () => void;
    /** Scope the next message to what is selected here, and open a collapsed chat. */
    onFocusInChat?: (selection: AgentStudioSelection) => void;
    className?: string;
}) {
    const [view, setView] = useState<AgentStudioView>(initialView);
    const [teaching, setTeaching] = useState(false);
    const agents = useQuery<AgentCard[]>({
        queryKey: ["/api/agent-cards"],
        queryFn: () => fetchJson<AgentCard[]>("/api/agent-cards"),
    });

    const agent = useMemo(
        () => agents.data?.find((candidate) => candidate.id === agentId),
        [agents.data, agentId],
    );

    const tools = agent?.tools ?? [];
    const reaching = tools.filter(isConsequentialTool);

    if (teaching) return <ComputerUseStudio initialTeaching organizationId={resolveActiveOrgId() ?? undefined}
        title={`Teach a task · ${agent?.name ?? "Agent Studio"}`} onClose={() => setTeaching(false)}
        isFocusMode={isFocusMode} onToggleFocusMode={onToggleFocusMode} className={className} />;

    return (
        <div className={cn("flex min-h-0 w-full flex-col rounded-xl border border-border/80 bg-card", className)} data-testid="agent-studio">
            <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Bot className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{agent?.name ?? "Agent Studio"}</p>
                    <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                        {agent ? agent.personaType : "No agent open"}
                    </p>
                </div>
                {reaching.length > 0 && (
                    <Badge variant="outline" className="shrink-0 gap-1 border-amber-500/40 px-1.5 py-0 text-[10px] text-amber-600 dark:text-amber-400">
                        <ShieldAlert className="h-3 w-3" aria-hidden />acts outside
                    </Badge>
                )}
                {agent && onFocusInChat && (
                    <Button
                        type="button" variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                        onClick={() => onFocusInChat({ agentId: agent.id, kind: "agent", label: agent.name })}
                        data-testid="agent-studio-discuss"
                        title="Ask the room about this agent"
                    >
                        <MessageSquare className="h-3.5 w-3.5" />Discuss
                    </Button>
                )}
                {agent && <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setTeaching(true)}>Teach a task</Button>}
                {onToggleFocusMode && (
                    <Button
                        type="button" variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                        onClick={onToggleFocusMode}
                        data-testid="agent-studio-focus"
                        aria-label={isFocusMode ? "Show Chat" : "Focus Studio"}
                        title={isFocusMode ? "Show Chat" : "Focus Studio"}
                    >
                        {isFocusMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                        {isFocusMode ? "Show Chat" : "Focus Studio"}
                    </Button>
                )}
                {onClose && (
                    <Button
                        type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                        onClick={onClose}
                        data-testid="agent-studio-close"
                        aria-label="Close Agent Studio"
                        title="Close Agent Studio"
                    >
                        <X className="h-3.5 w-3.5" />
                    </Button>
                )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/70 px-2 py-1.5" role="tablist" aria-label="Agent Studio">
                {AGENT_STUDIO_VIEWS.map((value) => (
                    <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={view === value}
                        onClick={() => setView(value)}
                        data-testid={`agent-studio-tab-${value}`}
                        className={cn(
                            "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                            view === value ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {VIEW_LABEL[value]}
                    </button>
                ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {agents.isLoading ? (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading agents…</p>
                ) : agents.error ? (
                    <p role="alert" className="text-xs text-destructive">These agents could not be loaded: {(agents.error as Error).message}</p>
                ) : !agent ? (
                    <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-border p-4 text-center" data-testid="agent-studio-empty">
                        <Sparkles className="h-6 w-6 text-muted-foreground/60" aria-hidden />
                        <p className="text-sm font-medium text-foreground">{agentId ? "Agent unavailable" : "Build an agent"}</p>
                        <p className="text-xs text-muted-foreground">
                            Describe what you want one to do in the room — "watch the support inbox and draft replies" — and
                            it will be drafted as a card you approve.
                        </p>
                    </div>
                ) : view === "identity" ? (
                    <div className="grid gap-0" data-testid="agent-studio-identity">
                        <Row label="Name">{agent.name}</Row>
                        <Row label="Does">{agent.description}</Row>
                        <Row label="Persona">{agent.personaType}</Row>
                        <Row label="Archetype">{agent.soulArchetype ?? <Empty>Not set</Empty>}</Row>
                        <Row label="In its words">
                            {agent.legend?.trim() ? <span className="italic">“{agent.legend}”</span> : <Empty>It has not said how it works. A room picking someone for a task reads this.</Empty>}
                        </Row>
                        <Row label="State">{agent.enabled === false ? "Switched off" : "Active"}{agent.isDefault ? " · default" : ""}</Row>
                    </div>
                ) : view === "brain" ? (
                    <div className="grid gap-0" data-testid="agent-studio-brain">
                        <Row label="Model">
                            {agent.modelBindingModelId ? `Model #${agent.modelBindingModelId}` : <Empty>Unbound — it runs on whatever the room defaults to, and its cost cannot be predicted.</Empty>}
                        </Row>
                        <Row label="Provider">{agent.modelBindingProviderId ? `Provider #${agent.modelBindingProviderId}` : <Empty>Unbound</Empty>}</Row>
                        <Row label="Temperament">
                            {agent.oceanTraits ? (
                                <span className="font-mono text-[11px]">
                                    O {agent.oceanTraits.o} · C {agent.oceanTraits.c} · E {agent.oceanTraits.e} · A {agent.oceanTraits.a} · N {agent.oceanTraits.n}
                                </span>
                            ) : (
                                <Empty>Even 0.5 across the board, which emits nothing.</Empty>
                            )}
                        </Row>
                    </div>
                ) : view === "reach" ? (
                    <div className="grid gap-2" data-testid="agent-studio-reach">
                        {tools.length === 0 ? (
                            <Empty>It can call nothing. It answers from the conversation and what it is told.</Empty>
                        ) : (
                            <ul className="grid gap-1 text-xs">
                                {tools.map((tool) => (
                                    <li key={tool} className="flex items-center gap-1.5">
                                        {isConsequentialTool(tool) ? (
                                            <ShieldAlert className="h-3 w-3 shrink-0 text-amber-500" aria-hidden />
                                        ) : (
                                            <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                                        )}
                                        <span className="font-mono text-[11px]">{tool}</span>
                                        {isConsequentialTool(tool) && <span className="text-[10px] text-amber-600 dark:text-amber-400">acts outside the platform</span>}
                                    </li>
                                ))}
                            </ul>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                            This is a ceiling, not a plan: a room can still withhold any of these. Changing it is a
                            proposal you approve, so nothing here grants a permission on its own.
                        </p>
                    </div>
                ) : view === "knowledge" ? (
                    <div className="grid gap-0" data-testid="agent-studio-knowledge">
                        <Row label="Topics">
                            {agent.topicAffinities?.length ? agent.topicAffinities.join(", ") : <Empty>None — it answers from the conversation alone.</Empty>}
                        </Row>
                        <Row label="Intents">{agent.intentAffinities?.length ? agent.intentAffinities.join(", ") : <Empty>None</Empty>}</Row>
                        <Row label="Capabilities">{agent.capabilities?.length ? agent.capabilities.join(", ") : <Empty>None declared</Empty>}</Row>
                    </div>
                ) : view === "governance" ? (
                    <div className="grid gap-2" data-testid="agent-studio-governance">
                        {reaching.length === 0 ? (
                            <Empty>No externally acting tools were identified by name. Runtime policy still determines approval requirements.</Empty>
                        ) : (
                            <>
                                <p className="text-xs text-foreground">These tools can act outside the platform. Approval depends on the runtime policy:</p>
                                <ul className="grid gap-1 text-xs">
                                    {reaching.map((tool) => (
                                        <li key={tool} className="flex items-center gap-1.5">
                                            <ShieldAlert className="h-3 w-3 shrink-0 text-amber-500" aria-hidden />
                                            <span className="font-mono text-[11px]">{tool}</span>
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                            This view summarizes tool names; it does not configure or prove approval policy. Tool grants are changed through a reviewed agent proposal.
                        </p>
                    </div>
                ) : view === "try" ? (
                    <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-border p-4 text-center" data-testid="agent-studio-try">
                        <Brain className="h-6 w-6 text-muted-foreground/60" aria-hidden />
                        <p className="text-sm font-medium text-foreground">Talk to it in the room</p>
                        <p className="text-xs text-muted-foreground">
                            This agent is a member of the room it was made in. Address it there and watch what it reaches
                            for — a sandboxed rehearsal against an unsaved draft is not built yet.
                        </p>
                        <Button size="sm" variant="outline" onClick={() => setTeaching(true)}>Teach a browser workflow</Button>
                        <p className="text-xs text-muted-foreground">Learned skills are organization-shared. This agent still needs computer-use tool grants to invoke them.</p>
                    </div>
                ) : (
                    <div className="grid gap-2" data-testid="agent-studio-evidence">
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Gauge className="h-3 w-3" aria-hidden />
                            How this agent has actually done — runs, spend and where it got stuck — is recorded per job.
                        </p>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Coins className="h-3 w-3" aria-hidden />
                            Its cost per run depends on the model it is bound to, which is on the Brain tab.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default AgentStudio;
