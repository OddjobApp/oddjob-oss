import type { CrewSessionRecord } from '@shared/schema/crew.js';
import { CREW_READINESS_RECIPES, unavailableDeclaredTools, type CrewReadinessReport } from '@shared/crew-readiness.js';
import { crewRepository } from './crew-repository.js';
import { crewToolsService } from './crew-tools.service.js';
import { resolveCrewStudio } from './crew-studio-tools.js';
import { getGoogleWorkspaceToken, type GoogleAccess } from '@domain/integrations/google-workspace-connector-bridge.js';
import { getQuickBooksClient } from '@domain/integrations/quickbooks/service.js';
import { financeRolesService } from '@domain/projects/core/finance-roles.service.js';
import { projectBindingService } from '@domain/integrations/project-binding.service.js';
import { saasAdapterInventoryService } from '@domain/integrations/saas-adapter-inventory.service.js';
import { SkillAugmentationService } from '@domain/agents/core/skill-augmentation.service.js';

/** Called only after the route's organization and Project Space authorization. */
export async function getCrewReadiness(room: CrewSessionRecord, activeStudio?: string | null, userId?: string, executingAgent?: { id: number; tools: string[] }): Promise<CrewReadinessReport> {
  const members = (await crewRepository.getMembers(room.id))
    .filter(card => card.organizationId === room.organizationId && card.enabled && (!executingAgent || card.id === executingAgent.id));
  if (executingAgent && members.length !== 1) throw new Error('The executing agent is not an enabled member of this room.');
  const turns = await crewRepository.getTranscript(room.id, 200);
  const studio = resolveCrewStudio(activeStudio, turns, room.cycleContext?.studio);
  const agents = await Promise.all(members.map(async card => {
    const tools = executingAgent ? [...executingAgent.tools].sort()
      : (await crewToolsService.resolveForCard(card, studio)).map(tool => tool.definition.name).sort();
    return { id: card.id, name: card.name, tools, unavailableDeclaredTools: unavailableDeclaredTools(card.tools, tools) };
  }));
  const names = new Set(agents.flatMap(agent => agent.tools));
  const checks: CrewReadinessReport['checks'] = [];
  let integrations: CrewReadinessReport['integrations'] = [];
  try {
    integrations = (await saasAdapterInventoryService.listForProject(room.organizationId, room.projectId))
      .map(adapter => ({ platform: adapter.platform, scope: adapter.scope, status: adapter.status, lastSync: adapter.lastSync, schemaCapturedAt: adapter.schemaSnapshot?.capturedAt ?? null }));
    checks.push({ label: 'Integration inventory', state: 'not_checked', detail: `${integrations.length} scoped connections configured. Connection status, last sync and captured schemas do not verify current credentials, write access or provider health.` });
  } catch {
    checks.push({ label: 'Integration inventory', state: 'blocked', detail: 'Could not load scoped connections. Retry after the service recovers; this does not mean there are no integrations.' });
  }
  const appliedSkills: CrewReadinessReport['appliedSkills'] = [];
  for (const agent of agents) {
    try {
      const applied = (await SkillAugmentationService.listAugmentationsForAgent(agent.id, room.organizationId)).filter(record => record.status === 'active');
      for (const record of applied) {
        appliedSkills.push({ agentId: agent.id, augmentationId: record.id, skillId: record.skillId, appliedAt: record.appliedAt?.toISOString() ?? null,
          missingTools: unavailableDeclaredTools(record.toolsAdded ?? [], agent.tools) });
      }
      checks.push({ label: `${agent.name} applied skills`, state: 'not_checked', detail: `${applied.length} active augmentation records. These show capabilities applied to the card, not skill selection or execution in this turn.` });
    } catch {
      checks.push({ label: `${agent.name} applied skills`, state: 'blocked', detail: 'Could not load scoped skill augmentations. Retry after the service recovers.' });
    }
  }
  const requirements: Array<{ label: string; access: GoogleAccess; applicable: boolean }> = [
    { label: 'Gmail reading', access: 'gmail_read', applicable: names.has('gmail_get_message') },
    { label: 'Calendar reading', access: 'calendar_read', applicable: names.has('gcal_get_calendar') },
    { label: 'Calendar editing', access: 'calendar_write', applicable: names.has('gcal_create_event') },
  ];
  // Sequential checks avoid concurrent refreshes of the same OAuth credential.
  for (const requirement of requirements) {
    if (!requirement.applicable) continue;
    try {
      const token = await getGoogleWorkspaceToken(room.organizationId, room.projectId, requirement.access);
      checks.push({ label: requirement.label, state: token ? 'passed' : 'blocked', detail: token
        ? 'Scoped credential preflight passed. Provider operations and approvals are checked when executed.'
        : 'Connect Google with this access in the organization or this Project Space.' });
    } catch {
      // Provider errors can contain credential-bearing URLs; never return raw errors.
      checks.push({ label: requirement.label, state: 'blocked', detail: 'Credential preflight failed. Reconnect or retry after the provider recovers.' });
    }
  }
  if (names.has('quickbooks_forecast_cashflow')) {
    try {
      await getQuickBooksClient(room.organizationId, room.projectId);
      checks.push({ label: 'QuickBooks connection', state: 'not_checked', detail: 'Scoped company configuration found. OAuth credentials, provider availability and company currency are checked during execution.' });
    } catch {
      checks.push({ label: 'QuickBooks connection', state: 'blocked', detail: 'Connect or repair QuickBooks in this organization or Project Space.' });
    }
    for (const entity of ['Account', 'Invoice', 'Bill']) {
      if (!userId) {
        checks.push({ label: `QuickBooks ${entity} reading`, state: 'not_checked', detail: 'A signed-in caller is required to check financial access.' });
        continue;
      }
      try {
        await financeRolesService.assertCan({ organizationId: room.organizationId, projectId: room.projectId, userId }, entity, 'read');
        checks.push({ label: `QuickBooks ${entity} reading`, state: 'passed', detail: 'Your project finance role permits this read. Access is checked again during execution.' });
      } catch {
        checks.push({ label: `QuickBooks ${entity} reading`, state: 'blocked', detail: `Could not verify ${entity} read access. Ask the project owner to check your membership and finance role, or retry if the service is unavailable.` });
      }
    }
  }
  let projectBindings: CrewReadinessReport['projectBindings'] = [];
  if (room.projectId != null) {
    try {
      projectBindings = (await projectBindingService.listForProject(room.organizationId, room.projectId))
        .map(binding => ({ kind: binding.resourceKind, key: binding.resourceKey, name: binding.resourceName }));
      checks.push({ label: 'Project bindings', state: 'not_checked', detail: `${projectBindings.length} configured resource bindings. Provider access, source revisions and destination mappings are not verified by a binding row.` });
    } catch {
      checks.push({ label: 'Project bindings', state: 'blocked', detail: 'Could not load bindings for this Project Space. Retry after the service recovers.' });
    }
  }
  const recipes = CREW_READINESS_RECIPES.map(recipe => ({
    id: recipe.id, label: recipe.label,
    agents: agents.map(agent => ({ id: agent.id, missingTools: unavailableDeclaredTools([...recipe.tools], agent.tools) })),
    detail: 'Tool coverage only. Credentials, verified inputs, approvals and successful execution remain separate checkpoints. Partial tool coverage across agents does not prove a coordinated handoff.',
  }));
  checks.push({ label: 'Other integrations, skills and end-to-end workflows', state: 'not_checked', detail: 'Tool registration does not verify credentials, selected skills, source mappings, quotas or a successful workflow.' });
  return { organizationId: room.organizationId, sessionKey: room.sessionKey, projectId: room.projectId, checkedAt: new Date().toISOString(), agents, checks, recipes, projectBindings, integrations, appliedSkills };
}
