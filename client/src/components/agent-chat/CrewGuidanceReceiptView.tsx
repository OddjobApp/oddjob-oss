import { BookOpen } from 'lucide-react';
import type { CrewGuidanceReceipt } from '@shared/crew-guidance-receipt';
import { CrewReceipt } from './CrewCard';

export function CrewGuidanceReceiptView({ receipt }: { receipt: CrewGuidanceReceipt }) {
  return <CrewReceipt icon={<BookOpen />} summary={`Guidance loaded · ${receipt.entries.length} procedures`}>
    <p className="text-muted-foreground">Loaded into this agent’s prompt. This does not establish tool execution or successful completion.</p>
    <ul className="divide-y divide-border/60">{receipt.entries.map(entry => <li key={entry.id} className="py-1.5 first:pt-0 last:pb-0">
      <p className="font-medium text-foreground">{entry.label}</p>
      <p className="text-muted-foreground">{entry.reason}</p>
      <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground/80" title="Version and source hash">v{entry.version} · {entry.contentHash}</p>
    </li>)}</ul>
  </CrewReceipt>;
}
