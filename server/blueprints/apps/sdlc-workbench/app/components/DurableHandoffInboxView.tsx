"use client";
import React, { useCallback, useEffect, useState } from 'react';
import { handoffs, type DurableStageHandoff, type StageHandoffInput } from '../../lib/platform-client';
import { triggerCycle } from '../../lib/workbench-bridge';

export function DurableHandoffInboxView({ pathname }: { pathname: string }) {
  const [items, setItems] = useState<DurableStageHandoff[]>([]);
  const [pending, setPending] = useState<StageHandoffInput[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [draftStatus, setDraftStatus] = useState('');
  const refresh = useCallback(async () => {
    if (!new URLSearchParams(window.location.search).get('crewRoom')) return;
    setBusy(true);
    let cacheError = '';
    try { setPending(handoffs.pending()); } catch { cacheError = 'Local retry cache is unavailable. Durable server handoffs are still shown below.'; }
    try { const page = await handoffs.list(); setItems(page.items); setNextCursor(page.nextCursor); setError(cacheError); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not read handoffs.'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    const enabled = Boolean(new URLSearchParams(window.location.search).get('crewRoom'));
    setEmbedded(enabled);
    if (!enabled) return;
    void refresh();
    const changed = () => void refresh();
    const prepared = (event: Event) => setDraftStatus(String((event as CustomEvent).detail));
    window.addEventListener('sdlc-handoff-changed', changed);
    window.addEventListener('workbench-request-status', prepared);
    return () => { window.removeEventListener('sdlc-handoff-changed', changed); window.removeEventListener('workbench-request-status', prepared); };
  }, [pathname, refresh]);
  async function act(operation: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await operation(); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Handoff action failed.'); }
    finally { setBusy(false); }
  }
  async function loadOlder() {
    if (!nextCursor) return;
    setBusy(true);
    try { const page = await handoffs.list(nextCursor); setItems(previous => [...previous, ...page.items.filter(item => !previous.some(existing => existing.handoff.id === item.handoff.id))]); setNextCursor(page.nextCursor); setError(''); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not read older handoffs.'); }
    finally { setBusy(false); }
  }
  if (!embedded) return null;
  const target = pathname.split('/').filter(Boolean).at(-1);
  return <details className="m-4 rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200" open={pending.length > 0 || Boolean(error) || undefined}>
    <summary className="cursor-pointer">Stage handoffs · {error ? 'check unavailable' : `${items.filter(item => item.handoff.status === 'offered').length} visible offers`} · {pending.length} unconfirmed</summary>
    <p className="mt-2 text-xs text-slate-400">{items.length} handoffs shown for this room. Refresh to check source readiness.</p>
    <p className="my-2 text-xs text-slate-400">Acknowledgement records destination receipt. It does not approve a release or launch work.</p>
    <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded border border-slate-600 px-2 py-1">{busy ? 'Checking…' : 'Refresh handoffs'}</button>
    {error && <p role="alert" className="mt-2 text-amber-300">{error}</p>}
    {draftStatus && <p role="status" className="mt-2 text-xs">{draftStatus}</p>}
    {!items.length && !error && <p className="mt-2 text-slate-400">No durable handoffs recorded for this room.</p>}
    {pending.map(input => <div className="mt-3 rounded border border-amber-800 p-2" key={`${input.transition}:${input.sourceRecordId}`}>
      <p>Unconfirmed {input.transition.replaceAll('_', ' ')} · source {input.sourceRecordId}</p>
      <button type="button" disabled={busy} className="mt-1 underline" onClick={() => void act(() => handoffs.offer(input))}>Retry handoff only</button>
      <button type="button" disabled={busy} className="ml-3 underline" onClick={() => { handoffs.discardRetry(input); setPending(handoffs.pending()); }}>Discard local retry</button>
    </div>)}
    {items.map(({ handoff, blocker }) => <article key={handoff.id} className="mt-3 rounded border border-slate-700 p-2">
      <p>{handoff.label} · {handoff.status}</p>
      <p className="break-all text-xs text-slate-400">{handoff.binding.repositoryUrl} · {handoff.binding.branch} · cycle #{handoff.binding.cycleId}</p>
      {handoff.input.commitSha && <p className="break-all text-xs">Commit {handoff.input.commitSha}</p>}
      {handoff.status === 'acknowledged' ? <>
        <p className="text-xs">Destination acknowledged at {handoff.receipt?.at}. No execution is implied.</p>
        {target === 'devops-workbench' && handoff.target === target && <button type="button" disabled={busy} className="mt-1 mr-3 underline" onClick={() => void act(async () => {
          const result = await handoffs.reconcileDeployment(handoff.id);
          setDraftStatus(`${result.reconciled ? `Matching run #${result.runId} · ${result.runStatus}. ` : ''}${result.message}`);
        })}>Check deployment attempt</button>}
        {target === handoff.target && <button type="button" className="mt-1 underline" onClick={() => {
          setDraftStatus(triggerCycle('Review acknowledged SDLC handoff', { handoffId: handoff.id }) ? 'Preparing review in CREW…' : 'Open this surface within CREW to prepare its review.');
        }}>Prepare review in CREW</button>}
      </> : <>
        {blocker && <p className="mt-1 text-xs text-amber-300">{blocker}</p>}
        {target === handoff.target ? <button type="button" disabled={busy || Boolean(blocker)} className="mt-1 rounded border border-slate-600 px-2 py-1 disabled:opacity-50" onClick={() => void act(() => handoffs.acknowledge(handoff.id, handoff.target))}>Acknowledge receipt</button>
          : <a className="mt-1 inline-block underline" href={`/${handoff.target}`}>Open destination workbench</a>}
      </>}
    </article>)}
    {nextCursor && <button type="button" disabled={busy} className="mt-3 underline" onClick={() => void loadOlder()}>Load older handoffs</button>}
  </details>;
}
