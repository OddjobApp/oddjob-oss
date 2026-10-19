import React from 'react';
import { Server, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CrewCard, CrewCardBody, CrewCardFooter, CrewCardHeader, CrewCardNotice, CrewCardStatus } from './CrewCard';

/**
 * The result of an approved scaffold, as reported by the server.
 */
export interface AssemblyOutcome {
  success: boolean;
  appName: string;
  displayName?: string;
  targetDir?: string;
  executedPacks: string[];
  error?: string;
  /** Present once the app is in the org catalogue and can be opened. */
  catalogue?: { appId: number; slug: string; href: string };
  /** Set when the scaffold succeeded but cataloguing did not. */
  catalogueError?: string;
  deployment?: { status: 'ready' | 'published'; runtimeUrl?: string; published: boolean; publicHref?: string };
  deploymentError?: string;
  design?: { styleId: string; applied: boolean };
  designError?: string;
}

export function AssemblyOutcomeCard({ outcome }: { outcome: AssemblyOutcome }) {
  const ok = outcome.success;
  const name = outcome.displayName || outcome.appName;
  const openHref = outcome.deployment?.publicHref || outcome.catalogue?.href;
  const problems = [
    outcome.designError && `The theme was not applied: ${outcome.designError}`,
    outcome.deploymentError && `Deployment needs attention: ${outcome.deploymentError}`,
    ok && !outcome.catalogue && `It could not be added to the app catalogue${outcome.catalogueError ? `: ${outcome.catalogueError}` : '.'}`,
  ].filter(Boolean) as string[];

  const summary = !ok
    ? outcome.error || 'The assembly did not complete.'
    : !outcome.catalogue
      ? 'The source was assembled, but the app is not in the catalogue.'
      : outcome.deployment?.status === 'published'
        ? 'Built, verified, and published.'
        : outcome.deployment?.status === 'ready'
          ? 'Built, running, and verified. It is not published.'
          : 'Added to the catalogue. Runtime deployment did not complete.';

  return (
    <CrewCard testId="assembly-outcome-card">
      <CrewCardHeader
        icon={<Server />}
        tone={ok ? 'success' : 'danger'}
        title={name}
        description={summary}
        aside={<CrewCardStatus tone={ok ? 'success' : 'danger'}>{ok ? 'Assembled' : 'Failed'}</CrewCardStatus>}
      />

      {ok && (
        <CrewCardBody>
          {outcome.executedPacks.length > 0 && (
            <ul className="space-y-1" aria-label="Packs that ran">
              {outcome.executedPacks.map((pack) => (
                <li key={pack} className="flex items-center gap-2 text-foreground/90">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  <span className="font-mono text-[11px]">{pack}</span>
                </li>
              ))}
            </ul>
          )}
          {outcome.targetDir && (
            <p className="text-muted-foreground">
              Written to <span className="break-all font-mono text-[11px] text-foreground/80">{outcome.targetDir}</span>
            </p>
          )}
          {outcome.design && (
            <p className="text-muted-foreground">App Forge theme: <span className="text-foreground">{outcome.design.styleId}</span></p>
          )}
          <CrewCardNotice title="Needs attention" items={problems} />
        </CrewCardBody>
      )}

      {ok && outcome.catalogue && openHref && (
        <CrewCardFooter>
          <Button asChild size="sm" variant="outline">
            <a href={openHref} data-testid="assembly-open-in-catalogue">
              {outcome.deployment?.publicHref ? 'Open app' : 'Open in catalogue'}
            </a>
          </Button>
        </CrewCardFooter>
      )}
    </CrewCard>
  );
}

export default AssemblyOutcomeCard;
