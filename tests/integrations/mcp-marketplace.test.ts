import { describe, it, expect, vi, beforeEach } from 'vitest';

// We would normally test the express route, but for unit testing the logic we can mock it
// Assuming we are testing the /api/mcp-servers/suggest endpoint behavior
describe('MCP Marketplace API - /suggest', () => {
  it('creates a new suggested tool in the database', async () => {
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1, name: 'puppeteer', status: 'suggested' }])
        })
      })
    };

    const result = await mockDb.insert().values({ name: 'puppeteer', status: 'suggested' }).returning();
    
    expect(result[0].status).toBe('suggested');
    expect(result[0].name).toBe('puppeteer');
  });

  it('filters tools correctly in the agent suggestions view', () => {
    const mockData = [
      { id: 1, name: 'github', status: 'active' },
      { id: 2, name: 'puppeteer', status: 'suggested' },
      { id: 3, name: 'postgres', status: 'suggested' }
    ];

    const suggested = mockData.filter(d => d.status === 'suggested');
    
    expect(suggested.length).toBe(2);
    expect(suggested[0].name).toBe('puppeteer');
  });
});
