/**
 * Agent Team Service
 * 
 * Manages hierarchical agent teams for coordinated mission execution.
 * Handles team formation, role assignment, delegation chains, and
 * escalation paths.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { createLogger } from '../../../../utils/logger.js';
import {
  AgentTeam,
  AgentTeamMember,
  CreateTeamRequest,
  CoordinationTask,
  MultiAgentMission
} from '../../../../../shared/schema/multi-agent.js';

const logger = createLogger('AgentTeamService');

interface DelegationChain {
  taskId: string;
  fromAgentId: string;
  toAgentId: string;
  reason: string;
  delegatedAt: string;
}

export class AgentTeamService extends EventEmitter {
  private teams: Map<string, AgentTeam> = new Map();
  private delegationChains: Map<string, DelegationChain[]> = new Map();
  private activeMissions: Map<string, MultiAgentMission> = new Map();

  /**
   * Create a new agent team
   */
  async createTeam(request: CreateTeamRequest): Promise<AgentTeam> {
    const teamId = randomUUID();
    const now = new Date().toISOString();

    // Build reporting structure
    const leads = request.members.filter((m) => m.role === 'lead');
    const others = request.members.filter((m) => m.role !== 'lead');

    const reportingStructure: { agentId: string; reportsTo?: string }[] = leads.map((lead) => ({
      agentId: lead.agentId
    }));

    others.forEach((member, index) => {
      const reportsTo = leads[index % leads.length]?.agentId;
      reportingStructure.push({
        agentId: member.agentId,
        reportsTo
      });
    });

    const team: AgentTeam = {
      id: teamId,
      name: request.name,
      missionId: request.missionId,
      members: request.members,
      hierarchy: {
        levels: this.calculateHierarchyLevels(request.members),
        maxSpanOfControl: 10,
        reportingStructure
      },
      createdAt: now,
      active: true
    };

    this.teams.set(teamId, team);
    this.delegationChains.set(teamId, []);

    logger.info('Created agent team', {
      teamId,
      name: request.name,
      memberCount: request.members.length,
      levels: team.hierarchy.levels
    });

    this.emit('team:created', { teamId, memberCount: request.members.length });

    return team;
  }

  /**
   * Calculate hierarchy depth based on roles
   */
  private calculateHierarchyLevels(members: AgentTeamMember[]): number {
    const hasLeads = members.some((m) => m.role === 'lead');
    const hasCoordinators = members.some((m) => m.role === 'coordinator');
    const hasSpecialists = members.some((m) => m.role === 'specialist');
    const hasSupport = members.some((m) => m.role === 'support');

    let levels = 1;
    if (hasLeads) levels++;
    if (hasCoordinators) levels++;
    if (hasSpecialists || hasSupport) levels++;

    return levels;
  }

  /**
   * Get team by ID
   */
  getTeam(teamId: string): AgentTeam | undefined {
    return this.teams.get(teamId);
  }

  /**
   * Get all teams
   */
  getAllTeams(): AgentTeam[] {
    return Array.from(this.teams.values());
  }

  /**
   * Add member to team
   */
  async addMember(teamId: string, member: AgentTeamMember): Promise<void> {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    team.members.push(member);
    team.hierarchy.levels = this.calculateHierarchyLevels(team.members);

    // Assign reporting structure
    const leads = team.members.filter((m) => m.role === 'lead');
    if (leads.length > 0 && member.role !== 'lead') {
      team.hierarchy.reportingStructure.push({
        agentId: member.agentId,
        reportsTo: leads[0].agentId
      });
    } else {
      team.hierarchy.reportingStructure.push({
        agentId: member.agentId
      });
    }

    logger.info('Added member to team', { teamId, agentId: member.agentId, role: member.role });
    this.emit('team:member_added', { teamId, agentId: member.agentId });
  }

  /**
   * Remove member from team
   */
  async removeMember(teamId: string, agentId: string): Promise<void> {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    team.members = team.members.filter((m) => m.agentId !== agentId);
    team.hierarchy.reportingStructure = team.hierarchy.reportingStructure.filter(
      (r) => r.agentId !== agentId
    );

    // Reassign direct reports
    const directReports = team.hierarchy.reportingStructure.filter(
      (r) => r.reportsTo === agentId
    );

    const leads = team.members.filter((m) => m.role === 'lead');
    if (leads.length > 0) {
      directReports.forEach((report) => {
        report.reportsTo = leads[0].agentId;
      });
    }

    logger.info('Removed member from team', { teamId, agentId });
    this.emit('team:member_removed', { teamId, agentId });
  }

  /**
   * Delegate a task to another agent
   */
  async delegateTask(
    teamId: string,
    taskId: string,
    fromAgentId: string,
    toAgentId: string,
    reason: string
  ): Promise<void> {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    const fromMember = team.members.find((m) => m.agentId === fromAgentId);
    if (!fromMember?.canDelegate) {
      throw new Error(`Agent ${fromAgentId} does not have delegation permission`);
    }

    const chains = this.delegationChains.get(teamId) || [];
    chains.push({
      taskId,
      fromAgentId,
      toAgentId,
      reason,
      delegatedAt: new Date().toISOString()
    });
    this.delegationChains.set(teamId, chains);

    logger.info('Task delegated', {
      teamId,
      taskId,
      from: fromAgentId,
      to: toAgentId,
      reason
    });

    this.emit('task:delegated', { teamId, taskId, fromAgentId, toAgentId });
  }

  /**
   * Get delegation chain for a task
   */
  getDelegationChain(teamId: string, taskId?: string): DelegationChain[] {
    const chains = this.delegationChains.get(teamId) || [];
    if (taskId) {
      return chains.filter((c) => c.taskId === taskId);
    }
    return chains;
  }

  /**
   * Find escalation target for an agent
   */
  findEscalationTarget(teamId: string, agentId: string): string | null {
    const team = this.teams.get(teamId);
    if (!team) return null;

    const member = team.members.find((m) => m.agentId === agentId);
    if (!member) return null;

    if (member.escalationTarget) {
      return member.escalationTarget;
    }

    // Find direct manager from reporting structure
    const report = team.hierarchy.reportingStructure.find((r) => r.agentId === agentId);
    return report?.reportsTo || null;
  }

  /**
   * Escalate a task to higher authority
   */
  async escalateTask(
    teamId: string,
    taskId: string,
    fromAgentId: string,
    reason: string
  ): Promise<string | null> {
    const escalationTarget = this.findEscalationTarget(teamId, fromAgentId);
    if (!escalationTarget) {
      logger.warn('No escalation target found', { teamId, agentId: fromAgentId });
      return null;
    }

    await this.delegateTask(teamId, taskId, fromAgentId, escalationTarget, `Escalation: ${reason}`);

    logger.info('Task escalated', {
      teamId,
      taskId,
      from: fromAgentId,
      to: escalationTarget
    });

    this.emit('task:escalated', { teamId, taskId, fromAgentId, toAgentId: escalationTarget });

    return escalationTarget;
  }

  /**
   * Get team members by role
   */
  getMembersByRole(teamId: string, role: AgentTeamMember['role']): AgentTeamMember[] {
    const team = this.teams.get(teamId);
    if (!team) return [];
    return team.members.filter((m) => m.role === role);
  }

  /**
   * Get subordinates of an agent
   */
  getSubordinates(teamId: string, agentId: string): AgentTeamMember[] {
    const team = this.teams.get(teamId);
    if (!team) return [];

    const directReportIds = team.hierarchy.reportingStructure
      .filter((r) => r.reportsTo === agentId)
      .map((r) => r.agentId);

    return team.members.filter((m) => directReportIds.includes(m.agentId));
  }

  /**
   * Check if agent can take on more work
   */
  canAcceptWork(teamId: string, agentId: string, maxTasks: number = 5): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;

    const member = team.members.find((m) => m.agentId === agentId);
    if (!member) return false;

    // Count current delegated tasks
    const chains = this.delegationChains.get(teamId) || [];
    const currentTasks = chains.filter((c) => c.toAgentId === agentId).length;

    return currentTasks < maxTasks;
  }

  /**
   * Get team workload distribution
   */
  getWorkloadDistribution(teamId: string): Record<string, number> {
    const chains = this.delegationChains.get(teamId) || [];
    const distribution: Record<string, number> = {};

    chains.forEach((chain) => {
      distribution[chain.toAgentId] = (distribution[chain.toAgentId] || 0) + 1;
    });

    return distribution;
  }

  /**
   * Find best agent for task based on role and workload
   */
  findBestAgentForTask(
    teamId: string,
    requiredRole: AgentTeamMember['role'],
    requiredCapabilities: string[]
  ): string | null {
    const team = this.teams.get(teamId);
    if (!team) return null;

    const candidates = team.members.filter(
      (m) =>
        m.role === requiredRole &&
        requiredCapabilities.every((cap) => m.responsibilities.includes(cap))
    );

    if (candidates.length === 0) return null;

    // Score by workload (lower is better) and priority
    const workload = this.getWorkloadDistribution(teamId);
    const scored = candidates.map((member) => ({
      agentId: member.agentId,
      score: member.priority * 10 - (workload[member.agentId] || 0) * 5
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.agentId || null;
  }

  /**
   * Dissolve a team
   */
  async dissolveTeam(teamId: string): Promise<void> {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    team.active = false;
    this.teams.delete(teamId);
    this.delegationChains.delete(teamId);

    logger.info('Team dissolved', { teamId });
    this.emit('team:dissolved', { teamId });
  }

  /**
   * Get team statistics
   */
  getTeamStats(teamId: string): {
    memberCount: number;
    activeDelegations: number;
    byRole: Record<string, number>;
  } | null {
    const team = this.teams.get(teamId);
    if (!team) return null;

    const byRole: Record<string, number> = {};
    team.members.forEach((m) => {
      byRole[m.role] = (byRole[m.role] || 0) + 1;
    });

    const chains = this.delegationChains.get(teamId) || [];

    return {
      memberCount: team.members.length,
      activeDelegations: chains.length,
      byRole
    };
  }
}

export const teamService = new AgentTeamService();
