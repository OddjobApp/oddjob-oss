import React, { useEffect } from 'react';
import { LayoutTemplate, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TokenizedAppSurface } from './TokenizedAppSurface';
import { CrewCard, CrewCardFooter, CrewCardHeader } from './CrewCard';
import {
  normalizeAssistantAppHref,
  type AssistantAppPayload,
} from '@/lib/assistant-app-href';

export function AppLaunchCard({
  app,
  onEvent,
}: {
  app: AssistantAppPayload;
  onEvent?: (summary: string) => void;
}) {
  const href = normalizeAssistantAppHref(app);
  // A canvas-marked app mounts in the room's App Studio (CrewCycleAppCanvas),
  // which binds crewRoom and hosts surface requests — a transcript iframe has
  // none of that, so the card stays compact and opens the studio in place.
  const mountsInStudio = app.studioSurface === 'cycle_canvas';
  const canEmbed = app.mode === 'embed' && href && !mountsInStudio;

  useEffect(() => {
    if (!canEmbed || typeof window === 'undefined' || !onEvent) return;

    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data;
      if (!data || typeof data !== 'object') return;

      if (data.source === 'workbench' && data.version === 1) {
        if (data.type === 'saved') {
          const summary = data.payload?.summary || 'User saved changes';
          onEvent(`[APP_EVENT] Saved in "${app.title}": ${summary}`);
        } else if (data.type === 'trigger-cycle') {
          const cycle = data.payload?.cycleSlug || 'default';
          onEvent(`[APP_EVENT] Triggered cycle "${cycle}" from "${app.title}"`);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [canEmbed, app.title, onEvent]);

  const open = () => {
    if (mountsInStudio) {
      window.dispatchEvent(new CustomEvent('crew-cycle-app:open', { detail: app }));
      return;
    }
    if (!href) return;
    const absolute = href.startsWith('http') ? href : `${window.location.origin}${href}`;
    window.open(absolute, '_blank', 'noopener,noreferrer');
  };

  const tags = [app.blueprint, app.cycleName, app.sourceAppName].filter(Boolean) as string[];

  if (canEmbed) {
    return <TokenizedAppSurface app={app} href={href} onOpenExternal={open} />;
  }

  return (
    <CrewCard testId="turn-app-launch">
      <CrewCardHeader
        icon={<LayoutTemplate />}
        title={<span className="block truncate">{app.title}</span>}
        description={app.description || (app.source === 'blueprint' ? 'From a blueprint' : undefined)}
        className="border-b-0"
      />
      {tags.length > 0 && (
        <div className="-mt-1 flex flex-wrap gap-1.5 pb-3 pl-[3.75rem] pr-4">
          {tags.map((tag) => (
            <span key={tag} className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}
      <CrewCardFooter
        note={
          <span className="block truncate font-mono text-[11px]" title={href ?? undefined}>
            {href ?? 'This app has no address to open yet.'}
          </span>
        }
      >
        <Button size="sm" onClick={open} disabled={!href && !mountsInStudio} data-testid="app-launch-open">
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
          {mountsInStudio ? 'Open in App Studio' : (app.actionLabel || 'Open app')}
        </Button>
      </CrewCardFooter>
    </CrewCard>
  );
}

export default AppLaunchCard;
