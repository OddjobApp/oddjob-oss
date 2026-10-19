import { describe, it, expect, vi } from 'vitest';
import { forgePlanService } from '../../core/forge-plan.service.js';

describe('ForgePlanService Resilience', () => {
    describe('decomposeRequirements', () => {
        it('should fallback to raw description if AI returns too few items', async () => {
            const description = "Build a complex dashboard with multiple charts, a table, and a chat interface.";
            const aiClient = {
                execute: vi.fn().mockResolvedValue({
                    success: true,
                    output: "1. Build it." // Too few items
                })
            };
            const aiConfig = { model: 'test' };

            const features = await forgePlanService.decomposeRequirements(
                description,
                'spa',
                aiConfig,
                aiClient
            );

            expect(features).toContain(description);
            expect(features).toContain("1.");
        });

        it('should return original description on AI failure', async () => {
            const description = "Test description";
            const aiClient = {
                execute: vi.fn().mockRejectedValue(new Error("AI Down"))
            };
            const aiConfig = { model: 'test' };

            const features = await forgePlanService.decomposeRequirements(
                description,
                'spa',
                aiConfig,
                aiClient
            );

            expect(features).toBe(description);
        });
    });

    describe('generateBuildPlan', () => {
        it('should generate tasks from architecture if AI planning returns empty', async () => {
            const aiClient = {
                execute: vi.fn().mockResolvedValue({
                    success: true,
                    output: "[]" // Empty array
                })
            };
            const aiConfig = { model: 'test' };
            const architecture = {
                components: [
                    { name: 'Dashboard', type: 'page', description: 'Main page', dependencies: [] },
                    { name: 'UserList', type: 'module', description: 'List of users', dependencies: [] }
                ],
                services: [],
                dataModels: []
            } as any;

            const plan = await forgePlanService.generateBuildPlan(
                "some features",
                aiConfig,
                aiClient,
                1.0,
                undefined,
                undefined,
                architecture
            );

            expect(plan.length).toBe(2);
            expect(plan[0].title).toBe('Dashboard');
            expect(plan[1].title).toBe('UserList');
            expect(plan[0].files).toContain('pages/dashboard.tsx');
            expect(plan[1].files).toContain('components/userlist.tsx');
        });
    });
});
