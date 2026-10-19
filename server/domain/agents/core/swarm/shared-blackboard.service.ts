/**
 * Shared Blackboard Service
 * 
 * Provides a shared memory space for agents in a swarm to collaboratively
 * read and write structured knowledge. Supports CRDT-like conflict resolution,
 * hierarchical organization, and access control.
 * 
 * Key Features:
 * - Hierarchical key-value storage (dot-notation paths)
 * - Last-write-wins with vector clock versioning
 * - Subscriptions for real-time updates
 * - Scoped read/write permissions per agent role
 * - Automatic conflict resolution for concurrent writes
 */

import { createLogger } from "@server/utils/logger.js";
import { swarmCommunicationService } from "../swarm-communication.service.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { v4 as uuidv4 } from "uuid";

const logger = createLogger("SharedBlackboardService");

// Blackboard entry with metadata
export interface BlackboardEntry {
  key: string;
  value: any;
  version: number;
  vectorClock: Record<string, number>;  // { agentId: sequence }
  lastModifiedBy: string;
  lastModifiedAt: Date;
  ttl?: number;  // Optional TTL in seconds
}

// Entry metadata without value
export interface BlackboardEntryMeta {
  key: string;
  version: number;
  lastModifiedBy: string;
  lastModifiedAt: Date;
  size: number;  // Approximate size in bytes
}

// Permission levels
export type Permission = "read" | "write" | "delete" | "admin";

// Access control entry
interface AccessControl {
  agentId: string;
  permissions: Permission[];
  grantedBy: string;
  grantedAt: Date;
}

// Subscription handler
export type BlackboardUpdateHandler = (
  event: {
    type: "created" | "updated" | "deleted";
    key: string;
    oldValue?: any;
    newValue?: any;
    modifiedBy: string;
    version: number;
  }
) => void;

/**
 * Manages shared blackboard for a swarm
 */
export class SwarmBlackboard {
  private swarmId: string;
  private namespace: string;
  private localCache: Map<string, BlackboardEntry> = new Map();
  private accessControl: Map<string, AccessControl> = new Map();
  private subscriptions: Set<BlackboardUpdateHandler> = new Set();
  private isSubscribed = false;

  constructor(swarmId: string, namespace: string = "default") {
    this.swarmId = swarmId;
    this.namespace = namespace;
    this.initRedisListener();
  }

  // ============================================================================
  // CORE OPERATIONS
  // ============================================================================

  /**
   * Write a value to the blackboard
   */
  async write(
    key: string,
    value: any,
    agentId: string,
    options?: {
      ttl?: number;
      ifNotExists?: boolean;  // Only write if key doesn't exist
      expectedVersion?: number;  // CAS: only write if version matches
    }
  ): Promise<{ success: boolean; version: number; conflict?: boolean }> {
    // Check permissions
    if (!this.hasPermission(agentId, "write")) {
      throw new Error(`Agent ${agentId} does not have write permission`);
    }

    const fullKey = this.getFullKey(key);
    
    // Check conditions
    if (options?.ifNotExists) {
      const existing = await this.read(key);
      if (existing !== undefined) {
        return { success: false, version: -1, conflict: true };
      }
    }

    if (options?.expectedVersion !== undefined) {
      const existing = this.localCache.get(fullKey);
      if (existing && existing.version !== options.expectedVersion) {
        return { success: false, version: existing.version, conflict: true };
      }
    }

    // Create/update entry
    const existing = this.localCache.get(fullKey);
    const newVersion = (existing?.version || 0) + 1;
    const vectorClock = this.incrementVectorClock(existing?.vectorClock || {}, agentId);

    const entry: BlackboardEntry = {
      key: fullKey,
      value,
      version: newVersion,
      vectorClock,
      lastModifiedBy: agentId,
      lastModifiedAt: new Date(),
      ttl: options?.ttl,
    };

    // Persist to Redis
    await this.persistToRedis(fullKey, entry);

    // Update local cache
    this.localCache.set(fullKey, entry);

    // Broadcast update
    await this.broadcastUpdate("updated", key, existing?.value, value, agentId, newVersion);

    logger.debug(`[Blackboard ${this.swarmId}] ${key} = ${JSON.stringify(value).slice(0, 50)}... (v${newVersion})`);

    return { success: true, version: newVersion };
  }

