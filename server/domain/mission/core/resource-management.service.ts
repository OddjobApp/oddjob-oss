import { db } from "@server/database_service.js";
import { 
    operationalCycles, 
    missionRuns, 
    missions, 
    resourcePools, 
    resourceAllocations,
    teams,
    teamMembers
} from "@shared/schema/index.js";
import { eq, and, sql, sum, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { CycleCollaborationService } from "./cycle-collaboration.service.js";

const logger = createLogger("ResourceManagement");

export interface ResourcePool {
    id: number;
    name: string;
    type: string;
    description: string | null;
    capacity: number | null;
    currentUtilization: number | null;
    metadata: any;
    createdAt: Date;
    updatedAt: Date;
}

export interface ResourceAllocation {
    id: number;
    poolId: number | null;
    cycleId: number | null;
    resourceId: string;
    userId: string | null;
    allocatedAt: Date;
    expiresAt: Date | null;
    autoRelease: boolean | null;
    usage: any;
}

export class ResourceManagementService {
    /**
     * Get all resource pools for an organization
     */
    static async getResourcePools(organizationId: number): Promise<ResourcePool[]> {
        const result = await db.select().from(resourcePools)
            .where(eq(resourcePools.organizationId, organizationId))
            .orderBy(desc(resourcePools.createdAt));
        return result as ResourcePool[];
    }
    
    /**
     * Create a new resource pool
     */
    static async createResourcePool(data: {
        name: string;
        organizationId: number;
        type: string;
        description?: string;
        capacity?: number;
        createdBy: string;
        metadata?: any;
    }): Promise<ResourcePool> {
        logger.info(`[Resources] Creating resource pool: ${data.name}`);
        
        const [pool] = await db.insert(resourcePools).values({
            name: data.name,
            type: data.type,
            organizationId: data.organizationId,
            description: data.description || null,
            capacity: data.capacity || 10,
            createdBy: data.createdBy,
            metadata: data.metadata || {}
        }).returning();

        return pool as ResourcePool;
    }
    
    /**
     * Add resource to pool
     */
    static async addResourceToPool(poolId: number, resource: {
        id: string;
        name: string;
        type: string;
        description?: string;
        required?: boolean;
        userId?: string;
        metadata?: any;
    }): Promise<void> {
        logger.info(`[Resources] Adding ${resource.type} to pool ${poolId}`);
        
        const [pool] = await db.select().from(resourcePools).where(eq(resourcePools.id, poolId)).limit(1);
        if (!pool) throw new Error("Pool not found");

        const currentUtilization = pool.currentUtilization || 0;
        const newUtilization = currentUtilization + 1;
        
        if (newUtilization > (pool.capacity || 10)) {
            logger.warn(`[Resources] Pool ${poolId} at ${newUtilization}/${pool.capacity} capacity. Consider expanding capacity.`);
            return;
        }
        
        await db.insert(resourceAllocations).values({
            poolId,
            resourceId: resource.id,
            userId: resource.userId || null,
            allocatedAt: new Date(),
            autoRelease: false,
            usage: {
                totalRequests: 0,
                lastUsed: null,
                successRate: 0,
                avgResponseTime: 0
            }
        });

        // Update pool utilization
        await db.update(resourcePools)
            .set({ currentUtilization: newUtilization })
            .where(eq(resourcePools.id, poolId));
    }
    
    /**
     * Remove resource from pool
     */
    static async removeResourceFromPool(poolId: number, resourceId: string): Promise<void> {
        logger.info(`[Resources] Removing resource ${resourceId} from pool ${poolId}`);
        
        await db.delete(resourceAllocations).where(
            and(eq(resourceAllocations.poolId, poolId), eq(resourceAllocations.resourceId, resourceId))
        );

        // Update pool utilization
        const [pool] = await db.select().from(resourcePools).where(eq(resourcePools.id, poolId)).limit(1);
        if (pool) {
            await db.update(resourcePools)
                .set({ currentUtilization: Math.max(0, (pool.currentUtilization || 1) - 1) })
                .where(eq(resourcePools.id, poolId));
        }
    }
    
    /**
     * Update resource usage statistics
     */
    static async updateResourceUsage(resourceId: string, usage: any): Promise<void> {
        await db.update(resourceAllocations)
            .set({ usage })
            .where(eq(resourceAllocations.resourceId, resourceId));
    }
    
    /**
     * Get resource allocation for a specific resource
     */
    static async getResourceAllocation(resourceId: string): Promise<ResourceAllocation | null> {
        const [allocation] = await db.select().from(resourceAllocations)
            .where(eq(resourceAllocations.resourceId, resourceId))
            .limit(1);
        return (allocation as ResourceAllocation) || null;
    }
    
    /**
     * Get resource utilization metrics
     */
    static async getResourceUtilization(poolId: number): Promise<{
        totalRequests: number;
        lastUsed: Date | null;
        successRate: number;
        avgResponseTime: number;
        totalTokens: number;
        allocatedResources: number;
    }> {
        const results = await db.select({
            totalRequests: sql`SUM((${resourceAllocations.usage}->>'totalRequests')::int)`,
            lastUsed: sql`MAX((${resourceAllocations.usage}->>'lastUsed')::timestamp)`,
            successRate: sql`AVG((${resourceAllocations.usage}->>'successRate')::float)`,
            avgResponseTime: sql`AVG((${resourceAllocations.usage}->>'avgResponseTime')::float)`,
            totalTokens: sql`SUM((${resourceAllocations.usage}->>'totalTokens')::int)`,
            allocatedResources: sql`COUNT(*)`
        }).from(resourceAllocations)
            .where(eq(resourceAllocations.poolId, poolId));
        
        const usage = results[0];
        
        return {
            totalRequests: parseInt(String(usage?.totalRequests || 0)),
            lastUsed: usage?.lastUsed ? new Date(String(usage.lastUsed)) : null,
            successRate: parseFloat(String(usage?.successRate || 0)),
            avgResponseTime: parseFloat(String(usage?.avgResponseTime || 0)),
            totalTokens: parseInt(String(usage?.totalTokens || 0)),
            allocatedResources: parseInt(String(usage?.allocatedResources || 0))
        };
    }
    
    /**
     * Get all resource allocations for a cycle
     */
    static async getCycleResourceAllocations(cycleId: number): Promise<any[]> {
        return db.select()
            .from(resourceAllocations)
            .innerJoin(resourcePools, eq(resourceAllocations.poolId, resourcePools.id))
            .where(eq(resourceAllocations.cycleId, cycleId))
            .orderBy(desc(resourceAllocations.allocatedAt));
    }
    
    /**
     * Auto-release expired resource allocations
     */
    static async releaseExpiredAllocations(): Promise<void> {
        logger.info(`[Resources] Releasing expired allocations`);
        
        const expiredAllocations = await db.select()
            .from(resourceAllocations)
            .where(and(
                sql`${resourceAllocations.allocatedAt} < NOW() - INTERVAL '1 hour'`,
                eq(resourceAllocations.autoRelease, true)
            ));
        
        for (const allocation of expiredAllocations) {
            await db.delete(resourceAllocations).where(eq(resourceAllocations.id, allocation.id));
            // Update utilization
            if (allocation.poolId) {
                const [pool] = await db.select().from(resourcePools).where(eq(resourcePools.id, allocation.poolId)).limit(1);
                if (pool) {
                    await db.update(resourcePools)
                        .set({ currentUtilization: Math.max(0, (pool.currentUtilization || 1) - 1) })
                        .where(eq(resourcePools.id, pool.id));
                }
            }
        }
    }
    
    /**
     * Get resource pools with high utilization
     */
    static async getHighUtilizationPools(organizationId: number, threshold: number = 0.8): Promise<ResourcePool[]> {
        const pools = await this.getResourcePools(organizationId);
        const results: ResourcePool[] = [];
        
        for (const pool of pools) {
            const utilization = (pool.currentUtilization || 0) / (pool.capacity || 1);
            if (utilization >= threshold) {
                results.push(pool);
            }
        }
        return results;
    }
    
    /**
     * Get idle resource pools
     */
    static async getIdleResourcePools(organizationId: number): Promise<ResourcePool[]> {
        const pools = await this.getResourcePools(organizationId);
        return pools.filter(pool => {
            const utilization = (pool.currentUtilization || 0) / (pool.capacity || 1);
            return utilization < 0.2; 
        });
    }
    
    /**
     * Get resource pools by type
     */
    static async getResourcePoolsByType(organizationId: number, type: string): Promise<ResourcePool[]> {
        const result = await db.select()
            .from(resourcePools)
            .where(and(eq(resourcePools.organizationId, organizationId), eq(resourcePools.type, type)))
            .orderBy(desc(resourcePools.createdAt));
        return result as ResourcePool[];
    }
}
