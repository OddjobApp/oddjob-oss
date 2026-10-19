import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface Status {
  configured: boolean;
  connection: { status: string; accountEmail?: string | null; workspaceName?: string | null; lastSyncAt?: string | null; sync?: { enabled?: boolean; projectId?: number | null; includeTranscripts?: boolean; lookbackDays?: number } } | null;
}

export function GranolaConnectionCard() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [projectId, setProjectId] = useState('');
  const status = useQuery<Status>({ queryKey: ['/api/me/connections/granola/oauth/status'], queryFn: async () => (await apiRequest('GET', '/api/me/connections/granola/oauth/status')).json(), staleTime: 30_000 });
  const connected = status.data?.connection?.status === 'connected';
  const sync = status.data?.connection?.sync ?? {};
  async function action(name: 'test' | 'disconnect' | 'sync') {
    setBusy(true); setMessage('');
    try {
      const result = await (await apiRequest('POST', `/api/me/connections/granola/${name}`, {})).json();
      setMessage(name === 'disconnect' ? 'Granola disconnected.' : name === 'sync' ? `Synced ${result.inserted + result.updated} meetings.` : 'Granola connection verified.');
      await status.refetch();
      await queryClient.invalidateQueries({ queryKey: ['/api/me/connections'] });
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Granola request failed.'); }
    finally { setBusy(false); }
  }
  async function updateSync(enabled: boolean, includeTranscripts = sync.includeTranscripts === true) {
    if (enabled && !Number.isInteger(Number(projectId || sync.projectId))) { setMessage('Enter a project ID before enabling shared knowledge sync.'); return; }
    setBusy(true); setMessage('');
    try {
      const selectedProject = Number(projectId || sync.projectId);
      await apiRequest('PATCH', `/api/me/connections/granola${enabled ? `?projectId=${selectedProject}` : ''}`, { sync: { enabled, includeTranscripts, lookbackDays: sync.lookbackDays ?? 90 } });
      setMessage(enabled ? 'Granola knowledge sync enabled for the selected project.' : 'Granola knowledge sync disabled.');
      await status.refetch();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update Granola sync.'); }
    finally { setBusy(false); }
  }
  const returnTo = `${window.location.pathname}${window.location.search}`;
  return <section aria-label="Connect Granola" className="space-y-3 rounded-lg border border-border bg-card p-4">
    <h2 className="font-semibold">Granola</h2>
    <p className="text-sm text-muted-foreground">Connect your personal Granola account so CREW can search meetings you can access in your active workspace.</p>
    {connected && <p className="text-sm">Connected as {status.data?.connection?.accountEmail || 'Granola user'}{status.data?.connection?.workspaceName ? ` · ${status.data.connection.workspaceName}` : ''}.</p>}
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline"><a href={`/api/me/connections/granola/oauth/initiate?returnTo=${encodeURIComponent(returnTo)}`}>{connected ? 'Reconnect Granola' : 'Connect Granola'}</a></Button>
      {connected && <Button variant="outline" disabled={busy} onClick={() => void action('test')}>Test connection</Button>}
      {connected && <Button variant="ghost" disabled={busy} onClick={() => void action('disconnect')}>Disconnect</Button>}
    </div>
    {connected && <div className="space-y-3 border-t border-border pt-3">
      <p className="text-xs text-muted-foreground">Optional sync copies meeting notes into a project’s shared knowledge base. Everyone with access to that project may find them.</p>
      <div className="flex max-w-md items-center gap-2"><Label htmlFor="granola-project">Project ID</Label><Input id="granola-project" value={projectId || String(sync.projectId ?? '')} onChange={event => setProjectId(event.target.value)} inputMode="numeric" /></div>
      <div className="flex items-center gap-2"><Switch id="granola-sync" checked={sync.enabled === true} disabled={busy} onCheckedChange={checked => void updateSync(checked)} /><Label htmlFor="granola-sync">Sync notes to project knowledge</Label></div>
      <div className="flex items-center gap-2"><Switch id="granola-transcripts" checked={sync.includeTranscripts === true} disabled={busy || !sync.enabled} onCheckedChange={checked => void updateSync(true, checked)} /><Label htmlFor="granola-transcripts">Include full transcripts</Label></div>
      {sync.enabled && <Button variant="outline" disabled={busy} onClick={() => void action('sync')}>Sync now</Button>}
    </div>}
    {status.isError && <p role="alert" className="text-sm">Could not check Granola status. <Button variant="ghost" size="sm" onClick={() => void status.refetch()}>Retry</Button></p>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
