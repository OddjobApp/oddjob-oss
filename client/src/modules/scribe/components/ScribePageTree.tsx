import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, FolderTree, Loader2, Tag, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

/**
 * The space index: every manuscript in the organization, nested.
 *
 * Scribe has stations inside a document and branches inside a station, but until
 * now nothing above the document — so a set of related manuscripts was a flat
 * list you navigated by remembering which room each one lived in. This is the
 * layer above: file one under another, tag across the tree, and open any of them
 * without leaving the studio.
 *
 * Reads the tree the server already assembles rather than nesting rows here. The
 * server is where cycle safety lives (setDocumentParent refuses a descendant),
 * and a second, client-side nesting pass would be a second thing to get wrong.
 */

export interface ScribeTreeNode {
    id: number;
    title: string;
    parentDocumentId: number | null;
    labels: string[];
    archetypeMode: string;
    sessionId: number;
    updatedAt: string;
    children: ScribeTreeNode[];
}

interface ScribePageTreeProps {
    /** The manuscript currently open, so the tree can mark it. */
    activeDocumentId?: number;
    onOpenDocument?: (documentId: number) => void;
    /** Fires after a move, so a parent showing breadcrumbs can refresh. */
    onTreeChanged?: () => void;
    /** Fires when the open manuscript is deleted, so a host can leave it. */
    onDocumentDeleted?: (documentId: number) => void;
    className?: string;
}

/** Every id at or beneath a node — the set a node may not be filed under. */
function descendantIds(node: ScribeTreeNode): Set<number> {
    const ids = new Set<number>([node.id]);
    const walk = (n: ScribeTreeNode) => {
        for (const child of n.children) {
            ids.add(child.id);
            walk(child);
        }
    };
    walk(node);
    return ids;
}

/** Flattened, for the move menu's list of candidate parents. */
function flatten(nodes: ScribeTreeNode[], depth = 0): Array<{ node: ScribeTreeNode; depth: number }> {
    return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)]);
}

