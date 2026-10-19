import React, { useState } from "react";
import { useModalBehavior } from "@/hooks/use-modal-behavior";
import { DocumentTelemetry } from "@domain/scribe/core/scribe.service";
import { Activity, Download, FileDown, Clock, Palette, Send, X, CheckCircle2, PackageCheck, PencilLine } from "lucide-react";
import { relativeTime, type PublishedState } from "../publication-state";

export type ExportTypographyTheme = "corporate_legal" | "novel_manuscript" | "modern_tech";

interface TelemetryExportDockProps {
    telemetry: DocumentTelemetry;
    currentRevision?: number;
    /**
     * The last publish, or null if there has never been one.
     *
     * Publishing showed a tick for 1600ms, closed the modal and left nothing
     * behind, so an author who looked away could not tell whether it had
     * happened. This is the part that stays.
     */
    published?: PublishedState | null;
    onExport: (format: "markdown" | "pdf" | "word", theme?: ExportTypographyTheme) => void;
    onPublish?: (versionTag: string, releaseNotes: string, theme: ExportTypographyTheme) => Promise<void>;
}

export const TelemetryExportDock: React.FC<TelemetryExportDockProps> = ({
    telemetry,
    currentRevision = 1,
    published = null,
    onExport,
    onPublish,
}) => {
    const [selectedTheme, setSelectedTheme] = useState<ExportTypographyTheme>("corporate_legal");
    const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
    const publishPanelRef = useModalBehavior<HTMLDivElement>({
        isOpen: isPublishModalOpen,
        onClose: () => setIsPublishModalOpen(false),
    });
    const [versionTag, setVersionTag] = useState(`v${currentRevision}.0`);
    const [releaseNotes, setReleaseNotes] = useState("Approved manuscript deliverable compiled from Scribe Studio");
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishError, setPublishError] = useState<string | null>(null);
    const [publishSuccess, setPublishSuccess] = useState(false);

    const readingTimeMins = Math.max(1, Math.ceil(telemetry.totalWordCount / 250));
    const completionPct = Math.min(100, Math.max(0, telemetry.completionPercentage || 0));

    const handlePublishSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!onPublish) return;
        setPublishError(null);
        setIsPublishing(true);
        try {
            await onPublish(versionTag, releaseNotes, selectedTheme);
            setPublishSuccess(true);
            setTimeout(() => {
                setPublishSuccess(false);
                setIsPublishModalOpen(false);
            }, 1600);
        } catch (err: any) {
            // Without this the modal just sat there looking idle, and the author
            // had no way to tell a failed publish from a slow one.
            console.error("Publish failed", err);
            setPublishError(err?.message || "Publish failed");
        } finally {
            setIsPublishing(false);
        }
    };

    return (
        <div data-testid="scribe-telemetry-dock" className="relative flex shrink-0 flex-wrap select-none items-center justify-between gap-x-4 gap-y-2 border-t border-border bg-card px-4 py-2 font-mono text-xs text-muted-foreground">
            {/* Publish Release Modal */}
            {isPublishModalOpen && (
                <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
                    <div
                        ref={publishPanelRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Publish a release"
                        className="bg-popover text-popover-foreground border border-border rounded-xl shadow-2xl w-full max-w-md p-5 flex flex-col gap-4 animate-in fade-in zoom-in-95">
                        <div className="flex items-center justify-between border-b border-border pb-3">
                            <div className="flex items-center gap-2">
                                <Send className="w-4 h-4 text-emerald-500" />
                                <span className="font-bold text-sm uppercase tracking-wider text-foreground">
                                    Publish to Project Assets
                                </span>
                            </div>
                            <button
                                type="button"
                                // axe: button-name, critical. An icon-only
                                // button with no text and no label announces as
                                // "button" and nothing else.
                                aria-label="Close publish dialog"
                                onClick={() => setIsPublishModalOpen(false)}
                                className="text-muted-foreground hover:text-foreground p-1 rounded"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {publishSuccess ? (
                            <div className="py-6 flex flex-col items-center justify-center gap-2 text-emerald-500 font-bold text-center">
                                <CheckCircle2 className="w-8 h-8 animate-bounce" />
                                <span>Manuscript Published & Catalogued into Project Assets!</span>
                            </div>
                        ) : (
                            <form onSubmit={handlePublishSubmit} className="flex flex-col gap-3 font-mono text-xs">
                                <div>
                                    <label className="block text-[11px] font-bold text-foreground mb-1">
                                        Release Version Tag:
                                    </label>
                                    <input
                                        type="text"
                                        value={versionTag}
                                        onChange={(e) => setVersionTag(e.target.value)}
                                        className="w-full bg-background border border-border rounded px-3 py-1.5 text-foreground text-xs focus:border-emerald-500 focus:outline-none"
                                        placeholder="e.g. v1.0.0, Final-Batna-Approved"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-[11px] font-bold text-foreground mb-1">
                                        Release Notes / Scope:
                                    </label>
                                    <textarea
                                        rows={3}
                                        value={releaseNotes}
                                        onChange={(e) => setReleaseNotes(e.target.value)}
                                        className="w-full bg-background border border-border rounded px-3 py-1.5 text-foreground text-xs focus:border-emerald-500 focus:outline-none"
                                        placeholder="Describe major clauses, chapters, or sign-offs included in this release..."
                                    />
                                </div>

                                <div className="text-[11px] text-muted-foreground bg-muted/40 p-2.5 rounded border border-border flex flex-col gap-1">
                                    <span className="font-semibold text-foreground">Publication Deliverables:</span>
                                    <span>• Compiled Markdown asset saved to Project Blobs (`file_blobs`)</span>
                                    <span>• Room attachment reference created (`crew_attachments`)</span>
                                    <span>• Auto-indexed for Knowledge Graph & Agent recall</span>
                                </div>

                                <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                                    <button
                                        type="button"
                                        onClick={() => setIsPublishModalOpen(false)}
                                        className="px-3 py-1.5 bg-background hover:bg-muted border border-border rounded text-foreground text-xs font-semibold"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isPublishing}
                                        className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
                                    >
                                        <Send className="w-3.5 h-3.5" />
                                        {isPublishing ? "Publishing..." : "Publish Milestone"}
                                    </button>
                                </div>

                                {publishError && (
                                    <p
                                        data-testid="scribe-publish-error"
                                        role="alert"
                                        className="rounded border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive"
                                    >
                                        {publishError}
                                    </p>
                                )}
                            </form>
                        )}
                    </div>
                </div>
            )}

            {/* Left: Overall Completion & Word Count & Reading Time */}
            <div className="hidden shrink-0 items-center gap-4 sm:flex">
                <div className="flex flex-col gap-1 min-w-[140px]">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground font-bold uppercase text-[10px]">Progress:</span>
                        <span className="font-bold text-foreground">{completionPct}%</span>
                        <span className="text-[10px] text-muted-foreground">
                            ({telemetry.totalWordCount} / {telemetry.targetWordCount}w)
                        </span>
                    </div>
                    {/* Visual Milestone Progress Bar */}
                    <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-300"
                            style={{ width: `${completionPct}%` }}
                        />
                    </div>
                </div>

                <div className="flex items-center gap-1.5 border-l border-border pl-3">
                    <Clock className="w-3.5 h-3.5 text-sky-500" />
                    <span className="text-foreground font-semibold text-[11px]">~{readingTimeMins} min read</span>
                </div>

                <div className="flex items-center gap-1.5 border-l border-border pl-3">
                    <span className="text-muted-foreground font-bold uppercase text-[10px]">Stations:</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                        {telemetry.stationsComplete} / {telemetry.totalStations} Done
                    </span>
                </div>
            </div>

            {/* Center: Real-Time EKG Waveform */}
            <div className="hidden shrink-0 items-center gap-3 rounded-full border border-border bg-muted/40 px-4 py-1.5 xl:flex">
                <Activity className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 animate-pulse" />
                <span className="text-[10px] uppercase font-bold text-foreground">Document EKG:</span>
                <div className="flex items-end gap-1 h-4 w-36">
                    {telemetry.ekgPoints.slice(0, 12).map((pt, i) => (
                        <div
                            key={i}
                            className={`w-2.5 rounded-t transition-all ${
                                pt.score > 70
                                    ? "bg-red-500"
                                    : pt.score > 40
                                    ? "bg-amber-400"
                                    : "bg-emerald-500"
                            }`}
                            style={{ height: `${Math.max(4, Math.min(16, pt.score / 6))}px` }}
                            title={`${pt.label}: Score ${pt.score}`}
                        />
                    ))}
                </div>
            </div>

            {/* Right: Export Pipeline, Theme Selector & Publish */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-initial sm:shrink-0">
                {/* Shortcuts Guide (Desktop) */}
                <div className="hidden 2xl:flex items-center gap-1.5 text-[10px] text-muted-foreground/80 px-2 py-1 rounded border border-border/60 bg-muted/20 select-none">
                    <span className="font-mono bg-background px-1 py-0.5 rounded border border-border text-[9px] font-bold text-foreground">⌘S</span>
                    <span>Save</span>
                    <span className="opacity-40">•</span>
                    <span className="font-mono bg-background px-1 py-0.5 rounded border border-border text-[9px] font-bold text-foreground">⌘↵</span>
                    <span>Next</span>
                    <span className="opacity-40">•</span>
                    <span className="font-mono bg-background px-1 py-0.5 rounded border border-border text-[9px] font-bold text-foreground">⌘J</span>
                    <span>Critics</span>
                </div>

                {/* Export Theme Picker */}
                <div className="hidden items-center gap-1 bg-background border border-border px-2 py-1 rounded shadow-xs sm:flex">
                    <Palette className="w-3 h-3 text-muted-foreground" />
                    <select
                        // axe: label-title-only, serious. A tooltip is not a
                        // label — it is invisible on touch and to anyone not
                        // hovering.
                        aria-label="Typographic export theme"
                        value={selectedTheme}
                        onChange={(e) => setSelectedTheme(e.target.value as ExportTypographyTheme)}
                        className="bg-transparent text-foreground text-[10px] font-bold focus:outline-none cursor-pointer"
                        title="Select Typographic Export Theme"
                    >
                        <option value="corporate_legal" className="bg-popover text-popover-foreground">🏛️ Corporate Legal</option>
                        <option value="novel_manuscript" className="bg-popover text-popover-foreground">📚 Novel Manuscript</option>
                        <option value="modern_tech" className="bg-popover text-popover-foreground">🚀 Modern Tech Spec</option>
                    </select>
                </div>

                <button
                    onClick={() => onExport("pdf", selectedTheme)}
                    className="px-2.5 py-1 bg-background hover:bg-muted border border-border hover:border-emerald-500/50 text-foreground rounded flex items-center gap-1 text-[10px] font-bold transition-colors shadow-xs"
                    title="Export publication PDF"
                >
                    <FileDown className="w-3 h-3 text-red-500 dark:text-red-400" /> PDF
                </button>
                <button
                    onClick={() => onExport("word", selectedTheme)}
                    className="px-2.5 py-1 bg-background hover:bg-muted border border-border hover:border-emerald-500/50 text-foreground rounded flex items-center gap-1 text-[10px] font-bold transition-colors shadow-xs"
                    title="Export Word DOCX"
                >
                    <FileDown className="w-3 h-3 text-blue-500 dark:text-blue-400" /> DOCX
                </button>
                <button
                    onClick={() => onExport("markdown", selectedTheme)}
                    className="px-2.5 py-1 bg-background hover:bg-muted border border-border hover:border-emerald-500/50 text-foreground rounded flex items-center gap-1 text-[10px] font-bold transition-colors shadow-xs"
                    title="Export structured Markdown"
                >
                    <Download className="w-3 h-3 text-muted-foreground" /> Markdown
                </button>

                {/*
                  * What was published, still here after the modal has gone.
                  *
                  * The version and time answer "did that happen"; the link
                  * answers "where did it go"; the edit count answers the one an
                  * author acts on — whether the asset they would send someone
                  * is still the document in front of them.
                  */}
                {published && (
                    <div
                        data-testid="scribe-published-state"
                        className="flex items-center gap-2 rounded border border-border bg-muted/40 px-2 py-1"
                    >
                        <PackageCheck className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                        <div className="flex flex-col leading-tight">
                            <span className="text-[10px] font-bold text-foreground">
                                {published.versionTag} published {relativeTime(published.publishedAt)}
                            </span>
                            <span className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                                <span>Project Assets</span>
                                {published.wordCount !== undefined && <span>&middot; {published.wordCount}w</span>}
                                {published.downloadUrl && (
                                    <a
                                        href={published.downloadUrl}
                                        className="font-semibold text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
                                    >
                                        Open asset
                                    </a>
                                )}
                            </span>
                        </div>
                        {published.editedSince > 0 && (
                            <span
                                data-testid="scribe-published-stale"
                                title="The published asset no longer matches this draft"
                                className="flex shrink-0 items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-400"
                            >
                                <PencilLine className="w-3 h-3" />
                                {published.editedSince} edited since
                            </span>
                        )}
                    </div>
                )}

                {onPublish && (
                    <button
                        onClick={() => setIsPublishModalOpen(true)}
                        className="px-3 py-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded flex items-center gap-1.5 text-[10px] font-bold transition-all shadow-sm"
                        title="Publish this manuscript as a canonical project deliverable and asset"
                    >
                        <Send className="w-3 h-3" />
                        {published ? "Publish new version" : "Publish to Project"}
                    </button>
                )}
            </div>
        </div>
    );
};
