import React from 'react';
import { AlertTriangle, ClipboardList, ListChecks } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyHint, PanelCard } from './CrewPanelCard';
import type { SupervisorNote } from './AgentChatSupervisorPanel';

interface BlackboardRecord { id: number; status: string; }
interface BlackboardDecision extends BlackboardRecord { statement: string; confidence?: number | null; }
interface BlackboardClaim extends BlackboardRecord { claim: string; confidence?: number | null; agreementLevel?: number | null; evidence?: Array<unknown>; }
interface BlackboardCommitment extends BlackboardRecord { title: string; ownerId?: string | null; }
interface BlackboardIssue { id: number; title: string; severity: 'low' | 'medium' | 'high'; consensusLevel?: number | null; }
interface BlackboardPlan { id: number; title: string; steps: Array<{ order: number; description: string; owner?: string | null }>; }
interface BlackboardTurn { id: number; speakerName: string; round: number; latencyMs?: number | null; }

export interface AgentChatBlackboardProps {
  session?: { mode?: string | null; consensusLevel?: number | null } | null;
  decisions?: BlackboardDecision[];
  claims?: BlackboardClaim[];
  commitments?: BlackboardCommitment[];
  issues?: BlackboardIssue[];
  notes?: SupervisorNote[];
  plans?: BlackboardPlan[];
  agentTurns?: BlackboardTurn[];
  recordKind: 'decision' | 'claim' | 'commitment';
  setRecordKind: (kind: 'decision' | 'claim' | 'commitment') => void;
  recordText: string;
  setRecordText: (text: string) => void;
  recordSaving?: boolean;
  roomOpen?: boolean;
  onCreateRecord: () => void;
  onUpdateRecord?: (type: 'decisions' | 'claims' | 'commitments', id: number, status: string) => void;
  onChangeRoomMode?: (mode: string) => void;
}

