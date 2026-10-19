import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { apiRequest, resolveActiveOrgId } from '@/lib/queryClient';
import { useOrgContextOptional } from '@domain-ui/core/ui/hooks/use-org-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ReauthorizationItem, ReauthorizationReason } from '@shared/oauth-reauthorization';

const REASON_TEXT: Record<ReauthorizationReason, string> = {
  refresh_rejected: 'The provider rejected the saved authorization.',
  no_refresh_token: 'The saved authorization can no longer be renewed.',
  credentials_missing: 'Saved credentials are missing.',
};

function scopeNote(item: ReauthorizationItem): string {
  if (item.kind === 'user') return 'Your account';
  return item.projectId != null ? 'Project space' : 'Organization';
}

/**
 * Surfaces connections whose OAuth grant expired and cannot be renewed, with a
 * link back through the provider's consent flow. Renders nothing when no
 * connection needs attention. `returnTo` is stamped at click time so the OAuth
 * callback lands the person back where they were.
 */
export function ReauthorizeConnectionsCard({
  projectId,
  projectKey,
  variant = 'card',
}: {
  projectId?: number | null;
  projectKey?: string;
  variant?: 'card' | 'banner';
}) {
  const orgId = useOrgContextOptional()?.selectedOrgId ?? resolveActiveOrgId();
  const scopeParam: Record<string, string> | null = projectId != null ? { projectId: String(projectId) } : projectKey ? { projectKey } : null;
  const query = useQuery<{ items: ReauthorizationItem[] }>({
    queryKey: ['/api/me/connections/reauthorizations', orgId, projectId ?? projectKey ?? null],
    queryFn: async () => {
      const params = new URLSearchParams(scopeParam ?? {});
      const url = `/api/me/connections/reauthorizations${params.size ? `?${params}` : ''}`;
      return (await apiRequest('GET', url)).json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const items = query.data?.items ?? [];
  if (query.isLoading || query.isError || items.length === 0) return null;

  const returnTo = encodeURIComponent(`${window.location.pathname}${window.location.search}`);

  return (
    <section
      aria-label="Reauthorize connections"
      data-testid="reauthorize-connections-card"
      className={cn(
        'text-xs text-amber-700 dark:text-amber-300',
        variant === 'banner'
          ? 'border-b border-amber-500/40 bg-amber-500/10 px-4 py-2'
          : 'rounded-lg border border-amber-500/40 bg-card p-4',
      )}
    >
      <div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-200">
        <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        Authorization expired
      </div>
      <ul className={cn('divide-y divide-amber-500/20', variant === 'banner' ? 'mt-1' : 'mt-2')}>
        {items.map(item => (
          <li
            key={`${item.kind}-${item.connectorId}`}
            className="flex flex-wrap items-center justify-between gap-2 py-2"
            data-testid={`reauthorize-${item.platform}`}
          >
            <div className="min-w-0">
              <span className="font-medium text-foreground">{item.label}</span>
              <span className="text-muted-foreground"> · {scopeNote(item)}</span>
              <p className="text-muted-foreground">
                {(item.reason && REASON_TEXT[item.reason]) || 'Authorization expired.'}
              </p>
            </div>
            {item.canReauthorize ? (
              <Button asChild size="sm" variant="outline" className="border-amber-500/40 bg-amber-500/20 text-amber-800 dark:text-amber-200 hover:bg-amber-500/30">
                <a href={`${item.reconnectUrl}&returnTo=${returnTo}`}>
                  {item.opensDashboard ? 'Open connectors' : `Reauthorize ${item.label}`}
                </a>
              </Button>
            ) : (
              <span className="text-muted-foreground">Ask an organization admin to reauthorize {item.label}.</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