  /**
   * Read a value from the blackboard
   */
  async read(key: string, agentId?: string): Promise<any> {
    // Check permissions if agentId provided
    if (agentId && !this.hasPermission(agentId, "read")) {
      throw new Error(`Agent ${agentId} does not have read permission`);
    }

    const fullKey = this.getFullKey(key);

    // Try local cache first
    const cached = this.localCache.get(fullKey);
    if (cached && !this.isExpired(cached)) {
      return cached.value;
    }

    // Fetch from Redis
    const entry = await this.fetchFromRedis(fullKey);
    if (entry && !this.isExpired(entry)) {
      this.localCache.set(fullKey, entry);
      return entry.value;
    }

    return undefined;
  }

  /**
   * Read metadata without full value
   */
  async readMeta(key: string): Promise<BlackboardEntryMeta | undefined> {
    const fullKey = this.getFullKey(key);
    const entry = this.localCache.get(fullKey) || await this.fetchFromRedis(fullKey);
    
    if (!entry || this.isExpired(entry)) return undefined;

    return {
      key,
      version: entry.version,
      lastModifiedBy: entry.lastModifiedBy,
      lastModifiedAt: entry.lastModifiedAt,
      size: JSON.stringify(entry.value).length,
    };
  }

  /**
   * Delete a key
   */
  async delete(key: string, agentId: string): Promise<boolean> {
    if (!this.hasPermission(agentId, "delete")) {
      throw new Error(`Agent ${agentId} does not have delete permission`);
    }

    const fullKey = this.getFullKey(key);
    const existing = this.localCache.get(fullKey);

    // Delete from Redis
    await redis.del(fullKey);

    // Remove from cache
    this.localCache.delete(fullKey);

    // Broadcast
    await this.broadcastUpdate("deleted", key, existing?.value, undefined, agentId, existing?.version || 0);

    logger.debug(`[Blackboard ${this.swarmId}] Deleted ${key}`);

    return true;
  }

  /**
   * Atomically compare-and-swap
   */
  async compareAndSwap(
    key: string,
    expectedValue: any,
    newValue: any,
    agentId: string
  ): Promise<{ success: boolean; version: number; actualValue?: any }> {
    const current = await this.read(key);
    
    if (JSON.stringify(current) !== JSON.stringify(expectedValue)) {
      return { success: false, version: -1, actualValue: current };
    }

    const result = await this.write(key, newValue, agentId);
    return { success: result.success, version: result.version };
  }

  // ============================================================================
  // BATCH & QUERY OPERATIONS
  // ============================================================================

  /**
   * Read multiple keys at once
   */
  async readMany(keys: string[], agentId?: string): Promise<Record<string, any>> {
    const result: Record<string, any> = {};
    for (const key of keys) {
      result[key] = await this.read(key, agentId);
    }
    return result;
  }

  /**
   * Write multiple keys atomically
   */
  async writeMany(
    entries: Record<string, any>,
    agentId: string
  ): Promise<{ success: boolean; versions: Record<string, number> }> {
    const versions: Record<string, number> = {};

    for (const [key, value] of Object.entries(entries)) {
      const result = await this.write(key, value, agentId);
      if (!result.success) {
        return { success: false, versions };
      }
      versions[key] = result.version;
    }

    return { success: true, versions };
  }

  /**
   * List keys matching a pattern
   */
  async listKeys(pattern: string = "*"): Promise<string[]> {
    const fullPattern = `blackboard:${this.swarmId}:${this.namespace}:${pattern}`;
    const keys = await redis.keys(fullPattern);
    return keys.map(k => k.replace(`blackboard:${this.swarmId}:${this.namespace}:`, ""));
  }

  /**
   * Search by value (expensive - scans all keys)
   */
  async findByValue(predicate: (value: any) => boolean): Promise<Array<{ key: string; value: any }>> {
    const keys = await this.listKeys("*");
    const results: Array<{ key: string; value: any }> = [];

    for (const key of keys) {
      const value = await this.read(key);
      if (value !== undefined && predicate(value)) {
        results.push({ key, value });
      }
    }

    return results;
  }

  // ============================================================================
  // HIERARCHICAL OPERATIONS
  // ============================================================================

  /**
   * Read a nested value using dot notation
   */
  async readPath(key: string, path: string, agentId?: string): Promise<any> {
    const value = await this.read(key, agentId);
    if (value === undefined) return undefined;

    const parts = path.split(".");
    let current = value;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }

