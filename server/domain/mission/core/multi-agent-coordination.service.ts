/**
 * Multi-Agent Coordination Service
 * 
 * Enables specialized agents to collaborate on complex missions through
 * role-based coordination, message passing, consensus building, and conflict resolution.
 */

import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { missionCorrelationService } from "./mission-correlation.service.js";
import { coordinationMemoryRepository } from "./coordination-memory.repository.js";

const logger = createLogger("MultiAgentCoordination");

export type AgentRole = 'planner' | 'executor' | 'reviewer' | 'specialist' | 'coordinator';
export type AgentPriority = 'low' | 'medium' | 'high' | 'critical';

export interface AgentCapabilities {
    canPlan: boolean;
    canExecute: boolean;
    canReview: boolean;
    canMakeDecisions: boolean;
    specialties: string[];
    maxConcurrentTasks: number;
}

export interface Agent {
    id: string;
    name: string;
    role: AgentRole;
    capabilities: AgentCapabilities;
    missionId: number;
    status: 'idle' | 'working' | 'reviewing' | 'waiting' | 'offline';
    currentTasks: string[];
    messages: AgentMessage[];
    createdAt: Date;
    lastActiveAt: Date;
    metadata?: Record<string, any>;
}

export interface AgentMessage {
    id: string;
    fromAgentId: string;
    toAgentId?: string;  // If undefined, broadcast to all
    type: 'task_assignment' | 'task_claim' | 'review_request' | 'review_feedback' | 'consensus_proposal' | 'consensus_vote' | 'conflict_notification' | 'information_share' | 'decision_request' | 'status_update' | 'blackboard_post';
    content: string;
    context?: Record<string, any>;
    priority: AgentPriority;
    timestamp: Date;
    threadId?: string;
    requiresResponse?: boolean;
    responseTo?: string;  // Reference to message being replied to
}

export interface AgentTask {
    id: string;
    missionId: number;
    assignedTo: string;
    assignedBy: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';
    priority: AgentPriority;
    dependencies: string[];
    deliverables: string[];
    deadline?: Date;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    result?: any;
    reviewBy?: string;
}

export interface BlackboardItem {
    id: string;
    missionId: number;
    topic: string;
    content: string;
    postedBy: string;
    type: 'goal' | 'observation' | 'hypothesis' | 'request' | 'result' | 'constraint' | 'affordance' | 'meta_trajectory';
    priority: AgentPriority;
    visibility: 'mission' | 'role' | 'agent';
    targetRole?: AgentRole;
    targetAgentId?: string;
    tags: string[];
    context?: Record<string, any>;
    createdAt: Date;
    expiresAt?: Date;
}

export interface CoordinatorPoolConfig {
    requiredRoles: AgentRole[];
    goal: string;
    seedTasks?: Array<{
        description: string;
        role?: AgentRole;
        priority?: AgentPriority;
        dependencies?: string[];
        deliverables?: string[];
    }>;
    postGoalToBlackboard?: boolean;
}

export interface CoordinationTrajectory {
    id: string;
    missionId: number;
    agentId: string;
    taskId?: string;
    event: 'agent_created' | 'task_assigned' | 'task_claimed' | 'task_started' | 'task_completed' | 'task_failed' | 'task_blocked' | 'blackboard_posted' | 'consensus_reached';
    rewardHint?: number;
    state?: Record<string, any>;
    outcome?: Record<string, any>;
    createdAt: Date;
}

export interface ConsensusProposal {
    id: string;
    missionId: number;
    proposedBy: string;
    topic: string;
    proposal: string;
    options: string[];
    votes: Map<string, string>;  // agentId -> option
    status: 'open' | 'concluded' | 'rejected';
    deadline: Date;
    minParticipation: number;  // Minimum agents needed
    conclusionThreshold: number;  // % agreement needed (0-1)
    createdAt: Date;
    concludedAt?: Date;
    result?: string;
}

export interface AgentConflict {
    id: string;
    missionId: number;
    agents: string[];  // Agents in conflict
    type: 'task_dispute' | 'resource_contention' | 'approach_disagreement' | 'priority_conflict' | 'deadlock';
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    status: 'identified' | 'under_resolution' | 'resolved' | 'escalated';
    proposedResolutions: Array<{
        proposedBy: string;
        resolution: string;
        agentVotes: Map<string, 'support' | 'oppose' | 'neutral'>;
    }>;
    createdAt: Date;
    resolvedAt?: Date;
    resolution?: string;
    escalatedTo?: string;
}

