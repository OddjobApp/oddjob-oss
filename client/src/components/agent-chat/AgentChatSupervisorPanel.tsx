import React from 'react';
import { ClipboardList, Gavel, Lightbulb, ShieldAlert } from 'lucide-react';
import { EmptyHint, PanelCard } from './CrewPanelCard';

export interface SupervisorNote {
  id: number;
  noteType: 'note' | 'critique' | 'consensus' | 'summary' | 'intent';
  content: string;
  round?: number;
  targetTurnId?: number | null;
  createdAt?: string;
}

export interface AgentChatSupervisorPanelProps {
  session?: { activeTopic?: string | null; nextSteps?: string | null } | null;
  notes?: SupervisorNote[];
  latestRound?: number;
}

export function AgentChatSupervisorPanel({ session, notes = [], latestRound = 0 }: AgentChatSupervisorPanelProps) {
  const latestNoteRound = Math.max(0, ...notes.map(note => note.round ?? 0));
  const stale = latestRound > latestNoteRound;
  const recent = (type: SupervisorNote['noteType'], count: number) =>
    notes.filter((note) => note.noteType === type).slice(-count);

  return (
    <div className="flex flex-col gap-3 p-2" data-testid="crew-supervisor-panel">
      <div className="flex items-center gap-2 px-1 pt-1">
        <Gavel className="h-4 w-4 text-amber-500" />
        <h3 className="text-xs font-semibold text-foreground">Supervisor</h3>
      </div>
      <PanelCard title="Direction" icon={<ClipboardList className="h-3 w-3 text-muted-foreground" />} testId="supervisor-direction">
        {stale && <p className="mb-2 text-xs text-muted-foreground">Saved guidance predates the latest discussion. Check the action card for execution status.</p>}
        {session?.activeTopic || session?.nextSteps ? (
          <dl className="flex flex-col gap-1.5 text-xs leading-relaxed">
            {session.activeTopic && <div><dt className="inline font-medium text-foreground">Active topic: </dt><dd className="inline text-foreground/80">{session.activeTopic}</dd></div>}
            {session.nextSteps && <div><dt className="inline font-medium text-foreground">Next steps: </dt><dd className="inline text-foreground/80">{session.nextSteps}</dd></div>}
          </dl>
        ) : <EmptyHint>The supervisor sets direction once the discussion starts.</EmptyHint>}
      </PanelCard>
      <details open={!stale}><summary className="cursor-pointer text-xs text-muted-foreground">{stale ? 'Earlier supervisor guidance' : 'Supervisor guidance'}</summary>
      <PanelCard title="Critique" icon={<ShieldAlert className="h-3 w-3 text-amber-500" />} className="border-amber-500/30 bg-amber-500/5" testId="supervisor-critique">
        {recent('critique', 2).length > 0 ? (
          <ul className="flex flex-col gap-2">{recent('critique', 2).map((note) => <li key={note.id} className="text-xs leading-relaxed text-foreground/85">{note.content}</li>)}</ul>
        ) : <EmptyHint>No critique yet.</EmptyHint>}
      </PanelCard>
      <PanelCard title="Future topics" icon={<Lightbulb className="h-3 w-3 text-muted-foreground" />} testId="supervisor-future-topics">
        {recent('intent', 4).length > 0 ? (
          <ol className="flex flex-col gap-1.5">{recent('intent', 4).map((note, index) => <li key={note.id} className="flex gap-2 text-xs leading-relaxed text-foreground/85"><span className="shrink-0 font-medium text-muted-foreground">{index + 1}.</span>{note.content}</li>)}</ol>
        ) : <EmptyHint>No further threads identified yet.</EmptyHint>}
      </PanelCard>
      </details>
    </div>
  );
}
