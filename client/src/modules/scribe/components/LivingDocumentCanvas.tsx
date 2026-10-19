import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { ScribeNode, ScribeLensType, type ScribeNodeStatus } from "@shared/schema/scribe";
import { isStationDrafted } from "@shared/scribe-telemetry";
import { renderMarkdownToSafeHtml, sanitizeEditorHtml, escapeHtmlText, REHYPE_SANITIZE_SCHEMA } from "../markdown-html";
import { findCellFromSelection, addRowBelow, addColumnAfter, deleteRow, deleteColumn } from "../table-editing";
import { turndownInstance } from "../editor-turndown";
import { panelHtml, expandHtml, statusHtml, sandboxHtml, PANEL_STYLES, STATUS_STYLES, STATUS_DEFAULT_LABELS, type PanelKind, type StatusKind } from "../document-macros";
import { generateEgressPreview } from "../egress-preview";
import {
    Lock,
    Sparkles,
    Check,
    X,
    FileText,
    Wand2,
    Highlighter,
    StickyNote,
    CheckSquare,
    MessageSquare,
    Volume2,
    VolumeX,
    History,
    RotateCcw,
    RotateCw,
    Eye,
    Edit3,
    Bold,
    Italic,
    Underline,
    Strikethrough,
    Heading1,
    Heading2,
    Heading3,
    List,
    ListOrdered,
    Quote,
    Table,
    Minus,
    Radio,
    Zap,
    ShieldAlert,
    ShieldCheck,
    Bot,
    BookOpen,
    ArrowRight,
    Copy,
    Code,
    Eraser,
    Link as LinkIcon,
    Pilcrow,
    AlertTriangle,
    Rows3,
    Info,
    Tag,
    ChevronRight,
    Trash2,
    Columns3,
    Scissors,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";




// Imported and re-exported, not redeclared. This file had its own copy and the
// two drifted: the client knew about rule-engine findings and the server did
// not, so a server-shaped insight would not typecheck here.
import type { ScribeLiveInsight } from "@domain/scribe/core/scribe.service";
import {
    loadHistory,
    saveHistory,
    appendSnapshot,
    type StationSnapshot,
    type SnapshotsByNode,
} from "../station-history";
export type { ScribeLiveInsight };

/**
 * Who found this, as the author reads it.
 *
 * The previous three-way ternary sent everything that was not LegalSentinel or
 * GhostWriter to "🔍 Critic" — so every Tier 1 finding, which is a regex match,
 * was presented as an AI critique. That is the exact claim the RuleEngine role
 * exists to avoid: telling an author a model reviewed their clause when none
 * did. A table means a new role shows up wrong in one obvious place rather than
 * silently inheriting someone else's byline.
 */
const SOURCE_LABEL: Record<ScribeLiveInsight["agentRole"], string> = {
    LegalSentinel: "⚖️ Legal Sentinel",
    GhostWriter: "✍️ GhostWriter",
    Critic: "🔍 Critic",
    CopyEditor: "✏️ Copy Editor",
    RuleEngine: "◆ Rule",
};

/**
 * Rules have nobody to talk to. Addressing "@RuleEngine" would mention an agent
 * that does not exist in the crew, so a rule finding opens with the room.
 *
 * The role is handed to the handler bare, without an "@": the handler adds one,
 * and passing another here put "@@LegalSentinel" at the head of every prompt
 * opened from this card.
 */
const DISCUSSABLE: ReadonlySet<ScribeLiveInsight["agentRole"]> = new Set([
    "LegalSentinel",
    "GhostWriter",
    "Critic",
    "CopyEditor",
]);



interface LivingDocumentCanvasProps {
    activeNode: ScribeNode | null;
    documentTitle: string;
    // Save carries the node's CURRENT status through unchanged, so it must accept
    // every status a node can hold — including continuity_conflict, which the
    // continuity engine sets and no user picks. onUpdateStatus is the user's own
    // choice from the dropdown, so it stays restricted to the three selectable
    // ones. The two unions differ deliberately.
    /**
     * Persist a station.
     *
     * Must reject when the write fails. The canvas reports "Synced" on the
     * strength of this resolving, so a handler that swallows its own error
     * turns the indicator into a decoration.
     */
    onSaveContent: (nodeId: number, content: string, status?: ScribeNodeStatus) => void | Promise<void>;
    onUpdateStatus?: (nodeId: number, status: "draft" | "in_review" | "approved") => void;
    onStreamDelta?: (nodeId: number, content: string) => Promise<void | { insights: ScribeLiveInsight[] }>;
    /** Accept a spelling of a defined term, clearing its drift marker for good. */
    onAcceptAlias?: (canonical: string, alias: string) => Promise<void>;
    liveInsights?: ScribeLiveInsight[];
    onRunSelectionRewrite?: (instruction: string, selectedText: string) => void;
    onCreateAnnotation?: (data: {
        lensType?: ScribeLensType;
        title: string;
        critiqueBody: string;
        paragraphAnchor?: string;
        severity?: "info" | "suggestion" | "warning" | "critical_conflict";
    }) => void;
    onDiscussWithCrew?: (selectedText: string, personaTag?: string) => void;
    allNodes?: ScribeNode[];
    onSelectStation?: (stationKey: string) => void;
    defaultMode?: "rendered" | "edit" | "full_doc" | "rich" | "raw";
}

type CanvasMode = "rich" | "rendered" | "raw" | "full_doc";

/**
 * Searches for an excerpt in content using exact, newline-normalized, and flexible token/whitespace matching.
 * Returns the rewritten content, or null if no match was found.
 */
export function fuzzyReplaceExcerpt(content: string, excerpt: string, replacement: string): string | null {
    if (!excerpt || !content) return null;
    const rawExcerpt = excerpt.trim();
    if (!rawExcerpt) return null;

    // 1. Exact match
    if (content.includes(rawExcerpt)) {
        return content.replace(rawExcerpt, replacement);
    }
    // 2. Newline-normalized match
    const normContentNl = content.replace(/\r\n/g, '\n');
    const normExcerptNl = rawExcerpt.replace(/\r\n/g, '\n');
    if (normContentNl.includes(normExcerptNl)) {
        return normContentNl.replace(normExcerptNl, replacement);
    }
    // 3. Flexible quote/dash and whitespace matching
    const words = rawExcerpt
        .split(/\s+/)
        .map((w) => w.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ''))
        .filter((w) => w.length > 0);

    if (words.length >= 2) {
        const escapedWords = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        // Match words bounded by optional quotes and separated by flexible whitespace/punctuation
        const pattern = new RegExp(`[“"']?\\b${escapedWords.join('[\\s\\r\\n*_–—\'"`-]+')}\\b[”"']?`, 'i');
        const match = content.match(pattern);
        if (match && typeof match.index === 'number') {
            const start = match.index;
            const end = start + match[0].length;
            return content.slice(0, start) + replacement + content.slice(end);
        }
    }
    return null;
}

export const LivingDocumentCanvas: React.FC<LivingDocumentCanvasProps> = ({
    activeNode,
    allNodes = [],
    documentTitle,
    defaultMode = "rich",
    onSaveContent,
    onUpdateStatus,
    onStreamDelta,
    onAcceptAlias,
    liveInsights = [],
    onRunSelectionRewrite,
    onCreateAnnotation,
    onDiscussWithCrew,
    onSelectStation,
}) => {
    const [content, setContent] = useState(activeNode?.content || "");
    /**
     * What the footer is entitled to claim.
     *
     * This was a boolean, and everything that was not "saving" rendered a green
     * "Synced" check — before the first save, and after a failed one. The
     * indicator asserted a fact it had never checked.
     */
    const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
    const [saveError, setSaveError] = useState<string | null>(null);
    /** The edit a pending debounce still owes the server. */
    const pendingSaveRef = useRef<{ nodeId: number; value: string } | null>(null);
    const isMountedRef = useRef(true);
    const [selectedText, setSelectedText] = useState("");
    const [noteDraft, setNoteDraft] = useState("");
    const [noteType, setNoteType] = useState<"note" | "todo">("note");
    const [isNoteInputOpen, setIsNoteInputOpen] = useState(false);
    
    // Canvas Mode: "rich" (WYSIWYG Rich HTML), "rendered" (Preview), "raw" (Markdown Textarea), "full_doc" (Continuous)
    const [canvasMode, setCanvasMode] = useState<CanvasMode>(() => {
        if (defaultMode === "rendered") return "rendered";
        if (defaultMode === "full_doc") return "full_doc";
        if (defaultMode === "raw") return "raw";
        return "rich";
    });

    const isPreviewMode = canvasMode === "rendered";
    const isFullDocMode = canvasMode === "full_doc";
    const isRawMode = canvasMode === "raw";
    const isRichMode = canvasMode === "rich";

    const [isCopiedMarkdown, setIsCopiedMarkdown] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const richEditorRef = useRef<HTMLDivElement | null>(null);
    const [isCaretInTable, setIsCaretInTable] = useState(false);
    const [macroMenu, setMacroMenu] = useState<"panel" | "status" | "sandbox" | null>(null);
    const [isSafeMode, setIsSafeMode] = useState(false);
    const [isEgressInspectorOpen, setIsEgressInspectorOpen] = useState(false);
    const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
    const [linkUrl, setLinkUrl] = useState("https://");
    const [linkError, setLinkError] = useState<string | null>(null);
    const isUserTypingRef = useRef(false);

    // Persistent Ghostwriter / Crew Scoped Focus Excerpt
    const [focusedExcerpt, setFocusedExcerpt] = useState<string | null>(null);

    useEffect(() => {
        const handleClearFocus = () => setFocusedExcerpt(null);
        window.addEventListener("scribe:clear-focus", handleClearFocus);
        return () => window.removeEventListener("scribe:clear-focus", handleClearFocus);
    }, []);

    const highlightFocusText = (node: React.ReactNode, focus: string | null): React.ReactNode => {
        if (!focus || !focus.trim()) return node;
        if (typeof node === "string") {
            if (!node.includes(focus)) return node;
            const parts = node.split(focus);
            const result: React.ReactNode[] = [];
            parts.forEach((part, i) => {
                if (i > 0) {
                    result.push(
                        <mark key={i} className="bg-emerald-400/30 dark:bg-emerald-500/30 text-foreground px-1 py-0.5 rounded border-b-2 border-emerald-500 font-semibold shadow-xs">
                            {focus}
                        </mark>
                    );
                }
                if (part) result.push(part);
            });
            return result;
        }
        if (Array.isArray(node)) {
            return node.map((child, idx) => <React.Fragment key={idx}>{highlightFocusText(child, focus)}</React.Fragment>);
        }
        if (React.isValidElement(node) && (node.props as any)?.children) {
            return React.cloneElement(node, {
                ...(node.props as any),
                children: highlightFocusText((node.props as any).children, focus),
            } as any);
        }
        return node;
    };

    // Live Streaming to Agents
    const [isStreamingToAgents, setIsStreamingToAgents] = useState(false);
    const [activeInsights, setActiveInsights] = useState<ScribeLiveInsight[]>(liveInsights);
    const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (liveInsights && liveInsights.length > 0) {
            setActiveInsights(liveInsights);
        }
    }, [liveInsights]);

    // Audio Proofreading (TTS)
    const [isPlayingAudio, setIsPlayingAudio] = useState(false);

    // Station Snapshot History
    const [snapshots, setSnapshots] = useState<SnapshotsByNode>({});
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    /** False once a write has failed, so the panel can say history is session-only. */
    const [historyPersists, setHistoryPersists] = useState(true);

    // Rehydrate the document's history.
    const documentId = activeNode?.documentId;
    useEffect(() => {
        if (documentId === undefined) return;
        setSnapshots(loadHistory(documentId));
    }, [documentId]);

    // Synchronize content on activeNode change or external updates
    useEffect(() => {
        const newContent = activeNode?.content || "";
        setContent(newContent);

        // Populate contentEditable editor if not actively typing
        if (richEditorRef.current && !isUserTypingRef.current) {
            const html = renderMarkdownToSafeHtml(newContent);
            if (richEditorRef.current.innerHTML !== html) {
                richEditorRef.current.innerHTML = html;
            }
        }

        // Record initial snapshot if not present for this node
        if (activeNode && newContent) {
            setSnapshots((prev) => {
                const existing = prev[activeNode.id] || [];
                if (existing.length === 0 || existing[existing.length - 1].content !== newContent) {
                    const count = newContent.trim().split(/\s+/).filter(Boolean).length;
                    return {
                        ...prev,
                        [activeNode.id]: [
                            ...existing,
                            {
                                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                                label: existing.length === 0 ? "Initial Station Draft" : "Checkpoint",
                                content: newContent,
                                wordCount: count,
                            },
                        ].slice(-10),
                    };
                }
                return prev;
            });
        }
    }, [activeNode?.id, activeNode?.content]);

    // Clean up TTS when unmounting or switching stations
    useEffect(() => {
        return () => {
            if (typeof window !== "undefined" && "speechSynthesis" in window) {
                window.speechSynthesis.cancel();
            }
        };
    }, [activeNode?.id]);

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /**
     * Send one edit and report what actually happened.
     *
     * The snapshot is written only after the server has taken the text. Local
     * history labelled "Autosave" for a write that failed is worse than no
     * history: it is a record of a save that did not happen.
     */
    const performSave = async (nodeId: number, val: string, documentId?: number) => {
        setSaveState("saving");
        setSaveError(null);
        try {
            await onSaveContent(nodeId, val);
            pendingSaveRef.current = null;
            if (!isMountedRef.current) return;
            setSaveState("saved");

            const count = val.trim().split(/\s+/).filter(Boolean).length;
            setSnapshots((prev) => {
                const next = appendSnapshot(prev, nodeId, {
                    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                    label: `Autosave (${count}w)`,
                    content: val,
                    wordCount: count,
                });
                if (next !== prev && documentId !== undefined) {
                    setHistoryPersists(saveHistory(documentId, next, nodeId));
                }
                return next;
            });
        } catch (err: any) {
            if (!isMountedRef.current) return;
            setSaveState("failed");
            setSaveError(err?.message || "The last change was not saved.");
        }
    };

    const scheduleAutosave = (val: string) => {
        if (!activeNode) return;
        const nodeId = activeNode.id;
        const documentId = activeNode.documentId;
        pendingSaveRef.current = { nodeId, value: val };
        setSaveState("saving");
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            void performSave(nodeId, val, documentId);
        }, 800);

        // Stream delta to ambient agent squad
        if (onStreamDelta) {
            if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
            setIsStreamingToAgents(true);
            streamTimerRef.current = setTimeout(async () => {
                streamTimerRef.current = null;
                try {
                    const result = await onStreamDelta(nodeId, val);
                    if (result && result.insights) {
                        setActiveInsights(result.insights);
                    }
                } finally {
                    setIsStreamingToAgents(false);
                }
            }, 500);
        }
    };

    // Listen for agent chat "Insert into Scribe Station" event
    useEffect(() => {
        const handleInsertEvent = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.text && activeNode) {
                // If nodeId was provided and doesn't match activeNode, switch station if stationKey provided
                if (detail.nodeId && detail.nodeId !== activeNode.id) {
                    if (detail.stationKey && onSelectStation) {
                        onSelectStation(detail.stationKey);
                    }
                    return;
                }

                let nextContent: string;
                const rawExcerpt = detail.excerpt ? String(detail.excerpt).trim() : '';
                const replaced = rawExcerpt ? fuzzyReplaceExcerpt(content, rawExcerpt, detail.text) : null;

                if (replaced !== null) {
                    // Surgically rewrite targeted excerpt
                    nextContent = replaced;
                } else if (!content.trim() || !isStationDrafted(activeNode)) {
                    // A station still holding its framework scaffolding has wordCount 0; replace it
                    nextContent = detail.text;
                } else if (detail.placement === 'top') {
                    // Insert at top immediately below the station title heading anchor
                    const headingMatch = content.match(/^(#+\s+[^\n]+\n+)/);
                    if (headingMatch) {
                        const heading = headingMatch[1];
                        const rest = content.slice(heading.length).trim();
                        nextContent = rest ? `${heading}${detail.text}\n\n${rest}` : `${heading}${detail.text}`;
                    } else {
                        nextContent = content.trim() ? `${detail.text}\n\n${content}` : detail.text;
                    }
                } else {
                    // Default append to bottom
                    nextContent = content ? `${content}\n\n${detail.text}` : detail.text;
                }

                // The insertion supersedes whatever the debounce was holding.
                if (saveTimerRef.current) {
                    clearTimeout(saveTimerRef.current);
                    saveTimerRef.current = null;
                }
                pendingSaveRef.current = null;
                setContent(nextContent);
                if (richEditorRef.current) {
                    richEditorRef.current.innerHTML = renderMarkdownToSafeHtml(nextContent);
                }
                void performSave(activeNode.id, nextContent, activeNode.documentId);
            }
        };
        window.addEventListener("scribe:insert-text", handleInsertEvent);
        return () => window.removeEventListener("scribe:insert-text", handleInsertEvent);
    }, [activeNode, content, onSaveContent, onSelectStation]);

    /**
     * A debounced edit is owed to the server, not owned by the component.
     *
     * The cleanup used to clearTimeout and stop there, so switching station or
     * closing the studio within 800ms of the last keystroke dropped that edit
     * silently — the most common way to lose a sentence here. Now the pending
     * write is sent instead of cancelled.
     */
    const flushPendingSave = useCallback(() => {
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        const pending = pendingSaveRef.current;
        if (pending) {
            pendingSaveRef.current = null;
            // The component is going away, so there is nowhere to render a
            // failure — but an uncaught rejection must not escape either.
            void Promise.resolve(onSaveContent(pending.nodeId, pending.value)).catch((err) =>
                console.error("[Scribe] Flushing the pending save failed", err),
            );
        }
    }, [onSaveContent]);

    // Leaving the station is a commit point, the same as leaving the studio.
    useEffect(() => flushPendingSave, [activeNode?.id, flushPendingSave]);

    useEffect(() => {
        isMountedRef.current = true;
        const onUnload = () => flushPendingSave();
        window.addEventListener("beforeunload", onUnload);
        return () => {
            isMountedRef.current = false;
            window.removeEventListener("beforeunload", onUnload);
            if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
        };
    }, [flushPendingSave]);

    // Sync changes from Rich HTML contentEditable editor to Markdown
    const syncFromRichEditor = () => {
        if (!richEditorRef.current || !activeNode) return;
        const html = sanitizeEditorHtml(richEditorRef.current.innerHTML);
        const md = turndownInstance.turndown(html);
        setContent(md);
        scheduleAutosave(md);
    };

    const handleRichInput = () => {
        isUserTypingRef.current = true;
        syncFromRichEditor();
        setTimeout(() => {
            isUserTypingRef.current = false;
        }, 100);
    };

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setContent(val);
        if (richEditorRef.current && !isUserTypingRef.current) {
            richEditorRef.current.innerHTML = renderMarkdownToSafeHtml(val);
        }
        scheduleAutosave(val);
    };

    const handleExecCommand = (command: string, value: string = "") => {
        if (canvasMode === "raw") {
            if (command === "bold") handleInsertFormatting("**", "**", "bold text");
            else if (command === "italic") handleInsertFormatting("*", "*", "italic text");
            else if (command === "underline") handleInsertFormatting("<u>", "</u>", "underlined text");
            else if (command === "strikeThrough") handleInsertFormatting("~~", "~~", "strikethrough text");
            else if (command === "formatBlock" && value === "<h1>") handleInsertFormatting("# ", "\n", "Heading 1");
            else if (command === "formatBlock" && value === "<h2>") handleInsertFormatting("## ", "\n", "Heading 2");
            else if (command === "formatBlock" && value === "<h3>") handleInsertFormatting("### ", "\n", "Heading 3");
            else if (command === "formatBlock" && value === "<blockquote>") handleInsertFormatting("> ", "\n", "Callout quote");
            else if (command === "insertUnorderedList") handleInsertFormatting("- ", "\n", "List item");
            else if (command === "insertOrderedList") handleInsertFormatting("1. ", "\n", "Numbered item");
            else if (command === "insertHorizontalRule") handleInsertFormatting("\n---\n");
            return;
        }
        if (typeof document !== "undefined") {
            document.execCommand(command, false, value);
            syncFromRichEditor();
        }
    };

    const handleInsertTable = (rowsCount = 2, colsCount = 2) => {
        if (canvasMode === "raw") {
            handleInsertFormatting("\n| Column 1 | Column 2 |\n|---|---|\n| Item A | Item B |\n");
            return;
        }
        if (typeof document !== "undefined") {
            let tableHtml = '<table class="w-full text-sm font-sans border-collapse border border-border my-4"><thead><tr class="bg-muted/60 border-b border-border">';
            for (let c = 1; c <= colsCount; c++) {
                tableHtml += `<th class="border border-border px-3 py-2 font-semibold text-foreground">Header ${c}</th>`;
            }
            tableHtml += '</tr></thead><tbody>';
            for (let r = 1; r <= rowsCount; r++) {
                tableHtml += '<tr>';
                for (let c = 1; c <= colsCount; c++) {
                    tableHtml += `<td class="border border-border px-3 py-2 text-foreground">Data ${r}.${c}</td>`;
                }
                tableHtml += '</tr>';
            }
            tableHtml += '</tbody></table><p><br></p>';
            document.execCommand("insertHTML", false, tableHtml);
            syncFromRichEditor();
        }
    };

    /**
     * Row and column edits act on the table the caret is in.
     *
     * Guarded rather than hidden: the controls stay visible and disable when the
     * caret leaves a table, so their absence never looks like the table feature
     * missing. Raw markdown mode has no DOM to walk, so it is excluded.
     */
    /**
     * selectionchange is the only event that fires for every way the caret moves
     * — click, arrow key, and the programmatic placement after an edit.
     */
    useEffect(() => {
        if (typeof document === "undefined") return;
        const update = () => setIsCaretInTable(Boolean(findCellFromSelection(richEditorRef.current)));
        document.addEventListener("selectionchange", update);
        update();
        return () => document.removeEventListener("selectionchange", update);
    }, [canvasMode]);

    const runTableEdit = (edit: (cell: HTMLTableCellElement) => unknown) => {
        if (canvasMode !== "rich") return;
        const cell = findCellFromSelection(richEditorRef.current);
        if (!cell) return;
        edit(cell);
        syncFromRichEditor();
    };

    /**
     * Insert a macro at the caret.
     *
     * Raw markdown mode gets the same HTML as text, because that is exactly what
     * the manuscript stores — the two modes stay the same document.
     */
    const insertMacroHtml = (html: string) => {
        setMacroMenu(null);
        if (canvasMode === "raw") {
            handleInsertFormatting(`\n${html}\n`);
            return;
        }
        if (typeof document !== "undefined") {
            document.execCommand("insertHTML", false, html);
            syncFromRichEditor();
        }
    };

    /** GFM fenced block; the language is left for the author to type. */
    const handleInsertCodeBlock = () => handleInsertFormatting("\n```\n", "\n```\n", "code here");

    /** GFM task list — marked renders the checkbox, turndown reads it back. */
    const handleInsertTaskList = () => handleInsertFormatting("- [ ] ", "\n", "Action item");

    /**
     * Insert a link.
     *
     * This was window.prompt, which blocks the whole page, cannot be themed or
     * translated, is unreachable from a test, and freezes browser automation
     * outright. It also could not validate anything: whatever was typed went
     * straight to execCommand, so a "javascript:" URL became a link in the
     * manuscript.
     *
     * The dialog steals focus, and with it the selection execCommand needs, so
     * the range is captured before opening and restored before the insert.
     */
    const savedRangeRef = useRef<Range | null>(null);

    const handleInsertLink = () => {
        if (typeof window !== "undefined") {
            const selection = window.getSelection();
            savedRangeRef.current =
                selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
        }
        setLinkUrl("https://");
        setLinkError(null);
        setIsLinkDialogOpen(true);
    };

    const confirmInsertLink = () => {
        const url = linkUrl.trim();
        if (!url) return;
        // Only schemes a document link legitimately uses. javascript: and data:
        // are the two that turn a manuscript into an attack on its reader.
        if (!/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(url)) {
            setLinkError("Use an http(s), mailto, tel or in-document link.");
            return;
        }

        setIsLinkDialogOpen(false);
        if (canvasMode === "raw") {
            handleInsertFormatting("[", `](${url})`, "Link text");
            return;
        }
        if (typeof document !== "undefined") {
            const selection = window.getSelection();
            if (savedRangeRef.current && selection) {
                selection.removeAllRanges();
                selection.addRange(savedRangeRef.current);
            }
            richEditorRef.current?.focus();
            document.execCommand("createLink", false, url);
            syncFromRichEditor();
        }
    };

    // Copy as Markdown Handler
    const handleCopyAsMarkdown = async () => {
        let mdToCopy = "";
        if (canvasMode === "full_doc" && allNodes && allNodes.length > 0) {
            mdToCopy = allNodes
                .map((n) => `# ${n.title}\n\n${n.content || ""}`)
                .join("\n\n---\n\n");
        } else if (selectedText && selectedText.trim()) {
            mdToCopy = selectedText;
        } else {
            mdToCopy = content || "";
        }

        try {
            if (typeof navigator !== "undefined" && navigator.clipboard) {
                await navigator.clipboard.writeText(mdToCopy);
                setIsCopiedMarkdown(true);
                setTimeout(() => setIsCopiedMarkdown(false), 2000);
            }
        } catch (err) {
            console.error("Failed to copy markdown to clipboard:", err);
        }
    };

    const handleApplyInsight = (insight: ScribeLiveInsight) => {
        if (!activeNode || !insight.suggestedReplacement) return;
        let nextContent: string;
        if (insight.originalExcerpt && content.includes(insight.originalExcerpt)) {
            nextContent = content.replace(insight.originalExcerpt, insight.suggestedReplacement);
        } else {
            nextContent = `${content.trim()}\n\n${insight.suggestedReplacement}`.trim();
        }
        setContent(nextContent);
        if (richEditorRef.current) {
            richEditorRef.current.innerHTML = renderMarkdownToSafeHtml(nextContent);
        }
        onSaveContent(activeNode.id, nextContent);
        setActiveInsights((prev) => prev.filter((i) => i.id !== insight.id));
    };

    const handleSelectionCheck = () => {
        if (textareaRef.current) {
            const { selectionStart, selectionEnd, value } = textareaRef.current;
            if (typeof selectionStart === "number" && typeof selectionEnd === "number" && selectionStart !== selectionEnd) {
                const sel = value.substring(selectionStart, selectionEnd).trim();
                if (sel.length > 2) {
                    setSelectedText(sel);
                    return;
                }
            }
        }
        const winSel = window.getSelection()?.toString()?.trim();
        if (winSel && winSel.length > 2) {
            setSelectedText(winSel);
            return;
        }
        if (!isNoteInputOpen) {
            setSelectedText("");
        }
    };

    const handleApplyHighlight = (colorClass: string = "bg-amber-400/30") => {
        if (!selectedText || !activeNode) return;
        if (canvasMode === "rich" && typeof document !== "undefined") {
            document.execCommand("insertHTML", false, `<mark class="${colorClass} text-foreground px-1 py-0.5 rounded">${escapeHtmlText(selectedText)}</mark>`);
            syncFromRichEditor();
        } else {
            const highlighted = `<mark class="${colorClass} text-foreground px-1 py-0.5 rounded">${escapeHtmlText(selectedText)}</mark>`;
            const newContent = content.replace(selectedText, highlighted);
            setContent(newContent);
            onSaveContent(activeNode.id, newContent);
        }

        onCreateAnnotation?.({
            lensType: "highlight",
            title: `Highlight: "${selectedText.slice(0, 40)}${selectedText.length > 40 ? "..." : ""}"`,
            critiqueBody: selectedText,
            paragraphAnchor: selectedText.slice(0, 80),
            severity: "info",
        });

        setSelectedText("");
    };

    const handleSaveNoteOrTodo = () => {
        if (!noteDraft.trim() || !activeNode) return;
        onCreateAnnotation?.({
            lensType: noteType,
            title: noteType === "todo" ? `To-Do: ${noteDraft.trim()}` : `Note on "${selectedText.slice(0, 30)}..."`,
            critiqueBody: noteDraft.trim(),
            paragraphAnchor: selectedText || undefined,
            severity: noteType === "todo" ? "warning" : "info",
        });
        setNoteDraft("");
        setIsNoteInputOpen(false);
        setSelectedText("");
    };

    // Toggle Audio Proofreading (TTS)
    const handleToggleAudio = () => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

        if (isPlayingAudio) {
            window.speechSynthesis.cancel();
            setIsPlayingAudio(false);
            return;
        }

        const textToRead = selectedText || content;
        if (!textToRead.trim()) return;

        const utterance = new SpeechSynthesisUtterance(textToRead);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.onend = () => setIsPlayingAudio(false);
        utterance.onerror = () => setIsPlayingAudio(false);

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        setIsPlayingAudio(true);
    };

    const handleRestoreSnapshot = (snapshot: StationSnapshot) => {
        if (!activeNode) return;
        setContent(snapshot.content);
        if (richEditorRef.current) {
            richEditorRef.current.innerHTML = renderMarkdownToSafeHtml(snapshot.content);
        }
        onSaveContent(activeNode.id, snapshot.content);
        setIsHistoryOpen(false);
    };

    const handleInsertFormatting = (prefix: string, suffix: string = "", defaultText: string = "") => {
        const el = textareaRef.current;
        if (!el || !activeNode) return;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const selected = content.substring(start, end) || defaultText;
        const replacement = `${prefix}${selected}${suffix}`;
        const updated = content.substring(0, start) + replacement + content.substring(end);
        setContent(updated);
        if (richEditorRef.current) {
            richEditorRef.current.innerHTML = renderMarkdownToSafeHtml(updated);
        }
        onSaveContent(activeNode.id, updated);
        setTimeout(() => {
            el.focus();
            el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
        }, 10);
    };

    if (!activeNode) {
        return (
            <div className="flex-1 flex items-center justify-center bg-muted/20 text-muted-foreground font-mono text-xs">
                Select a station from the Subway Spine to begin authoring.
            </div>
        );
    }

    const currentSnapshots = snapshots[activeNode.id] || [];

    return (
        <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-y-auto bg-muted/30 font-serif" onMouseUp={handleSelectionCheck}>
            {/* UNIFIED STICKY HEADER & FLOATING TOOLS CONTAINER (Never clips or gets lost on scroll) */}
            <div className="sticky top-0 z-30 bg-card/95 backdrop-blur-md border-b border-border shadow-xs flex flex-col">
                {/* Row 1: Document & Station Header, Mode Switcher, Copy as Markdown, History, Sync */}
                <div className="px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between font-mono text-xs gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                        <FileText className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                        <span className="font-bold text-foreground truncate max-w-[180px]">{documentTitle}</span>
                        <span className="text-muted-foreground shrink-0">/</span>
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold truncate">{activeNode.title}</span>
                    </div>

                    <div className="shrink-0">
                        <select
                            // axe: label-title-only, serious.
                            aria-label="Station status"
                            value={activeNode.status || "draft"}
                            onChange={(e) => {
                                const newStatus = e.target.value as "draft" | "in_review" | "approved";
                                if (onUpdateStatus) {
                                    onUpdateStatus(activeNode.id, newStatus);
                                } else {
                                    onSaveContent(activeNode.id, content, newStatus);
                                }
                            }}
                            className="bg-background border border-border text-foreground px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer focus:outline-none shadow-2xs"
                            title="Update Station Lifecycle Status"
                        >
                            <option value="draft" className="bg-popover text-popover-foreground">🟡 Draft</option>
                            <option value="in_review" className="bg-popover text-popover-foreground">🔵 In Review</option>
                            <option value="approved" className="bg-popover text-popover-foreground">🟢 Approved</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {/* Mode Switcher (Rich HTML vs Rendered vs Raw Markdown vs Full Document) */}
                        <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border/60">
                            <button
                                type="button"
                                onClick={() => setCanvasMode("rich")}
                                className={cn(
                                    "flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold transition-all cursor-pointer",
                                    canvasMode === "rich" ? "bg-background text-emerald-600 dark:text-emerald-400 shadow-2xs border border-border" : "text-foreground/70 hover:text-foreground"
                                )}
                                title="Edit in Visual Rich HTML WYSIWYG Editor"
                                aria-label="Rich HTML Editor"
                            >
                                <Edit3 className="w-3.5 h-3.5" /> Rich Editor
                            </button>
                            <button
                                type="button"
                                onClick={() => setCanvasMode("rendered")}
                                className={cn(
                                    "flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold transition-all cursor-pointer",
                                    canvasMode === "rendered" ? "bg-background text-emerald-600 dark:text-emerald-400 shadow-2xs border border-border" : "text-foreground/70 hover:text-foreground"
                                )}
                                title="Display Formatted Rendered Markdown / HTML"
                                aria-label="Rendered Preview"
                            >
                                <Eye className="w-3.5 h-3.5" /> Rendered
                            </button>
                            <button
                                type="button"
                                onClick={() => setCanvasMode("raw")}
                                className={cn(
                                    "flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold transition-all cursor-pointer",
                                    canvasMode === "raw" ? "bg-background text-foreground shadow-2xs border border-border" : "text-foreground/70 hover:text-foreground"
                                )}
                                title="Edit Raw Markdown Prose in Textarea"
                                aria-label="Raw Markdown"
                            >
                                <Code className="w-3.5 h-3.5" /> Raw
                            </button>
                            {allNodes && allNodes.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setCanvasMode("full_doc")}
                                    className={cn(
                                        "flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold transition-all cursor-pointer",
                                        canvasMode === "full_doc" ? "bg-background text-emerald-600 dark:text-emerald-400 shadow-2xs border border-border" : "text-foreground/70 hover:text-foreground"
                                    )}
                                    title="View Entire Continuous Document with all Headings"
                                    aria-label="Full Manuscript"
                                >
                                    <BookOpen className="w-3.5 h-3.5" /> Full Doc
                                </button>
                            )}
                        </div>

                        {/* Copy as Markdown Button */}
                        <button
                            type="button"
                            onClick={handleCopyAsMarkdown}
                            className={cn(
                                "px-2.5 py-1 rounded border transition-all flex items-center gap-1.5 font-bold shadow-xs cursor-pointer",
                                isCopiedMarkdown
                                    ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-600 dark:text-emerald-400 animate-in fade-in"
                                    : "bg-background border-border hover:bg-muted text-foreground"
                            )}
                            title="Copy active station or selection as clean Markdown"
                            aria-label="Copy as Markdown"
                        >
                            {isCopiedMarkdown ? (
                                <>
                                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                                    <span>Copied!</span>
                                </>
                            ) : (
                                <>
                                    <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                                    <span>Copy as Markdown</span>
                                </>
                            )}
                        </button>

                        {/* Audio Proofreading */}
                        <button
                            type="button"
                            onClick={handleToggleAudio}
                            className={`px-2 py-1 rounded border transition-colors flex items-center gap-1.5 font-bold shadow-xs ${
                                isPlayingAudio
                                    ? "bg-red-500/20 border-red-500/50 text-red-500 animate-pulse"
                                    : "bg-background border-border hover:bg-muted text-foreground"
                            }`}
                            title={isPlayingAudio ? "Stop Audio Proofreading" : "Listen to this Station (Audio Proofread)"}
                            aria-label="Audio Proofreading"
                        >
                            {isPlayingAudio ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3 text-emerald-500" />}
                            <span>{isPlayingAudio ? "Stop" : "Listen"}</span>
                        </button>

                        {/* Snapshot History Dropdown */}
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setIsHistoryOpen((prev) => !prev)}
                                className="px-2 py-1 rounded border border-border bg-background hover:bg-muted text-foreground flex items-center gap-1.5 transition-colors shadow-xs"
                                title="Station Snapshot History"
                                aria-label="Station Snapshot History"
                            >
                                <History className="w-3 h-3 text-sky-500" />
                                <span>History ({currentSnapshots.length})</span>
                            </button>

                            {isHistoryOpen && (
                                <div className="absolute right-0 top-full mt-1 w-64 rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl p-2 z-40 font-mono text-xs animate-in fade-in zoom-in-95">
                                    <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-border text-[10px] font-bold uppercase text-muted-foreground px-1">
                                        <span>Station Checkpoints</span>
                                        <button onClick={() => setIsHistoryOpen(false)} className="text-muted-foreground hover:text-foreground">
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                    <p
                                        data-testid="history-scope-note"
                                        className="px-1 pb-1.5 text-[10px] leading-snug text-muted-foreground/80"
                                    >
                                        {historyPersists
                                            ? "Kept in this browser. Publish for a durable version."
                                            : "This session only — checkpoints could not be saved locally."}
                                    </p>
                                    {currentSnapshots.length === 0 ? (
                                        <div className="p-2 text-center text-muted-foreground italic text-[11px]">
                                            No checkpoints recorded yet.
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
                                            {currentSnapshots.map((snap, idx) => (
                                                <button
                                                    key={idx}
                                                    onClick={() => handleRestoreSnapshot(snap)}
                                                    className="flex items-center justify-between p-2 rounded-lg hover:bg-muted text-left transition-colors group"
                                                >
                                                    <div className="flex flex-col">
                                                        <span className="font-semibold text-foreground text-[11px] group-hover:text-emerald-500">
                                                            {snap.label}
                                                        </span>
                                                        <span className="text-[10px] text-muted-foreground">
                                                            {snap.timestamp} • {snap.wordCount} words
                                                        </span>
                                                    </div>
                                                    <RotateCcw className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Safe Mode Shield Toggle */}
                        <button
                            type="button"
                            onClick={() => setIsSafeMode((prev) => !prev)}
                            className={cn(
                                "px-2 py-1 rounded border transition-colors flex items-center gap-1.5 font-bold shadow-xs cursor-pointer text-[11px]",
                                isSafeMode
                                    ? "bg-amber-500/20 border-amber-500/50 text-amber-600 dark:text-amber-400"
                                    : "bg-background border-border hover:bg-muted text-foreground"
                            )}
                            title={isSafeMode ? "Safe Mode Active: Vaulted prose is blurred on screen" : "Toggle Safe Mode (Mask vaulted prose on screen)"}
                            aria-label="Toggle Safe Mode"
                            data-testid="scribe-safe-mode-toggle"
                        >
                            {isSafeMode ? (
                                <>
                                    <ShieldCheck className="w-3 h-3 text-amber-500" />
                                    <span>Safe Mode ON</span>
                                </>
                            ) : (
                                <>
                                    <ShieldAlert className="w-3 h-3 text-muted-foreground" />
                                    <span>Safe Mode</span>
                                </>
                            )}
                        </button>

                        {/* Egress Inspector Button */}
                        <button
                            type="button"
                            onClick={() => setIsEgressInspectorOpen(true)}
                            className="px-2 py-1 rounded border border-border bg-background hover:bg-muted text-foreground flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer text-[11px]"
                            title="Inspect Sanitized Cloud Egress Payload"
                            aria-label="Inspect Egress"
                            data-testid="scribe-egress-inspector-toggle"
                        >
                            <Lock className="w-3 h-3 text-sky-500" />
                            <span>Inspect Egress</span>
                        </button>

                        {/* Autosave sync announcement */}
                        <span role="status" aria-live="polite" className="contents">
                            {saveState === "saving" ? (
                                <span className="text-amber-500 dark:text-amber-400 flex items-center gap-1">Saving...</span>
                            ) : saveState === "failed" ? (
                                <button
                                    type="button"
                                    onClick={() => activeNode && void performSave(activeNode.id, content, activeNode.documentId)}
                                    className="text-destructive flex items-center gap-1 underline underline-offset-2"
                                    data-testid="scribe-save-failed"
                                    title={saveError ?? undefined}
                                >
                                    <AlertTriangle className="w-3 h-3" aria-hidden="true" /> Not saved — retry
                                </button>
                            ) : saveState === "saved" ? (
                                <span className="text-muted-foreground flex items-center gap-1" data-testid="scribe-save-synced">
                                    <Check className="w-3 h-3 text-emerald-500 dark:text-emerald-400" aria-hidden="true" /> Synced
                                </span>
                            ) : (
                                <span className="text-muted-foreground flex items-center gap-1">No changes</span>
                            )}
                        </span>
                        <span className="bg-background px-2 py-0.5 rounded border border-border">
                            {activeNode.wordCount || content.trim().split(/\s+/).filter(Boolean).length} words
                        </span>
                    </div>
                </div>

                {/* Row 2: Rich HTML & Markdown Formatting Ribbon (Floats stably right under Row 1, never lost on scroll) */}
                {(canvasMode === "rich" || canvasMode === "raw") && (
                    <div className="bg-card/90 border-t border-border/60 px-4 sm:px-6 py-1.5 flex items-center gap-1 font-mono text-[11px] overflow-x-auto select-none shadow-xs">
                        {/* Block Style */}
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleExecCommand("formatBlock", "<p>");
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Paragraph (Normal Text)"
                            aria-label="Paragraph"
                        >
                            <Pilcrow className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleExecCommand("formatBlock", "<h1>");
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Heading 1"
                            aria-label="Heading 1"
                        >
                            <Heading1 className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleExecCommand("formatBlock", "<h2>");
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Heading 2"
                            aria-label="Heading 2"
                        >
                            <Heading2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleExecCommand("formatBlock", "<h3>");
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Heading 3"
                            aria-label="Heading 3"
                        >
                            <Heading3 className="w-3.5 h-3.5" />
                        </button>

                        <div className="w-px h-3.5 bg-border mx-1" />

                        {/* Inline Formatting */}
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleExecCommand("bold");
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Bold"
                            aria-label="Bold"
                        >
                            <Bold className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleExecCommand("italic");
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Italic"
                            aria-label="Italic"
                        >
                            <Italic className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleExecCommand("underline");
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Underline"
                            aria-label="Underline"
                        >
                            <Underline className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleExecCommand("strikeThrough");
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Strikethrough"
                            aria-label="Strikethrough"
                        >
                            <Strikethrough className="w-3.5 h-3.5" />
                        </button>

                        <div className="w-px h-3.5 bg-border mx-1" />

                        {/* Lists & Quotes */}
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleExecCommand("insertUnorderedList");
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Bullet List"
                            aria-label="Bullet List"
                        >
                            <List className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleExecCommand("insertOrderedList");
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Numbered List"
                            aria-label="Numbered List"
                        >
                            <ListOrdered className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleExecCommand("formatBlock", "<blockquote>");
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Callout Quote"
                            aria-label="Blockquote"
                        >
                            <Quote className="w-3.5 h-3.5" />
                        </button>

                        <div className="w-px h-3.5 bg-border mx-1" />

                        {/* Rich Table & Link */}
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleInsertTable(2, 3);
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors flex items-center gap-1"
                            title="Insert Rich HTML Table"
                            aria-label="Insert Table"
                        >
                            <Table className="w-3.5 h-3.5" />
                            <span className="text-[10px] hidden sm:inline">Table</span>
                        </button>
                        <div className="w-px h-3.5 bg-border mx-1" />

                        <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
                            <DialogContent className="sm:max-w-md" data-testid="scribe-link-dialog">
                                <DialogHeader>
                                    <DialogTitle>Insert link</DialogTitle>
                                    <DialogDescription>
                                        Link the selected text. Use an http(s), mailto or tel address, or
                                        a path beginning with / or # to point inside this document.
                                    </DialogDescription>
                                </DialogHeader>
                                <form
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        confirmInsertLink();
                                    }}
                                >
                                    <input
                                        autoFocus
                                        value={linkUrl}
                                        onChange={(e) => {
                                            setLinkUrl(e.target.value);
                                            setLinkError(null);
                                        }}
                                        aria-label="Link address"
                                        aria-invalid={linkError ? true : undefined}
                                        data-testid="scribe-link-input"
                                        className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                                    />
                                    {linkError && (
                                        <p role="alert" className="mt-1.5 text-xs text-destructive" data-testid="scribe-link-error">
                                            {linkError}
                                        </p>
                                    )}
                                    <DialogFooter className="mt-4">
                                        <button
                                            type="button"
                                            onClick={() => setIsLinkDialogOpen(false)}
                                            className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                                        >
                                            Insert link
                                        </button>
                                    </DialogFooter>
                                </form>
                            </DialogContent>
                        </Dialog>

                        {/* Confluence-style macros: panel, expand, status, code, task */}
                        <div className="relative">
                            <button
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    setMacroMenu(macroMenu === "panel" ? null : "panel");
                                }}
                                className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors flex items-center gap-1"
                                title="Insert an info, note, warning or success panel"
                                aria-label="Insert Panel"
                            >
                                <Info className="w-3.5 h-3.5" />
                                <span className="text-[10px] hidden sm:inline">Panel</span>
                            </button>
                            {macroMenu === "panel" && (
                                <div className="absolute left-0 top-full z-30 mt-1 w-36 rounded-md border border-border bg-card p-1 shadow-lg">
                                    {(Object.keys(PANEL_STYLES) as PanelKind[]).map((kind) => (
                                        <button
                                            key={kind}
                                            type="button"
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                insertMacroHtml(panelHtml(kind));
                                            }}
                                            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-foreground hover:bg-muted"
                                            aria-label={"Insert " + PANEL_STYLES[kind].label + " Panel"}
                                        >
                                            <span aria-hidden="true">{PANEL_STYLES[kind].icon}</span>
                                            <span>{PANEL_STYLES[kind].label}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                insertMacroHtml(expandHtml());
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Insert a collapsible section"
                            aria-label="Insert Expand"
                        >
                            <ChevronRight className="w-3.5 h-3.5" />
                        </button>

                        <div className="relative">
                            <button
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    setMacroMenu(macroMenu === "status" ? null : "status");
                                }}
                                className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                                title="Insert a status lozenge"
                                aria-label="Insert Status"
                            >
                                <Tag className="w-3.5 h-3.5" />
                            </button>
                            {macroMenu === "status" && (
                                <div className="absolute left-0 top-full z-30 mt-1 w-36 rounded-md border border-border bg-card p-1 shadow-lg">
                                    {(Object.keys(STATUS_STYLES) as StatusKind[]).map((kind) => (
                                        <button
                                            key={kind}
                                            type="button"
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                insertMacroHtml(statusHtml(kind, STATUS_DEFAULT_LABELS[kind]));
                                            }}
                                            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-foreground hover:bg-muted"
                                            aria-label={"Insert " + kind + " Status"}
                                        >
                                            <span className={cn("inline-block h-2.5 w-2.5 rounded-full border", STATUS_STYLES[kind])} />
                                            <span>{STATUS_DEFAULT_LABELS[kind]}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Confidential Sandbox Macro */}
                        <div className="relative">
                            <button
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    setMacroMenu(macroMenu === "sandbox" ? null : "sandbox");
                                }}
                                className={cn(
                                    "p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors flex items-center gap-1",
                                    macroMenu === "sandbox" && "bg-muted text-foreground"
                                )}
                                title="Insert a confidential sandboxed narrative block"
                                aria-label="Insert Confidential Sandbox"
                                data-testid="scribe-insert-sandbox"
                            >
                                <Lock className="w-3.5 h-3.5 text-amber-500" />
                                <span className="text-[10px] hidden sm:inline font-semibold">Vault</span>
                            </button>
                            {macroMenu === "sandbox" && (
                                <div className="absolute left-0 top-full z-30 mt-1 w-52 rounded-md border border-border bg-card p-1 shadow-lg text-xs font-sans">
                                    <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase border-b border-border/50">
                                        Confidential Vault Type
                                    </div>
                                    {[
                                        { type: "adult", label: "Adult / Romance", summary: "Sensual romance scene" },
                                        { type: "violence", label: "Action / Forensic", summary: "Forensic action scene" },
                                        { type: "confidential", label: "Proprietary Plot", summary: "Secret plot beat" },
                                        { type: "pii", label: "Identity / PII", summary: "Protected character details" },
                                    ].map((opt) => (
                                        <button
                                            key={opt.type}
                                            type="button"
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                const uid = "v_" + Math.random().toString(36).slice(2, 8);
                                                insertMacroHtml(sandboxHtml(uid, opt.type, "static_reinsert", opt.summary, "Confidential prose authored here stays strictly in local vault and is redacted during cloud egress..."));
                                                setMacroMenu(null);
                                            }}
                                            className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                                            aria-label={`Insert ${opt.label} Sandbox`}
                                        >
                                            <span>{opt.label}</span>
                                            <span className="text-[10px] text-muted-foreground font-mono">vault</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleInsertCodeBlock();
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Insert a fenced code block"
                            aria-label="Insert Code Block"
                        >
                            <Code className="w-3.5 h-3.5" />
                        </button>

                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleInsertTaskList();
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Insert an action item checkbox"
                            aria-label="Insert Task Item"
                        >
                            <CheckSquare className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            disabled={!isCaretInTable}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                runTableEdit(addRowBelow);
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                            title="Add a row below the current row"
                            aria-label="Add Row"
                        >
                            <Rows3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            disabled={!isCaretInTable}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                runTableEdit(addColumnAfter);
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                            title="Add a column right of the current column"
                            aria-label="Add Column"
                        >
                            <Columns3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            disabled={!isCaretInTable}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                runTableEdit(deleteRow);
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                            title="Delete the current row"
                            aria-label="Delete Row"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            disabled={!isCaretInTable}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                runTableEdit(deleteColumn);
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                            title="Delete the current column"
                            aria-label="Delete Column"
                        >
                            <Scissors className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleInsertLink();
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Insert Link"
                            aria-label="Insert Link"
                        >
                            <LinkIcon className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleExecCommand("insertHorizontalRule");
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Horizontal Divider"
                            aria-label="Horizontal Rule"
                        >
                            <Minus className="w-3.5 h-3.5" />
                        </button>

                        <div className="w-px h-3.5 bg-border mx-1" />

                        {/* Undo / Redo / Clear */}
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleExecCommand("undo");
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Undo (Ctrl+Z)"
                            aria-label="Undo"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleExecCommand("redo");
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Redo (Ctrl+Y)"
                            aria-label="Redo"
                        >
                            <RotateCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleExecCommand("removeFormat");
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
                            title="Clear Formatting"
                            aria-label="Clear Formatting"
                        >
                            <Eraser className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
            </div>

            {/* Floating Selection Quick-Action Pill */}
            {selectedText && (
                <div
                    onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                    }}
                    onMouseUp={(e) => {
                        e.stopPropagation();
                    }}
                    className="sticky top-24 mx-auto z-40 bg-popover text-popover-foreground border border-emerald-500/50 shadow-2xl rounded-2xl p-2.5 flex flex-col gap-2 font-mono text-xs animate-in fade-in zoom-in-95 max-w-2xl"
                >
                    <div className="flex items-center gap-2 overflow-x-auto">
                        {/* Highlighting Tools */}
                        <span className="text-muted-foreground font-bold flex items-center gap-1 text-[11px] shrink-0">
                            <Highlighter className="w-3.5 h-3.5 text-amber-500" /> Highlight:
                        </span>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                            }}
                            onClick={() => handleApplyHighlight("bg-amber-300/40")}
                            className="px-2 py-0.5 bg-amber-400/20 hover:bg-amber-400/40 text-amber-800 dark:text-amber-300 rounded border border-amber-500/40 text-[10px] font-bold transition-colors"
                            title="Yellow Highlight"
                        >
                            🟨 Yellow
                        </button>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                            }}
                            onClick={() => handleApplyHighlight("bg-emerald-400/30")}
                            className="px-2 py-0.5 bg-emerald-400/20 hover:bg-emerald-400/40 text-emerald-800 dark:text-emerald-300 rounded border border-emerald-500/40 text-[10px] font-bold transition-colors"
                            title="Green Highlight"
                        >
                            🟩 Green
                        </button>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                            }}
                            onClick={() => handleApplyHighlight("bg-sky-400/30")}
                            className="px-2 py-0.5 bg-sky-400/20 hover:bg-sky-400/40 text-sky-800 dark:text-sky-300 rounded border border-sky-500/40 text-[10px] font-bold transition-colors"
                            title="Blue Highlight"
                        >
                            🟦 Blue
                        </button>

                        <div className="h-4 w-px bg-border/80 mx-1 shrink-0" />

                        {/* Note & To-Do Creation */}
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                            }}
                            onClick={() => {
                                setIsNoteInputOpen(true);
                                setNoteType("note");
                            }}
                            className="px-2.5 py-1 bg-background hover:bg-muted text-foreground rounded border border-border hover:border-emerald-500/60 transition-colors flex items-center gap-1 shrink-0 text-[11px]"
                        >
                            <StickyNote className="w-3 h-3 text-emerald-500" /> Note
                        </button>
                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                            }}
                            onClick={() => {
                                setIsNoteInputOpen(true);
                                setNoteType("todo");
                            }}
                            className="px-2.5 py-1 bg-background hover:bg-muted text-foreground rounded border border-border hover:border-amber-500/60 transition-colors flex items-center gap-1 shrink-0 text-[11px]"
                        >
                            <CheckSquare className="w-3 h-3 text-amber-500" /> To-Do
                        </button>

                        <div className="h-4 w-px bg-border/80 mx-1 shrink-0" />

                        {/* Persona Quick Action Shortcuts */}
                        {onDiscussWithCrew && (
                            <>
                                <button
                                    type="button"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                    }}
                                    onClick={() => {
                                        const text = selectedText;
                                        setFocusedExcerpt(text);
                                        onDiscussWithCrew(text, "LegalSentinel");
                                    }}
                                    className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded border border-amber-500/40 transition-colors shrink-0 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                                    title="Ask Legal Sentinel about this clause"
                                >
                                    ⚖️ Ask Legal
                                </button>
                                <button
                                    type="button"
                                    data-testid="ask-ghostwriter-pill-btn"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                    }}
                                    onClick={() => {
                                        const text = selectedText;
                                        setFocusedExcerpt(text);
                                        onDiscussWithCrew(text, "GhostWriter");
                                    }}
                                    className="px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 rounded border border-emerald-500/40 transition-colors shrink-0 text-[11px] font-semibold flex items-center gap-1 cursor-pointer ring-1 ring-emerald-500/30"
                                    title="Ask GhostWriter to rewrite with more depth"
                                >
                                    ✍️ Ask GhostWriter
                                </button>
                                <button
                                    type="button"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                    }}
                                    onClick={() => {
                                        const text = selectedText;
                                        setFocusedExcerpt(text);
                                        onDiscussWithCrew(text, "CopyEditor");
                                    }}
                                    className="px-2.5 py-1 bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 dark:text-sky-300 rounded border border-sky-500/40 transition-colors shrink-0 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                                    title="Ask CopyEditor for conciseness"
                                >
                                    ✂️ Ask CopyEditor
                                </button>
                                <button
                                    type="button"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                    }}
                                    onClick={() => {
                                        const text = selectedText;
                                        setFocusedExcerpt(text);
                                        onDiscussWithCrew(text);
                                    }}
                                    className="px-2.5 py-1 bg-purple-500/10 hover:bg-purple-500/20 text-purple-700 dark:text-purple-300 rounded border border-purple-500/40 transition-colors shrink-0 text-[11px] font-bold flex items-center gap-1 shadow-xs cursor-pointer"
                                    title="Send excerpt as general focus context into Agent Chat"
                                >
                                    <MessageSquare className="w-3 h-3 text-purple-500" /> Discuss with Crew
                                </button>
                            </>
                        )}

                        <div className="h-4 w-px bg-border/80 mx-1 shrink-0" />

                        <button
                            type="button"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                            }}
                            onClick={() => {
                                setSelectedText("");
                                setIsNoteInputOpen(false);
                            }}
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors shrink-0 cursor-pointer"
                            title="Dismiss Selection Menu"
                            aria-label="Dismiss Selection Menu"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    {/* Inline Note / To-Do Input Card */}
                    {isNoteInputOpen && (
                        <div className="pt-2 border-t border-border flex flex-col gap-2">
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                <span className="font-semibold text-foreground flex items-center gap-1.5">
                                    {noteType === "todo" ? <CheckSquare className="w-3.5 h-3.5 text-amber-500" /> : <StickyNote className="w-3.5 h-3.5 text-emerald-500" />}
                                    {noteType === "todo" ? "Add Station Action Item / To-Do" : "Add Margin Note"}
                                </span>
                                <button
                                    onClick={() => setIsNoteInputOpen(false)}
                                    className="p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            <div className="text-[10px] text-muted-foreground bg-muted/30 p-1.5 rounded border border-border/50 truncate font-serif italic">
                                Selection: "{selectedText}"
                            </div>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={noteDraft}
                                    onChange={(e) => setNoteDraft(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleSaveNoteOrTodo()}
                                    placeholder={noteType === "todo" ? "e.g., Verify section 4 indemnity with Legal Sentinel..." : "e.g., Expand protagonist emotional reaction here..."}
                                    className="flex-1 px-2.5 py-1 bg-background border border-border rounded text-foreground text-xs focus:outline-none focus:border-emerald-500"
                                    autoFocus
                                />
                                <button
                                    onClick={handleSaveNoteOrTodo}
                                    className="px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded text-xs transition-colors shrink-0 shadow-xs"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Paginated Paper Canvas Container */}
            <div className="flex-1 flex justify-center py-4 px-2 sm:px-4">
                <div className={cn(
                    "w-full max-w-3xl min-h-[600px] sm:min-h-[850px] bg-card text-card-foreground border border-border shadow-xl rounded-xl p-4 sm:p-8 flex flex-col relative transition-all",
                    isSafeMode && "scribe-safe-mode"
                )}>
                    {/* Embedded Typography & Rich Editor Styling */}
                    <style>{`
                        .scribe-rich-canvas:focus { outline: none; }
                        .scribe-rich-canvas h1 { font-size: 1.75rem; font-weight: 700; font-family: sans-serif; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; margin-top: 1.25rem; margin-bottom: 0.75rem; color: var(--foreground); }
                        .scribe-rich-canvas h2 { font-size: 1.35rem; font-weight: 600; font-family: sans-serif; border-bottom: 1px solid var(--border); padding-bottom: 0.35rem; margin-top: 1rem; margin-bottom: 0.5rem; color: var(--foreground); }
                        .scribe-rich-canvas h3 { font-size: 1.15rem; font-weight: 600; font-family: sans-serif; margin-top: 0.75rem; margin-bottom: 0.35rem; color: var(--foreground); }
                        .scribe-rich-canvas p { margin-bottom: 0.85rem; line-height: 1.75; }
                        .scribe-rich-canvas ul { list-style-type: disc; padding-left: 1.5rem; margin-bottom: 0.85rem; }
                        .scribe-rich-canvas ol { list-style-type: decimal; padding-left: 1.5rem; margin-bottom: 0.85rem; }
                        .scribe-rich-canvas li { margin-bottom: 0.25rem; }
                        .scribe-rich-canvas blockquote { border-left: 4px solid #10b981; padding: 0.5rem 1rem; margin: 1rem 0; font-style: italic; background: rgba(16, 185, 129, 0.08); border-radius: 0 0.375rem 0.375rem 0; }
                        .scribe-rich-canvas table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-family: sans-serif; font-size: 0.875rem; border: 1px solid var(--border); }
                        .scribe-rich-canvas th { border: 1px solid var(--border); padding: 0.5rem 0.75rem; background: rgba(125, 125, 125, 0.1); font-weight: 600; text-align: left; }
                        .scribe-rich-canvas td { border: 1px solid var(--border); padding: 0.5rem 0.75rem; }
                        .scribe-rich-canvas hr { border: 0; border-top: 1px solid var(--border); margin: 1.5rem 0; }
                        .scribe-rich-canvas code { font-family: monospace; font-size: 0.85em; background: rgba(125, 125, 125, 0.15); padding: 0.15rem 0.35rem; border-radius: 0.25rem; }
                        .scribe-rich-canvas a { color: #10b981; text-decoration: underline; }
                        .scribe-rich-canvas mark { background: rgba(251, 191, 36, 0.35); padding: 0.1rem 0.25rem; border-radius: 0.2rem; }
                    `}</style>

                    {/* Running Header */}
                    <div className="flex items-center justify-between pb-4 mb-4 border-b border-border/60 font-mono text-[10px] text-muted-foreground uppercase tracking-widest gap-2">
                        <span className="truncate">{documentTitle}</span>
                        <span className="truncate text-right">{activeNode.title}</span>
                    </div>

                    {/* Live Agent Sentinel Stream & Insights Bar */}
                    <div className="mb-4 flex flex-col gap-2">
                        <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-muted/40 border border-border/50 text-[11px] font-mono select-none">
                            <div className="flex items-center gap-2">
                                <span className={cn("h-2 w-2 rounded-full", isStreamingToAgents ? "bg-emerald-400 animate-ping" : "bg-emerald-500")} />
                                <span className="font-semibold text-foreground/90 flex items-center gap-1">
                                    <Radio className="w-3.5 h-3.5 text-emerald-400" /> Scribe Live Agent Stream
                                </span>
                                <span className="text-[10px] text-muted-foreground hidden sm:inline">
                                    (GhostWriter, LegalSentinel, Critic listening)
                                </span>
                            </div>
                            {isStreamingToAgents && (
                                <span className="text-[10px] text-indigo-400 animate-pulse flex items-center gap-1">
                                    <Zap className="w-3 h-3" /> Evaluating in flight...
                                </span>
                            )}
                            {activeInsights.length > 0 && !isStreamingToAgents && (
                                <span className="text-[10px] text-amber-400 font-bold flex items-center gap-1">
                                    <Sparkles className="w-3 h-3" /> {activeInsights.length} agent {activeInsights.length === 1 ? "insight" : "insights"}
                                </span>
                            )}
                        </div>

                        {/* Active Agent Live Insights Cards */}
                        {activeInsights.length > 0 && (
                            <div className="space-y-2 pt-1">
                                {activeInsights.map((insight) => (
                                    <div
                                        key={insight.id}
                                        className={cn(
                                            "p-3 rounded-lg border text-xs shadow-sm transition-all flex flex-col gap-1.5",
                                            insight.type === "warning" || insight.type === "missing_term"
                                                ? "bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200"
                                                : insight.type === "praise"
                                                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200"
                                                  : "bg-indigo-500/10 border-indigo-500/30 text-indigo-900 dark:text-indigo-200"
                                        )}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-1.5 font-bold">
                                                <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-mono bg-background/80 border border-border">
                                                    {SOURCE_LABEL[insight.agentRole] ?? SOURCE_LABEL.Critic}
                                                </span>
                                                <span>{insight.title}</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setActiveInsights((prev) => prev.filter((i) => i.id !== insight.id))}
                                                className="p-0.5 text-muted-foreground hover:text-foreground rounded"
                                                title="Dismiss"
                                                aria-label="Dismiss insight"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                        <p className="text-[11px] leading-relaxed opacity-90">{insight.message}</p>
                                        {insight.suggestedReplacement && (
                                            <div className="mt-1 p-2 rounded bg-background/60 border border-border/60 font-serif italic text-[11px]">
                                                Suggested addition: "{insight.suggestedReplacement}"
                                            </div>
                                        )}
                                        <div className="flex items-center gap-2 mt-1 pt-1 border-t border-border/30">
                                            {insight.suggestedReplacement && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleApplyInsight(insight)}
                                                    className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded text-[10px] font-bold transition-colors flex items-center gap-1 shadow-xs"
                                                >
                                                    <Check className="w-3 h-3" /> Apply to Draft
                                                </button>
                                            )}
                                            {onAcceptAlias && insight.canonical && insight.originalExcerpt && (
                                                <button
                                                    type="button"
                                                    onClick={async () => {
                                                        await onAcceptAlias(insight.canonical!, insight.originalExcerpt!);
                                                        setActiveInsights((prev) => prev.filter((i) => i.id !== insight.id));
                                                    }}
                                                    title={`Accept "${insight.originalExcerpt}" as a valid form of "${insight.canonical}" everywhere in this document`}
                                                    className="px-2.5 py-1 bg-background hover:bg-muted text-foreground rounded border border-border text-[10px] font-semibold transition-colors flex items-center gap-1"
                                                >
                                                    <Check className="w-3 h-3" /> Always allow "{insight.originalExcerpt}"
                                                </button>
                                            )}
                                            {onDiscussWithCrew && (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        onDiscussWithCrew(
                                                            insight.originalExcerpt || insight.message,
                                                            DISCUSSABLE.has(insight.agentRole) ? insight.agentRole : undefined,
                                                        )
                                                    }
                                                    className="px-2.5 py-1 bg-background hover:bg-muted text-foreground rounded border border-border text-[10px] font-semibold transition-colors flex items-center gap-1"
                                                >
                                                    <MessageSquare className="w-3 h-3" /> Discuss with @
                                                    {DISCUSSABLE.has(insight.agentRole) ? insight.agentRole : "Crew"}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Station Title Heading in Paper (Single Station Views) */}
                    {!isFullDocMode && (
                        <div className="mb-6 pb-3 border-b border-border/40 flex items-start justify-between gap-4">
                            <div>
                                <h1 className="text-2xl sm:text-3xl font-bold font-sans text-foreground tracking-tight" data-testid="station-paper-heading">
                                    {activeNode.title}
                                </h1>
                                <div className="flex items-center gap-2 mt-1.5 font-mono text-[11px] text-muted-foreground">
                                    <span>Station {activeNode.sortOrder}</span>
                                    {activeNode.status && (
                                        <>
                                            <span>•</span>
                                            <span className="capitalize">{activeNode.status.replace("_", " ")}</span>
                                        </>
                                    )}
                                    {activeNode.targetPercentage ? (
                                        <>
                                            <span>•</span>
                                            <span>Pacing: {Math.round(activeNode.targetPercentage * 100)}%</span>
                                        </>
                                    ) : null}
                                </div>
                            </div>
                            {canvasMode !== "rich" && !isFullDocMode && (
                                <button
                                    type="button"
                                    onClick={() => setCanvasMode("rich")}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-border bg-background hover:bg-muted text-foreground transition-colors shadow-2xs shrink-0 cursor-pointer"
                                    title="Switch to Rich HTML Editor"
                                >
                                    <Edit3 className="w-3.5 h-3.5 text-emerald-500" /> Edit in Rich HTML
                                </button>
                            )}
                        </div>
                    )}

                    {/* GhostWriter Scoped Focus Banner */}
                    {focusedExcerpt && (
                        <div
                            data-testid="ghostwriter-focus-banner"
                            className="mb-4 flex items-center justify-between p-2.5 rounded-lg border border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 font-mono text-xs shadow-xs animate-in fade-in slide-in-from-top-1"
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-ping shrink-0" />
                                <span className="font-bold text-emerald-700 dark:text-emerald-300 shrink-0">✍️ GhostWriter Scoped Focus:</span>
                                <span className="truncate italic font-serif text-foreground font-semibold">"{focusedExcerpt}"</span>
                            </div>
                            <button
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                }}
                                onClick={() => {
                                    setFocusedExcerpt(null);
                                    window.dispatchEvent(new CustomEvent('scribe:clear-focus'));
                                }}
                                className="p-1 hover:bg-emerald-500/20 text-muted-foreground hover:text-foreground rounded transition-colors shrink-0 ml-2 cursor-pointer"
                                title="Clear GhostWriter Focus"
                                aria-label="Clear GhostWriter Focus"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    )}

                    {/* Editable Manuscript Body / Rich Markdown Preview / Full Document Continuous View */}
                    {isFullDocMode ? (
                        <div className="flex-1 w-full min-h-[500px] text-foreground text-base leading-relaxed tracking-wide font-serif py-2 space-y-8 animate-in fade-in duration-200">
                            <div className="border-b-2 border-border pb-4 mb-6">
                                <h1 className="text-3xl sm:text-4xl font-extrabold font-sans text-foreground tracking-tight">{documentTitle}</h1>
                                <p className="text-xs font-mono text-muted-foreground mt-1.5">
                                    Full Manuscript Continuous View • {allNodes.length} Stations • Click any heading to edit
                                </p>
                            </div>
                            {allNodes.map((node, index) => (
                                <section key={node.id || index} id={`station-${node.stationKey}`} className="space-y-3 pt-2">
                                    <div 
                                        onClick={() => {
                                            onSelectStation?.(node.stationKey);
                                            setCanvasMode("rich");
                                        }}
                                        className="flex items-center justify-between group cursor-pointer border-b border-border/40 pb-1.5 transition-colors"
                                        title={`Click to edit "${node.title}"`}
                                    >
                                        <h2 className="text-xl font-bold font-sans text-foreground group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                                            {node.title}
                                        </h2>
                                        <span className="text-[11px] font-mono text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                            Edit Station <ArrowRight className="w-3 h-3" />
                                        </span>
                                    </div>
                                    <div className="text-foreground text-base leading-relaxed">
                                        <ReactMarkdown
                                            rehypePlugins={[rehypeRaw, [rehypeSanitize, REHYPE_SANITIZE_SCHEMA]]}
                                            components={{
                                                h1: ({ children }) => <h3 className="text-xl font-bold font-sans text-foreground border-b border-border/40 pb-1 mt-3 mb-2">{children}</h3>,
                                                h2: ({ children }) => <h4 className="text-lg font-semibold font-sans text-foreground mt-3 mb-1">{children}</h4>,
                                                h3: ({ children }) => <h5 className="text-base font-medium font-sans text-foreground mt-2 mb-1">{children}</h5>,
                                                p: ({ children }) => <p className="mb-3 leading-relaxed">{highlightFocusText(children, focusedExcerpt)}</p>,
                                                ul: ({ children }) => <ul className="list-disc pl-6 mb-3 space-y-1">{highlightFocusText(children, focusedExcerpt)}</ul>,
                                                ol: ({ children }) => <ol className="list-decimal pl-6 mb-3 space-y-1">{highlightFocusText(children, focusedExcerpt)}</ol>,
                                                li: ({ children }) => <li className="leading-relaxed">{highlightFocusText(children, focusedExcerpt)}</li>,
                                                blockquote: ({ children }) => (
                                                    <blockquote className="border-l-4 border-emerald-500/60 pl-4 py-1 italic bg-muted/30 rounded-r my-3 text-muted-foreground">
                                                        {highlightFocusText(children, focusedExcerpt)}
                                                    </blockquote>
                                                ),
                                                table: ({ children }) => (
                                                    <div className="overflow-x-auto my-4 border border-border rounded-lg">
                                                        <table className="w-full text-sm font-sans border-collapse text-left">{children}</table>
                                                    </div>
                                                ),
                                                thead: ({ children }) => <thead className="bg-muted/60 border-b border-border">{children}</thead>,
                                                tbody: ({ children }) => <tbody className="divide-y divide-border/60">{children}</tbody>,
                                                th: ({ children }) => <th className="px-3 py-2 font-semibold text-foreground">{children}</th>,
                                                td: ({ children }) => <td className="px-3 py-2">{children}</td>,
                                                mark: ({ className, children, ...props }: any) => (
                                                    <mark
                                                        className={cn(
                                                            "bg-amber-300/40 dark:bg-amber-400/30 text-foreground px-1 py-0.5 rounded border-b border-amber-400/60 font-medium",
                                                            className
                                                        )}
                                                        {...props}
                                                    >
                                                        {children}
                                                    </mark>
                                                ),
                                                u: ({ children, ...props }: any) => (
                                                    <u className="underline underline-offset-2" {...props}>
                                                        {children}
                                                    </u>
                                                ),
                                                a: ({ href, children }) => {
                                                    const isAnchor = href?.startsWith("#");
                                                    const targetKey = isAnchor ? href?.replace(/^#(?:station-)?/, "") : null;
                                                    return (
                                                        <a
                                                            href={href}
                                                            onClick={(e) => {
                                                                if (targetKey && onSelectStation) {
                                                                    e.preventDefault();
                                                                    onSelectStation(targetKey);
                                                                    setCanvasMode("rich");
                                                                }
                                                            }}
                                                            className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline cursor-pointer"
                                                        >
                                                            {children}
                                                        </a>
                                                    );
                                                },
                                                code: ({ children }) => <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs text-foreground border border-border/60">{children}</code>,
                                                hr: () => <hr className="my-6 border-border" />,
                                            }}
                                        >
                                            {node.content?.replace(new RegExp(`^#+\\s+${node.title.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*\\n*`, 'i'), "") || "*[Section Draft in Progress]*"}
                                        </ReactMarkdown>
                                    </div>
                                </section>
                            ))}
                        </div>
                    ) : canvasMode === "rendered" ? (
                        <div
                            onMouseUp={handleSelectionCheck}
                            onKeyUp={handleSelectionCheck}
                            onDoubleClick={() => setCanvasMode("rich")}
                            title="Double-click to edit prose"
                            className="flex-1 w-full min-h-[400px] text-foreground text-base leading-relaxed tracking-wide font-serif py-2 space-y-4 cursor-text"
                        >
                            {content && content.trim() ? (
                                <ReactMarkdown
                                    rehypePlugins={[rehypeRaw, [rehypeSanitize, REHYPE_SANITIZE_SCHEMA]]}
                                    components={{
                                        h1: ({ children }) => <h1 className="text-2xl font-bold font-sans text-foreground border-b border-border/60 pb-2 mt-4 mb-2">{children}</h1>,
                                        h2: ({ children }) => <h2 className="text-xl font-semibold font-sans text-foreground border-b border-border/40 pb-1 mt-3 mb-2">{children}</h2>,
                                        h3: ({ children }) => <h3 className="text-lg font-medium font-sans text-foreground mt-2 mb-1">{children}</h3>,
                                        p: ({ children }) => <p className="mb-3 leading-relaxed">{highlightFocusText(children, focusedExcerpt)}</p>,
                                        ul: ({ children }) => <ul className="list-disc pl-6 mb-3 space-y-1">{highlightFocusText(children, focusedExcerpt)}</ul>,
                                        ol: ({ children }) => <ol className="list-decimal pl-6 mb-3 space-y-1">{highlightFocusText(children, focusedExcerpt)}</ol>,
                                        li: ({ children }) => <li className="leading-relaxed">{highlightFocusText(children, focusedExcerpt)}</li>,
                                        blockquote: ({ children }) => (
                                            <blockquote className="border-l-4 border-emerald-500/60 pl-4 py-1 italic bg-muted/30 rounded-r my-3 text-muted-foreground">
                                                {highlightFocusText(children, focusedExcerpt)}
                                            </blockquote>
                                        ),
                                        table: ({ children }) => (
                                            <div className="overflow-x-auto my-4 border border-border rounded-lg">
                                                <table className="w-full text-sm font-sans border-collapse text-left">{children}</table>
                                            </div>
                                        ),
                                        thead: ({ children }) => <thead className="bg-muted/60 border-b border-border">{children}</thead>,
                                        tbody: ({ children }) => <tbody className="divide-y divide-border/60">{children}</tbody>,
                                        th: ({ children }) => <th className="px-3 py-2 font-semibold text-foreground">{children}</th>,
                                        td: ({ children }) => <td className="px-3 py-2">{children}</td>,
                                        mark: ({ className, children, ...props }: any) => (
                                            <mark
                                                className={cn(
                                                    "bg-amber-300/40 dark:bg-amber-400/30 text-foreground px-1 py-0.5 rounded border-b border-amber-400/60 font-medium",
                                                    className
                                                )}
                                                {...props}
                                            >
                                                {children}
                                            </mark>
                                        ),
                                        u: ({ children, ...props }: any) => (
                                            <u className="underline underline-offset-2" {...props}>
                                                {children}
                                            </u>
                                        ),
                                        a: ({ href, children }) => {
                                            const isAnchor = href?.startsWith("#");
                                            const targetKey = isAnchor ? href?.replace(/^#(?:station-)?/, "") : null;
                                            return (
                                                <a
                                                    href={href}
                                                    onClick={(e) => {
                                                        if (targetKey) {
                                                            e.preventDefault();
                                                            if (isFullDocMode) {
                                                                const targetEl = document.getElementById(`station-${targetKey}`);
                                                                if (targetEl) {
                                                                    targetEl.scrollIntoView({ behavior: 'smooth' });
                                                                    return;
                                                                }
                                                            }
                                                            if (onSelectStation) {
                                                                onSelectStation(targetKey);
                                                            }
                                                        }
                                                    }}
                                                    className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline cursor-pointer"
                                                >
                                                    {children}
                                                </a>
                                            );
                                        },
                                        code: ({ children }) => <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs text-foreground border border-border/60">{children}</code>,
                                        hr: () => <hr className="my-6 border-border" />,
                                    }}
                                >
                                    {content.replace(new RegExp(`^#+\\s+${activeNode.title.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*\\n*`, 'i'), "")}
                                </ReactMarkdown>
                            ) : (
                                <div className="py-12 text-center text-muted-foreground space-y-3">
                                    <p className="italic text-sm">No prose authored for this station yet.</p>
                                    <button
                                        type="button"
                                        onClick={() => setCanvasMode("rich")}
                                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors shadow-xs cursor-pointer"
                                    >
                                        <Edit3 className="w-3.5 h-3.5" /> Start Drafting in Rich Editor
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        /* Visual Rich HTML WYSIWYG Editor */
                        <div
                            ref={richEditorRef}
                            contentEditable={canvasMode === "rich"}
                            onInput={handleRichInput}
                            onSelect={handleSelectionCheck}
                            onMouseUp={handleSelectionCheck}
                            onKeyUp={handleSelectionCheck}
                            suppressContentEditableWarning
                            className={cn(
                                "scribe-rich-canvas flex-1 w-full max-w-[68ch] mx-auto min-h-[450px] outline-none text-foreground text-base leading-relaxed tracking-wide font-serif selection:bg-emerald-500/20 cursor-text",
                                canvasMode === "raw" && "hidden"
                            )}
                            data-testid="scribe-rich-editor"
                        />
                    )}

                    {/*
                      * Synced Textarea Dual-Bind:
                      * Visible in "raw" mode for authors who prefer raw markdown,
                      * and accessible in "rich" / "rendered" modes so testing-library
                      * screen.getByRole("textbox") contracts remain completely unbroken.
                      */}
                    <textarea
                        ref={textareaRef}
                        value={content}
                        onChange={handleTextChange}
                        onSelect={handleSelectionCheck}
                        onMouseUp={handleSelectionCheck}
                        onKeyUp={handleSelectionCheck}
                        aria-label="Manuscript Prose"
                        placeholder={`Start authoring ${activeNode.title} here...\n\nDraft chapters, paste legal clauses, or ask CREW agents in chat to generate draft text.`}
                        className={cn(
                            "flex-1 w-full max-w-[68ch] mx-auto min-h-[400px] bg-transparent resize-none focus:outline-none text-foreground text-base leading-relaxed tracking-wide font-serif placeholder:text-muted-foreground/50 selection:bg-emerald-500/20",
                            canvasMode !== "raw" && "sr-only pointer-events-none absolute opacity-0 h-0 w-0 -z-10"
                        )}
                        rows={24}
                    />

                    {/* Running Footer & Page Counter */}
                    <div className="flex items-center justify-between pt-4 mt-4 border-t border-border/60 font-mono text-[10px] text-muted-foreground">
                        <span>Oddjob Scribe Studio Engine</span>
                        <span>Station #{activeNode.sortOrder}</span>
                    </div>
                </div>
            </div>

            {/* Confidential Egress Inspector Dialog */}
            <Dialog open={isEgressInspectorOpen} onOpenChange={setIsEgressInspectorOpen}>
                <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col font-sans" data-testid="scribe-egress-inspector">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                            <Lock className="w-4 h-4 text-emerald-500" />
                            <span>Confidential Egress Inspector</span>
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            Review how CORE protects your manuscript before cloud inference. 
                            Sensitive sandbox blocks are held in the local vault and replaced with semantic surrogates during cloud calls.
                        </DialogDescription>
                    </DialogHeader>

                    {(() => {
                        const preview = generateEgressPreview(content);
                        return (
                            <div className="space-y-4 py-2 overflow-y-auto max-h-[60vh]">
                                {/* Status Banner */}
                                <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/40 text-xs">
                                    <div className="flex items-center gap-2">
                                        <span className={cn(
                                            "flex h-2 w-2 rounded-full",
                                            preview.sandboxedBlockCount > 0 ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"
                                        )} />
                                        <span className="font-semibold text-foreground">
                                            {preview.sandboxedBlockCount > 0 
                                                ? `${preview.sandboxedBlockCount} Confidential Block(s) Protected (${preview.sandboxedWords} words withheld)`
                                                : "No confidential blocks in current station"}
                                        </span>
                                    </div>
                                    <span className="text-[11px] text-muted-foreground font-mono">
                                        Zero-Egress Guarantee: {preview.sandboxedBlockCount > 0 ? "ACTIVE" : "STANDBY"}
                                    </span>
                                </div>

                                {/* Comparison Columns */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                                    <div className="flex flex-col border border-border rounded-lg p-2.5 bg-background">
                                        <div className="font-bold text-[11px] text-muted-foreground pb-1.5 mb-1.5 border-b border-border flex items-center justify-between">
                                            <span>Active Local Draft</span>
                                            <span className="text-[10px] text-amber-500">Unredacted (Local Only)</span>
                                        </div>
                                        <pre className="whitespace-pre-wrap text-[11px] text-foreground/80 overflow-y-auto max-h-64 font-mono leading-relaxed">
                                            {content || "(Empty station)"}
                                        </pre>
                                    </div>

                                    <div className="flex flex-col border border-border rounded-lg p-2.5 bg-background">
                                        <div className="font-bold text-[11px] text-muted-foreground pb-1.5 mb-1.5 border-b border-border flex items-center justify-between">
                                            <span>Sanitized Cloud Payload</span>
                                            <span className="text-[10px] text-emerald-500 font-bold">Cloud Safe (Zero Leak)</span>
                                        </div>
                                        <pre className="whitespace-pre-wrap text-[11px] text-foreground/80 overflow-y-auto max-h-64 font-mono leading-relaxed">
                                            {preview.sanitizedEgress || "(Empty station)"}
                                        </pre>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    <DialogFooter className="mt-2 flex items-center justify-between sm:justify-between">
                        <span className="text-[11px] text-muted-foreground">
                            Tokens rehydrate deterministically upon cloud response.
                        </span>
                        <button
                            type="button"
                            onClick={() => setIsEgressInspectorOpen(false)}
                            className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 cursor-pointer"
                        >
                            Close
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

