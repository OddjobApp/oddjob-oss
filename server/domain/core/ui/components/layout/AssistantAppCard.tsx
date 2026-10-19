import React, { useEffect } from 'react';
import { ExternalLink, LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { normalizeAssistantAppHref } from '@/lib/assistant-app-href';
import type { AssistantAppResponse } from './copilot-chat-types';

/** Routes the copilot considers same-app navigation (navigate in-place, close sheet). */
export function isInternalAppRoute(href: string): boolean {
  if (!href || /^https?:\/\//i.test(href)) return false;
  return (
    href.startsWith('/app/') ||
    href.startsWith('/a/') ||
    href.startsWith('/pipeline/') ||
    href.startsWith('/operations/') ||
    href.startsWith('/armory/') ||
    href.startsWith('/missions') ||
    href.startsWith('/jobs') ||
    href.startsWith('/knowledge') ||
    href.startsWith('/settings')
  );
}

export interface AssistantAppCardProps {
  app: AssistantAppResponse;
  onNavigate?: (href: string) => void;
  onEvent?: (summary: string, data?: any) => void;
}

export function AssistantAppCard({
  app,
  onNavigate,
  onEvent,
}: AssistantAppCardProps) {
  // Build the href: explicit href wins; otherwise derive from slug using the correct
  // prefix for the app type — agent_ai lives at /a/:slug, App Forge at /app/:slug.
  const href = normalizeAssistantAppHref(app);
  const canEmbed = app.mode === 'embed' && href;
  const isInternal = !!href && isInternalAppRoute(href);

  useEffect(() => {
    if (!canEmbed || typeof window === 'undefined' || !onEvent) return;

    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data;
      if (!data || typeof data !== 'object') return;

      if (data.source === 'workbench' && data.version === 1) {
        if (data.type === 'saved') {
          const summary = data.payload?.summary || 'User saved changes';
          onEvent(`[APP_EVENT] Saved in "${app.title}": ${summary}`, data.payload);
        } else if (data.type === 'trigger-cycle') {
          const cycle = data.payload?.cycleSlug || 'default';
          onEvent(`[APP_EVENT] Triggered cycle "${cycle}" from "${app.title}"`, data.payload);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [canEmbed, app.title, onEvent]);

  const handleOpen = () => {
    if (!href) return;
    if (isInternal && onNavigate) {
      // Navigate in-place and close the copilot sheet so the app becomes the focus.
      console.debug('[AssistantAppCard] Navigating in-place:', href, 'source:', app.source);
      onNavigate(href);
    } else {
      // External URL or no navigate callback — open in a new tab.
      const absolute = href.startsWith('http') ? href : `${window.location.origin}${href}`;
      console.debug('[AssistantAppCard] Opening in new tab:', absolute, 'source:', app.source);
      window.open(absolute, '_blank', 'noopener,noreferrer');
    }
  };

  const handleOpenNewTab = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!href) return;
    const absolute = href.startsWith('http') ? href : `${window.location.origin}${href}`;
    window.open(absolute, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-indigo-400/25 bg-card/80 shadow-xl">
      <div className="flex items-start gap-3 border-b border-foreground/10 bg-indigo-500/10 p-4">
        <div className="rounded-xl border border-indigo-400/20 bg-indigo-400/10 p-2 text-indigo-700 dark:text-indigo-200">
          <LayoutTemplate className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-700 dark:text-indigo-300">Published app</p>
          <h3 className="mt-1 truncate text-sm font-bold text-foreground">{app.title}</h3>
          {app.description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{app.description}</p>}
          {(app.blueprint || app.cycleName || app.routePath || app.sourceAppName) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {app.blueprint && <span className="rounded-full border border-foreground/10 bg-foreground/5 px-2 py-1 text-[10px] font-semibold text-foreground">{app.blueprint}</span>}
              {app.cycleName && <span className="rounded-full border border-foreground/10 bg-foreground/5 px-2 py-1 text-[10px] font-semibold text-foreground">{app.cycleName}</span>}
              {app.routePath && <span className="rounded-full border border-foreground/10 bg-foreground/5 px-2 py-1 text-[10px] font-semibold text-foreground">/{app.routePath}</span>}
              {app.sourceAppName && <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-1 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">{app.sourceAppName}</span>}
            </div>
          )}
        </div>
      </div>
      {canEmbed && (
        <iframe
          title={app.title}
          src={href}
          className="h-80 w-full border-0 bg-background"
          sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
        />
      )}
      <div className="flex items-center justify-between gap-2 p-3">
        {/* Dev-only: show the resolved href so navigation issues are instantly visible */}
        {import.meta.env.DEV && href && (
          <span className="truncate font-mono text-[10px] text-muted-foreground" title={href}>{href}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* Secondary: always allow opening in a new tab for power users */}
          {isInternal && href && (
            <button
              onClick={handleOpenNewTab}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-foreground/5 rounded-md transition-colors"
              title="Open in new tab"
              aria-label="Open in new tab"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
          <Button
            size="sm"
            className="bg-indigo-600 text-foreground hover:bg-indigo-500"
            onClick={handleOpen}
            disabled={!href}
          >
            {app.actionLabel || 'Open app'}
            {!isInternal && <ExternalLink className="ml-2 h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
