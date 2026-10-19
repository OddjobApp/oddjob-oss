import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiRequest } from '@/lib/queryClient';
import type { CrewOperationSkillDraft } from '@shared/crew-operation-skill';

export function CrewOperationSkillReview({ draft, roomKey, organizationId }: { draft: CrewOperationSkillDraft; roomKey: string; organizationId: number }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(draft.name);
  const [inputs, setInputs] = useState(draft.inputs);
  const [agents, setAgents] = useState<Array<{ id: number; name: string }>>([]);
  const [target, setTarget] = useState(draft.registration?.targetAgentId ?? 0);
  const [status, setStatus] = useState<string | null>(null);
  const [validation, setValidation] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/crew/${encodeURIComponent(roomKey)}/operation-skill-drafts/${draft.evidenceHash}`;
  async function load() {
    const response = await apiRequest('GET', `${url}/review?orgId=${organizationId}`);
    const data = await response.json(); setAgents(data.agents); setStatus(data.reviewStatus);
    setName(data.draft.name); setInputs(data.draft.inputs); setTarget(data.draft.registration?.targetAgentId ?? data.agents[0]?.id ?? 0);
  }
  async function act(action: 'validate' | 'submit' | 'approve') {
    setBusy(true); setError(null);
    try {
      const response = await apiRequest('POST', `${url}/${action}?orgId=${organizationId}`, action === 'approve' ? {} : { name, inputs, targetAgentId: target });
      const result = await response.json();
      if (action === 'validate') setValidation(result); else await load();
    } catch { setError('Review action failed. Check access and validation blockers. Registration and approval require organization management permission.'); }
    finally { setBusy(false); }
  }
  const field = 'mt-1 text-xs';
  return <div className="space-y-3 border-t border-border/60 pt-3">
    <Button type="button" size="sm" variant={open ? 'ghost' : 'secondary'} disabled={busy} aria-expanded={open} onClick={async () => { if (open) { setOpen(false); return; } setBusy(true); try { await load(); setOpen(true); } catch { setError('Could not load this scoped skill draft.'); } finally { setBusy(false); } }}>Review and register skill</Button>
    {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
    {open && <div className="space-y-3">
      <p className="text-muted-foreground">Schema checks use mock inputs; no provider writes run. Approval registers a contract for the selected agent. Future calendar writes still require event approval.</p>
      <label className="block font-medium text-foreground">Skill name<Input className={field} value={name} disabled={!!status || busy} maxLength={100} onChange={event => { setName(event.target.value); setValidation(null); }} /></label>
      {Object.entries(inputs).map(([key, value]) => <label key={key} className="block font-medium text-foreground">{key}<Textarea className={field} value={value} disabled={!!status || busy} maxLength={500} onChange={event => { setInputs({ ...inputs, [key]: event.target.value }); setValidation(null); }} /></label>)}
      <label className="block font-medium text-foreground">Target agent<select className="mt-1 block h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={target} disabled={!!status || busy} onChange={event => { setTarget(Number(event.target.value)); setValidation(null); }}>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
      <p className="text-muted-foreground">Tools, approvals and recovery rules remain fixed for this recipe. Status: {status ?? 'Draft'}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy || !target} onClick={() => void act('validate')}>Validate contract and access</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy || !!status || !validation?.readyForReview} onClick={() => void act('submit')}>Submit for governance review</Button>
        <Button type="button" size="sm" disabled={busy || status !== 'pending'} onClick={() => void act('approve')}>Approve reviewed contract</Button>
      </div>
      {validation && <div className="space-y-0.5 rounded-lg border border-border/60 px-3 py-2">
        <p className={validation.readyForReview ? 'font-medium text-emerald-700 dark:text-emerald-300' : 'font-medium text-amber-700 dark:text-amber-300'}>{validation.readyForReview ? 'Ready for governance review' : 'Validation blockers'}</p>
        {validation.missingTools?.length > 0 && <p>Missing tools: {validation.missingTools.join(', ')}</p>}
        {validation.checks.map((check: any) => <p key={check.label}>{check.label}: {check.passed ? 'Passed' : 'Failed'}</p>)}
        {validation.accessChecks.map((check: any) => <p key={check.label}>{check.label}: {check.state} · {check.detail}</p>)}
        {validation.limitations.map((text: string) => <p className="text-muted-foreground" key={text}>{text}</p>)}
      </div>}
    </div>}
  </div>;
}
