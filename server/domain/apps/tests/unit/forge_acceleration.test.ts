import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uiRegistryService } from '../../core/ui-registry.service.js';
import { forgeFoundationService } from '../../core/forge-foundation.service.js';
import fs from 'fs/promises';
import path from 'path';

// Mock dependencies if necessary, but here we can test the real logic
// assuming the packaged components I just created exist.

describe('App Forge Acceleration Layer', () => {
    describe('UIRegistryService', () => {
        it('should discover packaged components and include them in the manifest', async () => {
            const manifest = await uiRegistryService.getUIPaletteManifest();
            const blockCategory = manifest['Platform Blocks (Self-Wiring)'] || manifest['Packaged Solutions'];
            expect(blockCategory).toBeDefined();
            const blockIds = Array.isArray(blockCategory) ? blockCategory.map((b: any) => typeof b === 'string' ? b : b.id) : [];
            expect(blockIds).toContain('IndustrialDashboardHero');
            expect(blockIds).toContain('MissionControlTable');
        });
    });

    describe('ForgeFoundationService', () => {
        it('should resolve relevant packaged foundations based on mission keywords', async () => {
            const description = "Build a mission control dashboard for industrial telemetry";
            // @ts-ignore - accessing private method for testing
            const foundations = await forgeFoundationService.resolvePackagedFoundations(description);
            console.log("FOUNDATIONS RETURNED:", foundations.split('CONTENT:')[0]);
            
            expect(foundations).toContain('FILE: @/components/packaged/IndustrialDashboardHero.tsx');
            expect(foundations).toContain('FILE: @/components/packaged/MissionControlTable.tsx');
            expect(foundations).toContain('IndustrialDashboardHero');
        });

        it('should limit foundations to top 3 relevant components', async () => {
            const description = "Everything dashboard table assistant assistant assistant";
            // @ts-ignore
            const foundations = await forgeFoundationService.resolvePackagedFoundations(description);
            
            const fileMarkers = foundations.match(/FILE: @\/components\/packaged\//g) || [];
            expect(fileMarkers.length).toBeLessThanOrEqual(3);
        });
    });
});
