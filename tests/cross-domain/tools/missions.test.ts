/**
 * MISSION_TOOLS tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MISSION_TOOLS } from '../../../server/domain/tools/v1/capabilities/missions.js';

const mockUpdateBlackboard = vi.fn();
const mockGetMissionDetail = vi.fn();
const mockAddSharedMemory = vi.fn();
const mockLaunchMission = vi.fn();

vi.mock('../../../server/domain/mission/index.js', () => ({
    missionService: {
        updateBlackboard: (...args: unknown[]) => mockUpdateBlackboard(...args),
        getMissionDetail: (...args: unknown[]) => mockGetMissionDetail(...args),
        addSharedMemory: (...args: unknown[]) => mockAddSharedMemory(...args),
        launchMission: (...args: unknown[]) => mockLaunchMission(...args),
    },
}));

describe('MISSION_TOOLS', () => {
    const missionContext = { missionId: 5, userId: 'user-1', organizationId: 1 };

    beforeEach(() => {
        vi.clearAllMocks();
        mockUpdateBlackboard.mockResolvedValue(undefined);
        mockGetMissionDetail.mockResolvedValue({ blackboard: { key: 'value' } });
        mockAddSharedMemory.mockResolvedValue(undefined);
        mockLaunchMission.mockResolvedValue({ success: true, missionRunId: 100 });
    });

    describe('update_blackboard', () => {
        it('returns error when no missionId in context', async () => {
            const result = await MISSION_TOOLS.update_blackboard.execute!(
                { content: { foo: 'bar' }, reason: 'test' },
                {}
            );
            expect(result).toContain('not part of a mission');
            expect(mockUpdateBlackboard).not.toHaveBeenCalled();
        });

        it('calls missionService.updateBlackboard and returns success', async () => {
            const result = await MISSION_TOOLS.update_blackboard.execute!(
                { content: { finding: 'data' }, reason: 'Step 1 complete' },
                missionContext
            );
            expect(result).toBe('Blackboard updated successfully.');
            expect(mockUpdateBlackboard).toHaveBeenCalledWith(5, { finding: 'data' }, 'user-1', 'Step 1 complete');
        });

        it('uses agent as userId when missing', async () => {
            await MISSION_TOOLS.update_blackboard.execute!(
                { content: {}, reason: 'ok' },
                { missionId: 5 }
            );
            expect(mockUpdateBlackboard).toHaveBeenCalledWith(5, {}, 'agent', 'ok');
        });

        it('returns error message on failure', async () => {
            mockUpdateBlackboard.mockRejectedValue(new Error('DB error'));
            const result = await MISSION_TOOLS.update_blackboard.execute!(
                { content: {}, reason: 'ok' },
                missionContext
            );
            expect(result).toContain('Failed to update blackboard');
            expect(result).toContain('DB error');
        });
    });

    describe('get_blackboard', () => {
        it('returns error when no missionId in context', async () => {
            const result = await MISSION_TOOLS.get_blackboard.execute!({}, {});
            expect(result).toContain('not part of a mission');
            expect(mockGetMissionDetail).not.toHaveBeenCalled();
        });

        it('returns blackboard as JSON string', async () => {
            const result = await MISSION_TOOLS.get_blackboard.execute!({}, missionContext);
            expect(result).toContain('"key"');
            expect(result).toContain('"value"');
            expect(mockGetMissionDetail).toHaveBeenCalledWith(5);
        });

        it('returns Mission not found when getMissionDetail returns null', async () => {
            mockGetMissionDetail.mockResolvedValue(null);
            const result = await MISSION_TOOLS.get_blackboard.execute!({}, missionContext);
            expect(result).toBe('Mission not found.');
        });

        it('returns error message on failure', async () => {
            mockGetMissionDetail.mockRejectedValue(new Error('Network error'));
            const result = await MISSION_TOOLS.get_blackboard.execute!({}, missionContext);
            expect(result).toContain('Failed to read blackboard');
        });
    });

    describe('add_shared_memory', () => {
        it('returns error when no missionId in context', async () => {
            const result = await MISSION_TOOLS.add_shared_memory.execute!(
                { observation: 'Found X' },
                {}
            );
            expect(result).toContain('not part of a mission');
            expect(mockAddSharedMemory).not.toHaveBeenCalled();
        });

        it('calls missionService.addSharedMemory with observation', async () => {
            const result = await MISSION_TOOLS.add_shared_memory.execute!(
                { observation: 'Found API key in cred 5', source: 'job-7' },
                missionContext
            );
            expect(result).toContain('Shared memory added');
            expect(mockAddSharedMemory).toHaveBeenCalledWith(5, 'Found API key in cred 5', 'job-7', 'user-1');
        });

        it('uses job-{jobId} as source when source not provided', async () => {
            await MISSION_TOOLS.add_shared_memory.execute!(
                { observation: 'test' },
                { missionId: 5, jobId: 42 }
            );
            expect(mockAddSharedMemory).toHaveBeenCalledWith(5, 'test', 'job-42', 'agent');
        });
    });

    describe('launch_mission', () => {
        it('returns error when no missionId in context', async () => {
            const result = await MISSION_TOOLS.launch_mission.execute!({ reason: 'start' }, {});
            expect(result).toContain('not part of a mission');
            expect(mockLaunchMission).not.toHaveBeenCalled();
        });

        it('returns success message with execution ID', async () => {
            const result = await MISSION_TOOLS.launch_mission.execute!(
                { reason: 'User requested start' },
                missionContext
            );
            expect(result).toContain('Mission Launched Successfully');
            expect(result).toContain('100');
            expect(mockLaunchMission).toHaveBeenCalledWith(5, 'user-1', 1, undefined, undefined);
        });

        it('returns failure message when launchMission returns success: false', async () => {
            mockLaunchMission.mockResolvedValue({ success: false, error: 'No members' });
            const result = await MISSION_TOOLS.launch_mission.execute!(
                { reason: 'start' },
                missionContext
            );
            expect(result).toContain('Failed to launch mission');
            expect(result).toContain('No members');
        });

        it('returns error message on exception', async () => {
            mockLaunchMission.mockRejectedValue(new Error('Timeout'));
            const result = await MISSION_TOOLS.launch_mission.execute!(
                { reason: 'start' },
                missionContext
            );
            expect(result).toContain('Error launching mission');
            expect(result).toContain('Timeout');
        });
    });
});
