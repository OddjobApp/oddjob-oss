import React from 'react';
import { Check, Lock } from 'lucide-react';
import type { PermissionRequiredPayload } from '@shared/crew-permission';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CrewCard, CrewCardBody, CrewCardFooter, CrewCardHeader, CrewCardStatus } from './CrewCard';

/**
 * A refused tool call the person can act on: what was refused, the steps that
 * would allow it in the order they have to happen, and who can take them.
 */
export function PermissionRequiredCard({ payload }: { payload: PermissionRequiredPayload }) {
  const remaining = payload.steps.filter((step) => !step.done);
  // Only an in-app project link: the payload is stored and replayed with the turn.
  const href = typeof payload.manageHref === 'string' && /^\/projects\/[^/?#]+\?/.test(payload.manageHref) ? payload.manageHref : null;
  const where = payload.project ? ` in ${payload.project.name}` : '';
  return (
    <CrewCard testId="permission-required-card" label={payload.title}>
      <CrewCardHeader
        icon={<Lock />}
        tone="attention"
        title={payload.title}
        description={`An agent tried to ${payload.action}${where}. That needs the ${payload.allowedRoles.join(' or ')} finance role.`}
        aside={<CrewCardStatus tone="attention">Not allowed</CrewCardStatus>}
      />
      {payload.steps.length > 0 && (
        <CrewCardBody>
          <ol className="space-y-1.5" aria-label="Steps to get access">
            {payload.steps.map((step, index) => (
              <li key={step.id} className="flex items-start gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums',
                    step.done ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {step.done ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                <span className={cn('text-sm', step.done ? 'text-muted-foreground line-through' : 'text-foreground')}>
                  {step.label}
                  {step.done && <span className="sr-only"> (done)</span>}
                </span>
              </li>
            ))}
          </ol>
        </CrewCardBody>
      )}
      <CrewCardFooter
        note={
          remaining.length === 0
            ? 'Every step is done. Ask again.'
            : payload.callerCanGrant
              ? 'You can do these yourself in the project’s Integrations tab.'
              : `Ask ${payload.grantedBy} to do ${remaining.length === 1 ? 'this' : 'these'}.`
        }
      >
        {payload.callerCanGrant && href && remaining.length > 0 && (
          <Button asChild size="sm">
            <a href={href}>Open QuickBooks access</a>
          </Button>
        )}
      </CrewCardFooter>
    </CrewCard>
  );
}