export function AgentChatBlackboard({
  session,
  decisions = [],
  claims = [],
  commitments = [],
  issues = [],
  notes = [],
  plans = [],
  agentTurns = [],
  recordKind,
  setRecordKind,
  recordText,
  setRecordText,
  recordSaving = false,
  roomOpen = true,
  onCreateRecord,
  onUpdateRecord,
  onChangeRoomMode,
}: AgentChatBlackboardProps) {
  const notesOfType = (type: SupervisorNote['noteType']) => notes.filter((note) => note.noteType === type);
  const latestSummary = notesOfType('summary').slice(-1)[0]?.content;

  return (
    <div className="flex flex-col gap-3 p-2" data-testid="crew-blackboard">
      <div className="flex items-center gap-2 px-1 pt-1">
        <ClipboardList className="h-4 w-4 text-indigo-400" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">Blackboard</h3>
        {onChangeRoomMode && (
          <select value={session?.mode ?? 'explore'} onChange={(event) => onChangeRoomMode(event.target.value)} disabled={!roomOpen} className="ml-auto h-7 rounded-md border border-border bg-background px-2 text-[10px] uppercase text-foreground" aria-label="CREW room mode" data-testid="crew-room-mode">
            {['explore', 'decide', 'build', 'investigate', 'operate', 'review'].map((mode) => <option key={mode} value={mode}>{mode}</option>)}
          </select>
        )}
      </div>
      <div className="rounded-lg border border-border/60 bg-background/50 p-2" data-testid="blackboard-record-composer">
        <div className="flex gap-1.5">
          <select aria-label="Blackboard record kind" value={recordKind} onChange={(event) => setRecordKind(event.target.value as typeof recordKind)} disabled={!roomOpen} className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground">
            <option value="decision">Decision</option><option value="claim">Claim</option><option value="commitment">Commitment</option>
          </select>
          <input aria-label={`Record a ${recordKind}`} value={recordText} onChange={(event) => setRecordText(event.target.value)} onKeyDown={(event) => { if (roomOpen && event.key === 'Enter') onCreateRecord(); }} disabled={!roomOpen} placeholder={`Record a ${recordKind}`} className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground" data-testid="blackboard-record-text" />
          <Button size="sm" className="h-8 px-2" disabled={!roomOpen || !recordText.trim() || recordSaving} onClick={onCreateRecord} data-testid="blackboard-record-submit">{recordSaving ? 'Saving' : 'Add'}</Button>
        </div>
        {!roomOpen && <div className="mt-1.5" data-testid="blackboard-room-closed-hint"><EmptyHint>Send a message to open the room, then record decisions, claims and commitments here.</EmptyHint></div>}
      </div>
      <PanelCard title="Consensus" icon={<ListChecks className="h-3 w-3 text-emerald-500" />} testId="blackboard-consensus">
        {session?.consensusLevel != null ? <div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${session.consensusLevel}%` }} /></div><span className="text-xs font-medium tabular-nums">{session.consensusLevel}%</span></div> : <EmptyHint>Consensus has not been measured yet.</EmptyHint>}
      </PanelCard>
      {decisions.length > 0 && <PanelCard title="Decisions" testId="blackboard-decisions"><ul className="flex flex-col gap-2">{decisions.slice(0, 4).map((decision) => <li key={decision.id} className="border-l-2 border-violet-500/50 pl-2"><div className="flex items-center gap-1.5"><Badge variant="outline" className="h-4 px-1 text-[9px]">{decision.status}</Badge>{decision.confidence != null && <span className="text-[9px] text-muted-foreground">{decision.confidence}%</span>}</div><p className="mt-1 text-xs text-foreground/85">{decision.statement}</p>{decision.status === 'proposed' && onUpdateRecord && <div className="mt-1 flex gap-2"><button className="text-[9px] text-emerald-500" onClick={() => onUpdateRecord('decisions', decision.id, 'accepted')}>Accept</button><button className="text-[9px] text-rose-500" onClick={() => onUpdateRecord('decisions', decision.id, 'rejected')}>Reject</button></div>}</li>)}</ul></PanelCard>}
      {claims.length > 0 && <PanelCard title="Evidence & claims" testId="blackboard-claims"><p className="mb-2 text-xs text-muted-foreground">Tool evidence can confirm a proposal was saved. Check its action card for the external outcome.</p><ul className="flex flex-col gap-2">{claims.slice(0, 4).map((claim) => <li key={claim.id} className="text-xs text-foreground/85"><Badge variant="outline" className="mr-1.5 h-4 px-1 text-[9px]">{claim.status}</Badge>{claim.claim}<div className="mt-0.5 text-[9px] text-muted-foreground">{claim.evidence?.length ?? 0} evidence item(s){claim.confidence != null ? ` · ${claim.confidence}% confidence` : ''}{claim.agreementLevel != null ? ` · ${claim.agreementLevel}% agreement` : ''}</div>{claim.status === 'unverified' && onUpdateRecord && <div className="mt-1 flex gap-2"><button className="text-[9px] text-emerald-500" onClick={() => onUpdateRecord('claims', claim.id, 'supported')}>Support</button><button className="text-[9px] text-amber-500" onClick={() => onUpdateRecord('claims', claim.id, 'disputed')}>Dispute</button></div>}</li>)}</ul></PanelCard>}
      {commitments.length > 0 && <PanelCard title="Commitments" testId="blackboard-commitments"><ul className="flex flex-col gap-2">{commitments.slice(0, 5).map((commitment) => <li key={commitment.id} className="flex items-start gap-2 text-xs text-foreground/85"><span className="min-w-0 flex-1"><strong>{commitment.title}</strong><span className="block text-[9px] text-muted-foreground">{commitment.status}{commitment.ownerId ? ` · ${commitment.ownerId}` : ''}</span></span>{commitment.status !== 'completed' && onUpdateRecord && <button className="text-[9px] text-emerald-500" onClick={() => onUpdateRecord('commitments', commitment.id, 'completed')}>Complete</button>}</li>)}</ul></PanelCard>}
      {issues.length > 0 && <PanelCard title="Issues raised" icon={<AlertTriangle className="h-3 w-3 text-rose-500" />} className="border-rose-500/30 bg-rose-500/5" testId="blackboard-issues"><ul className="flex flex-col gap-2">{issues.slice(0, 3).map((issue) => <li key={issue.id}><Badge variant={issue.severity === 'high' ? 'destructive' : 'warning'} className="h-4 px-1.5 text-[9px] uppercase">{issue.severity}</Badge><p className="mt-1 text-xs text-foreground/85">{issue.title}</p></li>)}</ul></PanelCard>}
      <PanelCard title="Summary" testId="supervisor-summary">{latestSummary ? <p className="text-xs leading-relaxed text-foreground/85">{latestSummary}</p> : <EmptyHint>Nothing summarised yet.</EmptyHint>}</PanelCard>
      <PanelCard title="Notes" testId="blackboard-notes">{notesOfType('note').length > 0 ? <ul className="flex flex-col gap-1.5">{notesOfType('note').slice(-6).map((note) => <li key={note.id} className="border-l-2 border-border pl-2 text-xs text-foreground/85">{note.content}</li>)}</ul> : <EmptyHint>Notes gather here as the discussion runs.</EmptyHint>}</PanelCard>
      {plans.length > 0 && <PanelCard title="Plan" testId="blackboard-plans">{plans.slice(0, 1).map((plan) => <div key={plan.id}><p className="mb-1.5 text-xs font-medium">{plan.title}</p><ol className="flex flex-col gap-1">{plan.steps.map((step) => <li key={step.order} className="text-xs text-foreground/85"><span className="text-muted-foreground">{step.order}.</span> {step.description}{step.owner && <Badge variant="outline" className="ml-1 h-4 px-1 text-[9px]">{step.owner}</Badge>}</li>)}</ol></div>)}</PanelCard>}
      <PanelCard title="Activity" testId="blackboard-activity">{agentTurns.length > 0 ? <ul className="flex flex-col gap-1.5">{agentTurns.map((turn) => <li key={turn.id} className="flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate text-foreground/85">{turn.speakerName}</span><span className="shrink-0 text-[10px] text-muted-foreground">round {turn.round}{turn.latencyMs != null ? ` · ${(turn.latencyMs / 1000).toFixed(1)}s` : ''}</span></li>)}</ul> : <EmptyHint>Agent activity appears here.</EmptyHint>}</PanelCard>
    </div>
  );
}
