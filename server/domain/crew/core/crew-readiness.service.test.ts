import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ members: vi.fn(), transcript: vi.fn(), resolve: vi.fn(), token: vi.fn(), quickbooks: vi.fn(), finance: vi.fn(), bindings: vi.fn(), inventory: vi.fn(), augmentations: vi.fn() }));
vi.mock('./crew-repository.js', () => ({ crewRepository: { getMembers: mocks.members, getTranscript: mocks.transcript } }));
vi.mock('./crew-tools.service.js', () => ({ crewToolsService: { resolveForCard: mocks.resolve } }));
vi.mock('@domain/integrations/google-workspace-connector-bridge.js', () => ({ getGoogleWorkspaceToken: mocks.token }));
vi.mock('@domain/integrations/quickbooks/service.js', () => ({ getQuickBooksClient: mocks.quickbooks }));
vi.mock('@domain/projects/core/finance-roles.service.js', () => ({ financeRolesService: { assertCan: mocks.finance } }));
vi.mock('@domain/integrations/project-binding.service.js', () => ({ projectBindingService: { listForProject: mocks.bindings } }));
vi.mock('@domain/integrations/saas-adapter-inventory.service.js', () => ({ saasAdapterInventoryService: { listForProject: mocks.inventory } }));
vi.mock('@domain/agents/core/skill-augmentation.service.js', () => ({ SkillAugmentationService: { listAugmentationsForAgent: mocks.augmentations } }));
import { getCrewReadiness } from './crew-readiness.service.js';
import type { CrewSessionRecord } from '@shared/schema/crew.js';

const room = { id: 3, organizationId: 342, projectId: 7, sessionKey: 'room', cycleContext: { studio: 'media' } } as CrewSessionRecord;
describe('room capability preflight', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.members.mockResolvedValue([{ id: 1, organizationId: 342, enabled: true, name: 'Copilot', tools: ['missing_mapping', 'gmail_get_message'] }, { id: 2, organizationId: 999, enabled: true }, { id: 3, organizationId: 342, enabled: false }]);
    mocks.transcript.mockResolvedValue([]);
    mocks.bindings.mockResolvedValue([]);
    mocks.inventory.mockResolvedValue([]);
    mocks.augmentations.mockResolvedValue([]);
    mocks.resolve.mockResolvedValue(['gmail_get_message', 'gcal_create_event'].map(name => ({ definition: { name } })));
  });
  it('uses exact offered tools, excludes foreign and disabled cards and reports missing mappings', async () => {
    mocks.token.mockResolvedValue('secret-token');
    const report = await getCrewReadiness(room);
    expect(report.agents).toHaveLength(1);
    expect(report.agents[0].unavailableDeclaredTools).toEqual(['missing_mapping']);
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'media');
    expect(mocks.token).toHaveBeenCalledWith(342, 7, 'calendar_write');
    expect(JSON.stringify(report)).not.toContain('secret-token');
    expect(report.checks.at(-1)?.state).toBe('not_checked');
  });
  it('distinguishes missing scope from successful credential preflight without implying execution', async () => {
    mocks.token.mockResolvedValueOnce('token').mockResolvedValueOnce(null);
    const report = await getCrewReadiness(room);
    expect(report.checks.filter(check => /^(Gmail|Calendar)/.test(check.label)).map(check => check.state)).toEqual(['passed', 'blocked']);
    expect(report.checks.find(check => check.label === 'Gmail reading')?.detail).toContain('checked when executed');
  });
  it('sanitizes provider errors rather than returning secret-bearing messages', async () => {
    mocks.token.mockRejectedValue(new Error('https://provider?token=secret'));
    const report = await getCrewReadiness(room);
    expect(report.checks.find(check => check.label === 'Gmail reading')?.state).toBe('blocked');
    expect(JSON.stringify(report)).not.toContain('token=secret');
  });
  it('honors leaving a studio rather than restoring historical write grants', async () => {
    mocks.token.mockResolvedValue(null);
    await getCrewReadiness(room, null);
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), undefined);
  });
  it('checks forecast roles for the actual caller and does not imply OAuth validity from configuration', async () => {
    mocks.resolve.mockResolvedValue(['quickbooks_forecast_cashflow', 'propose_financial_snapshot'].map(name => ({ definition: { name } })));
    mocks.quickbooks.mockResolvedValue({ client: { secret: 'never-return' } });
    mocks.finance.mockImplementation(async (_caller, entity) => { if (entity === 'Bill') throw new Error('forbidden'); });
    const report = await getCrewReadiness(room, null, 'user-9');
    expect(mocks.quickbooks).toHaveBeenCalledWith(342, 7);
    expect(mocks.finance).toHaveBeenCalledWith({ organizationId: 342, projectId: 7, userId: 'user-9' }, 'Bill', 'read');
    expect(report.checks.find(check => check.label === 'QuickBooks connection')?.state).toBe('not_checked');
    expect(report.checks.find(check => check.label === 'QuickBooks Bill reading')?.state).toBe('blocked');
    expect(report.recipes.find(recipe => recipe.id === 'books_snapshot')?.agents[0].missingTools).toEqual([]);
    expect(JSON.stringify(report)).not.toContain('never-return');
  });
  it('reports project bindings as configuration and strips connector metadata', async () => {
    mocks.bindings.mockResolvedValue([{ resourceKind: 'jira_project', resourceKey: 'OPS', resourceName: 'Operations', connectorId: 22, credentialId: 99 }]);
    const report = await getCrewReadiness(room);
    expect(mocks.bindings).toHaveBeenCalledWith(342, 7);
    expect(report.projectBindings).toEqual([{ kind: 'jira_project', key: 'OPS', name: 'Operations' }]);
    expect(JSON.stringify(report)).not.toContain('credentialId');
  });
  it('uses the executing agent’s exact current tools and refuses a foreign membership', async () => {
    const report = await getCrewReadiness(room, undefined, 'user-9', { id: 1, tools: ['gmail_get_message'] });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(report.agents[0].tools).toEqual(['gmail_get_message']);
    expect(report.recipes[0].agents[0].missingTools).toContain('gcal_create_event');
    await expect(getCrewReadiness(room, undefined, 'user-9', { id: 2, tools: [] })).rejects.toThrow('enabled member');
  });
  it('returns active scoped augmentation tool gaps, excluding rollback snapshots and rolled-back skills', async () => {
    mocks.augmentations.mockResolvedValue([{ id: 9, skillId: 4, status: 'active', toolsAdded: ['gmail_get_message', 'missing_tool'], appliedAt: new Date('2026-10-09T12:00:00Z'), rollbackSnapshot: { secret: 'private' } }, { id: 10, status: 'rolled_back', toolsAdded: ['other'] }]);
    const report = await getCrewReadiness(room);
    expect(mocks.augmentations).toHaveBeenCalledExactlyOnceWith(1, 342);
    expect(report.appliedSkills).toEqual([{ agentId: 1, augmentationId: 9, skillId: 4, appliedAt: '2026-10-09T12:00:00.000Z', missingTools: ['missing_tool'] }]);
    expect(JSON.stringify(report)).not.toContain('private');
  });
  it('does not treat an inventory failure as an empty set of configured integrations', async () => {
    mocks.inventory.mockRejectedValue(new Error('private-provider-error'));
    const report = await getCrewReadiness(room);
    expect(mocks.inventory).toHaveBeenCalledWith(342, 7);
    expect(report.checks.find(check => check.label === 'Integration inventory')?.state).toBe('blocked');
    expect(JSON.stringify(report)).not.toContain('private-provider-error');
  });
});
