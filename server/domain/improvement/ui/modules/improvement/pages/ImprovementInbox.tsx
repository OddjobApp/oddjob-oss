import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertTriangle, CircleSlash } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import CapabilityGapPanel from "../components/CapabilityGapPanel";

/**
 * The Improvement Inbox (§13).
 *
 * Deliberately an inbox, not an innovation dashboard. Every card is a decision
 * waiting on a person, and the surface is built so that what is NOT known is as
 * visible as what is: contradicting evidence sits beside supporting evidence,
 * limitations sit beside assumptions, and a candidate with no observations says
 * so rather than looking merely new.
 *
 * Nothing here computes a metric. Scores, verdicts and measurements come from
 * the server, which computes them deterministically; this renders what it is
 * given and never derives a number a reviewer might mistake for a measurement.
 */

type ImprovementStatus =
    | "observed" | "investigating" | "proposed" | "approved" | "experimenting"
    | "evaluating" | "promoted" | "revised" | "rejected" | "archived";

interface Opportunity {
    id: number;
    kind: "capability_gap" | "policy_candidate" | "workflow_candidate";
    title: string;
    status: ImprovementStatus;
    confidence: number;
    assumptions: string[];
    limitations: string[];
    sourceWindowStart: string | null;
    sourceWindowEnd: string | null;
    createdByType: string;
    createdById: string;
    updatedAt: string;
}

interface Observation {
    id: number;
    sourceType: string;
    sourceId: string;
    observedAt: string;
    facts: Record<string, unknown>;
    provenance: Record<string, unknown>;
}

interface Hypothesis {
    id: number;
    statement: string;
    mechanism: string | null;
    supportingObservationIds: number[];
    contradictingObservationIds: number[];
    alternatives: string[];
    unknowns: string[];
}

/** Mirrors the server's transition table. The server remains authoritative. */
const NEXT_STATES: Record<ImprovementStatus, ImprovementStatus[]> = {
    observed: ["investigating", "archived"],
    investigating: ["proposed", "archived"],
    proposed: ["approved", "rejected", "revised"],
    approved: ["experimenting"],
    experimenting: ["evaluating"],
    evaluating: ["promoted", "revised", "archived"],
    revised: ["proposed"],
    promoted: [],
    rejected: [],
    archived: [],
};

/** Transitions the server reserves to an authorized human. */
const HUMAN_AUTHORIZED = new Set([
    "proposed→approved", "proposed→rejected", "evaluating→promoted", "evaluating→archived",
]);

const KIND_LABEL: Record<Opportunity["kind"], string> = {
    capability_gap: "Capability gap",
    policy_candidate: "Policy candidate",
    workflow_candidate: "Workflow candidate",
};

const STATUS_TONE: Record<ImprovementStatus, string> = {
    observed: "bg-slate-500/15 text-foreground/70 border-slate-500/40",
    investigating: "bg-sky-500/15 text-sky-300 border-sky-500/40",
    proposed: "bg-amber-500/15 text-amber-300 border-amber-500/40",
    approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    experimenting: "bg-teal-500/15 text-teal-300 border-teal-500/40",
    evaluating: "bg-indigo-500/15 text-indigo-300 border-indigo-500/40",
    promoted: "bg-emerald-600/20 text-emerald-200 border-emerald-600/50",
    revised: "bg-orange-500/15 text-orange-300 border-orange-500/40",
    rejected: "bg-rose-500/15 text-rose-300 border-rose-500/40",
    archived: "bg-zinc-500/15 text-muted-foreground border-zinc-500/40",
};

