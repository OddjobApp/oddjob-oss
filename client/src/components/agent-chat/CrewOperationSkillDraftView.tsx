import { useState } from 'react';
import { Download, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { operationSkillMarkdown, type CrewOperationSkillDraft } from '@shared/crew-operation-skill';
import { CrewOperationSkillReview } from './CrewOperationSkillReview';
import { CrewCard, CrewCardBody, CrewCardFooter, CrewCardHeader, CrewCardStatus } from './CrewCard';

function download(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function CrewOperationSkillDraftView({ draft, reviewScope }: { draft: CrewOperationSkillDraft; reviewScope?: { roomKey: string; organizationId: number } }) {
  return <CrewCard label="Operation skill draft">
    <CrewCardHeader icon={<Wand2 />} title={draft.name} description="Review and test with different inputs before enabling reuse. This export does not register or activate a skill." aside={<CrewCardStatus>Draft</CrewCardStatus>} />
    <CrewCardBody>
      <details className="group">
        <summary className="cursor-pointer rounded-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Review workflow</summary>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">{operationSkillMarkdown(draft)}</pre>
      </details>
      {reviewScope && <CrewOperationSkillReview key={`${reviewScope.organizationId}:${reviewScope.roomKey}:${draft.evidenceHash}`} draft={draft} {...reviewScope} />}
    </CrewCardBody>
    <CrewCardFooter>
      <Button size="sm" variant="outline" onClick={() => download('SKILL.md', operationSkillMarkdown(draft), 'text/markdown')}><Download className="mr-1 h-3.5 w-3.5" aria-hidden />Download SKILL.md</Button>
      <Button size="sm" variant="ghost" onClick={() => download('skill-draft.json', JSON.stringify(draft, null, 2), 'application/json')}>Download contract</Button>
    </CrewCardFooter>
  </CrewCard>;
}
export function ExportCalendarOperationSkill({ proposalId, organizationId, roomKey }: { proposalId: number; organizationId: number; roomKey: string }) {
  const [draft, setDraft] = useState<CrewOperationSkillDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return <div className="mt-3">
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={async () => {
      setBusy(true); setError(false);
      try { const response = await apiRequest('POST', `/api/crew/${encodeURIComponent(roomKey)}/operation-skill-drafts?orgId=${organizationId}`, { proposalId }); setDraft(await response.json()); }
      catch { setError(true); } finally { setBusy(false); }
    }}>{busy ? 'Preparing draft…' : 'Export as skill draft'}</Button>
    {error && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">Could not export this operation. A verified email-to-calendar execution in this room is required.</p>}
    {draft && <CrewOperationSkillDraftView draft={draft} reviewScope={{ roomKey, organizationId }} />}
  </div>;
}
