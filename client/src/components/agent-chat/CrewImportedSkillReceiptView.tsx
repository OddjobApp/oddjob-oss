import { Puzzle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CrewImportedSkillReceipt } from '@shared/crew-imported-skill-receipt';
import { CrewReceipt } from './CrewCard';

type Status = CrewImportedSkillReceipt['entries'][number]['status'];
const labels: Record<Status, string> = {
  missing_tools: 'Missing tool mappings', reference_only: 'Reference only', not_executed: 'No tool execution recorded',
  tool_failure: 'Tool failure', partial_tool_evidence: 'Partial tool evidence', tool_evidence: 'Required tool evidence recorded',
};
const tones: Partial<Record<Status, string>> = {
  missing_tools: 'text-amber-700 dark:text-amber-300', tool_failure: 'text-red-700 dark:text-red-300',
  partial_tool_evidence: 'text-amber-700 dark:text-amber-300', tool_evidence: 'text-emerald-700 dark:text-emerald-300',
};
export function CrewImportedSkillReceiptView({ receipt }: { receipt: CrewImportedSkillReceipt }) {
  if (receipt.selectionStatus === 'checked' && !receipt.entries.length) return null;
  return <CrewReceipt icon={<Puzzle />} summary={`Imported skills · ${receipt.selectionStatus === 'unavailable' ? 'Selection unavailable' : receipt.entries.length}`}>
    <p className="text-muted-foreground">Reviewed contracts selected for this turn. Tool evidence does not establish completion of the whole workflow; imported code was not executed.</p>
    {receipt.selectionStatus === 'unavailable' && <p className="text-foreground">Selection could not be checked. This does not mean no skills are available.</p>}
    <ul className="divide-y divide-border/60">{receipt.entries.map(entry => <li key={entry.reviewId} className="space-y-0.5 py-1.5 first:pt-0 last:pb-0">
      <p><span className="font-medium text-foreground">{entry.name}</span> · <span className={cn(tones[entry.status] ?? 'text-muted-foreground')}>{labels[entry.status]}</span></p>
      {!!entry.missingTools.length && <p className="text-foreground">Missing: {entry.missingTools.join(', ')}</p>}
      {entry.calls.map((call, index) => <p key={`${call.name}:${index}`} className="text-muted-foreground">{call.name}: {call.ok ? 'Succeeded' : 'Failed'}</p>)}
      <p className="break-all font-mono text-[11px] text-muted-foreground/80" title="Reviewed source">Review #{entry.reviewId} · Contract {entry.contractHash}</p>
    </li>)}</ul>
  </CrewReceipt>;
}