// In-memory storage
const agents = new Map<string, Agent>();
const tasks = new Map<string, AgentTask>();
const consensusProposals = new Map<string, ConsensusProposal>();
const conflicts = new Map<string, AgentConflict>();
const blackboardItems = new Map<string, BlackboardItem>();
const trajectories = new Map<string, CoordinationTrajectory>();

// Role templates with default capabilities
const roleTemplates: Record<AgentRole, AgentCapabilities> = {
    planner: {
        canPlan: true,
        canExecute: false,
        canReview: true,
        canMakeDecisions: true,
        specialties: ['architecture', 'strategy', 'roadmap'],
        maxConcurrentTasks: 3,
    },
    executor: {
        canPlan: false,
        canExecute: true,
        canReview: false,
        canMakeDecisions: false,
        specialties: ['implementation', 'coding', 'testing'],
        maxConcurrentTasks: 5,
    },
    reviewer: {
        canPlan: false,
        canExecute: false,
        canReview: true,
        canMakeDecisions: true,
        specialties: ['quality', 'audit', 'validation'],
        maxConcurrentTasks: 4,
    },
    specialist: {
        canPlan: true,
        canExecute: true,
        canReview: true,
        canMakeDecisions: true,
        specialties: ['domain_expertise', 'optimization', 'analysis'],
        maxConcurrentTasks: 2,
    },
    coordinator: {
        canPlan: true,
        canExecute: true,
        canReview: true,
        canMakeDecisions: true,
        specialties: ['coordination', 'facilitation', 'conflict_resolution'],
        maxConcurrentTasks: 10,
    },
};

function createId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function recordTrajectoryEntry(entry: Omit<CoordinationTrajectory, 'id' | 'createdAt'>): CoordinationTrajectory {
    const trajectory: CoordinationTrajectory = {
        id: createId('trajectory'),
        createdAt: new Date(),
        ...entry,
    };
    trajectories.set(trajectory.id, trajectory);
    coordinationMemoryRepository.appendTrajectory(trajectory);
    return trajectory;
}

function deliverSystemMessage(agentId: string, message: Omit<AgentMessage, 'id' | 'fromAgentId' | 'timestamp'>): AgentMessage | undefined {
    const agent = agents.get(agentId);
    if (!agent) return undefined;

    const msg: AgentMessage = {
        id: createId('msg'),
        fromAgentId: 'system',
        timestamp: new Date(),
        ...message,
    };

    agent.messages.push(msg);
    agent.lastActiveAt = new Date();
    return msg;
}

