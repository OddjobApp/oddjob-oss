import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip, Loader2, FileText, Image as ImageIcon, Table2, AlertTriangle, Search, X } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Files attached to this room.
 *
 * Two states are kept visible on purpose, because collapsing either turns an
 * unknown into a claim: whether the file could be READ, and whether it is yet
 * SEARCHABLE. A file that failed to parse must not look empty, and one still
 * being embedded must not look absent — indexing runs in the background after
 * upload, so "pending" is a real and common state rather than an edge case.
 */

export interface CrewAttachment {
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
}

function iconFor(attachment: CrewAttachment) {
  if (attachment.parseType === 'image') return ImageIcon;
  if (attachment.parseType === 'table') return Table2;
  return FileText;
}

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CrewAttachmentBar({
  roomKey,
  organizationId,
  projectScoped = true,
  onAttached,
  onLoaded,
  className,
  triggerContainer,
}: {
  roomKey: string;
  organizationId?: number | null;
  /** Optionally gate to explicit project scope. Defaults to true. */
  projectScoped?: boolean;
  onAttached?: (attachments: CrewAttachment[]) => void;
  /** Fires whenever the list is (re)loaded, so a parent can mirror it. */
  onLoaded?: (attachments: CrewAttachment[]) => void;
  className?: string;
  /** Mount the picker button in the composer while keeping room files above it. */
  triggerContainer?: HTMLElement | null;
}) {
  const [attachments, setAttachments] = useState<CrewAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scopeQuery = organizationId != null ? `?organizationId=${organizationId}` : '';
  // Held in a ref, not a dependency: an inline callback from the parent would
  // otherwise change identity every render and drive an endless refetch loop.
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const load = useCallback(async () => {
    if (!roomKey || projectScoped === false) return;
    try {
      const response = await apiRequest('GET', `/api/crew/${roomKey}/attachments${scopeQuery}`);
      if (!response.ok) return;
      const data = await response.json();
      const next = Array.isArray(data?.attachments) ? data.attachments : [];
      setAttachments(next);
      onLoadedRef.current?.(next);
    } catch {
      // A failed list is not worth an error banner over the conversation; the
      // upload path reports its own failures, which is what users act on.
    }
  }, [roomKey, projectScoped, scopeQuery]);

  useEffect(() => { void load(); }, [load]);

  const remove = async (attachment: CrewAttachment) => {
    setError(null); setRemovingId(attachment.id);
    try {
      const response = await apiRequest('DELETE', `/api/crew/${roomKey}/attachments/${attachment.id}${scopeQuery}`);
      if (!response.ok) throw new Error('Could not remove the file from this room.');
      const data = await response.json();
      setAttachments(data.attachments);
      onLoadedRef.current?.(data.attachments);
    } catch (err: any) { setError(err?.message || 'Could not remove the file from this room.'); }
    finally { setRemovingId(null); }
  };

  // Indexing finishes after the upload responds, so poll briefly while anything
  // is still pending rather than leaving a permanently stale "pending" chip.
  useEffect(() => {
    if (!attachments.some((a) => a.indexStatus === 'pending')) return;
    const timer = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(timer);
  }, [attachments, load]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setIsUploading(true);
    try {
      const body = new FormData();
      Array.from(files).slice(0, 5).forEach((file) => body.append('files', file));

      const response = await fetch(`/api/crew/${roomKey}/attachments${scopeQuery}`, {
        method: 'POST',
        body,
        credentials: 'include',
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.message || detail?.error || `Upload failed (${response.status})`);
      }
      const data = await response.json();
      const next = Array.isArray(data?.attachments) ? data.attachments : [];
      setAttachments(next);
      onAttached?.(next);
    } catch (err: any) {
      setError(err?.message || 'Could not attach the file.');
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  if (projectScoped === false) return null;

  return (
    <div className={cn('space-y-1.5', className)} data-testid="crew-attachment-bar">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".png,.bmp,.jpg,.jpeg,.webp,.gif,.svg,.csv,.xlsx,.xls,.docx,.pdf,.md,.txt,.json,.xml,.yaml,.yml,.bpmn"
          className="hidden"
          onChange={(e) => void upload(e.target.files)}
          data-testid="crew-attachment-input"
          aria-label="Attach files to this room"
        />
        {(() => {
          const trigger = <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground"
          aria-label={isUploading ? 'Attaching files' : 'Attach files'}
          title={isUploading ? 'Attaching files…' : 'Attach files'}
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Paperclip className="h-4 w-4" />}
        </Button>;
          return triggerContainer ? createPortal(trigger, triggerContainer) : trigger;
        })()}
        {attachments.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {attachments.length} file{attachments.length === 1 ? '' : 's'} in this room
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[11px] text-destructive">{error}</p>
      )}

      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {attachments.map((attachment) => {
            const Icon = iconFor(attachment);
            const unreadable = attachment.parseStatus !== 'parsed';
            return (
              <li
                key={attachment.id}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px]',
                  unreadable
                    ? 'border-amber-500/40 bg-amber-500/5 text-amber-300'
                    : 'border-border/60 bg-card/60 text-foreground/90',
                )}
                title={
                  unreadable
                    ? `Could not read this file (${attachment.parseStatus})`
                    : `${attachment.textLength ?? 0} characters read`
                }
                data-testid={`crew-attachment-${attachment.id}`}
              >
                {unreadable ? <AlertTriangle className="h-3 w-3 shrink-0" /> : <Icon className="h-3 w-3 shrink-0" />}
                <span className="max-w-[16rem] truncate font-medium">{attachment.displayName}</span>
                <span className="text-muted-foreground">{readableSize(attachment.byteSize)}</span>

                {/* Searchability is separate from readability: a file can be
                    read and still not yet be retrievable by an agent. */}
                {attachment.indexStatus === 'indexed' ? (
                  <span className="flex items-center gap-0.5 text-emerald-400" title="Agents can search this file">
                    <Search className="h-2.5 w-2.5" /> searchable
                  </span>
                ) : attachment.indexStatus === 'pending' ? (
                  <span className="text-muted-foreground" title="Being indexed — agents cannot search it yet">indexing…</span>
                ) : attachment.indexStatus === 'skipped' ? (
                  <span className="text-muted-foreground" title="Nothing in this file could be embedded">not searchable</span>
                ) : (
                  <span className="text-destructive" title="Indexing failed — agents cannot search this file">index failed</span>
                )}
                <button type="button" className="rounded p-1 hover:bg-muted focus-visible:outline focus-visible:outline-2" aria-label={`Remove ${attachment.displayName} from room`} title="Remove from room; keeps the stored file and chat history" disabled={removingId !== null} onClick={() => void remove(attachment)}>
                  {removingId === attachment.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
