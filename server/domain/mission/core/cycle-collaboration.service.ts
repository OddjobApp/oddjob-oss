import { db } from "@server/database_service.js";
import { 
    operationalCycles, 
    missions, 
    orgs, 
    teams, 
    teamMembers, 
    teamPermissions, 
    cycleTemplates, 
    collaborationEvents,
    users
} from "@shared/schema/index.js";
import { eq, and, sql, inArray, isNull, desc, count, avg } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("CycleCollaboration");

export type TeamRole = 'admin' | 'member' | 'viewer';

export interface Team {
    id: number;
    name: string;
    organizationId: number | null;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface TeamMember {
    id: number;
    userId: string;
    name?: string | null;
    email?: string | null;
    role: string;
    permissions: any;
    joinedAt: Date;
}

export interface TeamPermission {
    id: number;
    teamId: number | null;
    resource: string;
    action: string;
    conditions: any;
}

export interface CycleTemplate {
    id: number;
    name: string;
    description: string | null;
    objective: string;
    category: string;
    blueprints: any;
    tags: any;
    organizationId: number | null;
    createdBy: string;
    isPublic: boolean | null;
    usageCount: number | null;
    rating: number | null;
    createdAt: Date;
}

export interface CollaborationEvent {
    id: number;
    teamId: number | null;
    userId: string;
    action: string;
    resource: string;
    details: any;
    timestamp: Date;
}

export class CycleCollaborationService {
    /**
     * Create a new team
     */
    static async createTeam(data: {
        name: string;
        organizationId: number;
        createdBy: string;
        description?: string;
    }): Promise<Team> {
        logger.info(`[Collab] Creating team: ${data.name}`);
        
        const [team] = await db.insert(teams).values({
            name: data.name,
            organizationId: data.organizationId,
            createdBy: data.createdBy,
            description: data.description || null
        }).returning();
        
        // Add creator as admin
        await db.insert(teamMembers).values({
            teamId: team.id,
            userId: data.createdBy,
            role: 'admin',
            permissions: ['*']
        });
        
        return team;
    }
    
    /**
     * Add member to team
     */
    static async addMember(teamId: number, userId: string, role: TeamRole, permissions: string[]): Promise<void> {
        logger.info(`[Collab] Adding member ${userId} to team ${teamId} with role ${role}`);
        
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) throw new Error("User not found");
        
        const [existing] = await db.select().from(teamMembers)
            .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
            .limit(1);
        if (existing) {
            logger.warn(`[Collab] User ${userId} is already a member of team ${teamId}`);
            return;
        }
        
        await db.insert(teamMembers).values({
            teamId,
            userId,
            role,
            permissions
        });
        
        this.emitCollaborationEvent(teamId, 'member_added', userId, {
            userId,
            role,
            permissions
        });
    }
    
