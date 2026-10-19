import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deAnonymizationService } from "@domain/prospecting/de-anonymization.service.js";
import { mcpClientService } from "@domain/integrations/core/mcp-client.service.js";
import { db } from '@server/database_service.js';
import { prospectProfiles } from '@shared/schema/index.js';
import { eq } from 'drizzle-orm';

// Mock dependencies
vi.mock('@server/database_service.js', () => ({
    db: {
        select: vi.fn(),
        update: vi.fn()
    }
}));

vi.mock("@domain/integrations/core/mcp-client.service.js", () => ({
    mcpClientService: {
        getAllTools: vi.fn()
    }
}));

describe('DeAnonymizationService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should skip local IP addresses', async () => {
        const result1 = await deAnonymizationService.resolveIp('127.0.0.1', 1, 1);
        const result2 = await deAnonymizationService.resolveIp('192.168.1.5', 1, 1);

        expect(result1).toBeNull();
        expect(result2).toBeNull();
        expect(mcpClientService.getAllTools).not.toHaveBeenCalled();
    });

    it('should return null if no matching MCP tool is found', async () => {
        vi.mocked(mcpClientService.getAllTools).mockReturnValue([
            { name: 'random_tool', execute: vi.fn() } as any
        ]);

        const result = await deAnonymizationService.resolveIp('8.8.8.8', 1, 1);

        expect(result).toBeNull();
    });

    it('should successfully resolve IP and update profile when a clearbit tool is available', async () => {
        const mockExecute = vi.fn().mockResolvedValue({
            company: { name: "Clearbit Test", domain: "clearbit.com" }
        });

        vi.mocked(mcpClientService.getAllTools).mockReturnValue([
            { name: 'mcp-clearbit-enrich_ip', execute: mockExecute } as any
        ]);

        const mockWhere = vi.fn().mockResolvedValue([
            { id: 1, metadata: {} }
        ]);
        const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
        vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

        const mockSetWhere = vi.fn().mockResolvedValue([]);
        const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
        vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

        const result = await deAnonymizationService.resolveIp('104.16.123.96', 1, 1);

        expect(mockExecute).toHaveBeenCalledWith({ ip: '104.16.123.96' }, expect.objectContaining({ organizationId: 1 }));
        expect(result).toEqual({ name: "Clearbit Test", domain: "clearbit.com" });
        expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                company: expect.objectContaining({
                    name: "Clearbit Test",
                    domain: "clearbit.com"
                })
            })
        }));
    });
});
