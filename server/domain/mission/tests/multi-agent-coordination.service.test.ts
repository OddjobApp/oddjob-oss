/**
 * Multi-Agent Coordination Service Tests
 * 
 * Comprehensive test suite for agent collaboration features.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    multiAgentCoordinationService,
    type Agent,
    type AgentRole,
    type AgentTask,
    type ConsensusProposal,
    type AgentConflict,
} from "../core/multi-agent-coordination.service.js";

// Mock dependencies
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    }),
}));

vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
    eventStream: {
        publish: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock("./mission-correlation.service.js", () => ({
    missionCorrelationService: {
        getCorrelationId: vi.fn().mockReturnValue("corr_test_123"),
    },
}));

describe("MultiAgentCoordinationService", () => {
    const TEST_MISSION_ID = 123;

    beforeEach(() => {
        multiAgentCoordinationService.clearAll();
    });

    describe("createAgent", () => {
        it("should create agent with correct role", () => {
            const agent = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "TestPlanner",
                "planner"
            );

            expect(agent).toBeDefined();
            expect(agent.name).toBe("TestPlanner");
            expect(agent.role).toBe("planner");
            expect(agent.missionId).toBe(TEST_MISSION_ID);
        });

        it("should assign correct capabilities based on role", () => {
            const planner = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Planner",
                "planner"
            );

            expect(planner.capabilities.canPlan).toBe(true);
            expect(planner.capabilities.canExecute).toBe(false);
            expect(planner.capabilities.canMakeDecisions).toBe(true);
        });

        it("should create executor with different capabilities", () => {
            const executor = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Executor",
                "executor"
            );

            expect(executor.capabilities.canPlan).toBe(false);
            expect(executor.capabilities.canExecute).toBe(true);
            expect(executor.capabilities.canMakeDecisions).toBe(false);
        });

        it("should support all roles", () => {
            const roles: AgentRole[] = ['planner', 'executor', 'reviewer', 'specialist', 'coordinator'];
            
            for (const role of roles) {
                const agent = multiAgentCoordinationService.createAgent(
                    TEST_MISSION_ID,
                    `${role}Agent`,
                    role
                );
                expect(agent.role).toBe(role);
            }
        });

        it("should accept custom capabilities", () => {
            const agent = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "CustomAgent",
                "planner",
                { specialties: ["ai", "ml"] }
            );

            expect(agent.capabilities.specialties).toContain("ai");
            expect(agent.capabilities.specialties).toContain("ml");
        });

        it("should start with idle status", () => {
            const agent = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "IdleAgent",
                "planner"
            );

            expect(agent.status).toBe("idle");
        });

        it("should generate unique IDs", () => {
            const agent1 = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Agent1",
                "planner"
            );
            const agent2 = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Agent2",
                "planner"
            );

            expect(agent1.id).not.toBe(agent2.id);
        });
    });

    describe("getAgent", () => {
        it("should return agent by ID", () => {
            const created = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Test",
                "planner"
            );

            const retrieved = multiAgentCoordinationService.getAgent(created.id);

            expect(retrieved).toEqual(created);
        });

        it("should return undefined for unknown ID", () => {
            const agent = multiAgentCoordinationService.getAgent("non-existent");
            expect(agent).toBeUndefined();
        });
    });

    describe("getAgentsForMission", () => {
        it("should return agents for specific mission", () => {
            multiAgentCoordinationService.createAgent(1, "Mission1Agent", "planner");
            multiAgentCoordinationService.createAgent(2, "Mission2Agent", "executor");

            const agents = multiAgentCoordinationService.getAgentsForMission(1);

            expect(agents.length).toBe(1);
            expect(agents[0].name).toBe("Mission1Agent");
        });

        it("should return empty array for mission with no agents", () => {
            const agents = multiAgentCoordinationService.getAgentsForMission(999);
            expect(agents).toEqual([]);
        });

        it("should sort by creation time", () => {
            multiAgentCoordinationService.createAgent(TEST_MISSION_ID, "First", "planner");
            multiAgentCoordinationService.createAgent(TEST_MISSION_ID, "Second", "executor");

            const agents = multiAgentCoordinationService.getAgentsForMission(TEST_MISSION_ID);

            expect(agents[0].name).toBe("First");
            expect(agents[1].name).toBe("Second");
        });
    });

    describe("updateAgentStatus", () => {
        it("should update agent status", () => {
            const agent = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Test",
                "planner"
            );

            const updated = multiAgentCoordinationService.updateAgentStatus(agent.id, "working");

            expect(updated?.status).toBe("working");
        });

        it("should update lastActiveAt", () => {
            const agent = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Test",
                "planner"
            );
            const beforeUpdate = agent.lastActiveAt;

            multiAgentCoordinationService.updateAgentStatus(agent.id, "working");

            expect(agent.lastActiveAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
        });

        it("should return undefined for unknown agent", () => {
            const result = multiAgentCoordinationService.updateAgentStatus("non-existent", "working");
            expect(result).toBeUndefined();
        });
    });

    describe("sendMessage", () => {
        it("should send direct message", () => {
            const sender = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Sender",
                "planner"
            );
            const receiver = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Receiver",
                "executor"
            );

            const message = multiAgentCoordinationService.sendMessage(sender.id, {
                toAgentId: receiver.id,
                type: "information_share",
                content: "Hello!",
                priority: "medium",
            });

            expect(message).toBeDefined();
            expect(message.content).toBe("Hello!");
            expect(message.toAgentId).toBe(receiver.id);
        });

        it("should broadcast to all agents when toAgentId not specified", () => {
            const sender = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Sender",
                "planner"
            );
            const receiver1 = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Receiver1",
                "executor"
            );
            const receiver2 = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Receiver2",
                "reviewer"
            );

            multiAgentCoordinationService.sendMessage(sender.id, {
                type: "information_share",
                content: "Broadcast message",
                priority: "low",
            });

            expect(receiver1.messages.length).toBe(1);
            expect(receiver2.messages.length).toBe(1);
        });

        it("should add message to sender's message list", () => {
            const sender = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Sender",
                "planner"
            );

            multiAgentCoordinationService.sendMessage(sender.id, {
                type: "information_share",
                content: "Test",
                priority: "low",
            });

            expect(sender.messages.length).toBe(1);
        });

        it("should throw error for unknown sender", () => {
            expect(() => {
                multiAgentCoordinationService.sendMessage("non-existent", {
                    type: "information_share",
                    content: "Test",
                    priority: "low",
                });
            }).toThrow();
        });

        it("should generate unique message IDs", () => {
            const sender = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Sender",
                "planner"
            );

            const msg1 = multiAgentCoordinationService.sendMessage(sender.id, {
                type: "information_share",
                content: "First",
                priority: "low",
            });

            const msg2 = multiAgentCoordinationService.sendMessage(sender.id, {
                type: "information_share",
                content: "Second",
                priority: "low",
            });

            expect(msg1.id).not.toBe(msg2.id);
        });
    });

    describe("getMessages", () => {
        it("should return messages for agent", () => {
            const agent1 = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Agent1",
                "planner"
            );
            const agent2 = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Agent2",
                "executor"
            );

            multiAgentCoordinationService.sendMessage(agent1.id, {
                toAgentId: agent2.id,
                type: "task_assignment",
                content: "Do this",
                priority: "high",
            });

            const messages = multiAgentCoordinationService.getMessages(agent2.id);

            expect(messages.length).toBe(1);
            expect(messages[0].content).toBe("Do this");
        });

        it("should filter by type", () => {
            const agent = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Agent",
                "planner"
            );

            multiAgentCoordinationService.sendMessage(agent.id, {
                type: "task_assignment",
                content: "Task",
                priority: "low",
            });

            multiAgentCoordinationService.sendMessage(agent.id, {
                type: "information_share",
                content: "Info",
                priority: "low",
            });

            const taskMessages = multiAgentCoordinationService.getMessages(agent.id, {
                type: "task_assignment",
            });

            expect(taskMessages.length).toBe(1);
            expect(taskMessages[0].type).toBe("task_assignment");
        });

        it("should return empty array for unknown agent", () => {
            const messages = multiAgentCoordinationService.getMessages("non-existent");
            expect(messages).toEqual([]);
        });
    });

    describe("createConsensusProposal", () => {
        it("should create proposal", () => {
            const proposer = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Proposer",
                "planner"
            );

            const consensus = multiAgentCoordinationService.createConsensusProposal(
                TEST_MISSION_ID,
                proposer.id,
                "Test Topic",
                "Test Proposal",
                ["option1", "option2"]
            );

            expect(consensus).toBeDefined();
            expect(consensus.topic).toBe("Test Topic");
            expect(consensus.options).toEqual(["option1", "option2"]);
            expect(consensus.status).toBe("open");
        });

        it("should notify decision-capable agents", () => {
            const planner = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Planner",
                "planner"
            );
            const executor = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Executor",
                "executor"
            );

            multiAgentCoordinationService.createConsensusProposal(
                TEST_MISSION_ID,
                planner.id,
                "Test",
                "Test",
                ["a", "b"]
            );

            // Executor cannot decide, should not receive notification
            expect(executor.messages.length).toBe(0);
        });

        it("should set default deadline", () => {
            const proposer = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Proposer",
                "planner"
            );

            const consensus = multiAgentCoordinationService.createConsensusProposal(
                TEST_MISSION_ID,
                proposer.id,
                "Test",
                "Test",
                ["a"]
            );

            expect(consensus.deadline.getTime()).toBeGreaterThan(Date.now());
        });
    });

    describe("castVote", () => {
        it("should record vote", () => {
            const proposer = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Proposer",
                "planner"
            );
            const voter = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Voter",
                "reviewer"
            );

            const consensus = multiAgentCoordinationService.createConsensusProposal(
                TEST_MISSION_ID,
                proposer.id,
                "Test",
                "Test",
                ["yes", "no"]
            );

            multiAgentCoordinationService.castVote(consensus.id, voter.id, "yes");

            const updated = multiAgentCoordinationService.getConsensus(consensus.id);
            expect(updated?.votes.get(voter.id)).toBe("yes");
        });

        it("should return undefined for invalid consensus", () => {
            const result = multiAgentCoordinationService.castVote(
                "non-existent",
                "agent",
                "option"
            );
            expect(result).toBeUndefined();
        });

        it("should not allow voting on concluded proposal", () => {
            const proposer = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Proposer",
                "planner"
            );
            const voter1 = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Voter1",
                "reviewer"
            );
            const voter2 = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Voter2",
                "specialist"
            );

            const consensus = multiAgentCoordinationService.createConsensusProposal(
                TEST_MISSION_ID,
                proposer.id,
                "Test",
                "Test",
                ["yes", "no"],
                { conclusionThreshold: 0.5 }
            );

            // Cast votes to conclude
            multiAgentCoordinationService.castVote(consensus.id, proposer.id, "yes");
            multiAgentCoordinationService.castVote(consensus.id, voter1.id, "yes");

            // Try to vote on concluded
            const result = multiAgentCoordinationService.castVote(
                consensus.id,
                voter2.id,
                "no"
            );

            // Should return undefined when trying to vote on concluded proposal
            expect(result).toBeUndefined();
        });
    });

    describe("assignTask", () => {
        it("should create task", () => {
            const assigner = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Assigner",
                "planner"
            );
            const assignee = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Assignee",
                "executor"
            );

            const task = multiAgentCoordinationService.assignTask(
                TEST_MISSION_ID,
                assigner.id,
                assignee.id,
                "Do something"
            );

            expect(task).toBeDefined();
            expect(task.description).toBe("Do something");
            expect(task.status).toBe("pending");
        });

        it("should update agent status to working", () => {
            const assigner = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Assigner",
                "planner"
            );
            const assignee = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Assignee",
                "executor"
            );

            multiAgentCoordinationService.assignTask(
                TEST_MISSION_ID,
                assigner.id,
                assignee.id,
                "Task"
            );

            expect(assignee.status).toBe("working");
            expect(assignee.currentTasks.length).toBe(1);
        });

        it("should notify assignee", () => {
            const assigner = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Assigner",
                "planner"
            );
            const assignee = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Assignee",
                "executor"
            );

            multiAgentCoordinationService.assignTask(
                TEST_MISSION_ID,
                assigner.id,
                assignee.id,
                "Important task"
            );

            expect(assignee.messages.length).toBe(1);
            expect(assignee.messages[0].type).toBe("task_assignment");
        });
    });

    describe("updateTaskStatus", () => {
        it("should update status", () => {
            const assigner = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Assigner",
                "planner"
            );
            const assignee = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Assignee",
                "executor"
            );

            const task = multiAgentCoordinationService.assignTask(
                TEST_MISSION_ID,
                assigner.id,
                assignee.id,
                "Task"
            );

            const updated = multiAgentCoordinationService.updateTaskStatus(
                task.id,
                "in_progress"
            );

            expect(updated?.status).toBe("in_progress");
            expect(updated?.startedAt).toBeDefined();
        });

        it("should notify assigner of completion", () => {
            const assigner = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Assigner",
                "planner"
            );
            const assignee = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Assignee",
                "executor"
            );

            const task = multiAgentCoordinationService.assignTask(
                TEST_MISSION_ID,
                assigner.id,
                assignee.id,
                "Task"
            );

            const beforeCount = assigner.messages.length;

            multiAgentCoordinationService.updateTaskStatus(task.id, "completed");

            expect(assigner.messages.length).toBe(beforeCount + 1);
        });

        it("should send to reviewer if assigned", () => {
            const assigner = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Assigner",
                "planner"
            );
            const assignee = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Assignee",
                "executor"
            );
            const reviewer = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Reviewer",
                "reviewer"
            );

            const task = multiAgentCoordinationService.assignTask(
                TEST_MISSION_ID,
                assigner.id,
                assignee.id,
                "Task",
                { reviewBy: reviewer.id }
            );

            multiAgentCoordinationService.updateTaskStatus(task.id, "completed");

            // Reviewer should have received a review request
            const reviewMessages = reviewer.messages.filter(
                m => m.type === "review_request"
            );
            expect(reviewMessages.length).toBe(1);
        });
    });

    describe("detectConflict", () => {
        it("should create conflict record", () => {
            const agent1 = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Agent1",
                "planner"
            );
            const agent2 = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Agent2",
                "executor"
            );

            const conflict = multiAgentCoordinationService.detectConflict(
                TEST_MISSION_ID,
                [agent1.id, agent2.id],
                "approach_disagreement",
                "They disagree",
                "medium"
            );

            expect(conflict).toBeDefined();
            expect(conflict.type).toBe("approach_disagreement");
            expect(conflict.agents).toContain(agent1.id);
            expect(conflict.agents).toContain(agent2.id);
        });

        it("should notify coordinator if exists", () => {
            const coordinator = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Coordinator",
                "coordinator"
            );
            const agent1 = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Agent1",
                "planner"
            );
            const agent2 = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Agent2",
                "executor"
            );

            multiAgentCoordinationService.detectConflict(
                TEST_MISSION_ID,
                [agent1.id, agent2.id],
                "task_dispute",
                "Task ownership dispute",
                "high"
            );

            const conflictMessages = coordinator.messages.filter(
                m => m.type === "conflict_notification"
            );
            expect(conflictMessages.length).toBe(1);
        });

        it("should support all conflict types", () => {
            const types: AgentConflict['type'][] = [
                'task_dispute',
                'resource_contention',
                'approach_disagreement',
                'priority_conflict',
                'deadlock'
            ];

            const agent1 = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Agent1",
                "planner"
            );
            const agent2 = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Agent2",
                "executor"
            );

            for (const type of types) {
                const conflict = multiAgentCoordinationService.detectConflict(
                    TEST_MISSION_ID,
                    [agent1.id, agent2.id],
                    type,
                    `Test ${type}`,
                    "low"
                );
                expect(conflict.type).toBe(type);
            }
        });
    });

    describe("blackboard coordination", () => {
        it("should post and read mission-visible blackboard items", () => {
            const coordinator = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Coordinator",
                "coordinator"
            );
            const executor = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Executor",
                "executor"
            );

            const item = multiAgentCoordinationService.postBlackboardItem(
                TEST_MISSION_ID,
                coordinator.id,
                {
                    topic: "mission.goal",
                    content: "Ship the first decentralized coordination slice",
                    type: "goal",
                    priority: "critical",
                    visibility: "mission",
                    tags: ["goal"],
                }
            );

            const items = multiAgentCoordinationService.readBlackboard(
                TEST_MISSION_ID,
                executor.id,
                { topic: "mission.goal" }
            );

            expect(items).toHaveLength(1);
            expect(items[0].id).toBe(item.id);
            expect(items[0].content).toContain("coordination");
        });

        it("should honor role-targeted blackboard visibility", () => {
            const planner = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Planner",
                "planner"
            );
            const executor = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Executor",
                "executor"
            );
            const reviewer = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Reviewer",
                "reviewer"
            );

            multiAgentCoordinationService.postBlackboardItem(
                TEST_MISSION_ID,
                planner.id,
                {
                    topic: "implementation.hint",
                    content: "Use the existing mission service path",
                    type: "observation",
                    priority: "medium",
                    visibility: "role",
                    targetRole: "executor",
                    tags: ["implementation"],
                }
            );

            expect(
                multiAgentCoordinationService.readBlackboard(TEST_MISSION_ID, executor.id)
            ).toHaveLength(1);
            expect(
                multiAgentCoordinationService.readBlackboard(TEST_MISSION_ID, planner.id)
            ).toHaveLength(0);
            expect(reviewer.messages.filter(m => m.type === "blackboard_post")).toHaveLength(0);
        });

        it("should reject blackboard posts from agents outside the mission", () => {
            const agent = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Coordinator",
                "coordinator"
            );

            expect(() => {
                multiAgentCoordinationService.postBlackboardItem(999, agent.id, {
                    topic: "mission.goal",
                    content: "Wrong mission",
                    type: "goal",
                    priority: "high",
                    visibility: "mission",
                    tags: [],
                });
            }).toThrow();
        });
    });

    describe("decentralized task claiming", () => {
        it("should let an available agent claim a pending task from an offline assignee", () => {
            const coordinator = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Coordinator",
                "coordinator"
            );
            const offlineExecutor = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "OfflineExecutor",
                "executor"
            );
            const activeExecutor = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "ActiveExecutor",
                "executor"
            );

            const task = multiAgentCoordinationService.assignTask(
                TEST_MISSION_ID,
                coordinator.id,
                offlineExecutor.id,
                "Implement task claiming",
                { priority: "high" }
            );
            multiAgentCoordinationService.updateAgentStatus(offlineExecutor.id, "offline");

            const claimed = multiAgentCoordinationService.claimNextTask(
                TEST_MISSION_ID,
                activeExecutor.id
            );

            expect(claimed?.id).toBe(task.id);
            expect(claimed?.assignedTo).toBe(activeExecutor.id);
            expect(claimed?.status).toBe("in_progress");
            expect(activeExecutor.currentTasks).toContain(task.id);
            expect(offlineExecutor.currentTasks).not.toContain(task.id);
        });
    });

    describe("coordinator pool", () => {
        it("should create a coordinator pool with goal and seed tasks", () => {
            const pool = multiAgentCoordinationService.createCoordinatorPool(
                TEST_MISSION_ID,
                {
                    goal: "Coordinate a multi-agent feature build",
                    requiredRoles: ["planner", "executor", "reviewer"],
                    seedTasks: [
                        {
                            description: "Draft implementation plan",
                            role: "planner",
                            priority: "high",
                            deliverables: ["plan"],
                        },
                        {
                            description: "Implement first runtime slice",
                            role: "executor",
                            priority: "critical",
                            deliverables: ["code"],
                        },
                    ],
                }
            );

            expect(pool.coordinator.role).toBe("coordinator");
            expect(pool.agents).toHaveLength(3);
            expect(pool.tasks).toHaveLength(2);
            expect(pool.goalItem?.type).toBe("goal");
        });
    });

    describe("coordination trajectories", () => {
        it("should record lifecycle events for later meta-controller training", () => {
            const coordinator = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Coordinator",
                "coordinator"
            );
            const executor = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Executor",
                "executor"
            );
            const task = multiAgentCoordinationService.assignTask(
                TEST_MISSION_ID,
                coordinator.id,
                executor.id,
                "Complete traceable task"
            );

            multiAgentCoordinationService.updateTaskStatus(task.id, "in_progress");
            multiAgentCoordinationService.updateTaskStatus(task.id, "completed", { ok: true });

            const trajectories = multiAgentCoordinationService.getTrajectoriesForMission(TEST_MISSION_ID);

            expect(trajectories.some(t => t.event === "agent_created")).toBe(true);
            expect(trajectories.some(t => t.event === "task_assigned")).toBe(true);
            expect(trajectories.some(t => t.event === "task_completed" && t.rewardHint === 1)).toBe(true);
        });
    });

    describe("getMissionStats", () => {
        it("should return mission statistics", () => {
            multiAgentCoordinationService.createAgent(TEST_MISSION_ID, "Agent", "planner");

            const stats = multiAgentCoordinationService.getMissionStats(TEST_MISSION_ID);

            expect(stats.agentCount).toBe(1);
            expect(stats.tasksByStatus).toBeDefined();
            expect(stats.messagesExchanged).toBe(0);
        });

        it("should count tasks by status", () => {
            const assigner = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Assigner",
                "planner"
            );
            const assignee = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Assignee",
                "executor"
            );

            const task1 = multiAgentCoordinationService.assignTask(
                TEST_MISSION_ID,
                assigner.id,
                assignee.id,
                "Task 1"
            );
            const task2 = multiAgentCoordinationService.assignTask(
                TEST_MISSION_ID,
                assigner.id,
                assignee.id,
                "Task 2"
            );

            multiAgentCoordinationService.updateTaskStatus(task1.id, "completed");

            const stats = multiAgentCoordinationService.getMissionStats(TEST_MISSION_ID);

            expect(stats.tasksByStatus.pending).toBe(1);
            expect(stats.tasksByStatus.completed).toBe(1);
        });

        it("should calculate average completion time", async () => {
            const assigner = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Assigner",
                "planner"
            );
            const assignee = multiAgentCoordinationService.createAgent(
                TEST_MISSION_ID,
                "Assignee",
                "executor"
            );

            const task = multiAgentCoordinationService.assignTask(
                TEST_MISSION_ID,
                assigner.id,
                assignee.id,
                "Task"
            );

            multiAgentCoordinationService.updateTaskStatus(task.id, "in_progress");
            await new Promise(r => setTimeout(r, 10)); // Small delay
            multiAgentCoordinationService.updateTaskStatus(task.id, "completed");

            const stats = multiAgentCoordinationService.getMissionStats(TEST_MISSION_ID);

            expect(stats.avgTaskCompletionTime).toBeGreaterThanOrEqual(0);
        });
    });

    describe("facilitateCollaboration", () => {
        it("should create agents for required roles", () => {
            const result = multiAgentCoordinationService.facilitateCollaboration(
                TEST_MISSION_ID,
                "Complex task",
                ["planner", "executor", "reviewer"]
            );

            expect(result.agents.length).toBe(3);
            expect(result.agents.some(a => a.role === "planner")).toBe(true);
            expect(result.agents.some(a => a.role === "executor")).toBe(true);
            expect(result.agents.some(a => a.role === "reviewer")).toBe(true);
        });

        it("should assign tasks to each agent", () => {
            const result = multiAgentCoordinationService.facilitateCollaboration(
                TEST_MISSION_ID,
                "Complex task",
                ["planner", "executor"]
            );

            expect(result.tasks.length).toBe(2);
        });

        it("should create consensus for multi-agent collaboration", () => {
            const result = multiAgentCoordinationService.facilitateCollaboration(
                TEST_MISSION_ID,
                "Complex task",
                ["planner", "executor"]
            );

            expect(result.consensus).toBeDefined();
        });

        it("should not create consensus for single agent", () => {
            const result = multiAgentCoordinationService.facilitateCollaboration(
                TEST_MISSION_ID,
                "Simple task",
                ["planner"]
            );

            expect(result.consensus).toBeUndefined();
        });
    });

    describe("clearAll", () => {
        it("should clear all data", () => {
            multiAgentCoordinationService.createAgent(TEST_MISSION_ID, "Agent", "planner");

            expect(multiAgentCoordinationService.getAgentsForMission(TEST_MISSION_ID).length).toBe(1);

            multiAgentCoordinationService.clearAll();

            expect(multiAgentCoordinationService.getAgentsForMission(TEST_MISSION_ID).length).toBe(0);
        });
    });
});
