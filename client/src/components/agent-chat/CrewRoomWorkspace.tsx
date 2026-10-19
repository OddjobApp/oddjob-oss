import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { crewRoomBriefSchema, type CrewRoomBrief } from '@shared/crew-room-brief';
import { collectWorkProducts, type CrewWorkProduct } from '@shared/crew-work-product';
import type { CrewSession, CrewTurn, CrewCommitment, CrewDecision, CrewClaim, CrewIssue } from './AgentChatPanel';

export function roomProgress({ closed, working, blocked, decisions, hasProduct }: { closed: boolean; working: boolean; blocked: boolean; decisions: boolean; hasProduct: boolean }) {
  if (closed) return 'Closed';
  if (working) return 'Working';
  if (blocked) return 'Blocked';
  if (decisions) return 'Awaiting decision';
  return hasProduct ? 'Ready for review' : 'Exploring';
}

export interface CrewRoomWorkspaceProps {
  placement?: 'supervisor' | 'blackboard' | 'all';
  session: CrewSession | null;
  turns: CrewTurn[];
  workProductTurns?: Array<{ id: number; speakerName: string; artifacts?: Array<{ payload?: unknown }> }>;
  commitments: CrewCommitment[];
  decisions: CrewDecision[];
  claims: CrewClaim[];
  issues: CrewIssue[];
  working: boolean;
  onSaveBrief: (brief: CrewRoomBrief) => Promise<void>;
  onSaveProduct: (product: CrewWorkProduct) => Promise<void>;
  onRequest: (message: string) => void;
}