    /**
     * Remove member from team
     */
    static async removeMember(teamId: number, userId: string): Promise<void> {
        logger.info(`[Collab] Removing member ${userId} from team ${teamId}`);
        
        await db.delete(teamMembers).where(
            and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))
        );
        
        this.emitCollaborationEvent(teamId, 'member_removed', userId, { userId });
    }
    
    /**
     * Update team permissions
     */
    static async updateMemberPermissions(teamId: number, userId: string, permissions: string[]): Promise<void> {
        await db.update(teamMembers)
            .set({ permissions })
            .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
        
        this.emitCollaborationEvent(teamId, 'permissions_updated', userId, { permissions });
    }
    
    /**
     * Share cycle with team
     */
    static async shareCycleWithTeam(cycleId: number, teamId: number, sharedBy: string): Promise<void> {
        logger.info(`[Collab] Sharing cycle ${cycleId} with team ${teamId}`);
        
        const [cycle] = await db.select().from(operationalCycles).where(eq(operationalCycles.id, cycleId)).limit(1);
        if (!cycle) throw new Error("Cycle not found");
        
        const hasPermission = await this.checkTeamPermission(teamId, 'cycle', 'view', cycleId);
        if (!hasPermission) {
            throw new Error("Team lacks permission to view this cycle");
        }
        
        await db.update(operationalCycles)
            .set({ 
                metadata: {
                    ...(cycle.metadata as any),
                    sharedWithTeamId: teamId,
                    sharedBy,
                    sharedAt: new Date().toISOString()
                }
            })
            .where(eq(operationalCycles.id, cycleId));
        
        this.emitCollaborationEvent(teamId, 'cycle_shared', sharedBy, { cycleId });
    }
    
    /**
     * Create cycle template
     */
    static async createTemplate(data: {
        name: string;
        description: string;
        objective: string;
        category: string;
        blueprints: any[];
        tags: string[];
        organizationId: number;
        createdBy: string;
        isPublic?: boolean;
    }): Promise<CycleTemplate> {
        logger.info(`[Collab] Creating template: ${data.name}`);
        
        const [template] = await db.insert(cycleTemplates).values({
            ...data,
            usageCount: 0,
            rating: 0
        }).returning();
        
        return template;
    }
    
    /**
     * Get templates available to team
     */
    static async getTeamTemplates(teamId: number): Promise<CycleTemplate[]> {
        const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
        if (!team) return [];
        
        // Corrected subquery logic using inArray or sql
        return db.select().from(cycleTemplates)
            .where(and(
                eq(cycleTemplates.organizationId, team.organizationId || -1),
                sql`${cycleTemplates.isPublic} = true OR ${cycleTemplates.createdBy} IN (
                    SELECT user_id FROM team_members WHERE team_id = ${teamId}
                )`
            ))
            .orderBy(desc(cycleTemplates.usageCount), desc(cycleTemplates.rating));
    }
    
    /**
     * Rate template
     */
    static async rateTemplate(templateId: number, rating: number, userId: string): Promise<void> {
        await db.update(cycleTemplates)
            .set({ rating })
            .where(eq(cycleTemplates.id, templateId));
        
        logger.info(`[Collab] Template ${templateId} rated ${rating} by ${userId}`);
    }
    
    /**
     * Get team cycles
     */
    static async getTeamCycles(teamId: number): Promise<any[]> {
        const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
        if (!team) return [];
        
        return db.select().from(operationalCycles)
            .where(and(
                eq(operationalCycles.organizationId, team.organizationId || -1),
                sql`${operationalCycles.metadata}->>'sharedWithTeamId' = ${teamId}::text OR ${operationalCycles.createdBy} IN (
                    SELECT user_id FROM team_members WHERE team_id = ${teamId}
                )`
            ))
            .orderBy(desc(operationalCycles.createdAt));
    }
    
    /**
     * Check team permission for resource
     */
    static async checkTeamPermission(teamId: number, resource: string, action: string, resourceId?: number): Promise<boolean> {
        const permissions = await db.select().from(teamPermissions)
            .where(eq(teamPermissions.teamId, teamId));
        
        return permissions.some(p => 
            p.resource === resource && 
            p.action === action &&
            (!resourceId || !(p.conditions as any)?.resourceId || (p.conditions as any).resourceId === resourceId)
        );
    }
    
    /**
     * Get team members
     */
    static async getTeamMembers(teamId: number): Promise<TeamMember[]> {
        const result = await db.select({
            id: teamMembers.id,
            userId: teamMembers.userId,
            name: users.username,
            email: users.email,
            role: teamMembers.role,
            permissions: teamMembers.permissions,
            joinedAt: teamMembers.joinedAt
        })
            .from(teamMembers)
            .leftJoin(users, eq(teamMembers.userId, users.id))
            .where(eq(teamMembers.teamId, teamId))
            .orderBy(desc(teamMembers.joinedAt));

        return result as TeamMember[];
    }
    
    /**
     * Emit collaboration event
     */
    private static emitCollaborationEvent(teamId: number, action: string, userId: string, details: any): void {
        eventStream.publish(`team.${teamId}`, {
            action,
            userId,
            details,
            timestamp: new Date()
        }, {
            subject: `team:${teamId}`,
        }, 'cycle-collaboration').catch(() => {});
    }
    
    /**
     * Get collaboration analytics
     */
    static async getCollaborationAnalytics(organizationId: number): Promise<{
        totalTeams: number;
        totalMembers: number;
        sharedCycles: number;
        templatesCreated: number;
        averageRating: number;
        activeCollaborations: number;
    }> {
        const foundTeams = await db.select().from(teams).where(eq(teams.organizationId, organizationId));
        const totalTeams = foundTeams.length;
        
        if (totalTeams === 0) {
            return { totalTeams: 0, totalMembers: 0, sharedCycles: 0, templatesCreated: 0, averageRating: 0, activeCollaborations: 0 };
        }

        const teamIds = foundTeams.map(t => t.id);
        const memberCountResult = await db.select({ count: count() })
            .from(teamMembers)
            .where(inArray(teamMembers.teamId, teamIds));
        const totalMembers = parseInt(String(memberCountResult[0]?.count || 0));
        
        const sharedCountResult = await db.select({ count: count() })
            .from(operationalCycles)
            .where(and(
                eq(operationalCycles.organizationId, organizationId),
                sql`${operationalCycles.metadata}->>'sharedWithTeamId' IS NOT NULL`
            ));
        const sharedCycles = parseInt(String(sharedCountResult[0]?.count || 0));
        
        const templateCountResult = await db.select({ count: count() })
            .from(cycleTemplates)
            .where(eq(cycleTemplates.organizationId, organizationId));
        const templatesCreated = parseInt(String(templateCountResult[0]?.count || 0));
        
        const ratingResult = await db.select({ avg: avg(cycleTemplates.rating) })
            .from(cycleTemplates)
            .where(eq(cycleTemplates.organizationId, organizationId));
        const averageRating = ratingResult[0]?.avg ? parseFloat(String(ratingResult[0].avg)) : 0;
        
        const activeCountResult = await db.select({ count: count() })
            .from(operationalCycles)
            .where(and(
                eq(operationalCycles.organizationId, organizationId),
                eq(operationalCycles.status, 'active'),
                sql`${operationalCycles.updatedAt} > NOW() - INTERVAL '24 hours'`
            ));
        const activeCollaborations = parseInt(String(activeCountResult[0]?.count || 0));
        
        return {
            totalTeams,
            totalMembers,
            sharedCycles,
            templatesCreated,
            averageRating,
            activeCollaborations
        };
    }
    
    /**
     * Get team activity feed
     */
    static async getTeamActivityFeed(teamId: number, limit: number = 50): Promise<CollaborationEvent[]> {
        const events = await db.select()
            .from(collaborationEvents)
            .where(eq(collaborationEvents.teamId, teamId))
            .orderBy(desc(collaborationEvents.timestamp))
            .limit(limit);
        
        return events as CollaborationEvent[];
    }
    
    /**
     * Create team permission
     */
    static async createTeamPermission(teamId: number, resource: string, action: string, conditions: Record<string, any> = {}): Promise<void> {
        await db.insert(teamPermissions).values({
            teamId,
            resource,
            action,
            conditions
        });
    }
    
    /**
     * Update team permission
     */
    static async updateTeamPermission(permissionId: number, conditions: Record<string, any>): Promise<void> {
        await db.update(teamPermissions)
            .set({ conditions })
            .where(eq(teamPermissions.id, permissionId));
    }
    
    /**
     * Delete team permission
     */
    static async deleteTeamPermission(permissionId: number): Promise<void> {
        await db.delete(teamPermissions).where(eq(teamPermissions.id, permissionId));
    }
    
    /**
     * Get team permissions
     */
    static async getTeamPermissions(teamId: number): Promise<TeamPermission[]> {
        const result = await db.select().from(teamPermissions)
            .where(eq(teamPermissions.teamId, teamId));
        return result as TeamPermission[];
    }
}
