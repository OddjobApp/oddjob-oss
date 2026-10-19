import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { CrewReadinessReport } from '@shared/crew-readiness';
import { surfaceAdapters, type CrewAppSurface } from '@shared/crew-surface-connections';

interface AdapterBinding { platform: string; boundResource?: { kind: string; value: string } | null; bindings?: Array<{ resourceName?: string | null; resourceKey: string }> }
export function CrewSurfaceConnections({ surface, roomKey, organizationId }: { surface: CrewAppSurface; roomKey: string; organizationId: number }) {
  const dependencies = surfaceAdapters(surface);
  const query = useQuery({
    queryKey: ['crew-surface-connections', organizationId, roomKey, surface.path], retry: false, throwOnError: false,
    queryFn: async () => {
      try {
      const response = await apiRequest('GET', `/api/crew/${encodeURIComponent(roomKey)}/readiness?orgId=${organizationId}&studio=app`);
      if (!response.ok) throw new Error('Could not check connections for this room.');
      const report: CrewReadinessReport = await response.json();
      if (report.organizationId !== organizationId || report.sessionKey !== roomKey) throw new Error('Connection report does not match this room.');
      let bindings: AdapterBinding[] = [];
      if (report.projectId != null) {
        const resources = await apiRequest('GET', `/api/projects/${report.projectId}/integrations?organizationId=${organizationId}`);
        if (!resources.ok) throw new Error('Could not verify project connection bindings.');
        const payload = await resources.json();
        bindings = payload.adapters ?? [];
      }
      return { report, bindings, error: false };
      } catch { return { report: null, bindings: [] as AdapterBinding[], error: true }; }
    },
  });
  const inventoryFailed = query.data?.report?.checks.some((check) => check.label === 'Integration inventory' && check.state === 'blocked');
  return <section aria-label="Surface connections" className="m-2 space-y-2 rounded-xl border border-border p-3 text-xs">
    <div className="flex items-center justify-between gap-2"><strong>Connections</strong><button type="button" className="underline" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? 'Checking…' : 'Refresh'}</button></div>
    <p className="truncate text-muted-foreground" title={surface.path}>{surface.title} · {surface.path.split('?')[0].split('/').at(-1)}</p>
    {dependencies !== null && <div className="rounded border border-border/60 p-2"><strong>Oddjob internal API</strong><p className="text-muted-foreground">Organization {organizationId} · Gateway access and write permissions not checked</p></div>}
    {dependencies === null && <p>No adapter contract declared for this surface.</p>}
    {(query.isError || query.data?.error || inventoryFailed) && <p role="alert" className="text-destructive">Connection checks unavailable. This does not establish that a connection is missing.</p>}
    {dependencies?.map((platform) => {
      const configured = query.data?.report?.integrations.filter((connection) => connection.platform.toLowerCase() === platform) ?? [];
      const targets = query.data?.bindings.filter((binding) => binding.platform.toLowerCase() === platform) ?? [];
      const checked = Boolean(query.data?.report) && !inventoryFailed && !query.isError;
      return <div key={platform} className="rounded border border-border/60 p-2">
        <strong className="capitalize">{platform}</strong>
        <p>{!checked ? 'Not checked' : configured.length === 0 ? 'Missing connection' : 'Configured · credentials and provider health unverified'}</p>
        {configured.map((connection, index) => <p key={index} className="text-muted-foreground">{connection.scope} · Recorded status: {connection.status}</p>)}
        <p className="text-muted-foreground">Destination: {targets.map((target) => target.boundResource?.value ?? target.bindings?.map((binding) => binding.resourceName ?? binding.resourceKey).join(', ')).filter(Boolean).join('; ') || 'Not recorded in project bindings'}</p>
        <p className="text-muted-foreground">Write access: not verified</p>
        <a className="mt-1 inline-block underline" href={`/connections?orgId=${organizationId}`}>{checked && configured.length === 0 ? 'Connect' : 'Manage connection'}</a>
      </div>;
    })}
    {query.data?.report && <p className="text-muted-foreground">Checked {new Date(query.data.report.checkedAt).toLocaleTimeString()}</p>}
  </section>;
}
