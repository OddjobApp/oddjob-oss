import React, { useEffect, useMemo, useState } from "react";
import {
    GitCommitHorizontal,
    GitCompare,
    History,
    RotateCcw,
    ShieldCheck,
    FileCheck2,
    X,
    Loader2,
    Link2,
} from "lucide-react";
import type { ScribeDocument, ScribeNode, ScribeRevision, ScribeReview } from "@shared/schema/scribe";
import { apiRequest } from "@/lib/queryClient";
import { useModalBehavior } from "@/hooks/use-modal-behavior";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface ScribeGovernancePanelProps {
    document: ScribeDocument;
    /** Stations on the active branch — used to label node-scoped reviews. */
    nodes: ScribeNode[];
    activeNode: ScribeNode | null;
    /** Reload the document view after a mutation (rollback, metadata save). */
    onChanged: () => void;
    className?: string;
}

interface DocTreeEntry {
    id: number;
    title: string;
}

interface DiffChange {
    stationKey: string;
    title: string;
    status: "added" | "removed" | "modified" | "unchanged";
    before: string | null;
    after: string | null;
    wordDelta: number;
    lines?: Array<{ type: "same" | "added" | "removed"; text: string }>;
}

const KIND_BADGE: Record<string, string> = {
    commit: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30",
    edit: "bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/30",
    merge: "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30",
    fork: "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30",
    publish: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30",
    rollback: "bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30",
    reset: "bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30",
    delete: "bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30",
    metadata: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/30",
    review_request: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/30",
    outline: "bg-muted text-muted-foreground border-border",
    add: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30",
    rename: "bg-muted text-muted-foreground border-border",
};

function flattenTree(nodes: any[], depth = 0): DocTreeEntry[] {
    const out: DocTreeEntry[] = [];
    for (const n of nodes ?? []) {
        out.push({ id: n.id, title: `${"— ".repeat(depth)}${n.title}` });
        out.push(...flattenTree(n.children ?? [], depth + 1));
    }
    return out;
}

function formatWhen(iso: string | Date | null | undefined): string {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleString();
}

