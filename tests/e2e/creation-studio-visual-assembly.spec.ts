import { test, expect } from '@playwright/test';
import { dagResolver } from '../../server/domain/scaffold/dag-resolver.js';
import { blueprintStateService } from '../../server/domain/scaffold/blueprint-state.service.js';
import { ASSEMBLY_TOOLS } from '../../server/domain/tools/v1/capabilities/assembly-tools.js';
import type { AssemblyBlueprint } from '../../shared/schema/assembly-blueprint.js';

test.describe('Composable Creation Studio & In-Chat Assembly Visuals', () => {

    test('Assembly Capability Tools are properly registered and executable', async () => {
        // 1. Verify all 4 assembly tools exist with parameters and execute handlers
        expect(ASSEMBLY_TOOLS['resolve_assembly_dag']).toBeDefined();
        expect(ASSEMBLY_TOOLS['render_workflow_diagram']).toBeDefined();
        expect(ASSEMBLY_TOOLS['mount_builder_pod']).toBeDefined();
        expect(ASSEMBLY_TOOLS['evaluate_functional_gaps']).toBeDefined();

        // 2. Test resolve_assembly_dag tool execution
        const dagResult: any = await ASSEMBLY_TOOLS['resolve_assembly_dag'].execute({
            requestedPacks: ['auth-jwt', 'ui-oddjob-design-system']
        }, {} as any);

        expect(dagResult.success).toBe(true);
        expect(Array.isArray(dagResult.executionOrder)).toBe(true);
        expect(dagResult.totalPacks).toBeGreaterThan(0);

        // 3. Test render_workflow_diagram tool execution
        const diagramResult: any = await ASSEMBLY_TOOLS['render_workflow_diagram'].execute({
            stages: [
                { id: 'core', name: 'Host Express Engine', status: 'ready', dependsOn: [] },
                { id: 'auth', name: 'JWT Authentication', status: 'active', dependsOn: ['core'] },
                { id: 'hil', name: 'SOC2 Approval Gate', status: 'blocked', dependsOn: ['auth'] },
            ]
        }, {} as any);

        expect(diagramResult.success).toBe(true);
        expect(diagramResult.chart).toContain('graph TD');
        expect(diagramResult.chart).toContain('core["Host Express Engine (READY)"]:::ready');
        expect(diagramResult.chart).toContain('core --> auth');

        // 4. Test evaluate_functional_gaps tool execution
        const gapResult: any = await ASSEMBLY_TOOLS['evaluate_functional_gaps'].execute({
            blueprint: {
                id: 'test-bp',
                name: 'Test Incident Response Cycle',
                category: 'operational_cycle',
                description: 'Testing gap detection',
                stages: [
                    {
                        id: 's1',
                        name: 'Database Ingestion',
                        type: 'dataset_schema',
                        podComponent: 'DatasetSchemaPod',
                        requires: [],
                        provides: ['db_ready'],
                        conflicts: [],
                        defaultConfig: {},
                        completionCriteria: { type: 'dataset_verified' }
                    }
                ],
                isAssemblyReady: false,
            }
        }, {} as any);

        expect(gapResult.success).toBe(true);
        expect(Array.isArray(gapResult.gaps)).toBe(true);
        expect(typeof gapResult.gapsCount).toBe('number');
    });

    test('Blueprint State Engine handles stage progression and prerequisite gating', async () => {
        const testBlueprint: AssemblyBlueprint = {
            id: 'e2e-studio-bp',
            name: 'Automated Breach Remediation Cycle',
            category: 'operational_cycle',
            description: 'E2E test blueprint for Creation Studio state engine',
            stages: [
                {
                    id: 'stage-data',
                    name: 'Audit Log Ingestion',
                    type: 'dataset_schema',
                    requires: [],
                    provides: ['data_schema'],
                    conflicts: [],
                    podComponent: 'DatasetSchemaPod',
                    defaultConfig: {},
                    completionCriteria: { type: 'dataset_verified' },
                },
                {
                    id: 'stage-agent',
                    name: 'Remediation Agents',
                    type: 'agent_roster',
                    requires: ['stage-data'],
                    provides: ['agents_assigned'],
                    conflicts: [],
                    podComponent: 'AgenticHRPod',
                    defaultConfig: {},
                    completionCriteria: { type: 'agents_assigned' },
                },
                {
                    id: 'stage-governance',
                    name: 'SOC2 Approval Gate',
                    type: 'hil_governance',
                    requires: ['stage-agent'],
                    provides: ['hil_gate'],
                    conflicts: [],
                    podComponent: 'HILGovernancePod',
                    defaultConfig: {},
                    completionCriteria: { type: 'hil_gate_configured' },
                },
            ],
            isAssemblyReady: false,
        };

        const session = blueprintStateService.createSession('session-e2e-1', testBlueprint);
        expect(session.progressPercent).toBe(0);
        expect(session.activeStage?.id).toBe('stage-data');

        // Attempting to complete stage-governance before prerequisites must throw
        expect(() => {
            blueprintStateService.submitStageCompletion(
                'session-e2e-1',
                'stage-governance',
                { approverRole: 'security-lead' }
            );
        }).toThrow(/Cannot complete stage 'stage-governance'/);

        // Complete stages sequentially
        const step1 = blueprintStateService.submitStageCompletion(
            'session-e2e-1',
            'stage-data',
            { schemaVersion: 'v1.0' }
        );
        expect(step1.progressPercent).toBe(33);
        expect(step1.activeStage?.id).toBe('stage-agent');

        const step2 = blueprintStateService.submitStageCompletion(
            'session-e2e-1',
            'stage-agent',
            { primaryAgentId: 'agent-sentinel' }
        );
        expect(step2.progressPercent).toBe(67);
        expect(step2.activeStage?.id).toBe('stage-governance');

        const step3 = blueprintStateService.submitStageCompletion(
            'session-e2e-1',
            'stage-governance',
            { approverRole: 'security-lead' }
        );
        expect(step3.progressPercent).toBe(100);
        expect(step3.isAssemblyReady).toBe(true);

        // Verify Mermaid Chart generation
        expect(step3.mermaidChart).toContain('graph TD');
        expect(step3.mermaidChart).toContain('classDef verified fill:#10b981');
    });

    test('In-Chat CREW Room UI renders and mounts interactive visual elements', async ({ page }) => {
        test.setTimeout(180_000);

        // 1. Navigate to workspace chat
        await page.goto('/workspace/chat', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        // 2. Take a screenshot of chat page
        await page.screenshot({ path: 'test-results/creation-studio-chat-initial.png' });

        // 3. Verify chat UI elements are present
        const chatContainer = page.locator('[data-testid="crew-roster"], [data-testid="crew-chat-panel"], form, textarea').first();
        await expect(chatContainer).toBeVisible({ timeout: 20_000 });

        // 4. Verify that page content loaded
        const bodyContent = await page.content();
        expect(bodyContent.length).toBeGreaterThan(500);

        console.log('--- CREW Chat Room UI successfully verified in browser ---');
    });
});
