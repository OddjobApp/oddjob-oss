import { useCallback, useEffect, useState } from "react";
import { FileText, Image as ImageIcon, Table2, AlertTriangle, Search, RefreshCw, Download, Pencil, Save, X } from "lucide-react";
import { apiRequest, resolveActiveOrgId } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Every file attached anywhere in this project.
 *
 * Reads the same records the room reads through `list_attachments`, so a file
 * listed here and a file an agent can search are the same thing rather than two
 * views that drift.
 *
 * Read and searchable are reported separately throughout. A file that could not
 * be parsed must not look empty, and one still being embedded must not look
 * absent — that distinction is the whole reason the index state is explicit.
 */

interface ProjectFile {
    id: number;
    displayName: string;
    mimeType: string | null;
    byteSize: number;
    parseStatus: string;
    parseType: string | null;
    textLength: number | null;
    indexStatus: string;
    uploadedBy: string | null;
    createdAt: string | null;
    preview: string | null;
    sessionKey?: string;
    roomTitle?: string | null;
}

function iconFor(file: ProjectFile) {
    if (file.parseType === "image") return ImageIcon;
    if (file.parseType === "table") return Table2;
    return FileText;
}

function readableSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProjectFilesTab({ projectKey }: { projectKey: string }) {
    const [files, setFiles] = useState<ProjectFile[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [draft, setDraft] = useState("");
    const [saving, setSaving] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    // A download is a plain <a href>, so it never passes through apiRequest and
    // has to carry the organization itself. Read it the way apiRequest does:
    // the workspace URL usually has no ?orgId= at all — the selection lives in
    // sessionStorage — so parsing the query string alone sent nothing, and the
    // server fell back to the user's default org for the file.
    const activeOrgId = resolveActiveOrgId();

    /**
     * The server refuses this request for reasons the person can act on — the
     * file is too large to edit here, or they may read this project but not
     * change it. Reporting only the status code turned all of them into
     * "(400)", so prefer the message the server actually sent.
     */
    const reasonFrom = async (response: Response, fallback: string): Promise<string> => {
        try {
            const body = await response.json();
            const message = body?.error?.message ?? body?.message;
            if (typeof message === "string" && message.trim()) return message;
        } catch {
            // Not JSON, or already consumed — fall through to the generic line.
        }
        return `${fallback} (${response.status})`;
    };

    const openEditor = async (file: ProjectFile) => {
        setActionError(null);
        try {
            const response = await apiRequest("GET", `/api/projects/${projectKey}/files/${file.id}/content`);
            if (!response.ok) throw new Error(await reasonFrom(response, "Could not open document"));
            const data = await response.json();
            setDraft(data.content || "");
            setEditingId(file.id);
        } catch (err: any) {
            setActionError(err?.message || "Could not open this document.");
        }
    };

    const saveEditor = async () => {
        if (editingId === null) return;
        setSaving(true);
        setActionError(null);
        try {
            const response = await apiRequest("PATCH", `/api/projects/${projectKey}/files/${editingId}/content`, { content: draft });
            if (!response.ok) throw new Error(await reasonFrom(response, "Could not save document"));
            setEditingId(null);
            await load();
        } catch (err: any) {
            setActionError(err?.message || "Could not save this document.");
        } finally {
            setSaving(false);
        }
    };

    const load = useCallback(async () => {
        setError(null);
        try {
            const response = await apiRequest("GET", `/api/projects/${projectKey}/files`);
            if (!response.ok) throw new Error(`Request failed (${response.status})`);
            const data = await response.json();
            setFiles(Array.isArray(data?.files) ? data.files : []);
        } catch (err: any) {
            // A failed read is not "no files" — saying so keeps an outage from
            // reading as an empty project.
            setError(err?.message || "Could not load this project's files.");
            setFiles(null);
        }
    }, [projectKey]);

    useEffect(() => { void load(); }, [load]);

    if (error) {
        return (
            <div className="space-y-3 py-4">
                <p role="alert" className="text-sm text-destructive">{error}</p>
                <Button variant="outline" size="sm" onClick={() => void load()}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" /> Try again
                </Button>
            </div>
        );
    }

    if (files === null) {
        return <p className="py-4 text-sm text-muted-foreground">Loading files…</p>;
    }

    if (files.length === 0) {
        return (
            <div className="py-6 text-sm text-muted-foreground" data-testid="project-files-empty">
                <p className="font-semibold text-foreground">No files in this project yet.</p>
                <p className="mt-1">
                    Attach a file in any of this project's rooms and it appears here, searchable by the
                    agents working in them.
                </p>
            </div>
        );
    }

    const unsearchable = files.filter((f) => f.indexStatus !== "indexed").length;

    return (
        <div className="space-y-3 py-4" data-testid="project-files">
            {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{files.length} file{files.length === 1 ? "" : "s"}</span>
                {unsearchable > 0 && (
                    // Surfaced rather than buried per row: if a third of the
                    // project's files are unsearchable, that is worth knowing at
                    // a glance before wondering why an agent missed something.
                    <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/40">
                        {unsearchable} not searchable
                    </Badge>
                )}
            </div>

            <ul className="space-y-1.5">
                {files.map((file) => {
                    const Icon = iconFor(file);
                    const unreadable = file.parseStatus !== "parsed";
                    const editable = (file.mimeType || "").startsWith("text/") || /\.(md|markdown|txt|json|csv|xml|ya?ml|log)$/i.test(file.displayName);
                    return (
                        <li
                            key={file.id}
                            className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2"
                            data-testid={`project-file-${file.id}`}
                        >
                            {unreadable
                                ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                                : <Icon className="h-4 w-4 shrink-0 text-teal-400" />}

                            <span className="min-w-0 flex-1">
                                {editable ? (
                                    <button type="button" onClick={() => void openEditor(file)} className="block max-w-full truncate text-left text-sm font-medium hover:text-teal-400 hover:underline">
                                        {file.displayName}
                                    </button>
                                ) : <span className="block truncate text-sm font-medium">{file.displayName}</span>}
                                <span className="block text-[11px] text-muted-foreground">
                                    {readableSize(file.byteSize)}
                                    {" · "}
                                    {unreadable
                                        ? `could not read (${file.parseStatus})`
                                        : `${(file.textLength ?? 0).toLocaleString()} characters read`}
                                    {file.roomTitle || file.sessionKey
                                        ? ` · from ${file.roomTitle || file.sessionKey}`
                                        : ""}
                                </span>
                            </span>

                            {file.indexStatus === "indexed" ? (
                                <Badge variant="outline" className="gap-1 text-[10px] text-emerald-400 border-emerald-500/40">
                                    <Search className="h-3 w-3" /> searchable
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                    {file.indexStatus === "pending" ? "indexing…" : file.indexStatus}
                                </Badge>
                            )}

                            {editable && (
                                <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => void openEditor(file)}>
                                    <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                                </Button>
                            )}

                            <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-[11px]">
                                <a
                                    href={`/api/projects/${projectKey}/files/${file.id}/download${activeOrgId ? `?orgId=${encodeURIComponent(activeOrgId)}` : ""}`}
                                    aria-label={`Download ${file.displayName}`}
                                >
                                    <Download className="mr-1 h-3.5 w-3.5" /> Download
                                </a>
                            </Button>

                            {editingId === file.id && (
                                <div className="basis-full space-y-2 border-t border-border/60 pt-3">
                                    <textarea
                                        aria-label={`Edit ${file.displayName}`}
                                        value={draft}
                                        onChange={(event) => setDraft(event.target.value)}
                                        className="min-h-[420px] w-full resize-y rounded-md border border-border bg-background p-4 font-mono text-sm leading-6 text-foreground focus:border-teal-500 focus:outline-none"
                                    />
                                    <div className="flex justify-end gap-2">
                                        <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} disabled={saving}>
                                            <X className="mr-1 h-4 w-4" /> Cancel
                                        </Button>
                                        <Button size="sm" onClick={() => void saveEditor()} disabled={saving}>
                                            <Save className="mr-1 h-4 w-4" /> {saving ? "Saving…" : "Save document"}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
