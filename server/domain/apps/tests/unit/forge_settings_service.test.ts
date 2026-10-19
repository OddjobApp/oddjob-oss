import { describe, it, expect, beforeEach, vi } from 'vitest';
import { forgeSettingsService, ForgeSettings, ForgeSettingsService } from '../../core/forge-settings.service.js';
import { redis } from '@domain/core/infrastructure/redis/redis-client.js';

vi.mock('@domain/core/infrastructure/redis/redis-client.js', () => ({
    redis: {
        get: vi.fn(),
        setex: vi.fn(),
    },
}));

describe('ForgeSettingsService', () => {
    const orgId = 123;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return default settings if none exist in Redis', async () => {
        vi.mocked(redis.get).mockResolvedValue(null);
        
        const settings = await forgeSettingsService.getSettings(orgId);
        
        expect(settings.coding.typescriptStrict).toBe(true);
        expect(settings.security.owaspLevel).toBe('owasp-top-10');
        expect(settings.updatedAt).toBeNull();
    });

    it('should return merged settings if they exist in Redis', async () => {
        const customSettings = {
            coding: { typescriptStrict: false },
            security: { owaspLevel: 'l1' }
        };
        vi.mocked(redis.get).mockResolvedValue(JSON.stringify(customSettings));
        
        const settings = await forgeSettingsService.getSettings(orgId);
        
        expect(settings.coding.typescriptStrict).toBe(false);
        expect(settings.security.owaspLevel).toBe('l1');
        // Verify defaults for missing fields
        expect(settings.coding.eslintRuleset).toBe('airbnb');
    });

    it('should save settings with metadata', async () => {
        vi.mocked(redis.get).mockResolvedValue(null);
        const newSettings = { coding: { typescriptStrict: false } };
        
        await forgeSettingsService.saveSettings(orgId, newSettings as any, 456);
        
        expect(redis.setex).toHaveBeenCalled();
        const callArgs = vi.mocked(redis.setex).mock.calls[0];
        expect(callArgs[0]).toBe(`forge:settings:org:${orgId}`);
        const saved = JSON.parse(callArgs[2] as string);
        expect(saved.coding.typescriptStrict).toBe(false);
        expect(saved.updatedBy).toBe(456);
        expect(saved.updatedAt).toBeDefined();
    });

    it('should generate correct prompt context', () => {
        const settings = ForgeSettingsService.getDefaults();
        settings.coding.typescriptStrict = true;
        settings.security.owaspLevel = 'MANDATORY-HARD';
        
        const context = forgeSettingsService.toPromptContext(settings);
        
        expect(context).toContain('TypeScript: Strict mode MANDATORY');
        expect(context).toContain('Security Level: MANDATORY-HARD');
    });
});
