import React from 'react';
import { Layers, PlusCircle, Edit3, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import { approvalArgFields } from '@shared/approval-args';

export interface AppActionApprovalViewProps {
  payload: Record<string, any>;
  decision: 'pending' | 'approved' | 'rejected';
  outcome?: {
    success?: boolean;
    action?: string;
    recordId?: string;
    collection?: string;
    discarded?: boolean;
    error?: string;
  } | null;
}

export function AppActionApprovalView({
  payload,
  decision,
  outcome,
}: AppActionApprovalViewProps) {
  const appName = payload.app?.name || payload.app || 'App';
  const collection = payload.collection || 'records';
  const action = payload.action || 'create_record';
  const recordId = payload.recordId || outcome?.recordId;
  const data = payload.data || {};

  const actionLabel =
    action === 'create_record'
      ? 'Create Record'
      : action === 'update_record'
      ? 'Update Record'
      : action === 'delete_record'
      ? 'Delete Record'
      : String(action).replace(/_/g, ' ');

  const ActionIcon =
    action === 'delete_record'
      ? Trash2
      : action === 'update_record'
      ? Edit3
      : PlusCircle;

  const dataFields = approvalArgFields(data);

  return (
    <div className="space-y-3" data-testid="app-action-proposal">
      {/* Target App & Action Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/40 p-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground">
              {appName}
            </div>
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <span>Collection:</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-foreground">
                {collection}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground">
          <ActionIcon className="h-3.5 w-3.5 text-primary" />
          <span className="capitalize">{actionLabel}</span>
        </div>
      </div>

      {/* Record Target (if existing ID is specified) */}
      {recordId && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Record ID:</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
            {recordId}
          </span>
        </div>
      )}

      {/* Proposed Data Fields */}
      {action === 'delete_record' ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-foreground">
          <p className="font-medium text-destructive">
            Warning: This record will be permanently deleted from &lsquo;{collection}&rsquo;.
          </p>
        </div>
      ) : dataFields.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">Proposed Fields</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-lg border border-border/60 bg-card p-3 text-xs">
            {dataFields.map((field) => (
              <React.Fragment key={field.label}>
                <dt className="font-medium text-muted-foreground">{field.label}</dt>
                <dd className="break-words whitespace-pre-wrap font-sans text-foreground">
                  {field.value}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      ) : (
        <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          No custom field values provided.
        </div>
      )}

      {/* Decision / Execution Outcome */}
      {outcome && outcome.error ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Execution failed: {outcome.error}</span>
        </div>
      ) : outcome && outcome.discarded ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
          <span>Action was discarded.</span>
        </div>
      ) : outcome && outcome.success ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            {action === 'create_record'
              ? `Record created successfully (${outcome.recordId ?? recordId}).`
              : action === 'update_record'
              ? `Record updated successfully (${outcome.recordId ?? recordId}).`
              : `Record deleted successfully.`}
          </span>
        </div>
      ) : decision === 'pending' ? (
        <p className="text-xs text-muted-foreground">
          Review the proposed app modifications. Approving will apply this action to the app database.
        </p>
      ) : null}
    </div>
  );
}
