import React, { useState } from 'react';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { crewDevelopmentBindingSchema } from '@shared/crew-development-binding';

type Options = { cycles: Array<{ id: number; name: string; status: string }>; projectId: number | null; current: { cycleId?: number | null; repositoryUrl?: string; branch?: string; testEnvironment?: string } };
export function CrewDevelopmentSetup({ roomKey, organizationId, onSaved }: { roomKey: string; organizationId: number; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);
  const [repositories, setRepositories] = useState<string[]>([]);
  const [cycleId, setCycleId] = useState('');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [testEnvironment, setTestEnvironment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endpoint = `/api/crew/${encodeURIComponent(roomKey)}/development-binding?orgId=${organizationId}`;
  async function browse() {
    setOpen(true); setBusy(true); setError(''); setOptions(null); setRepositories([]);
    try {
      const response = await apiRequest('GET', endpoint);
      const data: Options = await response.json();
      setOptions(data); setCycleId(data.current.cycleId ? String(data.current.cycleId) : '');
      setRepositoryUrl(data.current.repositoryUrl ?? ''); setBranch(data.current.branch ?? ''); setTestEnvironment(data.current.testEnvironment ?? '');
      if (data.projectId != null) {
        const resources = await apiRequest('GET', `/api/projects/${data.projectId}/integrations?organizationId=${organizationId}`);
        const inventory = await resources.json();
        const values = (inventory.adapters ?? []).filter((adapter: any) => ['github', 'gitlab', 'bitbucket'].includes(String(adapter.platform).toLowerCase()))
          .flatMap((adapter: any) => [adapter.boundResource?.value, ...(adapter.bindings ?? []).map((binding: any) => binding.resourceKey)]);
        setRepositories([...new Set(values.filter((value: unknown): value is string => typeof value === 'string' && /^https?:\/\//.test(value)))] as string[]);
      }
    } catch { setError('Could not load development configuration. The room must exist and you must have access to its Project Space.'); }
    finally { setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError('');
    const parsed = crewDevelopmentBindingSchema.safeParse({ cycleId: Number(cycleId), repositoryUrl, branch, testEnvironment });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the configuration.'); return; }
    setBusy(true);
    try { await apiRequest('PUT', endpoint, parsed.data); setOpen(false); onSaved(); }
    catch { setError('Could not save. Only the room host or an organization manager can configure a cycle in this Project Space.'); }
    finally { setBusy(false); }
  }
  return <>
    <Button size="sm" variant="outline" onClick={() => void browse()}>Configure development</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Development context</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">Browse this room’s Project Space and record the target for SDLC work. Saving does not launch agents or grant repository access.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {busy && !options && <p role="status">Loading configuration…</p>}
      {options && <form onSubmit={save} className="space-y-3">
        <label className="block text-sm">Development cycle<select className="mt-1 w-full rounded border border-border bg-background p-2" required value={cycleId} onChange={e => setCycleId(e.target.value)}><option value="">Select a cycle</option>{options.cycles.map(cycle => <option key={cycle.id} value={cycle.id}>{cycle.name} · {cycle.status} · #{cycle.id}</option>)}</select></label>
        {options.cycles.length === 0 && <p className="text-sm">No cycles are recorded in this Project Space. <a className="underline" href={`/operations?orgId=${organizationId}`}>Browse operations</a></p>}
        <label className="block text-sm">Repository URL<input className="mt-1 w-full rounded border border-border bg-background p-2" list="crew-recorded-repositories" type="url" required value={repositoryUrl} onChange={e => setRepositoryUrl(e.target.value)} placeholder="https://github.com/owner/repository" /></label>
        <datalist id="crew-recorded-repositories">{repositories.map(url => <option key={url} value={url} />)}</datalist>
        <p className="text-xs text-muted-foreground">{repositories.length} repository URLs recorded in project connections. You can also enter a URL. Credentials and repository access remain unverified. <a className="underline" href={`/connections?orgId=${organizationId}`}>Browse connections</a></p>
        <label className="block text-sm">Working branch<input className="mt-1 w-full rounded border border-border bg-background p-2" required value={branch} onChange={e => setBranch(e.target.value)} /></label>
        <label className="block text-sm">Test environment<input className="mt-1 w-full rounded border border-border bg-background p-2" required value={testEnvironment} onChange={e => setTestEnvironment(e.target.value)} placeholder="Named staging environment or isolated local fixture" /></label>
        <Button type="submit" disabled={busy || !options.cycles.length}>{busy ? 'Saving…' : 'Save configuration'}</Button>
      </form>}
    </DialogContent></Dialog>
  </>;
}