/** Side-by-side / unified diff for two revisions of the manuscript. */
const RevisionDiffModal: React.FC<{
    diff: { from: ScribeRevision; to: ScribeRevision; changes: DiffChange[] };
    onClose: () => void;
}> = ({ diff, onClose }) => {
    const panelRef = useModalBehavior<HTMLDivElement>({ isOpen: true, onClose });
    const changed = diff.changes.filter((c) => c.status !== "unchanged");

    return (
        <div data-testid="revision-diff-modal" className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label="Revision comparison"
                className="flex h-[85vh] w-full max-w-5xl flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden font-mono text-xs"
            >
                <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                        <GitCompare className="h-4 w-4 text-emerald-500" />
                        <span className="font-bold text-foreground text-sm">
                            r{diff.from.revisionNumber} → r{diff.to.revisionNumber}
                        </span>
                        <span className="text-muted-foreground text-xs">
                            {changed.length} station{changed.length === 1 ? "" : "s"} changed
                        </span>
                    </div>
                    <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto bg-background p-4 space-y-4">
                    {changed.length === 0 && (
                        <div className="flex h-full items-center justify-center text-muted-foreground italic">
                            No content differences between these revisions.
                        </div>
                    )}
                    {changed.map((c) => (
                        <div key={c.stationKey} className="rounded-lg border border-border overflow-hidden">
                            <div className="flex items-center justify-between bg-muted/30 px-3 py-2">
                                <span className="font-semibold text-foreground">{c.title}</span>
                                <span className={cn("text-[10px] uppercase font-bold",
                                    c.status === "added" ? "text-emerald-500" :
                                    c.status === "removed" ? "text-rose-500" : "text-sky-500")}>
                                    {c.status} · {c.wordDelta > 0 ? `+${c.wordDelta}` : c.wordDelta}w
                                </span>
                            </div>
                            {c.lines ? (
                                <div className="px-3 py-2 leading-relaxed">
                                    {c.lines.map((l, i) => (
                                        <div
                                            key={i}
                                            className={cn(
                                                "whitespace-pre-wrap font-sans",
                                                l.type === "added" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                                                l.type === "removed" && "bg-rose-500/10 text-rose-700 dark:text-rose-300 line-through",
                                                l.type === "same" && "text-foreground/80",
                                            )}
                                        >
                                            {l.type === "added" ? "+ " : l.type === "removed" ? "− " : "  "}
                                            {l.text}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <pre className="px-3 py-2 font-sans text-xs text-foreground whitespace-pre-wrap">
                                    {c.after ?? c.before ?? ""}
                                </pre>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export const ScribeGovernancePanel: React.FC<ScribeGovernancePanelProps> = ({
    document,
    nodes,
    activeNode,
    onChanged,
    className,
}) => {
    const docId = document.id;

    const [treeDocs, setTreeDocs] = useState<DocTreeEntry[]>([]);
    const [revisions, setRevisions] = useState<ScribeRevision[]>([]);
    const [reviews, setReviews] = useState<ScribeReview[]>([]);
    const [restoreTarget, setRestoreTarget] = useState<{ documentId: number; revision: ScribeRevision } | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [aiSystemId, setAiSystemId] = useState(document.aiSystemId ?? "");
    const [lineageRef, setLineageRef] = useState<string>(document.dataLineageGraphId?.toString() ?? "");
    const [biasRef, setBiasRef] = useState<string>(document.biasMitigationStrategyDocumentId?.toString() ?? "");
    const [govRef, setGovRef] = useState<string>(document.governancePolicyDocumentId?.toString() ?? "");

    const [commitMessage, setCommitMessage] = useState("");
    const [diff, setDiff] = useState<{ from: ScribeRevision; to: ScribeRevision; changes: DiffChange[] } | null>(null);

    useEffect(() => {
        setRestoreTarget(null);
        setAiSystemId(document.aiSystemId ?? "");
        setLineageRef(document.dataLineageGraphId?.toString() ?? "");
        setBiasRef(document.biasMitigationStrategyDocumentId?.toString() ?? "");
        setGovRef(document.governancePolicyDocumentId?.toString() ?? "");
    }, [docId, document.aiSystemId, document.dataLineageGraphId, document.biasMitigationStrategyDocumentId, document.governancePolicyDocumentId]);

    const refresh = async () => {
        try {
            const [revRes, reviewRes, treeRes] = await Promise.all([
                apiRequest("GET", `/api/scribe/documents/${docId}/revisions?limit=50`),
                apiRequest("GET", `/api/scribe/documents/${docId}/reviews`),
                apiRequest("GET", `/api/scribe/tree`),
            ]);
            const revData = await revRes.json();
            const reviewData = await reviewRes.json();
            const treeData = await treeRes.json();
            setRevisions(revData.revisions ?? []);
            setReviews(reviewData.reviews ?? []);
            setTreeDocs(flattenTree(Array.isArray(treeData) ? treeData : []));
        } catch (err: any) {
            setError(err.message || "Failed to load governance data");
        }
    };

    useEffect(() => {
        void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [docId]);

    const docOptions = useMemo(() => treeDocs.filter((t) => t.id !== docId), [treeDocs, docId]);

    const saveMetadata = async () => {
        setBusy("metadata");
        setError(null);
        try {
            await apiRequest("PATCH", `/api/scribe/documents/${docId}/ai-system`, {
                aiSystemId: aiSystemId.trim() || null,
                dataLineageGraphId: lineageRef ? parseInt(lineageRef, 10) : null,
                biasMitigationStrategyDocumentId: biasRef ? parseInt(biasRef, 10) : null,
                governancePolicyDocumentId: govRef ? parseInt(govRef, 10) : null,
            });
            onChanged();
            await refresh();
        } catch (err: any) {
            setError(err.message || "Failed to save AI-system metadata");
        } finally {
            setBusy(null);
        }
    };

    const commit = async () => {
        setBusy("commit");
        setError(null);
        try {
            await apiRequest("POST", `/api/scribe/documents/${docId}/commits`, {
                message: commitMessage.trim() || undefined,
            });
            setCommitMessage("");
            await refresh();
        } catch (err: any) {
            setError(err.message || "Failed to commit snapshot");
        } finally {
            setBusy(null);
        }
    };

    const showDiff = async (revision: ScribeRevision) => {
        // Diff against the next-older revision in the list — the state this
        // one moved away from.
        const idx = revisions.findIndex((r) => r.id === revision.id);
        const previous = revisions[idx + 1];
        if (!previous) {
            setError("No earlier revision to compare against.");
            return;
        }
        setBusy(`diff-${revision.id}`);
        setError(null);
        try {
            const res = await apiRequest("GET", `/api/scribe/documents/${docId}/revisions/diff?from=${previous.id}&to=${revision.id}`);
            setDiff(await res.json());
        } catch (err: any) {
            setError(err.message || "Failed to load diff");
        } finally {
            setBusy(null);
        }
    };

    const rollback = async (revision: ScribeRevision) => {
        if (busy || restoreTarget?.documentId !== docId) return;
        setBusy(`rollback-${revision.id}`);
        setError(null);
        try {
            await apiRequest("POST", `/api/scribe/documents/${docId}/revisions/${revision.id}/rollback`);
            setRestoreTarget(null);
            onChanged();
            await refresh();
        } catch (err: any) {
            setError(err.message || "Failed to roll back");
        } finally {
            setBusy(null);
        }
    };

    const requestReview = async (nodeId?: number) => {
        setBusy("review");
        setError(null);
        try {
            await apiRequest("POST", `/api/scribe/documents/${docId}/reviews`, nodeId ? { nodeId } : {});
            onChanged();
            await refresh();
        } catch (err: any) {
            setError(err.message || "Failed to request review");
        } finally {
            setBusy(null);
        }
    };

    const decide = async (reviewId: number, decision: "approved" | "changes_requested") => {
        setBusy(`decide-${reviewId}`);
        setError(null);
        try {
            await apiRequest("POST", `/api/scribe/reviews/${reviewId}/decision`, { decision });
            onChanged();
            await refresh();
        } catch (err: any) {
            setError(err.message || "Failed to record decision");
        } finally {
            setBusy(null);
        }
    };

    const nodeTitle = (nodeId: number | null) =>
        nodeId == null ? "Whole document" : nodes.find((n) => n.id === nodeId)?.title ?? `Station #${nodeId}`;

    const linkSelect = (
        label: string,
        value: string,
        setValue: (v: string) => void,
    ) => (
        <label className="block">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</span>
            <select
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
                <option value="">— none —</option>
                {docOptions.map((d) => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                ))}
            </select>
        </label>
    );

    return (
        <div className={cn("w-full h-full overflow-y-auto font-mono text-xs", className)} data-testid="scribe-governance-panel">
            <AlertDialog open={restoreTarget?.documentId === docId} onOpenChange={open => { if (!open && !busy) setRestoreTarget(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Restore revision r{restoreTarget?.revision.revisionNumber}?</AlertDialogTitle>
                        <AlertDialogDescription>The current state stays in history. Restoring appends a new revision without erasing earlier versions.</AlertDialogDescription>
                    </AlertDialogHeader>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={Boolean(busy)}>Cancel</AlertDialogCancel>
                        <AlertDialogAction disabled={Boolean(busy)} onClick={event => { event.preventDefault(); if (restoreTarget) void rollback(restoreTarget.revision); }}>
                            {busy?.startsWith('rollback-') ? 'Restoring…' : 'Restore revision'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            {diff && <RevisionDiffModal diff={diff} onClose={() => setDiff(null)} />}

            {error && (
                <div className="m-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-600 dark:text-rose-300">
                    {error}
                </div>
            )}

            {/* ── AI System ── */}
            <section className="border-b border-border px-3 py-3 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" />
                    AI System
                </div>
                <label className="block">
                    <span className="text-[10px] font-semibold uppercase text-muted-foreground">AI System ID</span>
                    <input
                        value={aiSystemId}
                        onChange={(e) => setAiSystemId(e.target.value)}
                        placeholder="e.g. aisys-prod-0123"
                        className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    />
                </label>
                {linkSelect("Data lineage document", lineageRef, setLineageRef)}
                {linkSelect("Bias mitigation strategy", biasRef, setBiasRef)}
                {linkSelect("Governance policy", govRef, setGovRef)}
                <button
                    type="button"
                    onClick={() => void saveMetadata()}
                    disabled={busy === "metadata"}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50"
                >
                    {busy === "metadata" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                    Save AI-system links
                </button>
            </section>

            {/* ── Reviews ── */}
            <section className="border-b border-border px-3 py-3 space-y-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground">
                        <FileCheck2 className="h-3.5 w-3.5 text-emerald-400" />
                        Reviews
                    </div>
                    <div className="flex gap-1">
                        <button
                            type="button"
                            disabled={!activeNode || busy === "review"}
                            onClick={() => void requestReview(activeNode?.id)}
                            className="rounded-md border border-border bg-background px-2 py-0.5 text-[10px] font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                            title={activeNode ? `Request review of "${activeNode.title}"` : "Select a station first"}
                        >
                            Station
                        </button>
                        <button
                            type="button"
                            disabled={busy === "review"}
                            onClick={() => void requestReview(undefined)}
                            className="rounded-md border border-border bg-background px-2 py-0.5 text-[10px] font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                        >
                            Document
                        </button>
                    </div>
                </div>
                {reviews.length === 0 && (
                    <p className="text-[10px] text-muted-foreground italic">No review requests yet.</p>
                )}
                {reviews.slice(0, 10).map((r) => (
                    <div key={r.id} className="rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-foreground truncate">{nodeTitle(r.nodeId)}</span>
                            <span className={cn("shrink-0 rounded-full border px-1.5 py-0.2 text-[9px] font-bold uppercase",
                                r.status === "approved" ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-300" :
                                r.status === "changes_requested" ? "border-amber-500/40 text-amber-600 dark:text-amber-300" :
                                "border-sky-500/40 text-sky-600 dark:text-sky-300")}>
                                {r.status.replaceAll("_", " ")}
                            </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                            by {r.requestedBy}
                            {r.revisionId ? ` · pins r${revisions.find((v) => v.id === r.revisionId)?.revisionNumber ?? "?"}` : ""}
                            {r.decisionNote ? ` · ${r.decisionNote}` : ""}
                        </div>
                        {r.status === "pending" && (
                            <div className="flex gap-1.5 pt-0.5">
                                <button
                                    type="button"
                                    disabled={busy === `decide-${r.id}`}
                                    onClick={() => void decide(r.id, "approved")}
                                    className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                                >
                                    Approve
                                </button>
                                <button
                                    type="button"
                                    disabled={busy === `decide-${r.id}`}
                                    onClick={() => void decide(r.id, "changes_requested")}
                                    className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                                >
                                    Request changes
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </section>

            {/* ── History ── */}
            <section className="px-3 py-3 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground">
                    <History className="h-3.5 w-3.5 text-sky-400" />
                    Version History
                </div>
                <div className="flex gap-1.5">
                    <input
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        placeholder="Commit message…"
                        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    />
                    <button
                        type="button"
                        onClick={() => void commit()}
                        disabled={busy === "commit"}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                        <GitCommitHorizontal className="h-3 w-3" />
                        Commit
                    </button>
                </div>
                {revisions.length === 0 && (
                    <p className="text-[10px] text-muted-foreground italic">No revisions recorded yet.</p>
                )}
                {revisions.map((r) => (
                    <div key={r.id} className="rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-foreground">r{r.revisionNumber}</span>
                            <span className={cn("rounded-full border px-1.5 py-0.2 text-[9px] font-bold uppercase", KIND_BADGE[r.kind] ?? "bg-muted text-muted-foreground border-border")}>
                                {r.kind.replaceAll("_", " ")}
                            </span>
                        </div>
                        {r.message && <div className="mt-0.5 truncate text-foreground/80" title={r.message}>{r.message}</div>}
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                            {r.actor} · {formatWhen(r.createdAt)} · {r.scope}
                        </div>
                        <div className="flex gap-1.5 pt-1">
                            <button
                                type="button"
                                disabled={busy === `diff-${r.id}`}
                                onClick={() => void showDiff(r)}
                                className="rounded border border-border bg-background px-2 py-0.5 text-[10px] font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                            >
                                Diff
                            </button>
                            <button
                                type="button"
                                disabled={Boolean(busy)}
                                onClick={() => { setError(null); setRestoreTarget({ documentId: docId, revision: r }); }}
                                className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[10px] font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                            >
                                <RotateCcw className="h-3 w-3" />
                                Restore
                            </button>
                        </div>
                    </div>
                ))}
            </section>
        </div>
    );
};

export default ScribeGovernancePanel;
