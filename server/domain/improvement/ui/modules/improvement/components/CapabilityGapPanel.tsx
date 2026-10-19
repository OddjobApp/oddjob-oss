import { useQuery } from "@tanstack/react-query";
import { Loader2, AlertTriangle, ShieldQuestion } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Scored capability-gap candidates (§6).
 *
 * The score state is the point of this panel, not the number. A `provisional`
 * score is an understatement with named gaps; a `withheld` one is a refusal to
 * guess. Rendering either as a bare figure would undo the reason they exist.
 */

type ScoreState = "final" | "provisional" | "withheld";

interface ScoreComponent {
    id: string;
    points: number;
    max: number;
    state: "measured" | "unavailable";
    detail: string;
}

interface PrioritizedGap {
    key: string;
    intendedOutcome: string;
    score: number | null;
    scoreState: ScoreState;
    components: ScoreComponent[];
    penalties: ScoreComponent[];
    outstanding: string[];
    reasons: string[];
}

interface AggregatedGap {
    key: string;
    signature: { intendedOutcome: string; requiredVerb: string; requiredObject: string };
    eventCount: number;
    uniqueAffectedRuns: number;
}

interface GapReport {
    capabilityGaps: PrioritizedGap[];
    allotmentGaps: AggregatedGap[];
    dataQuality: {
        totalEvents: number;
        eventsWithoutRunIdentity: number;
        eventsWithoutActor: number;
        similarityBudgetExceeded: number;
    };
}

const STATE_TONE: Record<ScoreState, string> = {
    final: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    provisional: "bg-amber-500/15 text-amber-300 border-amber-500/40",
    withheld: "bg-rose-500/15 text-rose-300 border-rose-500/40",
};

async function fetchJson(url: string) {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed: ${res.status}`);
    return res.json();
}

function ComponentRow({ c }: { c: ScoreComponent }) {
    const unavailable = c.state === "unavailable";
    return (
        <li className={`flex flex-wrap items-baseline gap-2 ${unavailable ? "opacity-70" : ""}`}>
            <span className="font-mono text-xs">{c.id}</span>
            <span className="font-mono text-xs tabular-nums">
                {unavailable ? "—" : c.points}/{c.max}
            </span>
            {unavailable && (
                <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-300">
                    unavailable
                </Badge>
            )}
            {/* The arithmetic, so the number can be checked by hand. */}
            <span className="text-xs text-muted-foreground">{c.detail}</span>
        </li>
    );
}

export default function CapabilityGapPanel() {
    const { data, isLoading, error } = useQuery<GapReport>({
        queryKey: ["/api/improvement/capability-gaps"],
        queryFn: () => fetchJson("/api/improvement/capability-gaps"),
    });

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Analysing capability gaps…
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded border border-rose-500/40 bg-rose-500/5 p-3 text-sm text-rose-300">
                {(error as Error).message}
            </div>
        );
    }

    const gaps = data?.capabilityGaps ?? [];
    const allotment = data?.allotmentGaps ?? [];

    return (
        <section className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold tracking-tight">Capability gaps</h2>
                <p className="max-w-2xl text-sm text-muted-foreground">
                    Capabilities an agent tried to use and could not. Scored from recorded events —
                    a score is only shown when its inputs allow one.
                </p>
            </div>

            {data && data.dataQuality.totalEvents === 0 && (
                <Card>
                    <CardContent className="p-6 text-sm text-muted-foreground">
                        No capability-gap events recorded yet. This fills as agents encounter tools
                        they cannot use — an empty list means nothing has been observed, not that
                        nothing is missing.
                    </CardContent>
                </Card>
            )}

            {gaps.map((gap) => (
                <Card key={gap.key} className="border-border/70">
                    <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <CardTitle className="font-mono text-sm">{gap.intendedOutcome}</CardTitle>
                            <div className="flex items-center gap-2">
                                <span className="font-mono text-lg tabular-nums">
                                    {gap.score === null ? "—" : gap.score}
                                </span>
                                <Badge variant="outline" className={STATE_TONE[gap.scoreState]}>
                                    {gap.scoreState}
                                </Badge>
                            </div>
                        </div>
                    </CardHeader>

                    <CardContent className="space-y-3">
                        {gap.reasons.map((reason, i) => (
                            <p
                                key={i}
                                className={`flex items-start gap-2 text-xs ${
                                    gap.scoreState === "withheld" ? "text-rose-300" : "text-amber-300/90"
                                }`}
                            >
                                {gap.scoreState === "withheld" ? (
                                    <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                ) : (
                                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                )}
                                {reason}
                            </p>
                        ))}

                        <ul className="space-y-1">
                            {gap.components.map(c => <ComponentRow key={c.id} c={c} />)}
                        </ul>
                        <ul className="space-y-1 border-t border-border/60 pt-2">
                            {gap.penalties.map(c => <ComponentRow key={c.id} c={c} />)}
                        </ul>

                        {gap.outstanding.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                                Needed for a final score: {gap.outstanding.join(", ")}
                            </p>
                        )}
                    </CardContent>
                </Card>
            ))}

            {allotment.length > 0 && (
                <Card className="border-sky-500/30">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">
                            Allotment gaps ({allotment.length}) — not capability candidates
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {/* These exist; the run simply was not permitted to use them.
                            Scoring them for capability invention would propose
                            building something the platform already has. */}
                        <p className="text-xs text-muted-foreground">
                            A registered tool sat outside the run's permitted allotment. These are
                            access and recruitment questions, deliberately left unscored.
                        </p>
                        <ul className="space-y-1">
                            {allotment.map(g => (
                                <li key={g.key} className="flex flex-wrap items-baseline gap-2 text-xs">
                                    <span className="font-mono">{g.signature.intendedOutcome}</span>
                                    <span className="text-muted-foreground">
                                        {g.uniqueAffectedRuns} run(s), {g.eventCount} event(s)
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            )}

            {data && data.dataQuality.totalEvents > 0 && (
                <p className="text-xs text-muted-foreground">
                    {data.dataQuality.totalEvents} event(s) ·{" "}
                    {data.dataQuality.eventsWithoutRunIdentity} without run identity (excluded from
                    frequency) · {data.dataQuality.eventsWithoutActor} without an actor (excluded from
                    user impact)
                    {data.dataQuality.similarityBudgetExceeded > 0 &&
                        ` · ${data.dataQuality.similarityBudgetExceeded} candidate(s) past the similarity budget, scores withheld`}
                </p>
            )}
        </section>
    );
}
