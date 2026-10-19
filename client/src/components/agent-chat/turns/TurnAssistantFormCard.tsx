import React from 'react';
import { StudioForm } from '@/modules/forms/StudioForm';
import { GoogleWorkspaceIcon } from '../GoogleWorkspaceIcon';
import { apiRequest } from '@/lib/queryClient';

export interface TurnAssistantFormCardProps {
  payload: Record<string, any>;
  onArtifactSubmit: (message: string) => void;
}

/** The server's reason (e.g. "already completed") when it gave one. */
function submitFailureMessage(err: unknown): string {
  const reason = err instanceof Error && err.message ? err.message : null;
  return reason ? `Not submitted: ${reason}` : 'Not submitted. Try again.';
}

export function TurnAssistantFormCard({
  payload: p,
  onArtifactSubmit,
}: TurnAssistantFormCardProps) {
  const isInputRequest = p.type === 'input_request';
  const formSchema = p.schema || { fields: p.fields };
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  if (isInputRequest) {
    return (
      <div
        className="mt-3 rounded-xl border border-amber-500/40 bg-card p-4"
        data-testid="turn-artifact"
      >
        <div className="mb-3 border-b border-border/60 pb-2">
          <h3 className="text-sm font-bold text-foreground">{(p.title as string) || 'Input requested'}</h3>
          {p.description && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {p.description as string}
            </p>
          )}
        </div>
        <StudioForm
          schema={formSchema}
          submitLabel={(p.submitLabel as string) || 'Submit'}
          context={{}}
          themeConfig={{ primaryColor: 'hsl(var(--primary))', companyName: 'Oddjob' }}
          onSubmit={async (data: Record<string, any>) => {
            if (typeof p.requestId === 'number') {
              // A request that was not recorded must not be announced as submitted:
              // the room would believe the answer reached whatever is waiting on it.
              try {
                await apiRequest('POST', `/api/oddjob/forms/${p.requestId}/submit`, { data });
                setSubmitError(null);
              } catch (err) {
                setSubmitError(submitFailureMessage(err));
                return;
              }
            }
            onArtifactSubmit(
              `I submitted the "${p.title ?? 'form'}" form with: ${JSON.stringify(data)}`,
            );
          }}
        />
        {submitError && (
          <p role="alert" className="mt-2 text-xs text-destructive" data-testid="input-request-error">
            {submitError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="mt-3 rounded-xl border border-border/70 bg-card p-4"
      data-testid="turn-artifact"
    >
      {(p.title || p.description) && (
        <div className="mb-3 border-b border-border/60 pb-2">
          {p.title && (
            <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
              {/gmail/i.test(String(p.title)) && <GoogleWorkspaceIcon kind="email" />}
              {p.title as string}
            </h3>
          )}
          {p.description && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {p.description as string}
            </p>
          )}
        </div>
      )}
      <StudioForm
        schema={formSchema}
        submitLabel={(p.submitLabel as string) || 'Submit'}
        context={(p.context as Record<string, any>) || {}}
        themeConfig={{ primaryColor: 'hsl(var(--primary))', companyName: 'Oddjob' }}
        onSubmit={(data: Record<string, any>) =>
          onArtifactSubmit(
            `I submitted the "${p.title ?? 'form'}" with: ${JSON.stringify({ ...data, ...(formSchema.fields?.some((field: any) => field.key === 'body' && field.type === 'markdown') ? { body_format: 'markdown' } : {}) })}. Prepare the proposed action for my review; do not send without approval.`,
          )
        }
      />
    </div>
  );
}
