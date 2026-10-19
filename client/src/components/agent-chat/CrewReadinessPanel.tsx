import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { CrewReadinessReport } from '@shared/crew-readiness';

export function CrewReadinessPanel({ roomKey, organizationId, studio }: { roomKey: string; organizationId: number; studio: string | null }) {
  const [open, setOpen] = useState(false);
  const query = useQuery<CrewReadinessReport>({
    queryKey: ['crew-readiness', organizationId, roomKey, studio],
    enabled: open,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await apiRequest('GET', `/api/crew/${encodeURIComponent(roomKey)}/readiness?orgId=${organizationId}&studio=${encodeURIComponent(studio ?? 'none')}`);
      return response.json();
    },
  });
  return <section className="m-2 rounded-xl border border-border p-3 text-xs">
    <button type="button" className="font-semibold" aria-expanded={open} onClick={() => setOpen(!open)}>Capabilities {open ? '▾' : '▸'}</button>
    {open && <div className="mt-3 space-y-3">
      <p className="text-muted-foreground">Available tools and credential preflight for this room. Execution still checks permissions and inputs.</p>
      <button type="button" className="underline" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? 'Checking…' : 'Refresh checks'}</button>
      {query.isError && <p role="alert">Could not check this room. Retry when the connection recovers.</p>}
      {query.data && <>
        <p className="text-muted-foreground">Project: {query.data.projectId ?? 'Organization scope'} · Checked {new Date(query.data.checkedAt).toLocaleTimeString()}</p>
        {query.data.checks.map(check => <div key={check.label}><strong>{check.label}: {check.state === 'passed' ? 'Preflight passed' : check.state === 'blocked' ? 'Blocked' : 'Not checked'}</strong><p className="text-muted-foreground">{check.detail}</p></div>)}
        {query.data.recipes?.map(recipe => <details key={recipe.id}><summary>{recipe.label}</summary><p className="mt-2 text-muted-foreground">{recipe.detail}</p>{recipe.agents.map(agent => <p className="mt-2" key={agent.id}>{query.data.agents.find(card => card.id === agent.id)?.name}: {agent.missingTools.length ? `Missing ${agent.missingTools.join(', ')}` : 'Required tools offered'}</p>)}</details>)}
        {!!query.data.projectBindings?.length && <details><summary>Project resources</summary><ul className="mt-2">{query.data.projectBindings.map(binding => <li key={`${binding.kind}:${binding.key}`}>{binding.name ?? binding.key} · {binding.kind}</li>)}</ul></details>}
        {!!query.data.integrations?.length && <details><summary>Configured integrations</summary><ul className="mt-2 space-y-2">{query.data.integrations.map((integration, index) => <li key={`${integration.platform}:${index}`}><strong>{integration.platform}</strong> · {integration.scope} · {integration.status}<p className="text-muted-foreground">Last sync: {integration.lastSync ? new Date(integration.lastSync).toLocaleString() : 'Never recorded'} · Schema: {integration.schemaCapturedAt ? new Date(integration.schemaCapturedAt).toLocaleString() : 'Not captured'}</p></li>)}</ul></details>}
        {!!query.data.appliedSkills?.length && <details><summary>Applied skill augmentations</summary><ul className="mt-2 space-y-2">{query.data.appliedSkills.map(skill => <li key={skill.augmentationId}>{query.data.agents.find(agent => agent.id === skill.agentId)?.name} · {skill.skillId == null ? 'Manual augmentation' : `Skill #${skill.skillId}`}<p className="text-muted-foreground">{skill.missingTools.length ? `Unavailable tools: ${skill.missingTools.join(', ')}` : 'Added tools offered; execution not verified'}</p></li>)}</ul></details>}
        {query.data.agents.map(agent => <details key={agent.id}>
          <summary>{agent.name} · {agent.tools.length} available tools</summary>
          {agent.unavailableDeclaredTools.length > 0 && <p className="mt-2">Declared but unavailable: {agent.unavailableDeclaredTools.join(', ')}</p>}
          <ul className="mt-2 max-h-48 overflow-y-auto">{agent.tools.map(name => <li key={name}>{name}</li>)}</ul>
        </details>)}
      </>}
    </div>}
  </section>;
}