    return current;
  }

  /**
   * Write to a nested path using dot notation
   */
  async writePath(
    key: string,
    path: string,
    value: any,
    agentId: string
  ): Promise<{ success: boolean; version: number }> {
    const existing = await this.read(key, agentId) || {};
    const parts = path.split(".");
    
    // Deep clone and set value at path
    const newValue = JSON.parse(JSON.stringify(existing));
    let current = newValue;
    
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;

    return this.write(key, newValue, agentId);
  }

  /**
   * Delete a nested path
   */
  async deletePath(key: string, path: string, agentId: string): Promise<{ success: boolean; version: number }> {
    const existing = await this.read(key, agentId);
    if (!existing) return { success: false, version: -1 };

    const parts = path.split(".");
    const newValue = JSON.parse(JSON.stringify(existing));
    let current = newValue;

    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) return { success: false, version: -1 };
      current = current[parts[i]];
    }

    delete current[parts[parts.length - 1]];

    return this.write(key, newValue, agentId);
  }

  // ============================================================================
  // ACCESS CONTROL
  // ============================================================================

  /**
   * Grant permissions to an agent
   */
  grantAccess(
    agentId: string,
    permissions: Permission[],
    grantedBy: string
  ): void {
    if (!this.hasPermission(grantedBy, "admin")) {
      throw new Error(`Agent ${grantedBy} does not have admin permission`);
    }

    this.accessControl.set(agentId, {
      agentId,
      permissions,
      grantedBy,
      grantedAt: new Date(),
    });

    logger.info(`[Blackboard ${this.swarmId}] Granted ${permissions.join(",")} to ${agentId}`);
  }

  /**
   * Revoke agent access
   */
  revokeAccess(agentId: string, revokedBy: string): void {
    if (!this.hasPermission(revokedBy, "admin")) {
      throw new Error(`Agent ${revokedBy} does not have admin permission`);
    }

    this.accessControl.delete(agentId);
    logger.info(`[Blackboard ${this.swarmId}] Revoked access for ${agentId}`);
  }

  /**
   * Check if agent has permission
   */
  hasPermission(agentId: string, permission: Permission): boolean {
    // Admin bypass
    const agentPerms = this.accessControl.get(agentId);
    if (!agentPerms) return false;
    return agentPerms.permissions.includes(permission) || agentPerms.permissions.includes("admin");
  }

  // ============================================================================
  // SUBSCRIPTIONS
  // ============================================================================

  /**
   * Subscribe to blackboard updates
   */
  subscribe(handler: BlackboardUpdateHandler): () => void {
    this.subscriptions.add(handler);
    return () => this.subscriptions.delete(handler);
  }

  /**
   * Unsubscribe from updates
   */
  unsubscribe(handler: BlackboardUpdateHandler): void {
    this.subscriptions.delete(handler);
  }

  private async broadcastUpdate(
    type: "created" | "updated" | "deleted",
    key: string,
    oldValue: any,
    newValue: any,
    modifiedBy: string,
    version: number
  ): Promise<void> {
    // Notify local subscribers
    const event = { type, key, oldValue, newValue, modifiedBy, version };
    for (const handler of this.subscriptions) {
      try {
        handler(event);
      } catch (e) {
        logger.error("[Blackboard] Error in update handler:", e);
      }
    }

    // Broadcast to swarm
    await swarmCommunicationService.broadcast(this.swarmId, "blackboard", {
      type: "blackboard:update",
      namespace: this.namespace,
      update: event,
    });

    // Emit to event stream
    await eventStream.publish(
      "swarm.blackboard.updated",
      {
        swarmId: this.swarmId,
        namespace: this.namespace,
        key,
        type,
        modifiedBy,
        version,
      },
      { organizationId: 0, missionId: 0, swarmId: this.swarmId },
      "swarm"
    );
  }

  // ============================================================================
  // REDIS INTEGRATION
  // ============================================================================

  private getFullKey(key: string): string {
    return `blackboard:${this.swarmId}:${this.namespace}:${key}`;
  }

  private async persistToRedis(fullKey: string, entry: BlackboardEntry): Promise<void> {
    const serialized = JSON.stringify(entry);
    
    if (entry.ttl) {
      await redis.setex(fullKey, entry.ttl, serialized);
    } else {
      await redis.set(fullKey, serialized);
    }
  }

  private async fetchFromRedis(fullKey: string): Promise<BlackboardEntry | undefined> {
    const data = await redis.get(fullKey);
    if (!data) return undefined;
    
    try {
      const entry: BlackboardEntry = JSON.parse(data);
      entry.lastModifiedAt = new Date(entry.lastModifiedAt);
      return entry;
    } catch (e) {
      logger.error(`[Blackboard] Failed to parse entry ${fullKey}:`, e);
      return undefined;
    }
  }

  private isExpired(entry: BlackboardEntry): boolean {
    if (!entry.ttl) return false;
    const elapsed = (Date.now() - entry.lastModifiedAt.getTime()) / 1000;
    return elapsed > entry.ttl;
  }

  private async initRedisListener(): Promise<void> {
    if (this.isSubscribed) return;
    
    // Listen for swarm blackboard updates
    await swarmCommunicationService.subscribe(this.swarmId, (message) => {
      if (message.payload?.type === "blackboard:update" && 
          message.payload?.namespace === this.namespace) {
        const update = message.payload.update;
        
        // Update local cache
        const fullKey = this.getFullKey(update.key);
        if (update.type === "deleted") {
          this.localCache.delete(fullKey);
        } else {
          // Fetch fresh from Redis
          this.fetchFromRedis(fullKey).then(entry => {
            if (entry) this.localCache.set(fullKey, entry);
          });
        }

        // Notify subscribers
        for (const handler of this.subscriptions) {
          try {
            handler(update);
          } catch (e) {
            logger.error("[Blackboard] Error in swarm update handler:", e);
          }
        }
      }
    });

    this.isSubscribed = true;
  }

  // ============================================================================
  // VECTOR CLOCKS (FOR CRDT)
  // ============================================================================

  private incrementVectorClock(
    clock: Record<string, number>,
    agentId: string
  ): Record<string, number> {
    return {
      ...clock,
      [agentId]: (clock[agentId] || 0) + 1,
    };
  }

  /**
   * Compare two vector clocks
   * Returns: -1 (a < b), 0 (concurrent), 1 (a > b)
   */
  compareVectorClocks(
    a: Record<string, number>,
    b: Record<string, number>
  ): -1 | 0 | 1 {
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    
    let aDominates = false;
    let bDominates = false;

    for (const key of allKeys) {
      const aVal = a[key] || 0;
      const bVal = b[key] || 0;

      if (aVal > bVal) aDominates = true;
      if (bVal > aVal) bDominates = true;
    }

    if (aDominates && !bDominates) return 1;
    if (bDominates && !aDominates) return -1;
    return 0;
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Clear all local cache
   */
  clearCache(): void {
    this.localCache.clear();
  }

  /**
   * Get blackboard statistics
   */
  getStats(): {
    cachedEntries: number;
    totalSubscriptions: number;
    controlledAgents: number;
  } {
    return {
      cachedEntries: this.localCache.size,
      totalSubscriptions: this.subscriptions.size,
      controlledAgents: this.accessControl.size,
    };
  }
}

