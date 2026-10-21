import React from 'react';

export interface OutboundMessagePreviewProps {
  payload: Record<string, any>;
  outboundChannel: 'slack' | 'email';
  decision: 'pending' | 'approved' | 'rejected';
  displaySubject: string;
  displayBody: string;
  editedSubject: string | null;
  setEditedSubject: (subj: string | null) => void;
  editedBody: string | null;
  setEditedBody: (body: string | null) => void;
  isEditingDraft: boolean;
  setIsEditingDraft: (editing: boolean) => void;
  isSubmitting: boolean;
  reason?: string;
  outboundOutcome: { sent?: boolean; discarded?: boolean; outcomeUnknown?: boolean; error?: string } | null;
}

export function OutboundMessagePreview({
  payload,
  outboundChannel,
  decision,
  displaySubject,
  displayBody,
  editedSubject,
  setEditedSubject,
  editedBody,
  setEditedBody,
  isEditingDraft,
  setIsEditingDraft,
  isSubmitting,
  reason,
  outboundOutcome,
}: OutboundMessagePreviewProps) {
  return (
    <div data-testid="outbound-message-preview">
      {payload.trigger && (
        <p className="mb-2 text-muted-foreground" data-testid="outbound-trigger">
          {payload.trigger}
        </p>
      )}
      <div className="divide-y divide-border/60 rounded-t-lg border border-border/60">
        {outboundChannel === 'email' ? (
          <>
            <div className="flex gap-3 px-3 py-2">
              <span className="w-12 shrink-0 text-muted-foreground">From</span>
              <span className="text-xs text-foreground">{payload.from || 'Connected mailbox'}</span>
            </div>
            <div className="flex gap-3 px-3 py-2">
              <span className="w-12 shrink-0 text-muted-foreground">To</span>
              <span className="text-xs text-foreground">{(payload.to ?? []).join(', ')}</span>
            </div>
            {payload.cc && payload.cc.length > 0 && (
              <div className="flex gap-3 px-3 py-2">
                <span className="w-12 shrink-0 text-muted-foreground">Cc</span>
                <span className="text-xs text-foreground">{payload.cc.join(', ')}</span>
              </div>
            )}
            {payload.bcc?.length > 0 && <div className="flex gap-3 px-3 py-2"><span className="w-12 shrink-0 text-muted-foreground">Bcc</span><span className="text-xs text-foreground">{payload.bcc.join(', ')}</span></div>}
            {payload.bodyFormat === 'html' && <p className="px-3 py-2 text-xs text-muted-foreground">HTML email · source shown below for review</p>}
            <div className="flex gap-3 px-3 py-2">
              <span className="w-12 shrink-0 text-muted-foreground">Subject</span>
              {isEditingDraft && decision === 'pending' ? (
                <input
                  type="text"
                  value={editedSubject ?? displaySubject}
                  onChange={(e) => setEditedSubject(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  data-testid="edit-subject-input"
                />
              ) : (
                <span className="text-xs font-medium text-foreground">{displaySubject || '(no subject)'}</span>
              )}
            </div>
          </>
        ) : (
          <>
            {payload.workspace && (
              <div className="flex gap-3 px-3 py-2">
                <span className="w-16 shrink-0 text-muted-foreground">Workspace</span>
                <span className="text-xs text-foreground">{payload.workspace}</span>
              </div>
            )}
            <div className="flex gap-3 px-3 py-2">
              <span className="w-16 shrink-0 text-muted-foreground">To</span>
              <span className="text-xs text-foreground">{(payload.to ?? []).join(', ')}</span>
            </div>
            {payload.thread && (
              <div className="flex gap-3 px-3 py-2">
                <span className="w-16 shrink-0 text-muted-foreground">Thread</span>
                <span className="text-xs text-foreground">{payload.thread}</span>
              </div>
            )}
          </>
        )}
      </div>
      {isEditingDraft && decision === 'pending' ? (
        <textarea
          value={editedBody ?? displayBody}
          onChange={(e) => setEditedBody(e.target.value)}
          disabled={isSubmitting}
          rows={Math.min(12, Math.max(4, displayBody.split('\n').length + 1))}
          className="-mt-px w-full rounded-b-lg border border-input bg-background px-3 py-2.5 text-xs leading-relaxed text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          data-testid="edit-body-input"
        />
      ) : (
        <div className="rounded-b-lg border border-t-0 border-border/60 px-3 py-2.5">
          <p className="text-xs leading-relaxed text-foreground whitespace-pre-wrap">{displayBody}</p>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        {reason && <p className="text-muted-foreground">{reason}</p>}
        {decision === 'pending' && (
          <button
            type="button"
            onClick={() => {
              if (!isEditingDraft) {
                setEditedBody(displayBody);
                setEditedSubject(displaySubject);
              } else {
                setEditedBody(null);
                setEditedSubject(null);
              }
              setIsEditingDraft(!isEditingDraft);
            }}
            className="ml-auto shrink-0 rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="edit-draft-toggle"
          >
            {isEditingDraft ? 'Cancel edits' : 'Edit draft'}
          </button>
        )}
      </div>
      {(outboundOutcome as any)?.warning && <p role="status" className="mt-2 text-sm">{(outboundOutcome as any).warning}</p>}
      {outboundOutcome?.sent === false && (
        <p role="alert" className="mt-2 text-red-700 dark:text-red-300">{outboundOutcome.outcomeUnknown ? "Delivery status unknown: " : "Delivery failed: "}{outboundOutcome.error}</p>
      )}
    </div>
  );
}