async function fetchJson(url: string) {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed: ${res.status}`);
    return res.json();
}

function formatWindow(start: string | null, end: string | null): string {
    if (!start && !end) return "No observation window recorded";
    const fmt = (v: string | null) => (v ? new Date(v).toLocaleDateString() : "—");
    return `${fmt(start)} → ${fmt(end)}`;
}

function EvidencePanel({ opportunityId }: { opportunityId: number }) {
    const observations = useQuery<{ observations: Observation[] }>({
        queryKey: [`/api/improvement/opportunities/${opportunityId}/observations`],
        queryFn: () => fetchJson(`/api/improvement/opportunities/${opportunityId}/observations`),
    });
    const hypotheses = useQuery<{ hypotheses: Hypothesis[] }>({
        queryKey: [`/api/improvement/opportunities/${opportunityId}/hypotheses`],
        queryFn: () => fetchJson(`/api/improvement/opportunities/${opportunityId}/hypotheses`),
    });

    if (observations.isLoading || hypotheses.isLoading) {
        return (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading evidence…
            </div>
        );
    }

    const obs = observations.data?.observations ?? [];
    const hyps = hypotheses.data?.hypotheses ?? [];

    return (
        <div className="space-y-4 pt-2">
            <section>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    Observations ({obs.length})
                </h4>
                {obs.length === 0 ? (
                    // Absence is a finding, not a blank space.
                    <p className="text-sm text-amber-300/90 flex items-center gap-2">
                        <CircleSlash className="h-4 w-4" />
                        No observations recorded. Nothing here is evidenced yet.
                    </p>
                ) : (
                    <ul className="space-y-2">
                        {obs.map((o) => (
                            <li key={o.id} className="rounded border border-border/60 bg-muted/30 p-2 text-sm">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline" className="text-[10px]">{o.sourceType}</Badge>
                                    <span className="font-mono text-xs text-muted-foreground">{o.sourceId}</span>
                                    <span className="text-xs text-muted-foreground">
                                        {new Date(o.observedAt).toLocaleString()}
                                    </span>
                                </div>
                                <pre className="mt-1 overflow-x-auto text-xs text-muted-foreground">
                                    {JSON.stringify(o.facts, null, 0)}
                                </pre>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    Hypotheses ({hyps.length})
                </h4>
                {hyps.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hypothesis proposed yet.</p>
                ) : (
                    <ul className="space-y-3">
                        {hyps.map((h) => (
                            <li key={h.id} className="rounded border border-border/60 p-3 text-sm">
                                <p className="font-medium">{h.statement}</p>
                                {h.mechanism && (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        <span className="uppercase tracking-wider">Proposed mechanism (hypothesis): </span>
                                        {h.mechanism}
                                    </p>
                                )}
                                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
                                        Supporting: {h.supportingObservationIds.length}
                                    </Badge>
                                    {/* Counter-evidence gets equal billing, always. */}
                                    <Badge variant="outline" className="border-rose-500/40 text-rose-300">
                                        Contradicting: {h.contradictingObservationIds.length}
                                    </Badge>
                                </div>
                                {h.unknowns.length > 0 && (
                                    <p className="mt-2 text-xs text-amber-300/90">
                                        Unknowns: {h.unknowns.join("; ")}
                                    </p>
                                )}
                                {h.alternatives.length > 0 && (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Alternatives considered: {h.alternatives.join("; ")}
                                    </p>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
    const [expanded, setExpanded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const queryClient = useQueryClient();

    const transition = useMutation({
        mutationFn: async (to: ImprovementStatus) => {
            const res = await fetch(`/api/improvement/opportunities/${opportunity.id}/transition`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ to }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error ?? `Transition failed (${res.status})`);
            return body;
        },
        onSuccess: () => {
            setError(null);
            queryClient.invalidateQueries({ queryKey: ["/api/improvement/opportunities"] });
        },
        // The server refuses with a reason; show it verbatim rather than a
        // generic failure, because "you lack authority" and "that move is
        // illegal" call for different responses from the reader.
        onError: (err: Error) => setError(err.message),
    });

    const nextStates = NEXT_STATES[opportunity.status] ?? [];

    return (
        <Card className="border-border/70">
            <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="text-base">{opportunity.title}</CardTitle>
                    <Badge variant="outline" className={STATUS_TONE[opportunity.status]}>
                        {opportunity.status}
                    </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="text-[10px]">{KIND_LABEL[opportunity.kind]}</Badge>
                    <span>{formatWindow(opportunity.sourceWindowStart, opportunity.sourceWindowEnd)}</span>
                    <span>·</span>
                    <span>
                        Raised by {opportunity.createdByType}:{opportunity.createdById}
                    </span>
                </div>
            </CardHeader>

            <CardContent className="space-y-3">
                {/* Labelled precisely: this is confidence in the description, not
                    a probability that the improvement will work. */}
                <p className="text-xs text-muted-foreground">
                    Confidence in this description: <span className="font-mono">{opportunity.confidence}/100</span>
                    <span className="ml-1 italic">(not a probability of success)</span>
                </p>

                {opportunity.assumptions.length > 0 && (
                    <div className="text-xs">
                        <span className="uppercase tracking-wider text-muted-foreground">Assumptions: </span>
                        {opportunity.assumptions.join("; ")}
                    </div>
                )}

                {opportunity.limitations.length > 0 ? (
                    <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                        <span>
                            <span className="uppercase tracking-wider text-amber-300">Not observed: </span>
                            {opportunity.limitations.join("; ")}
                        </span>
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground italic">
                        No limitations declared — treat the evidence as unbounded in scope until one is.
                    </p>
                )}

                <Separator />

                <Button variant="ghost" size="sm" onClick={() => setExpanded(v => !v)}>
                    {expanded ? "Hide evidence" : "Show evidence"}
                </Button>
                {expanded && <EvidencePanel opportunityId={opportunity.id} />}

                {nextStates.length > 0 && (
                    <>
                        <Separator />
                        <div className="space-y-2">
                            <p className="text-xs uppercase tracking-wider text-muted-foreground">Decision</p>
                            <div className="flex flex-wrap gap-2">
                                {nextStates.map((to) => {
                                    const key = `${opportunity.status}→${to}`;
                                    const needsAuthority = HUMAN_AUTHORIZED.has(key);
                                    return (
                                        <Button
                                            key={to}
                                            size="sm"
                                            variant={needsAuthority ? "default" : "outline"}
                                            disabled={transition.isPending}
                                            onClick={() => transition.mutate(to)}
                                            title={
                                                needsAuthority
                                                    ? "Reserved to an authorized human; the server re-checks this."
                                                    : undefined
                                            }
                                        >
                                            {to}
                                            {needsAuthority && (
                                                <span className="ml-1 text-[10px] opacity-80">· authority</span>
                                            )}
                                        </Button>
                                    );
                                })}
                            </div>
                            {error && <p className="text-xs text-rose-300">{error}</p>}
                        </div>
                    </>
                )}

                {nextStates.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                        Terminal state — a recorded decision. Reopening means a new opportunity citing this one.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

export default function ImprovementInbox() {
    const { data, isLoading, error } = useQuery<{ opportunities: Opportunity[]; count: number }>({
        queryKey: ["/api/improvement/opportunities"],
        queryFn: () => fetchJson("/api/improvement/opportunities"),
    });

    return (
        <div className="mx-auto max-w-4xl space-y-6 p-6">
            <header className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">Improvement Inbox</h1>
                <p className="max-w-2xl text-sm text-muted-foreground">
                    Candidates raised from recorded evidence. Each is a decision waiting on a person —
                    nothing here promotes itself, and every figure shown was computed by a
                    deterministic service rather than inferred.
                </p>
            </header>

            {isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading candidates…
                </div>
            )}

            {error && (
                <div className="rounded border border-rose-500/40 bg-rose-500/5 p-3 text-sm text-rose-300">
                    {(error as Error).message}
                </div>
            )}

            {data && data.opportunities.length === 0 && (
                <Card>
                    <CardContent className="p-6 text-sm text-muted-foreground">
                        No improvement candidates yet. Candidates appear once evidence has been recorded
                        against an opportunity — an empty inbox means nothing has been observed, not that
                        nothing is wrong.
                    </CardContent>
                </Card>
            )}

            <div className="space-y-4">
                {data?.opportunities.map((o) => (
                    <OpportunityCard key={o.id} opportunity={o} />
                ))}
            </div>

            <Separator />

            <CapabilityGapPanel />
        </div>
    );
}