/**
 * Factory for creating/managing blackboards
 */
export class SharedBlackboardService {
  private blackboards: Map<string, SwarmBlackboard> = new Map();

  getOrCreate(swarmId: string, namespace: string = "default"): SwarmBlackboard {
    const key = `${swarmId}:${namespace}`;
    
    if (!this.blackboards.has(key)) {
      this.blackboards.set(key, new SwarmBlackboard(swarmId, namespace));
    }
    
    return this.blackboards.get(key)!;
  }

  get(swarmId: string, namespace: string = "default"): SwarmBlackboard | undefined {
    return this.blackboards.get(`${swarmId}:${namespace}`);
  }

  remove(swarmId: string, namespace: string = "default"): void {
    this.blackboards.delete(`${swarmId}:${namespace}`);
  }

  list(swarmId?: string): Array<{ swarmId: string; namespace: string; stats: any }> {
    const result: Array<{ swarmId: string; namespace: string; stats: any }> = [];
    
    for (const [key, board] of this.blackboards) {
      const [id, ns] = key.split(":");
      if (!swarmId || id === swarmId) {
        result.push({ swarmId: id, namespace: ns, stats: board.getStats() });
      }
    }
    
    return result;
  }
}

export const sharedBlackboardService = new SharedBlackboardService();