export const ScribePageTree: React.FC<ScribePageTreeProps> = ({
    activeDocumentId,
    onOpenDocument,
    onTreeChanged,
    onDocumentDeleted,
    className,
}) => {
    const [roots, setRoots] = useState<ScribeTreeNode[]>([]);
    const [labels, setLabels] = useState<Array<{ label: string; count: number }>>([]);
    const [activeLabel, setActiveLabel] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
    const [movingId, setMovingId] = useState<number | null>(null);
    const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
    const [labelDraft, setLabelDraft] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const query = activeLabel ? `?label=${encodeURIComponent(activeLabel)}` : "";
            const [treeRes, labelRes] = await Promise.all([
                apiRequest("GET", `/api/scribe/tree${query}`),
                apiRequest("GET", "/api/scribe/labels"),
            ]);
            setRoots(await treeRes.json());
            setLabels(await labelRes.json());
        } catch (err: any) {
            setError(err?.message || "Could not load the page tree.");
        } finally {
            setIsLoading(false);
        }
    }, [activeLabel]);

    useEffect(() => {
        void load();
    }, [load]);

    const flat = useMemo(() => flatten(roots), [roots]);

    /**
     * The open manuscript, wherever it sits.
     *
     * Label editing lives here rather than in the studio header because this is
     * the surface labels are *for* — the filter above is the only thing that
     * reads them, so editing them anywhere else separates the two halves.
     */
    const activeNode = useMemo(
        () => flat.find(({ node }) => node.id === activeDocumentId)?.node ?? null,
        [flat, activeDocumentId],
    );

    const saveLabels = async (next: string[]) => {
        if (!activeDocumentId) return;
        try {
            // Replaced wholesale, not patched: the server lowercases and
            // de-duplicates, so a delta would mean guessing the stored form here.
            await apiRequest("PUT", `/api/scribe/documents/${activeDocumentId}/labels`, { labels: next });
            await load();
            onTreeChanged?.();
        } catch (err: any) {
            setError(err?.message || "Could not save labels.");
        }
    };

    const moveTo = async (documentId: number, parentDocumentId: number | null) => {
        setMovingId(null);
        try {
            await apiRequest("PATCH", `/api/scribe/documents/${documentId}/parent`, { parentDocumentId });
            await load();
            onTreeChanged?.();
        } catch (err: any) {
            // The server rejects a cycle; surfacing the reason beats a silent no-op.
            setError(err?.message || "Could not move that document.");
        }
    };

    const deleteDocument = async (node: ScribeTreeNode) => {
        setConfirmingDeleteId(null);
        try {
            await apiRequest("DELETE", `/api/scribe/documents/${node.id}`);
            // Deleting the open manuscript leaves the host pointing at a dead
            // id; tell it before the reload so it can fall back cleanly.
            if (node.id === activeDocumentId) onDocumentDeleted?.(node.id);
            await load();
            onTreeChanged?.();
        } catch (err: any) {
            setError(err?.message || "Could not delete that document.");
        }
    };

    const toggle = (id: number) =>
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const renderNode = (node: ScribeTreeNode, depth: number): React.ReactNode => {
        const isActive = node.id === activeDocumentId;
        const hasChildren = node.children.length > 0;
        const isCollapsed = collapsed.has(node.id);
        const forbidden = descendantIds(node);

        return (
            <li key={node.id} data-testid={`scribe-tree-node-${node.id}`}>
                <div
                    className={cn(
                        "group flex items-center gap-1 rounded px-1 py-0.5 text-xs",
                        isActive ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "text-foreground hover:bg-muted",
                    )}
                    style={{ paddingLeft: `${depth * 12 + 4}px` }}
                >
                    {hasChildren ? (
                        <button
                            type="button"
                            onClick={() => toggle(node.id)}
                            className="shrink-0 rounded p-0.5 hover:bg-muted"
                            aria-label={isCollapsed ? `Expand ${node.title}` : `Collapse ${node.title}`}
                        >
                            {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                    ) : (
                        <span className="w-4 shrink-0" />
                    )}

                    <button
                        type="button"
                        onClick={() => onOpenDocument?.(node.id)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        aria-label={`Open ${node.title}`}
                    >
                        <FileText className="h-3 w-3 shrink-0 opacity-70" />
                        <span className="truncate">{node.title}</span>
                    </button>

                    {node.labels.length > 0 && (
                        <span className="hidden shrink-0 gap-1 sm:flex">
                            {node.labels.slice(0, 2).map((label) => (
                                <span
                                    key={label}
                                    className="rounded border border-border bg-muted px-1 text-[9px] text-muted-foreground"
                                >
                                    {label}
                                </span>
                            ))}
                        </span>
                    )}

                    <button
                        type="button"
                        onClick={() => setMovingId(movingId === node.id ? null : node.id)}
                        className="shrink-0 rounded px-1 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                        aria-label={`Move ${node.title}`}
                    >
                        Move
                    </button>

                    {/* Two clicks, matching the spine's station delete: one arms,
                        the second deletes. A document is a bigger blast radius
                        than a station, so the armed state carries the warning. */}
                    <button
                        type="button"
                        onClick={() =>
                            confirmingDeleteId === node.id
                                ? void deleteDocument(node)
                                : setConfirmingDeleteId(node.id)
                        }
                        onBlur={() => setConfirmingDeleteId((id) => (id === node.id ? null : id))}
                        className={cn(
                            "shrink-0 rounded px-1 text-[10px] transition-opacity",
                            confirmingDeleteId === node.id
                                ? "bg-destructive/15 text-destructive animate-pulse opacity-100"
                                : "text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100",
                        )}
                        aria-label={
                            confirmingDeleteId === node.id
                                ? `Confirm delete ${node.title}`
                                : `Delete ${node.title}`
                        }
                        title={
                            confirmingDeleteId === node.id
                                ? node.children.length
                                    ? "Click again to delete — manuscripts filed under it move to the root"
                                    : "Click again to delete this manuscript"
                                : "Delete manuscript"
                        }
                    >
                        {confirmingDeleteId === node.id ? "Delete?" : <Trash2 className="h-3 w-3" />}
                    </button>
                </div>

                {movingId === node.id && (
                    <div
                        className="ml-6 mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg"
                        data-testid={`scribe-tree-move-${node.id}`}
                    >
                        <button
                            type="button"
                            onClick={() => void moveTo(node.id, null)}
                            className="block w-full rounded px-2 py-1 text-left text-[11px] text-foreground hover:bg-muted"
                            aria-label={`File ${node.title} at the root`}
                        >
                            Move to root
                        </button>
                        {flat
                            // A document cannot be filed under itself or its own
                            // descendants; the server refuses it, so offering it
                            // would only produce an error the reader has to read.
                            .filter(({ node: candidate }) => !forbidden.has(candidate.id))
                            .map(({ node: candidate, depth: candidateDepth }) => (
                                <button
                                    key={candidate.id}
                                    type="button"
                                    onClick={() => void moveTo(node.id, candidate.id)}
                                    className="block w-full truncate rounded px-2 py-1 text-left text-[11px] text-foreground hover:bg-muted"
                                    style={{ paddingLeft: `${candidateDepth * 8 + 8}px` }}
                                    aria-label={`File ${node.title} under ${candidate.title}`}
                                >
                                    {candidate.title}
                                </button>
                            ))}
                    </div>
                )}

                {hasChildren && !isCollapsed && (
                    <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>
                )}
            </li>
        );
    };

    return (
        <div
            className={cn("flex min-h-0 flex-col border-r border-border bg-card/40", className)}
            data-testid="scribe-page-tree"
        >
            <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5 text-[11px] font-semibold text-foreground">
                <FolderTree className="h-3.5 w-3.5 text-emerald-500" />
                <span>Manuscripts</span>
                {isLoading && <Loader2 className="ml-auto h-3 w-3 animate-spin text-muted-foreground" />}
            </div>

            {labels.length > 0 && (
                <div className="flex flex-wrap gap-1 border-b border-border/60 px-2 py-1.5">
                    {labels.map(({ label, count }) => (
                        <button
                            key={label}
                            type="button"
                            onClick={() => setActiveLabel(activeLabel === label ? null : label)}
                            className={cn(
                                "flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors",
                                activeLabel === label
                                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                    : "border-border bg-muted text-muted-foreground hover:text-foreground",
                            )}
                            aria-label={`Filter by ${label}`}
                        >
                            <Tag className="h-2.5 w-2.5" />
                            {label}
                            <span className="opacity-60">{count}</span>
                        </button>
                    ))}
                    {activeLabel && (
                        <button
                            type="button"
                            onClick={() => setActiveLabel(null)}
                            className="flex items-center gap-0.5 rounded px-1 text-[10px] text-muted-foreground hover:text-foreground"
                            aria-label="Clear label filter"
                        >
                            <X className="h-2.5 w-2.5" /> clear
                        </button>
                    )}
                </div>
            )}

            {activeNode && (
                <form
                    className="flex flex-wrap items-center gap-1 border-b border-border/60 px-2 py-1.5"
                    onSubmit={(e) => {
                        e.preventDefault();
                        const label = labelDraft.trim();
                        if (!label) return;
                        setLabelDraft("");
                        void saveLabels([...activeNode.labels, label]);
                    }}
                >
                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Labels</span>
                    {activeNode.labels.map((label) => (
                        <button
                            key={label}
                            type="button"
                            onClick={() => void saveLabels(activeNode.labels.filter((l) => l !== label))}
                            className="group inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1 text-[10px] text-muted-foreground hover:border-destructive/50 hover:text-destructive"
                            aria-label={`Remove label ${label}`}
                        >
                            {label}
                            <X className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
                        </button>
                    ))}
                    <input
                        value={labelDraft}
                        onChange={(e) => setLabelDraft(e.target.value)}
                        placeholder="+ label"
                        aria-label="Add a label"
                        data-testid="scribe-label-input"
                        className="w-16 rounded border border-border bg-background px-1 py-0.5 text-[10px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                    />
                </form>
            )}

            {error && (
                <p role="alert" className="px-2 py-1.5 text-[11px] text-destructive" data-testid="scribe-tree-error">
                    {error}
                </p>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
                {!isLoading && roots.length === 0 && !error ? (
                    <p className="px-2 py-2 text-[11px] text-muted-foreground">
                        {activeLabel ? `No manuscripts labelled "${activeLabel}".` : "No manuscripts yet."}
                    </p>
                ) : (
                    <ul>{roots.map((node) => renderNode(node, 0))}</ul>
                )}
            </div>
        </div>
    );
};
