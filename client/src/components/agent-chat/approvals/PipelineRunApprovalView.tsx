import React from 'react';
import { approvalArgFields } from '@shared/approval-args';

export interface PipelineRunApprovalViewProps {
  payload: Record<string, any>;
  decision: 'pending' | 'approved' | 'rejected';
  pipelineRunOutcome: { state?: string; status?: string; executionId?: number | null; error?: string } | null;
}

export function PipelineRunApprovalView({
  payload,
  decision,
  pipelineRunOutcome,
}: PipelineRunApprovalViewProps) {
  return (
    <div className="space-y-2">
      <p className="font-medium text-foreground">Review the pipeline run</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border/60 px-3 py-2">
        <dt className="text-muted-foreground">Pipeline</dt>
        <dd className="break-words">{payload.pipelineName} (#{payload.pipelineId})</dd>
        {approvalArgFields(payload.inputData).map(field => (
          <React.Fragment key={field.label}>
            <dt className="text-muted-foreground">{field.label}</dt>
            <dd className="break-words whitespace-pre-wrap">{field.value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {decision === 'pending' && (
        <p className="text-muted-foreground">Nothing runs until an org admin approves. Approving starts the run with these inputs.</p>
      )}
      {pipelineRunOutcome && (pipelineRunOutcome.state === 'failed' || pipelineRunOutcome.status === 'failed') ? (
        <p role="alert" className="text-red-700 dark:text-red-300">Run failed: {pipelineRunOutcome.error ?? 'unknown error'}</p>
      ) : pipelineRunOutcome?.state === 'succeeded' ? (
        <p className="text-emerald-700 dark:text-emerald-300">Run finished{pipelineRunOutcome.executionId ? ` (execution #${pipelineRunOutcome.executionId})` : ''}.</p>
      ) : (pipelineRunOutcome?.state === 'running' || pipelineRunOutcome?.status === 'started') && (
        <p role="status">Run started.</p>
      )}
    </div>
  );
}