export function CrewRoomWorkspace({ placement = 'all', session, turns, workProductTurns = [], commitments, decisions, claims, issues, working, onSaveBrief, onSaveProduct, onRequest }: CrewRoomWorkspaceProps) {
  const products = useMemo(() => collectWorkProducts([...workProductTurns.filter(item => !turns.some(turn => turn.id === item.id)), ...turns]), [turns, workProductTurns]);
  const [selectedKey, setSelectedKey] = useState('');
  const selected = products.find(product => product.versionKey === selectedKey) ?? products.at(-1);
  const versions = selected ? products.filter(product => product.documentKey === selected.documentKey) : [];
  const versionIndex = selected ? versions.findIndex(product => product.versionKey === selected.versionKey) : -1;
  const previous = versionIndex > 0 ? versions[versionIndex - 1] : undefined;
  const [editingBrief, setEditingBrief] = useState(false);
  const [objective, setObjective] = useState('');
  const [criteria, setCriteria] = useState('');
  const [constraints, setConstraints] = useState('');
  const [editingProduct, setEditingProduct] = useState(false);
  const [draft, setDraft] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const closed = session?.status === 'archived';
  const disabled = !session || closed || saving || working;
  const status = roomProgress({ closed, working, blocked: commitments.some(item => item.status === 'blocked') || issues.some(item => item.severity === 'high' && ['open', 'acknowledged'].includes(item.status)), decisions: decisions.some(item => item.status === 'proposed'), hasProduct: products.length > 0 });
  const nextCommitment = commitments.find(item => ['open', 'in_progress', 'blocked'].includes(item.status));
  const brief = session?.memory?.roomBrief;
  const guidanceBehind = Math.max(0, ...turns.map(turn => turn.round)) > (session?.memory?.updatedRound ?? 0);
  const lines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean);
  const save = async (operation: () => Promise<void>) => {
    setSaving(true); setError('');
    try { await operation(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not save changes.'); } finally { setSaving(false); }
  };
  const fieldClass = 'w-full rounded-md border border-border bg-background p-2 text-sm text-foreground';
  const exportProduct = () => {
    if (!selected) return;
    const url = URL.createObjectURL(new Blob([selected.content], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `${selected.title.replace(/[^a-z0-9-]/gi, '-').slice(0, 80) || 'crew-work-product'}.md`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section id={placement === 'supervisor' ? 'crew-room-direction' : 'crew-workspace'} aria-label={placement === 'supervisor' ? 'Room direction' : 'Room work products and evidence'} className="min-w-0 break-words rounded-xl border border-border bg-card p-3 text-card-foreground">
      {placement !== 'blackboard' && <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Room direction</h2><span role="status" className="rounded-md bg-muted px-2 py-1 text-xs">{status}</span></div>}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      {placement !== 'blackboard' && <>
      <p className="mt-2 text-sm"><strong>Objective:</strong> {brief?.objective || 'Define the outcome this team should achieve.'}</p>
      <p className="mt-1 text-xs text-muted-foreground"><strong>{guidanceBehind ? 'Saved next step:' : 'Next step:'}</strong> {nextCommitment ? `${nextCommitment.title}${nextCommitment.ownerId ? ` · Owner: ${nextCommitment.ownerId}` : ''}` : session?.nextSteps || 'No next step recorded.'}</p>
      {guidanceBehind && <p className="mt-1 text-xs text-muted-foreground">Saved room guidance may predate recent actions. Use the action card for execution status.</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium">Success criteria and scope</summary>
        {brief ? <><ul className="my-2 list-disc space-y-1 pl-5 text-sm">{brief.successCriteria.map((item, index) => <li key={index}>{item}</li>)}</ul>{brief.constraints.length > 0 && <p className="text-xs text-muted-foreground">Constraints: {brief.constraints.join(' · ')}</p>}</> : <p className="my-2 text-xs text-muted-foreground">No success criteria recorded.</p>}
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => { setObjective(brief?.objective ?? ''); setCriteria(brief?.successCriteria.join('\n') ?? ''); setConstraints(brief?.constraints.join('\n') ?? ''); setError(''); setEditingBrief(true); }}>Edit room brief</Button>
      </details>
      {editingBrief && <form className="mt-3 space-y-2" onSubmit={event => {
        event.preventDefault();
        const parsed = crewRoomBriefSchema.safeParse({ objective, successCriteria: lines(criteria), constraints: lines(constraints) });
        if (!parsed.success) { setError('Enter an objective and at least one success criterion. Keep the objective under 2,000 characters and each criterion under 500.'); return; }
        void save(async () => { await onSaveBrief(parsed.data); setEditingBrief(false); });
      }}>
        <label className="block text-xs">Objective<textarea required value={objective} onChange={event => setObjective(event.target.value)} maxLength={2000} className={fieldClass} /></label>
        <label className="block text-xs">Success criteria, one per line<textarea required value={criteria} onChange={event => setCriteria(event.target.value)} className={fieldClass} /></label>
        <label className="block text-xs">Scope constraints, one per line<textarea value={constraints} onChange={event => setConstraints(event.target.value)} className={fieldClass} /></label>
        <div className="flex gap-2"><Button type="submit" size="sm" disabled={disabled}>{saving ? 'Saving…' : 'Save brief'}</Button><Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEditingBrief(false)}>Cancel</Button></div>
      </form>}
      </>}
      {placement !== 'supervisor' && <>
      <details open={placement === 'blackboard'} className="mt-3 border-t border-border pt-3">
        <summary className="cursor-pointer text-sm font-semibold">Work product{selected ? ` · ${selected.title} · Version ${versionIndex + 1}` : ''}</summary>
        {!selected ? <div className="mt-2"><p className="mb-2 text-xs text-muted-foreground">The team's deliverable and its revisions will appear here.</p><Button size="sm" variant="outline" disabled={disabled} onClick={() => onRequest('Create a room work product using publish_work_product from our current brief and available evidence. Identify missing information and unmet success criteria.')}>Create work product</Button></div> : <div className="mt-3 space-y-3">
          <label className="block text-xs">Document and version<select aria-label="Work product version" className={fieldClass} value={selected.versionKey} disabled={editingProduct || saving} onChange={event => setSelectedKey(event.target.value)}>{products.map(product => <option key={product.versionKey} value={product.versionKey}>{product.title} · Turn {product.turnId} · {product.author}</option>)}</select></label>
          <p className="text-xs text-muted-foreground">{selected.changeSummary}{selected.sourceTurnId ? ` · Revised from turn ${selected.sourceTurnId}` : ''}</p>
          <div className="flex flex-wrap items-center gap-2"><CopyButton value={selected.content} label="Copy" tooltipText="Copy work product" /><Button size="sm" variant="outline" onClick={exportProduct}>Export Markdown</Button><Button size="sm" variant="outline" disabled={disabled} onClick={() => { setSelectedKey(selected.versionKey); setDraft(selected.content); setChangeSummary(''); setEditingProduct(true); }}>Edit</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={() => onRequest(`Revise the work product "${selected.title}" (documentKey: ${selected.documentKey}, source turn: ${selected.turnId}) against the room success criteria. Preserve recorded user corrections, cite evidence, and publish a complete updated version with publish_work_product.`)}>Ask CREW to revise</Button></div>
          {editingProduct ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); void save(async () => { await onSaveProduct({ type: 'crew_work_product', documentKey: selected.documentKey, title: selected.title, content: draft, changeSummary, sourceTurnId: selected.turnId }); setEditingProduct(false); setSelectedKey(''); }); }}><label className="block text-xs">Document content<textarea required maxLength={50000} rows={10} value={draft} onChange={event => setDraft(event.target.value)} className={fieldClass} /></label><label className="block text-xs">What changed?<input required maxLength={1000} value={changeSummary} onChange={event => setChangeSummary(event.target.value)} className={fieldClass} /></label><Button size="sm" type="submit" disabled={disabled}>{saving ? 'Saving…' : 'Save new version'}</Button><Button size="sm" type="button" variant="ghost" disabled={saving} onClick={() => setEditingProduct(false)}>Cancel</Button></form> : <div className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.content}</ReactMarkdown></div>}
          {previous && <details><summary className="cursor-pointer text-xs font-medium">Compare with previous version</summary><div className="mt-2 grid gap-3 md:grid-cols-2"><div><h3 className="text-xs font-semibold">Previous · Turn {previous.turnId}</h3><pre className="whitespace-pre-wrap break-words text-xs">{previous.content}</pre></div><div><h3 className="text-xs font-semibold">Selected · Turn {selected.turnId}</h3><pre className="whitespace-pre-wrap break-words text-xs">{selected.content}</pre></div></div></details>}
        </div>}
      </details>
      <details className="mt-3 border-t border-border pt-3"><summary className="cursor-pointer text-xs font-medium">Evidence, decisions and execution</summary>
        <p className="mt-2 text-xs text-muted-foreground">Tool success confirms execution, not independent verification. Claim status and decision status are shown separately.</p>
        <ul className="mt-2 space-y-2 text-xs">{decisions.map(item => <li key={`decision-${item.id}`}><strong>Decision · {item.status}:</strong> {item.statement}</li>)}{commitments.map(item => <li key={`commitment-${item.id}`}><strong>Commitment · {item.status}:</strong> {item.title}{item.ownerId ? ` · ${item.ownerId}` : ''}</li>)}{claims.map(item => <li key={`claim-${item.id}`}><strong>Claim · {item.status}:</strong> {item.claim} · {item.evidence?.length ?? 0} evidence items</li>)}{turns.filter(turn => turn.toolsUsed?.length > 0).slice(-10).map(turn => <li key={`tool-${turn.id}`}><a href={`#turn-${turn.id}`} className="text-primary underline">Turn {turn.id} · {turn.speakerName}</a><ul className="pl-3">{turn.toolsUsed.map((tool, index) => <li key={index}>{tool.name} · {tool.ok ? 'Succeeded' : 'Failed'}{tool.error ? ` · ${tool.error}` : ''}</li>)}</ul></li>)}</ul>
        {decisions.length + commitments.length + claims.length === 0 && !turns.some(turn => turn.toolsUsed?.length) && <p className="mt-2 text-xs text-muted-foreground">No decisions, commitments, claims or tool executions recorded yet.</p>}
      </details>
      </>}
    </section>
  );
}
