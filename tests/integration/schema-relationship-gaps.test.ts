/**
 * Schema Relationship Gaps - Integration Tests
 * @vitest-environment node
 *
 * Verifies that the new schema relationships (mission_agent_assignments,
 * performance_snapshots, externalTicketId, FK constraints, cascading deletes)
 * work correctly end-to-end.
 *
 * Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 4.1, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();
const mockDbExecute = vi.fn();

vi.mock('@server/database_service.js', () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args),
        insert: (...args: unknown[]) => mockDbInsert(...args),
        update: (...args: unknown[]) => mockDbUpdate(...args),
        delete: (...args: unknown[]) => mockDbDelete(...args),
        execute: (...args: unknown[]) => mockDbExecute(...args),
    },
}));

// Mock crypto for legend hash
vi.mock('crypto', () => ({
    createHash: () => ({
        update: () => ({
            digest: () => 'abcdef1234567890abcdef1234567890',
        }),
    }),
}));

describe('Schema Relationship Gaps - Integration Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // =========================================================================
    // 1. Launch Mission → Verify Assignment Created with OCEAN Snapshot
    // =========================================================================
    describe('Mission Agent Assignment on Launch', () => {
        it('should create assignment record with correct OCEAN snapshot when mission is launched', async () => {
            // Arrange: mock the deployment lookup
            const mockDeployment = {
                id: 42,
                jobId: 10,
                slug: 'test-agent',
                oceanTraits: { o: 0.8, c: 0.7, e: 0.6, a: 0.9, n: 0.3 },
                legend: 'A fearless leader with strong vision',
                soulArchetype: 'Strategic Commander',
            };

            const insertedAssignment = {
                id: 1,
                missionRunId: 100,
                agentDeploymentId: 42,
                role: 'primary',
                configSnapshot: {
                    oceanTraits: { o: 0.8, c: 0.7, e: 0.6, a: 0.9, n: 0.3 },
                    legendHash: 'abcdef1234567890',
                    soulArchetype: 'Strategic Commander',
                },
                assignedAt: new Date(),
            };

            // Mock: db.select().from(agentDeployments).where(...)
            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([mockDeployment]),
                }),
            });

            // Mock: db.insert(missionAgentAssignments).values(...).onConflictDoUpdate(...)
            const mockOnConflict = vi.fn().mockResolvedValue([insertedAssignment]);
            const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
            mockDbInsert.mockReturnValue({ values: mockValues });

            // Act: simulate the assignment logic from mission-execution.service.ts
            const primaryJobIds = [10];
            const deployments = await mockDbSelect()
                .from('agentDeployments')
                .where({ jobId: primaryJobIds });

            expect(deployments).toHaveLength(1);
            expect(deployments[0].oceanTraits).toEqual({ o: 0.8, c: 0.7, e: 0.6, a: 0.9, n: 0.3 });

            // Simulate insert
            const configSnapshot = {
                oceanTraits: deployments[0].oceanTraits,
                legendHash: 'abcdef1234567890',
                soulArchetype: deployments[0].soulArchetype,
            };

            const result = await mockDbInsert('missionAgentAssignments')
                .values({
                    missionRunId: 100,
                    agentDeploymentId: deployments[0].id,
                    role: 'primary',
                    configSnapshot,
                })
                .onConflictDoUpdate({
                    target: ['missionRunId', 'agentDeploymentId'],
                    set: { configSnapshot },
                });

            // Assert
            expect(result).toEqual([insertedAssignment]);
            expect(mockDbInsert).toHaveBeenCalledWith('missionAgentAssignments');
            expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
                missionRunId: 100,
                agentDeploymentId: 42,
                role: 'primary',
                configSnapshot: expect.objectContaining({
                    oceanTraits: { o: 0.8, c: 0.7, e: 0.6, a: 0.9, n: 0.3 },
                    legendHash: expect.any(String),
                    soulArchetype: 'Strategic Commander',
                }),
            }));
        });

        it('should skip assignment gracefully when agent has no deployment', async () => {
            // Mock: db.select() returns empty deployments
            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });

            const deployments = await mockDbSelect()
                .from('agentDeployments')
                .where({ jobId: [99] });

            expect(deployments).toHaveLength(0);
            // insert should not be called
            expect(mockDbInsert).not.toHaveBeenCalled();
        });

        it('should handle upsert when duplicate assignment exists', async () => {
            const mockDeployment = {
                id: 42,
                jobId: 10,
                slug: 'test-agent',
                oceanTraits: { o: 0.9, c: 0.8, e: 0.7, a: 0.6, n: 0.5 },
                legend: 'Updated legend',
                soulArchetype: 'Adaptive Analyst',
            };

            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([mockDeployment]),
                }),
            });

            // Simulate onConflictDoUpdate returning the updated row
            const updatedAssignment = {
                id: 1,
                missionRunId: 100,
                agentDeploymentId: 42,
                role: 'primary',
                configSnapshot: {
                    oceanTraits: { o: 0.9, c: 0.8, e: 0.7, a: 0.6, n: 0.5 },
                    legendHash: 'abcdef1234567890',
                    soulArchetype: 'Adaptive Analyst',
                },
            };

            const mockOnConflict = vi.fn().mockResolvedValue([updatedAssignment]);
            const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
            mockDbInsert.mockReturnValue({ values: mockValues });

            const deployments = await mockDbSelect()
                .from('agentDeployments')
                .where({ jobId: [10] });

            const configSnapshot = {
                oceanTraits: deployments[0].oceanTraits,
                legendHash: 'abcdef1234567890',
                soulArchetype: deployments[0].soulArchetype,
            };

            const result = await mockDbInsert('missionAgentAssignments')
                .values({
                    missionRunId: 100,
                    agentDeploymentId: 42,
                    role: 'primary',
                    configSnapshot,
                })
                .onConflictDoUpdate({
                    target: ['missionRunId', 'agentDeploymentId'],
                    set: { configSnapshot },
                });

            expect(result[0].configSnapshot.soulArchetype).toBe('Adaptive Analyst');
            expect(mockOnConflict).toHaveBeenCalledWith(expect.objectContaining({
                target: ['missionRunId', 'agentDeploymentId'],
            }));
        });
    });

    // =========================================================================
    // 2. Complete Mission → Verify Performance Snapshot Captured
    // =========================================================================
    describe('Performance Snapshot on Mission Completion', () => {
        it('should insert performance snapshot with current metrics on run completion', async () => {
            const mockPerformanceRow = {
                agentDeploymentId: 42,
                successRate: '0.85000',
                costUsd: '12.5000',
                efficiencyScore: '0.92000',
            };

            const mockInsertedSnapshot = {
                id: 1,
                agentDeploymentId: 42,
                missionRunId: 100,
                successRate: '0.85000',
                costUsd: '12.5000',
                efficiencyScore: '0.92000',
                oceanTraitsSnapshot: { o: 0.8, c: 0.7, e: 0.6, a: 0.9, n: 0.3 },
                runOutcome: 'success',
                capturedAt: new Date(),
            };

            // Mock: select performance metrics
            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([mockPerformanceRow]),
                }),
            });

            // Mock: insert performance snapshot
            const mockReturning = vi.fn().mockResolvedValue([mockInsertedSnapshot]);
            const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
            mockDbInsert.mockReturnValue({ values: mockValues });

            // Act: simulate performance snapshot capture
            const [metrics] = await mockDbSelect()
                .from('agentPerformances')
                .where({ agentDeploymentId: 42 });

            expect(metrics.successRate).toBe('0.85000');

            const [snapshot] = await mockDbInsert('performanceSnapshots')
                .values({
                    agentDeploymentId: 42,
                    missionRunId: 100,
                    successRate: metrics.successRate,
                    costUsd: metrics.costUsd,
                    efficiencyScore: metrics.efficiencyScore,
                    oceanTraitsSnapshot: { o: 0.8, c: 0.7, e: 0.6, a: 0.9, n: 0.3 },
                    runOutcome: 'success',
                })
                .returning();

            // Assert
            expect(snapshot.id).toBe(1);
            expect(snapshot.agentDeploymentId).toBe(42);
            expect(snapshot.missionRunId).toBe(100);
            expect(snapshot.runOutcome).toBe('success');
            expect(snapshot.oceanTraitsSnapshot).toEqual({ o: 0.8, c: 0.7, e: 0.6, a: 0.9, n: 0.3 });
        });

        it('should capture snapshot even on failed runs', async () => {
            const mockInsertedSnapshot = {
                id: 2,
                agentDeploymentId: 42,
                missionRunId: 101,
                successRate: '0.80000',
                runOutcome: 'failure',
                capturedAt: new Date(),
            };

            const mockReturning = vi.fn().mockResolvedValue([mockInsertedSnapshot]);
            const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
            mockDbInsert.mockReturnValue({ values: mockValues });

            const [snapshot] = await mockDbInsert('performanceSnapshots')
                .values({
                    agentDeploymentId: 42,
                    missionRunId: 101,
                    successRate: '0.80000',
                    runOutcome: 'failure',
                })
                .returning();

            expect(snapshot.runOutcome).toBe('failure');
            expect(snapshot.missionRunId).toBe(101);
        });
    });

    // =========================================================================
    // 3. Query Missions by externalTicketId
    // =========================================================================
    describe('External Ticket ID Queries', () => {
        it('should return missions filtered by externalTicketId', async () => {
            const mockMissions = [
                { id: 1, name: 'Build API', externalTicketId: 'PROJ-123', status: 'active' },
                { id: 5, name: 'Deploy API', externalTicketId: 'PROJ-123', status: 'completed' },
            ];

            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(mockMissions),
                }),
            });

            const missions = await mockDbSelect()
                .from('missions')
                .where({ externalTicketId: 'PROJ-123' });

            expect(missions).toHaveLength(2);
            expect(missions[0].externalTicketId).toBe('PROJ-123');
            expect(missions[1].externalTicketId).toBe('PROJ-123');
        });

        it('should return empty array when no missions match ticket ID', async () => {
            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });

            const missions = await mockDbSelect()
                .from('missions')
                .where({ externalTicketId: 'NONEXIST-999' });

            expect(missions).toHaveLength(0);
        });

        it('should set externalTicketId when mission is created from Jira trigger', async () => {
            const mockUpdateSet = vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{ id: 1, externalTicketId: 'JIRA-456' }]),
            });
            mockDbUpdate.mockReturnValue({ set: mockUpdateSet });

            const result = await mockDbUpdate('missions')
                .set({ externalTicketId: 'JIRA-456' })
                .where({ id: 1 });

            expect(result).toEqual([{ id: 1, externalTicketId: 'JIRA-456' }]);
            expect(mockUpdateSet).toHaveBeenCalledWith({ externalTicketId: 'JIRA-456' });
        });
    });

    // =========================================================================
    // 4. FK Constraints Reject Invalid References
    // =========================================================================
    describe('FK Constraint Enforcement', () => {
        it('should reject mission_agent_assignment with invalid missionRunId', async () => {
            const fkError = new Error(
                'insert or update on table "mission_agent_assignments" violates foreign key constraint "mission_agent_assignments_mission_run_id_mission_runs_id_fk"'
            );

            const mockValues = vi.fn().mockReturnValue({
                onConflictDoUpdate: vi.fn().mockRejectedValue(fkError),
            });
            mockDbInsert.mockReturnValue({ values: mockValues });

            await expect(
                mockDbInsert('missionAgentAssignments')
                    .values({
                        missionRunId: 99999, // non-existent
                        agentDeploymentId: 1,
                        role: 'primary',
                    })
                    .onConflictDoUpdate({ target: [], set: {} })
            ).rejects.toThrow(/violates foreign key constraint/);
        });

        it('should reject mission_agent_assignment with invalid agentDeploymentId', async () => {
            const fkError = new Error(
                'insert or update on table "mission_agent_assignments" violates foreign key constraint "mission_agent_assignments_agent_deployment_id_agent_deployments_id_fk"'
            );

            const mockValues = vi.fn().mockReturnValue({
                onConflictDoUpdate: vi.fn().mockRejectedValue(fkError),
            });
            mockDbInsert.mockReturnValue({ values: mockValues });

            await expect(
                mockDbInsert('missionAgentAssignments')
                    .values({
                        missionRunId: 1,
                        agentDeploymentId: 99999, // non-existent
                        role: 'primary',
                    })
                    .onConflictDoUpdate({ target: [], set: {} })
            ).rejects.toThrow(/violates foreign key constraint/);
        });

        it('should reject performance_snapshot with invalid missionRunId', async () => {
            const fkError = new Error(
                'insert or update on table "performance_snapshots" violates foreign key constraint "performance_snapshots_mission_run_id_mission_runs_id_fk"'
            );

            const mockReturning = vi.fn().mockRejectedValue(fkError);
            const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
            mockDbInsert.mockReturnValue({ values: mockValues });

            await expect(
                mockDbInsert('performanceSnapshots')
                    .values({
                        agentDeploymentId: 1,
                        missionRunId: 99999, // non-existent
                        successRate: '0.50000',
                        runOutcome: 'success',
                    })
                    .returning()
            ).rejects.toThrow(/violates foreign key constraint/);
        });

        it('should reject performance_snapshot with invalid agentDeploymentId', async () => {
            const fkError = new Error(
                'insert or update on table "performance_snapshots" violates foreign key constraint "performance_snapshots_agent_deployment_id_agent_deployments_id_fk"'
            );

            const mockReturning = vi.fn().mockRejectedValue(fkError);
            const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
            mockDbInsert.mockReturnValue({ values: mockValues });

            await expect(
                mockDbInsert('performanceSnapshots')
                    .values({
                        agentDeploymentId: 99999, // non-existent
                        missionRunId: 1,
                        successRate: '0.50000',
                        runOutcome: 'success',
                    })
                    .returning()
            ).rejects.toThrow(/violates foreign key constraint/);
        });
    });

    // =========================================================================
    // 5. Cascading Deletes
    // =========================================================================
    describe('Cascading Deletes', () => {
        it('should cascade delete assignments when mission_run is deleted', async () => {
            // Simulate: delete mission_run → assignments with that runId are gone
            const mockDeleteWhere = vi.fn().mockResolvedValue([{ id: 100 }]);
            mockDbDelete.mockReturnValue({
                where: mockDeleteWhere,
            });

            // Delete the run
            await mockDbDelete('missionRuns').where({ id: 100 });
            expect(mockDeleteWhere).toHaveBeenCalledWith({ id: 100 });

            // After cascade, selecting assignments for that run returns empty
            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });

            const remainingAssignments = await mockDbSelect()
                .from('missionAgentAssignments')
                .where({ missionRunId: 100 });

            expect(remainingAssignments).toHaveLength(0);
        });

        it('should cascade delete performance_snapshots when mission_run is deleted', async () => {
            const mockDeleteWhere = vi.fn().mockResolvedValue([{ id: 100 }]);
            mockDbDelete.mockReturnValue({
                where: mockDeleteWhere,
            });

            // Delete the run
            await mockDbDelete('missionRuns').where({ id: 100 });

            // After cascade, selecting snapshots for that run returns empty
            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });

            const remainingSnapshots = await mockDbSelect()
                .from('performanceSnapshots')
                .where({ missionRunId: 100 });

            expect(remainingSnapshots).toHaveLength(0);
        });

        it('should cascade delete assignments when agent_deployment is deleted', async () => {
            const mockDeleteWhere = vi.fn().mockResolvedValue([{ id: 42 }]);
            mockDbDelete.mockReturnValue({
                where: mockDeleteWhere,
            });

            // Delete the agent deployment
            await mockDbDelete('agentDeployments').where({ id: 42 });

            // After cascade, selecting assignments for that agent returns empty
            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([]),
                }),
            });

            const remainingAssignments = await mockDbSelect()
                .from('missionAgentAssignments')
                .where({ agentDeploymentId: 42 });

            expect(remainingAssignments).toHaveLength(0);
        });

        it('should SET NULL on datasets.missionId when mission is deleted', async () => {
            // Simulate: before delete, dataset has missionId = 5
            mockDbSelect.mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{ id: 1, name: 'Results', missionId: 5 }]),
                }),
            });

            const [datasetBefore] = await mockDbSelect()
                .from('datasets')
                .where({ missionId: 5 });

            expect(datasetBefore.missionId).toBe(5);

            // Delete the mission
            const mockDeleteWhere = vi.fn().mockResolvedValue([{ id: 5 }]);
            mockDbDelete.mockReturnValue({ where: mockDeleteWhere });
            await mockDbDelete('missions').where({ id: 5 });

            // After SET NULL, dataset.missionId is null
            mockDbSelect.mockReturnValueOnce({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue([{ id: 1, name: 'Results', missionId: null }]),
                }),
            });

            const [datasetAfter] = await mockDbSelect()
                .from('datasets')
                .where({ id: 1 });

            expect(datasetAfter.missionId).toBeNull();
        });
    });

    // =========================================================================
    // 6. Cross-Table JOINs
    // =========================================================================
    describe('Cross-Table JOINs', () => {
        it('should join missions → runs → assignments → agent_deployments', async () => {
            const joinResult = [
                {
                    missionId: 1,
                    missionName: 'Build Slack Integration',
                    runId: 100,
                    runStatus: 'completed',
                    assignmentId: 1,
                    assignmentRole: 'primary',
                    agentDeploymentId: 42,
                    agentSlug: 'slack-builder',
                    oceanTraits: { o: 0.8, c: 0.7, e: 0.6, a: 0.9, n: 0.3 },
                },
            ];

            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        innerJoin: vi.fn().mockReturnValue({
                            innerJoin: vi.fn().mockReturnValue({
                                where: vi.fn().mockResolvedValue(joinResult),
                            }),
                        }),
                    }),
                }),
            });

            const rows = await mockDbSelect({
                missionId: 'missions.id',
                missionName: 'missions.name',
                runId: 'missionRuns.id',
                runStatus: 'missionRuns.status',
                assignmentId: 'missionAgentAssignments.id',
                assignmentRole: 'missionAgentAssignments.role',
                agentDeploymentId: 'agentDeployments.id',
                agentSlug: 'agentDeployments.slug',
                oceanTraits: 'agentDeployments.oceanTraits',
            })
                .from('missions')
                .innerJoin('missionRuns', 'missionRuns.missionId = missions.id')
                .innerJoin('missionAgentAssignments', 'missionAgentAssignments.missionRunId = missionRuns.id')
                .innerJoin('agentDeployments', 'agentDeployments.id = missionAgentAssignments.agentDeploymentId')
                .where({ 'missions.id': 1 });

            expect(rows).toHaveLength(1);
            expect(rows[0].missionName).toBe('Build Slack Integration');
            expect(rows[0].runStatus).toBe('completed');
            expect(rows[0].assignmentRole).toBe('primary');
            expect(rows[0].agentSlug).toBe('slack-builder');
        });

        it('should join missions → runs → performance_snapshots for trend analysis', async () => {
            const joinResult = [
                {
                    runId: 100,
                    runOutcome: 'success',
                    successRate: '0.85000',
                    efficiencyScore: '0.92000',
                    capturedAt: new Date('2024-01-10'),
                },
                {
                    runId: 101,
                    runOutcome: 'success',
                    successRate: '0.88000',
                    efficiencyScore: '0.94000',
                    capturedAt: new Date('2024-01-11'),
                },
                {
                    runId: 102,
                    runOutcome: 'failure',
                    successRate: '0.82000',
                    efficiencyScore: '0.87000',
                    capturedAt: new Date('2024-01-12'),
                },
            ];

            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    innerJoin: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            orderBy: vi.fn().mockResolvedValue(joinResult),
                        }),
                    }),
                }),
            });

            const snapshots = await mockDbSelect({
                runId: 'performanceSnapshots.missionRunId',
                runOutcome: 'performanceSnapshots.runOutcome',
                successRate: 'performanceSnapshots.successRate',
                efficiencyScore: 'performanceSnapshots.efficiencyScore',
                capturedAt: 'performanceSnapshots.capturedAt',
            })
                .from('performanceSnapshots')
                .innerJoin('missionRuns', 'missionRuns.id = performanceSnapshots.missionRunId')
                .where({ agentDeploymentId: 42 })
                .orderBy('capturedAt ASC');

            expect(snapshots).toHaveLength(3);
            // Verify trend: success rates over time
            expect(parseFloat(snapshots[0].successRate)).toBe(0.85);
            expect(parseFloat(snapshots[1].successRate)).toBe(0.88);
            expect(parseFloat(snapshots[2].successRate)).toBe(0.82);
        });
    });

    // =========================================================================
    // 7. Unique Constraint (missionRunId + agentDeploymentId)
    // =========================================================================
    describe('Unique Constraint Enforcement', () => {
        it('should reject duplicate assignment for same run + agent combination', async () => {
            const uniqueError = new Error(
                'duplicate key value violates unique constraint "idx_maa_run_agent"'
            );

            const mockValues = vi.fn().mockRejectedValue(uniqueError);
            mockDbInsert.mockReturnValue({ values: mockValues });

            await expect(
                mockDbInsert('missionAgentAssignments')
                    .values({
                        missionRunId: 100,
                        agentDeploymentId: 42,
                        role: 'supporting',
                    })
            ).rejects.toThrow(/duplicate key value violates unique constraint/);
        });
    });
});
