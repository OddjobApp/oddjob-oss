import React, { useState, useEffect } from 'react';
import { InlineApprovalCard } from './InlineApprovalCard';
import { apiRequest } from '@/lib/queryClient';
import { validateSurfaceAnswers, type SurfaceRequest } from '@shared/crew-surface-request';
const LocationPicker = React.lazy(() => import('@domain-ui/core/ui/components/shared/LocationPicker').then(m => ({ default: m.LocationPicker })));
export interface PendingSurfaceRequest { request: SurfaceRequest; appTitle: string; finish: (status: 'submitted' | 'cancelled', data?: Record<string, unknown>) => void; approvalUrl?: string }
export function CrewSurfaceRequestCard({ pending, onDismiss }: { pending: PendingSurfaceRequest; onDismiss?: () => void }) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [approval, setApproval] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    if (pending.request.kind !== 'approval' || !pending.approvalUrl) return;
    let cancelled = false;
    apiRequest('GET', pending.approvalUrl).then(r => r.json()).then(payload => {
      if (cancelled) return;
      setApproval(payload);
      if (['approved', 'rejected'].includes(payload.status)) {
        pending.finish('submitted', { approvalId: pending.request.approvalId, decision: payload.status });
        setDone(true);
      }
    })
      .catch(() => { if (!cancelled) setError('This approval is unavailable under the room and app access rules.'); });
    return () => { cancelled = true; };
  }, [pending]);
  if (pending.request.kind === 'approval') return <section className="mx-4 my-3" aria-label="App approval request">
    <p className="text-xs text-muted-foreground">{pending.appTitle} · Governed approval</p>
    {error && <p role="alert">{error}</p>}
    {done ? <p role="status">Decision returned to app. Check the action outcome for execution status.</p> : approval ? <InlineApprovalCard payload={approval} onArtifactSubmit={async () => {
      try { const response = await apiRequest('GET', pending.approvalUrl!); const stored = await response.json();
        if (!['approved', 'rejected'].includes(stored.status)) throw new Error('Decision not confirmed');
        pending.finish('submitted', { approvalId: pending.request.approvalId, decision: stored.status }); setDone(true);
      } catch { setError('The persisted decision could not be confirmed. Check the approval before retrying.'); }
    }} /> : <p>Loading governed request…</p>}
    {!done ? <button onClick={() => { try { pending.finish('cancelled'); } catch {} setDone(true); }}>Dismiss request</button> : onDismiss ? <button onClick={onDismiss}>Clear</button> : null}
  </section>;
  return <section className="mx-4 my-3 rounded-xl border border-border bg-card p-4" aria-label="App input request">
    <p className="text-xs text-muted-foreground">{pending.appTitle} · Input request</p><h3 className="font-semibold">{pending.request.title}</h3>
    <p className="text-xs text-muted-foreground">Answers return to this app surface. Submitting is not approval to execute an action.</p>
    <form onSubmit={e => { e.preventDefault(); try { const answers = validateSurfaceAnswers(pending.request, data); pending.finish('submitted', answers); setDone(true); } catch (err) { setError((err as Error).message); } }}>
      {pending.request.fields?.map(f => <label key={f.key} className="mt-3 block text-sm">{f.label}{f.required ? ' *' : ''}
        {f.type === 'select' ? <select disabled={done} className="ml-2 rounded border bg-background p-2" value={String(data[f.key] ?? '')} onChange={e => setData(d => ({ ...d, [f.key]: e.target.value }))}><option value="">Choose…</option>{f.options?.map(o => <option key={o}>{o}</option>)}</select>
          : f.type === 'location' ? <React.Suspense fallback={<p className="text-xs text-muted-foreground">Loading map…</p>}><LocationPicker value={data[f.key] as any} onChange={v => setData(d => ({ ...d, [f.key]: v }))} disabled={done} placeholder={f.label} /></React.Suspense>
          : <input disabled={done} className="ml-2 rounded border bg-background p-2" type={f.type === 'checkbox' ? 'checkbox' : f.type === 'number' ? 'number' : 'text'} step="any" onChange={e => setData(d => ({ ...d, [f.key]: f.type === 'checkbox' ? e.target.checked : f.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value }))} />}
      </label>)}
      {error && <p role="alert">{error}</p>}{done ? <div className="mt-2 flex items-center gap-3"><p role="status">Request closed.</p>{onDismiss && <button type="button" onClick={onDismiss}>Clear</button>}</div> : <div className="mt-3 flex gap-3"><button type="submit">Return answers</button><button type="button" onClick={() => { try { pending.finish('cancelled'); } catch {} setDone(true); }}>Cancel</button></div>}
    </form>
  </section>;
}
