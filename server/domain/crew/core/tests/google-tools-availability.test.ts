import { describe, expect, it } from 'vitest';
import { classifyReadOnly, COMMUNICATION_TOOLS, crewToolsService } from '../crew-tools.service.js';
import { GOOGLE_WORKSPACE_TOOLS } from '@domain/tools/v1/capabilities/google-workspace.js';
import { MAIL_DOCS_WRITE_NAMES, GOOGLE_MAIL_DOCS_TOOLS } from '@domain/tools/v1/capabilities/google-mail-docs.js';
import { AMAZON_TOOLS } from '@domain/tools/v1/capabilities/amazon.js';
describe('CREW Google mail and Docs availability', () => {
  it('offers Amazon proposals and cart handoffs to CREW', () => {
    expect(COMMUNICATION_TOOLS).toContain('amazon_propose_purchase');
    expect(COMMUNICATION_TOOLS).toContain('amazon_build_cart');
    expect(classifyReadOnly(AMAZON_TOOLS.amazon_propose_purchase)).toBe('proposal');
    expect(classifyReadOnly(AMAZON_TOOLS.amazon_build_cart)).toBe('proposal');
  });
  it('resolves the Amazon tools for an agent without explicit shopping tools', async () => {
    const tools = await crewToolsService.resolveForCard({ name: 'Shopping test', tools: [] } as any);
    const names = tools.map(tool => tool.definition.name);
    for (const name of ['amazon_search_products', 'amazon_get_product', 'amazon_build_cart', 'amazon_propose_purchase']) expect(names).toContain(name);
  });
  it('offers every mail and Docs proposal through the room tool resolver', () => {
    for (const name of MAIL_DOCS_WRITE_NAMES) {
      expect(GOOGLE_WORKSPACE_TOOLS[name]).toBeDefined();
      expect(COMMUNICATION_TOOLS).toContain(name);
      expect(classifyReadOnly(GOOGLE_WORKSPACE_TOOLS[name])).toBe('proposal');
    }
  });
  it('offers every new Google read tool automatically', () => {
    for (const definition of Object.values(GOOGLE_MAIL_DOCS_TOOLS)) {
      if (definition.idempotency === 'read-safe') expect(classifyReadOnly(definition)).not.toBeNull();
    }
  });
});