export const multiAgentCoordinationService = {
    /**
     * Create a new agent for a mission
     */
    createAgent(
        missionId: number,
        name: string,
        role: AgentRole,
        customCapabilities?: Partial<AgentCapabilities>,
        metadata?: Record<string, any>
    ): Agent {
        const id = `agent_${missionId}_${role}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = new Date();

        const capabilities = customCapabilities
            ? { ...roleTemplates[role], ...customCapabilities }
            : roleTemplates[role];

        const agent: Agent = {
            id,
            name,
            role,
            capabilities,
            missionId,
            status: 'idle',
            currentTasks: [],
            messages: [],
            createdAt: now,
            lastActiveAt: now,
            metadata,
        };

        agents.set(id, agent);
        recordTrajectoryEntry({
            missionId,
            agentId: id,
            event: 'agent_created',
            state: { role, capabilities },
        });

        logger.info(`[MultiAgent] Created agent ${name} (${role}) for mission ${missionId}`);

        eventStream.publish('agent.created', {
            agentId: id,
            name,
            role,
            missionId,
        }, {
            correlationId: missionCorrelationService.getCorrelationId(),
            subject: `mission:${missionId}`,
        }, 'multi-agent');

        return agent;
    },

    /**
     * Get an agent by ID
     */
    getAgent(agentId: string): Agent | undefined {
        return agents.get(agentId);
    },

    /**
     * Get all agents for a mission
     */
    getAgentsForMission(missionId: number): Agent[] {
        return Array.from(agents.values())
            .filter(a => a.missionId === missionId)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },

    /**
     * Update agent status
     */
    updateAgentStatus(agentId: string, status: Agent['status']): Agent | undefined {
        const agent = agents.get(agentId);
        if (!agent) return undefined;

        agent.status = status;
        agent.lastActiveAt = new Date();

        eventStream.publish('agent.status_changed', {
            agentId,
            status,
            missionId: agent.missionId,
        }, {
            correlationId: missionCorrelationService.getCorrelationId(),
            subject: `mission:${agent.missionId}`,
        }, 'multi-agent');

        return agent;
    },

    /**
     * Send message between agents
     */
    sendMessage(
        fromAgentId: string,
        message: Omit<AgentMessage, 'id' | 'fromAgentId' | 'timestamp'>
    ): AgentMessage {
        const fromAgent = agents.get(fromAgentId);
        if (!fromAgent) {
            throw new Error(`Agent ${fromAgentId} not found`);
        }

        const msg: AgentMessage = {
            id: createId('msg'),
            fromAgentId,
            timestamp: new Date(),
            ...message,
        };

        // Add to sender's messages
        fromAgent.messages.push(msg);
        fromAgent.lastActiveAt = new Date();

        // Add to recipient's messages if specified (and not same as sender)
        if (message.toAgentId && message.toAgentId !== fromAgentId) {
            const toAgent = agents.get(message.toAgentId);
            if (toAgent) {
                toAgent.messages.push(msg);
            }
        } else if (!message.toAgentId) {
            // Broadcast to all agents in mission
            this.getAgentsForMission(fromAgent.missionId)
                .filter(a => a.id !== fromAgentId)
                .forEach(a => a.messages.push(msg));
        }

        eventStream.publish('agent.message_sent', {
            messageId: msg.id,
            fromAgentId,
            toAgentId: message.toAgentId,
            type: message.type,
            missionId: fromAgent.missionId,
        }, {
            correlationId: missionCorrelationService.getCorrelationId(),
            subject: `mission:${fromAgent.missionId}`,
        }, 'multi-agent');

        return msg;
    },

    /**
     * Get messages for an agent
     */
    getMessages(
        agentId: string,
        options?: { type?: AgentMessage['type']; since?: Date; unreadOnly?: boolean }
    ): AgentMessage[] {
        const agent = agents.get(agentId);
        if (!agent) return [];

        let messages = [...agent.messages];

        if (options?.type) {
            messages = messages.filter(m => m.type === options.type);
        }

        if (options?.since) {
            messages = messages.filter(m => m.timestamp >= options.since!);
        }

        return messages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    },

    /**
     * Create a consensus proposal
     */
    createConsensusProposal(
        missionId: number,
        proposedBy: string,
        topic: string,
        proposal: string,
        options: string[],
        config?: { deadline?: Date; minParticipation?: number; conclusionThreshold?: number }
    ): ConsensusProposal {
        const id = `consensus_${missionId}_${Date.now()}`;
        const now = new Date();

        const consensus: ConsensusProposal = {
            id,
            missionId,
            proposedBy,
            topic,
            proposal,
            options,
            votes: new Map(),
            status: 'open',
            deadline: config?.deadline || new Date(now.getTime() + 3600000), // 1 hour default
            minParticipation: config?.minParticipation || 2,
            conclusionThreshold: config?.conclusionThreshold || 0.7, // 70% default
            createdAt: now,
        };

        consensusProposals.set(id, consensus);

        // Notify all agents in mission
        const missionAgents = this.getAgentsForMission(missionId);
        for (const agent of missionAgents) {
            if (agent.id !== proposedBy && agent.capabilities.canMakeDecisions) {
                this.sendMessage(proposedBy, {
                    toAgentId: agent.id,
                    type: 'consensus_proposal',
                    content: `Consensus proposal: ${topic}\n${proposal}\nOptions: ${options.join(', ')}`,
                    priority: 'high',
                    requiresResponse: true,
                    context: { consensusId: id },
                });
            }
        }

        logger.info(`[MultiAgent] Created consensus proposal ${id} for mission ${missionId}`);

        return consensus;
    },

    /**
     * Cast a vote on a consensus proposal
     */
    castVote(
        consensusId: string,
        agentId: string,
        option: string
    ): ConsensusProposal | undefined {
        const consensus = consensusProposals.get(consensusId);
        if (!consensus) return undefined;
        if (consensus.status !== 'open') return undefined;
        if (!consensus.options.includes(option)) return undefined;

        consensus.votes.set(agentId, option);

        // Check if consensus is reached
        this.checkConsensusConclusion(consensus);

        // Notify proposer
        this.sendMessage(agentId, {
            toAgentId: consensus.proposedBy,
            type: 'consensus_vote',
            content: `Voted for: ${option}`,
            priority: 'medium',
            context: { consensusId, vote: option },
        });

        return consensus;
    },

    /**
     * Check if consensus has been reached
     */
    checkConsensusConclusion(consensus: ConsensusProposal): void {
        const missionAgents = this.getAgentsForMission(consensus.missionId)
            .filter(a => a.capabilities.canMakeDecisions);

        // Check participation
        const participation = consensus.votes.size / missionAgents.length;
        if (participation < consensus.minParticipation / missionAgents.length) {
            return; // Not enough participation
        }

        // Check if any option has reached threshold
        const voteCounts = new Map<string, number>();
        for (const vote of consensus.votes.values()) {
            voteCounts.set(vote, (voteCounts.get(vote) || 0) + 1);
        }

        const totalVotes = consensus.votes.size;
        for (const [option, count] of voteCounts) {
            if (count / totalVotes >= consensus.conclusionThreshold) {
                // Consensus reached
                consensus.status = 'concluded';
                consensus.result = option;
                consensus.concludedAt = new Date();
                recordTrajectoryEntry({
                    missionId: consensus.missionId,
                    agentId: consensus.proposedBy,
                    event: 'consensus_reached',
                    rewardHint: 0.75,
                    state: { topic: consensus.topic, votes: Object.fromEntries(consensus.votes) },
                    outcome: { result: option },
                });

                eventStream.publish('consensus.reached', {
                    consensusId: consensus.id,
                    missionId: consensus.missionId,
                    result: option,
                    votes: Object.fromEntries(consensus.votes),
                }, {
                    correlationId: missionCorrelationService.getCorrelationId(),
                    subject: `mission:${consensus.missionId}`,
                }, 'multi-agent');

                // Notify all agents
                const missionAgents = this.getAgentsForMission(consensus.missionId);
                for (const agent of missionAgents) {
                    if (agent.id !== consensus.proposedBy) {
                        this.sendMessage(consensus.proposedBy, {
                            toAgentId: agent.id,
                            type: 'information_share',
                            content: `Consensus reached on "${consensus.topic}": ${option} (${Math.round(count / totalVotes * 100)}% agreement)`,
                            priority: 'high',
                            context: { consensusId: consensus.id, result: option },
                        });
                    }
                }

                return;
            }
        }

        // Check deadline
        if (new Date() > consensus.deadline) {
            consensus.status = 'rejected';
            consensus.concludedAt = new Date();
        }
    },

    /**
     * Get consensus proposal status
     */
    getConsensus(consensusId: string): ConsensusProposal | undefined {
        return consensusProposals.get(consensusId);
    },

    /**
     * Get all consensus proposals for a mission
     */
    getConsensusForMission(missionId: number): ConsensusProposal[] {
        return Array.from(consensusProposals.values())
            .filter(c => c.missionId === missionId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    /**
     * Assign a task to an agent
     */
    assignTask(
        missionId: number,
        assignedBy: string,
        assignedTo: string,
        description: string,
        config?: {
            priority?: AgentTask['priority'];
            dependencies?: string[];
            deliverables?: string[];
            deadline?: Date;
            reviewBy?: string;
        }
    ): AgentTask {
        const id = `task_${missionId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const task: AgentTask = {
            id,
            missionId,
            assignedTo,
            assignedBy,
            description,
            status: 'pending',
            priority: config?.priority || 'medium',
            dependencies: config?.dependencies || [],
            deliverables: config?.deliverables || [],
            deadline: config?.deadline,
            createdAt: new Date(),
            reviewBy: config?.reviewBy,
        };

        tasks.set(id, task);
        recordTrajectoryEntry({
            missionId,
            agentId: assignedTo,
            taskId: id,
            event: 'task_assigned',
            state: {
                assignedBy,
                priority: task.priority,
                dependencies: task.dependencies,
                deliverables: task.deliverables,
            },
        });

        // Update agent's task list
        const agent = agents.get(assignedTo);
        if (agent) {
            agent.currentTasks.push(id);
            agent.status = 'working';
        }

        // Notify agent
        this.sendMessage(assignedBy, {
            toAgentId: assignedTo,
            type: 'task_assignment',
            content: `New task assigned: ${description}`,
            priority: task.priority,
            requiresResponse: true,
            context: { taskId: id, deadline: config?.deadline },
        });

        logger.info(`[MultiAgent] Assigned task ${id} to agent ${assignedTo}`);

        return task;
    },

    /**
     * Update task status
     */
    updateTaskStatus(
        taskId: string,
        status: AgentTask['status'],
        result?: any
    ): AgentTask | undefined {
        const task = tasks.get(taskId);
        if (!task) return undefined;

        task.status = status;

        if (status === 'in_progress' && !task.startedAt) {
            task.startedAt = new Date();
            recordTrajectoryEntry({
                missionId: task.missionId,
                agentId: task.assignedTo,
                taskId,
                event: 'task_started',
            });
        }

        if ((status === 'completed' || status === 'failed') && !task.completedAt) {
            task.completedAt = new Date();
            task.result = result;
            recordTrajectoryEntry({
                missionId: task.missionId,
                agentId: task.assignedTo,
                taskId,
                event: status === 'completed' ? 'task_completed' : 'task_failed',
                rewardHint: status === 'completed' ? 1 : -1,
                outcome: { result },
            });

            // Update agent status
            const agent = agents.get(task.assignedTo);
            if (agent) {
                agent.currentTasks = agent.currentTasks.filter(t => t !== taskId);
                if (agent.currentTasks.length === 0) {
                    agent.status = 'idle';
                }
            }

            // If completed and has reviewer, send for review
            if (status === 'completed' && task.reviewBy) {
                this.sendMessage(task.assignedTo, {
                    toAgentId: task.reviewBy,
                    type: 'review_request',
                    content: `Task completed and ready for review: ${task.description}`,
                    priority: 'medium',
                    context: { taskId, result },
                });
            }
        }

        if (status === 'blocked') {
            recordTrajectoryEntry({
                missionId: task.missionId,
                agentId: task.assignedTo,
                taskId,
                event: 'task_blocked',
                rewardHint: -0.25,
                outcome: { result },
            });
        }

        // Notify assigner
        this.sendMessage(task.assignedTo, {
            toAgentId: task.assignedBy,
            type: 'status_update',
            content: `Task ${status}: ${task.description}`,
            priority: 'medium',
            context: { taskId, status, result },
        });

        return task;
    },

    /**
     * Get task by ID
     */
    getTask(taskId: string): AgentTask | undefined {
        return tasks.get(taskId);
    },

    /**
     * Get all tasks for a mission
     */
    getTasksForMission(missionId: number): AgentTask[] {
        return Array.from(tasks.values())
            .filter(t => t.missionId === missionId)
            .sort((a, b) => {
                // Sort by status priority, then deadline
                const statusOrder = { pending: 0, in_progress: 1, blocked: 2, completed: 3, failed: 4 };
                if (statusOrder[a.status] !== statusOrder[b.status]) {
                    return statusOrder[a.status] - statusOrder[b.status];
                }
                if (a.deadline && b.deadline) {
                    return a.deadline.getTime() - b.deadline.getTime();
                }
                return b.createdAt.getTime() - a.createdAt.getTime();
            });
    },

    /**
     * Detect and handle conflicts between agents
     */
    detectConflict(
        missionId: number,
        agents: string[],
        type: AgentConflict['type'],
        description: string,
        severity: AgentConflict['severity'] = 'medium'
    ): AgentConflict {
        const id = `conflict_${missionId}_${Date.now()}`;

        const conflict: AgentConflict = {
            id,
            missionId,
            agents,
            type,
            description,
            severity,
            status: 'identified',
            proposedResolutions: [],
            createdAt: new Date(),
        };

        conflicts.set(id, conflict);

        // Notify coordinator if exists, otherwise all agents
        const missionAgents = this.getAgentsForMission(missionId);
        const coordinator = missionAgents.find(a => a.role === 'coordinator');

        if (coordinator) {
            this.sendMessage(coordinator.id, {
                toAgentId: coordinator.id,
                type: 'conflict_notification',
                content: `Conflict detected: ${description}`,
                priority: severity === 'critical' ? 'critical' : 'high',
                context: { conflictId: id, type, agents },
            });
        } else {
            // Notify all involved agents - use first agent as sender
            const senderId = agents[0];
            if (senderId) {
                for (let i = 1; i < agents.length; i++) {
                    this.sendMessage(senderId, {
                        toAgentId: agents[i],
                        type: 'conflict_notification',
                        content: `Conflict detected between agents: ${description}`,
                        priority: severity === 'critical' ? 'critical' : 'high',
                        context: { conflictId: id },
                    });
                }
            }
        }

        logger.warn(`[MultiAgent] Conflict detected ${id}: ${description}`);

        return conflict;
    },

    /**
     * Propose a resolution to a conflict
     */
    proposeResolution(
        conflictId: string,
        proposedBy: string,
        resolution: string
    ): AgentConflict | undefined {
        const conflict = conflicts.get(conflictId);
        if (!conflict) return undefined;

        conflict.proposedResolutions.push({
            proposedBy,
            resolution,
            agentVotes: new Map(),
        });

        conflict.status = 'under_resolution';

        // Notify all involved agents
        for (const agentId of conflict.agents) {
            if (agentId !== proposedBy) {
                this.sendMessage(proposedBy, {
                    toAgentId: agentId,
                    type: 'information_share',
                    content: `Proposed resolution: ${resolution}`,
                    priority: 'high',
                    context: { conflictId, proposedBy },
                });
            }
        }

        return conflict;
    },

    /**
     * Vote on a proposed resolution
     */
    voteOnResolution(
        conflictId: string,
        resolutionIndex: number,
        agentId: string,
        vote: 'support' | 'oppose' | 'neutral'
    ): AgentConflict | undefined {
        const conflict = conflicts.get(conflictId);
        if (!conflict) return undefined;
        if (!conflict.agents.includes(agentId)) return undefined;

        const resolution = conflict.proposedResolutions[resolutionIndex];
        if (!resolution) return undefined;

        resolution.agentVotes.set(agentId, vote);

        // Check if resolution has majority support
        const supportCount = Array.from(resolution.agentVotes.values())
            .filter(v => v === 'support').length;
        
        if (supportCount > conflict.agents.length / 2) {
            // Resolution accepted
            conflict.status = 'resolved';
            conflict.resolvedAt = new Date();
            conflict.resolution = resolution.resolution;

            // Notify all agents
            for (const agentId of conflict.agents) {
                deliverSystemMessage(agentId, {
                    toAgentId: agentId,
                    type: 'information_share',
                    content: `Conflict resolved: ${resolution.resolution}`,
                    priority: 'high',
                    context: { conflictId, resolution: resolution.resolution },
                });
            }
        }

        return conflict;
    },

    /**
     * Get conflict by ID
     */
    getConflict(conflictId: string): AgentConflict | undefined {
        return conflicts.get(conflictId);
    },

    /**
     * Get all conflicts for a mission
     */
    getConflictsForMission(missionId: number): AgentConflict[] {
        return Array.from(conflicts.values())
            .filter(c => c.missionId === missionId)
            .sort((a, b) => {
                const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
                if (severityOrder[a.severity] !== severityOrder[b.severity]) {
                    return severityOrder[a.severity] - severityOrder[b.severity];
                }
                return b.createdAt.getTime() - a.createdAt.getTime();
            });
    },

    /**
     * Post a shared blackboard item. Blackboard posts are visible independently
     * of direct inbox messages, so agents can coordinate without central routing.
     */
    postBlackboardItem(
        missionId: number,
        postedBy: string,
        item: Omit<BlackboardItem, 'id' | 'missionId' | 'postedBy' | 'createdAt'>
    ): BlackboardItem {
        const agent = agents.get(postedBy);
        if (!agent) {
            throw new Error(`Agent ${postedBy} not found`);
        }
        if (agent.missionId !== missionId) {
            throw new Error(`Agent ${postedBy} does not belong to mission ${missionId}`);
        }

        const blackboardItem: BlackboardItem = {
            id: createId('bb'),
            missionId,
            postedBy,
            createdAt: new Date(),
            ...item,
        };

        blackboardItems.set(blackboardItem.id, blackboardItem);
        coordinationMemoryRepository.appendBlackboardItem(blackboardItem);
        recordTrajectoryEntry({
            missionId,
            agentId: postedBy,
            event: 'blackboard_posted',
            rewardHint: item.type === 'result' ? 0.5 : undefined,
            state: {
                topic: item.topic,
                type: item.type,
                tags: item.tags,
            },
            outcome: item.context,
        });

        const visibleAgents = this.getAgentsForMission(missionId).filter(target => {
            if (target.id === postedBy) return false;
            if (item.visibility === 'role') return item.targetRole === target.role;
            if (item.visibility === 'agent') return item.targetAgentId === target.id;
            return true;
        });

        for (const target of visibleAgents) {
            this.sendMessage(postedBy, {
                toAgentId: target.id,
                type: 'blackboard_post',
                content: `${item.topic}: ${item.content}`,
                priority: item.priority,
                context: {
                    blackboardItemId: blackboardItem.id,
                    topic: item.topic,
                    type: item.type,
                    tags: item.tags,
                },
            });
        }

        eventStream.publish('blackboard.item_posted', {
            itemId: blackboardItem.id,
            missionId,
            topic: item.topic,
            type: item.type,
            postedBy,
        }, {
            correlationId: missionCorrelationService.getCorrelationId(),
            subject: `mission:${missionId}`,
        }, 'multi-agent');

        return blackboardItem;
    },

    /**
     * Read mission blackboard items visible to the requesting agent.
     */
    readBlackboard(
        missionId: number,
        agentId: string,
        options?: {
            topic?: string;
            type?: BlackboardItem['type'];
            tags?: string[];
            since?: Date;
            includeExpired?: boolean;
            limit?: number;
        }
    ): BlackboardItem[] {
        const agent = agents.get(agentId);
        if (!agent || agent.missionId !== missionId) return [];

        const now = new Date();
        let items = Array.from(blackboardItems.values()).filter(item => {
            if (item.missionId !== missionId) return false;
            if (!options?.includeExpired && item.expiresAt && item.expiresAt < now) return false;
            if (item.visibility === 'role' && item.targetRole !== agent.role) return false;
            if (item.visibility === 'agent' && item.targetAgentId !== agentId) return false;
            return true;
        });

        if (options?.topic) {
            items = items.filter(item => item.topic === options.topic);
        }
        if (options?.type) {
            items = items.filter(item => item.type === options.type);
        }
        if (options?.since) {
            items = items.filter(item => item.createdAt >= options.since!);
        }
        if (options?.tags?.length) {
            items = items.filter(item => options.tags!.every(tag => item.tags.includes(tag)));
        }

        items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return typeof options?.limit === 'number' ? items.slice(0, options.limit) : items;
    },

    /**
     * Let an idle-capable agent claim the highest-priority available task.
     */
    claimNextTask(
        missionId: number,
        agentId: string,
        options?: { requiredSpecialty?: string }
    ): AgentTask | undefined {
        const agent = agents.get(agentId);
        if (!agent || agent.missionId !== missionId) return undefined;
        if (agent.currentTasks.length >= agent.capabilities.maxConcurrentTasks) return undefined;
        if (options?.requiredSpecialty && !agent.capabilities.specialties.includes(options.requiredSpecialty)) {
            return undefined;
        }

        const priorityOrder: Record<AgentPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        const availableTasks = Array.from(tasks.values())
            .filter(task => task.missionId === missionId && task.status === 'pending')
            .filter(task => {
                const assigned = agents.get(task.assignedTo);
                return !assigned || assigned.status === 'offline';
            })
            .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.createdAt.getTime() - b.createdAt.getTime());

        const task = availableTasks[0];
        if (!task) return undefined;

        const previousAssignee = task.assignedTo;
        const previousAgent = agents.get(previousAssignee);
        if (previousAgent) {
            previousAgent.currentTasks = previousAgent.currentTasks.filter(id => id !== task.id);
        }
        task.assignedTo = agentId;
        task.status = 'in_progress';
        task.startedAt = new Date();
        agent.currentTasks.push(task.id);
        agent.status = 'working';
        agent.lastActiveAt = new Date();

        this.sendMessage(agentId, {
            type: 'task_claim',
            content: `Claimed task: ${task.description}`,
            priority: task.priority,
            context: { taskId: task.id, previousAssignee },
        });

        recordTrajectoryEntry({
            missionId,
            agentId,
            taskId: task.id,
            event: 'task_claimed',
            rewardHint: 0.1,
            state: { previousAssignee, priority: task.priority },
        });

        return task;
    },

    /**
     * Create a coordinator and role-based worker pool around a complex goal.
     */
    createCoordinatorPool(
        missionId: number,
        config: CoordinatorPoolConfig
    ): { coordinator: Agent; agents: Agent[]; tasks: AgentTask[]; goalItem?: BlackboardItem } {
        let coordinator = this.getAgentsForMission(missionId).find(a => a.role === 'coordinator');
        if (!coordinator) {
            coordinator = this.createAgent(missionId, `coordinator_${Date.now()}`, 'coordinator');
        }

        const agentsForPool = config.requiredRoles.map(role => {
            const existing = this.getAgentsForMission(missionId).find(a => a.role === role && a.status !== 'offline');
            return existing ?? this.createAgent(missionId, `${role}_${Date.now()}`, role);
        });

        const goalItem = config.postGoalToBlackboard === false
            ? undefined
            : this.postBlackboardItem(missionId, coordinator.id, {
                topic: 'mission.goal',
                content: config.goal,
                type: 'goal',
                priority: 'critical',
                visibility: 'mission',
                tags: ['goal', 'coordination'],
            });

        const seededTasks = (config.seedTasks ?? []).map(seed => {
            const assignee = seed.role
                ? agentsForPool.find(agent => agent.role === seed.role)
                : agentsForPool[0];

            if (!assignee) {
                throw new Error(`No available agent for seed task: ${seed.description}`);
            }

            return this.assignTask(
                missionId,
                coordinator!.id,
                assignee.id,
                seed.description,
                {
                    priority: seed.priority ?? 'medium',
                    dependencies: seed.dependencies,
                    deliverables: seed.deliverables,
                }
            );
        });

        return {
            coordinator,
            agents: agentsForPool,
            tasks: seededTasks,
            goalItem,
        };
    },

    /**
     * Retrieve coordination trajectories for offline HRL/meta-controller training.
     */
    getTrajectoriesForMission(missionId: number): CoordinationTrajectory[] {
        return Array.from(trajectories.values())
            .filter(t => t.missionId === missionId)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },

    /**
     * Facilitate collaboration on a complex task
     */
    facilitateCollaboration(
        missionId: number,
        taskDescription: string,
        requiredRoles: AgentRole[]
    ): { agents: Agent[]; tasks: AgentTask[]; consensus?: ConsensusProposal } {
        // Get or create a coordinator for this mission
        const missionAgents = this.getAgentsForMission(missionId);
        let coordinator = missionAgents.find(a => a.role === 'coordinator');
        
        if (!coordinator) {
            coordinator = this.createAgent(
                missionId,
                `coordinator_${Date.now()}`,
                'coordinator'
            );
        }

        const result = {
            agents: [] as Agent[],
            tasks: [] as AgentTask[],
            consensus: undefined as ConsensusProposal | undefined,
        };

        for (const role of requiredRoles) {
            let agent = missionAgents.find(a => a.role === role && a.status === 'idle');
            
            if (!agent) {
                // Create new agent
                agent = this.createAgent(
                    missionId,
                    `${role}_${Date.now()}`,
                    role
                );
            }
            
            result.agents.push(agent);

            // Assign subtask from coordinator
            const task = this.assignTask(
                missionId,
                coordinator.id,
                agent.id,
                `${taskDescription} - ${role} responsibility`,
                { priority: 'high' }
            );
            result.tasks.push(task);
        }

        // Create consensus for final decision if multiple agents
        if (result.agents.length > 1) {
            result.consensus = this.createConsensusProposal(
                missionId,
                coordinator.id,
                `Approach for: ${taskDescription}`,
                'Select the best approach',
                ['approach_1', 'approach_2', 'approach_3'],
                { conclusionThreshold: 0.6 }
            );
        }

        return result;
    },

    /**
     * Get coordination statistics for a mission
     */
    getMissionStats(missionId: number): {
        agentCount: number;
        tasksByStatus: Record<AgentTask['status'], number>;
        messagesExchanged: number;
        activeConsensus: number;
        openConflicts: number;
        avgTaskCompletionTime: number;
    } {
        const missionAgents = this.getAgentsForMission(missionId);
        const missionTasks = this.getTasksForMission(missionId);
        const missionConsensus = this.getConsensusForMission(missionId);
        const missionConflicts = this.getConflictsForMission(missionId);

        const tasksByStatus = {
            pending: 0,
            in_progress: 0,
            completed: 0,
            failed: 0,
            blocked: 0,
        };

        let totalCompletionTime = 0;
        let completedCount = 0;

        for (const task of missionTasks) {
            tasksByStatus[task.status]++;
            
            if (task.status === 'completed' && task.startedAt && task.completedAt) {
                totalCompletionTime += task.completedAt.getTime() - task.startedAt.getTime();
                completedCount++;
            }
        }

        const messagesExchanged = missionAgents.reduce(
            (sum, agent) => sum + agent.messages.length,
            0
        );

        return {
            agentCount: missionAgents.length,
            tasksByStatus,
            messagesExchanged,
            activeConsensus: missionConsensus.filter(c => c.status === 'open').length,
            openConflicts: missionConflicts.filter(c => c.status !== 'resolved' && c.status !== 'escalated').length,
            avgTaskCompletionTime: completedCount > 0 ? totalCompletionTime / completedCount : 0,
        };
    },

    /**
     * Clear all data (for testing)
     */
    clearAll(): void {
        agents.clear();
        tasks.clear();
        consensusProposals.clear();
        conflicts.clear();
        blackboardItems.clear();
        trajectories.clear();
    },
};
