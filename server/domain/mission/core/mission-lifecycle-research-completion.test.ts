import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MissionLifecycleHooks } from './mission-lifecycle-hooks.js';

// The completion hook dynamic-imports these; mock them by their exact specifiers.
const publish = vi.fn().mockResolvedValue('mock-event-id');
vi.mock('@domain/core/infrastructure/event-stream.service.js', () => ({
    eventStream: { publish },
}));

const createDocument = vi.fn().mockResolvedValue({ id: 4242 });
vi.mock('@domain/knowledge/core/extraction/document-service.js', () => ({
    documentService: { createDocument },
}));

// Reach the fire-and-forget hook directly (it's a private static that reads only the
// passed mission object — no DB access — so we can exercise it without onMissionTerminalState).
const runCopilotResearchCompletion = (mission: any, status: 'completed' | 'failed') =>
    (MissionLifecycleHooks as any).runCopilotResearchCompletion(mission, status);

const flush = () => new Promise((r) => setTimeout(r, 20));

function copilotResearchRun(overrides: Record<string, any> = {}) {
    return {
        id: 77,
        missionId: 12,
        organizationId: 9,
        createdBy: 'user-1',
        missionContext: {
            source: 'copilot_research',
            question: 'What is our refund SLA?',
            result: 'Refunds are processed within 5 business days.',
            topic: 'Policies',
            requestedByUserId: 'user-1',
        },
        ...overrides,
    };
}

describe('MissionLifecycleHooks.runCopilotResearchCompletion', () => {
    beforeEach(() => vi.clearAllMocks());

    it('stores the answer in the KB and posts an Assistant Update on completion', async () => {
        runCopilotResearchCompletion(copilotResearchRun(), 'completed');
        await flush();

        expect(createDocument).toHaveBeenCalledTimes(1);
        expect(createDocument).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Research: What is our refund SLA?',
                textContent: 'Refunds are processed within 5 business days.',
                sourceType: 'copilot_research',
                topicNames: ['Policies'],
            }),
            expect.objectContaining({ organizationId: 9, userId: 'user-1' }),
        );

        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledWith(
            'intervention.triggered',
            expect.objectContaining({
                priority: 'medium',
                title: expect.stringContaining('Research complete'),
                context: expect.objectContaining({ missionRunId: 77, documentId: 4242 }),
            }),
            expect.objectContaining({ organizationId: 9, userId: 'user-1' }),
            'copilot-research',
        );
    });

    it('falls back to the Agency Intelligence topic when none is given', async () => {
        const run = copilotResearchRun({
            missionContext: {
                source: 'copilot_research',
                question: 'What is our refund SLA?',
                result: 'Refunds are processed within 5 business days.',
                requestedByUserId: 'user-1',
            },
        });
        runCopilotResearchCompletion(run, 'completed');
        await flush();

        expect(createDocument).toHaveBeenCalledWith(
            expect.objectContaining({ topicNames: ['Agency Intelligence'] }),
            expect.anything(),
        );
    });

    it('posts a failure update and does NOT write to the KB when the mission fails', async () => {
        runCopilotResearchCompletion(copilotResearchRun(), 'failed');
        await flush();

        expect(createDocument).not.toHaveBeenCalled();
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledWith(
            'intervention.triggered',
            expect.objectContaining({ title: expect.stringContaining("didn't complete") }),
            expect.objectContaining({ organizationId: 9 }),
            'copilot-research',
        );
    });

    it('does not re-deliver a run already marked copilotResearchDelivered', async () => {
        const run = copilotResearchRun();
        (run.missionContext as any).copilotResearchDelivered = true;
        runCopilotResearchCompletion(run, 'completed');
        await flush();

        expect(createDocument).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
    });

    it('ignores runs that are not copilot research missions', async () => {
        const run = copilotResearchRun({ missionContext: { source: 'other', result: 'x' } });
        runCopilotResearchCompletion(run, 'completed');
        await flush();

        expect(createDocument).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
    });

    it('still posts an update when there is no synthesized answer to store', async () => {
        const run = copilotResearchRun({
            missionContext: { source: 'copilot_research', question: 'q', requestedByUserId: 'user-1' },
        });
        runCopilotResearchCompletion(run, 'completed');
        await flush();

        expect(createDocument).not.toHaveBeenCalled();
        expect(publish).toHaveBeenCalledTimes(1);
    });
});
