import { describe, it, expect, beforeEach, vi } from 'vitest';
import { forgeDesignCatalogService } from '../../core/forge-design-catalog.service.js';
import { appForgeService } from '../../app-forge.service.js';
import { redis } from '@domain/core/infrastructure/redis/redis-client.js';

describe('App Forge: Design System & Discovery Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('ForgeDesignCatalogService', () => {
        it('should fetch and parse a style from designdotmd.directory', async () => {
            const styleId = 'terminal';
            const style = await forgeDesignCatalogService.getStyleById(styleId);
            
            expect(style).toBeDefined();
            expect(style?.id).toBe(styleId);
            expect(style?.colors).toBeDefined();
            expect(style?.colors.primary).toBeDefined();
            expect(style?.typography).toBeDefined();
        });

        it('should condense tokens into a prompt context', async () => {
            const styleId = 'terminal';
            const style = await forgeDesignCatalogService.getStyleById(styleId);
            const context = forgeDesignCatalogService.toPromptContext(style!);
            
            expect(context.toUpperCase()).toContain('DESIGN IDENTITY: TERMINAL');
            expect(context).toContain('Color Palette');
            expect(context).toContain('Typography');
        });
    });

    describe('AppForgeService Discovery Phase', () => {
        it.skip('should inject design style context when designStyleId is provided', async () => {
            // This is a complex test because it involves real network calls if not mocked
            // We'll mock the catalog service for this test
            const mockStyle = {
                id: 'custom-style',
                name: 'Custom Style',
                tokens: {
                    colors: { primary: '#ff0000', background: '#000000' },
                    fonts: { body: 'Inter', heading: 'Inter' },
                    radii: { button: '4px' }
                }
            };
            
            const spy = vi.spyOn(forgeDesignCatalogService, 'getStyleById').mockResolvedValue(mockStyle as any);
            
            const options: any = {
                name: 'Test App',
                slug: 'test-app',
                description: 'A test app',
                blueprint: 'chat-assistant',
                designStyleId: 'custom-style'
            };

            const result = await (appForgeService as any).runDiscovery(options, 'job-123');
            
            expect(spy).toHaveBeenCalledWith('custom-style');
            expect(options.designStyleContext).toBeDefined();
            expect(options.designStyleContext).toContain('DESIGN IDENTITY: custom-style');
            expect(options.designStyleContext).toContain('#ff0000');
        });

        it.skip('should resolve reference asset context when referenceAssetIds are provided', async () => {
            // Mock asset service or DB if necessary
            // For now we'll check if the logic path is exercised
            const options: any = {
                name: 'Test App',
                slug: 'test-app',
                description: 'A test app',
                blueprint: 'chat-assistant',
                referenceAssetIds: [123]
            };

            // We expect it to try and fetch the asset. We can mock the db/asset service if needed.
            // But even without full mock, we can verify it doesn't crash and sets researchContext
            const result = await (appForgeService as any).runDiscovery(options, 'job-123');
            expect(options.researchContext).toBeDefined();
        });
    });
});
