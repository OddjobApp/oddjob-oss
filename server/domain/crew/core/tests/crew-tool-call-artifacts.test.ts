import { afterEach, describe, expect, it, vi } from 'vitest';
import { crewToolsService, compactToolOutputForPrompt } from '../crew-tools.service.js';
import { executeToolCalls } from '../crew-speaker-turn.service.js';

/**
 * Each call is digested for the model from its own artifact. Looking the
 * artifact up by tool name returned the first call's, so a later failed call
 * to the same tool reached the model as the earlier call's success.
 */
describe('tool call artifacts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('pairs each result with its own artifact, so a failed repeat call reads as a failure', async () => {
    vi.spyOn(crewToolsService, 'execute')
      .mockResolvedValueOnce({ record: { name: 'gdrive_list_files', ok: true, ms: 1 }, output: '{"files":[{"id":"a"}]}',
        artifact: { tool: 'gdrive_list_files', payload: { type: 'google_workspace_results', title: 'Drive files', items: [{ id: 'a', kind: 'document', title: 'Q3 plan' }] } } } as any)
      .mockResolvedValueOnce({ record: { name: 'gdrive_list_files', ok: false, ms: 1, error: 'Drive access revoked' }, output: 'Error listing files: Drive access revoked', artifact: undefined } as any);
    const artifacts: any[] = [];

    const done = await executeToolCalls(
      [{ name: 'gdrive_list_files', args: { query: 'plan' } }, { name: 'gdrive_list_files', args: { query: 'budget' } }],
      { availableTools: [] as any, toolContext: { organizationId: 342 } as any, cost: { toolCalls: 0 } as any, toolsUsed: [], artifacts },
    );

    expect(done[0].artifact?.payload).toMatchObject({ title: 'Drive files' });
    expect(done[1].artifact).toBeUndefined();
    expect(compactToolOutputForPrompt(done[0].record.name, done[0].output, done[0].artifact)).toContain('Q3 plan');
    const second = compactToolOutputForPrompt(done[1].record.name, done[1].output, done[1].artifact);
    expect(second).toContain('Drive access revoked');
    expect(second).not.toContain('Q3 plan');
  });

  it('turns a refusal that says what would allow it into one permission card per access', async () => {
    const { z } = await import('zod');
    const { PermissionRequiredError } = await import('@domain/projects/core/finance-roles.service.js');
    const permission = {
      type: 'permission_required' as const, key: '3:read QuickBooks Invoice records', title: 'QuickBooks access needed',
      action: 'read QuickBooks Invoice records', reason: 'You cannot read QuickBooks Invoice records on this project.',
      allowedRoles: ['Accounts receivable'], project: { id: 3, key: 'books', name: 'Books' }, organizationId: 342,
      steps: [{ id: 'grant' as const, label: 'Give you the Accounts receivable finance role', done: false }],
      grantedBy: 'an org admin', callerCanGrant: false, manageHref: '/projects/books?tab=integrations&orgId=342',
    };
    const refusing = (name: string) => ({
      reason: 'declared-read-safe',
      definition: { name, description: '', parameters: z.object({}), execute: async () => { throw new PermissionRequiredError(permission.reason, permission); } },
    });
    const tools = [refusing('quickbooks_list_records'), refusing('quickbooks_calculate_total')] as any;
    const artifacts: any[] = [];

    const done = await executeToolCalls(
      [{ name: 'quickbooks_list_records', args: {} }, { name: 'quickbooks_calculate_total', args: {} }],
      { availableTools: tools, toolContext: { organizationId: 342 } as any, cost: { toolCalls: 0 } as any, toolsUsed: [], artifacts },
    );

    // Still failures: nothing was read, and the evasion check must see that.
    expect(done.map((d) => d.record.ok)).toEqual([false, false]);
    expect(done[0].output).toContain('was refused');
    // Both calls were refused for the same access: one card.
    expect(artifacts.filter((a) => a.payload?.type === 'permission_required')).toHaveLength(1);
    expect(artifacts[0].payload).toMatchObject({ key: permission.key, action: 'read QuickBooks Invoice records' });
  });
});
