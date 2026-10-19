/**
 * Cross-Mission Swarm Registry
 *
 * Extends the single-mission swarm model to support swarms that span
 * multiple missions within an organization. Agents from Mission A can
 * discover, join, and contribute to swarms initiated by Mission B.
 *
 * Architecture:
 * - Registry is org-scoped and stored in Redis (TTL = 24h)
 * - Each swarm entry carries a set of participating missionIds
 * - Shared blackboard is keyed by swarm ID, not by missionId
 * - Agents signal intent via `join` and depart via `leave`
 */

import { createLogger } from "@server/utils/logger.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { swarmCoordinator, SwarmConfig } from "./swarm-coordinator.service.js";
import { v4 as uuidv4 } from "uuid";

const logger = createLogger("CrossMissionSwarmRegistry");

const REGISTRY_TTL_SECONDS = 86400; // 24 hours

export interface CrossMissionSwarmEntry {
  swarmId: string;
  name: string;
  goal: string;
  organizationId: number;
  missionIds: number[];       // All participating missions
  agentIds: string[];
  status: "forming" | "active" | "dissolving" | "dissolved";
  createdAt: string;
  createdByMissionId: number;
}

export interface SwarmJoinRequest {
  swarmId: string;
  missionId: number;
  agentId: string;
  role?: string;
}

class CrossMissionSwarmRegistryService {
  private registryKey(orgId: number) {
    return `cross_mission_swarms:org:${orgId}`;
  }

  // =========================================================================
  // REGISTRY CRUD
  // =========================================================================

  /**
   * Initiates a new cross-mission swarm, readable by any mission in the org.
   */
  async createSwarm(
    orgId: number,
    createdByMissionId: number,
    goal: string,
    name: string
  ): Promise<CrossMissionSwarmEntry> {
    const swarmId = uuidv4();

    const entry: CrossMissionSwarmEntry = {
      swarmId,
      name,
      goal,
      organizationId: orgId,
      missionIds: [createdByMissionId],
      agentIds: [],
      status: "forming",
      createdAt: new Date().toISOString(),
      createdByMissionId,
    };

    // Persist to registry
    await this.upsertEntry(orgId, entry);

    // Also create the underlying swarm in SwarmCoordinator
    const config: SwarmConfig = {
      name,
      organizationId: orgId,
      missionId: createdByMissionId,
      goal,
    };
    await swarmCoordinator.createSwarm(config);

    await eventStream.publish("cross_mission_swarm.created", { swarmId, orgId, createdByMissionId, goal });
    logger.info(`[CrossMissionSwarmRegistry] Created swarm ${swarmId} from mission ${createdByMissionId}`);

    return entry;
  }

  /**
   * Lists all active cross-mission swarms for an org.
   */
  async listActiveSwarms(orgId: number): Promise<CrossMissionSwarmEntry[]> {
    try {
      const raw = await redis.get(this.registryKey(orgId));
      if (!raw) return [];
      const all: CrossMissionSwarmEntry[] = JSON.parse(raw);
      return all.filter(s => s.status !== "dissolved");
    } catch (err: any) {
      logger.warn(`[CrossMissionSwarmRegistry] Failed to list swarms for org ${orgId}: ${err.message}`);
      return [];
    }
  }

  /**
   * Gets a specific swarm by ID.
   */
  async getSwarm(orgId: number, swarmId: string): Promise<CrossMissionSwarmEntry | null> {
    const swarms = await this.listActiveSwarms(orgId);
    return swarms.find(s => s.swarmId === swarmId) || null;
  }

  /**
   * Allows a mission's agent to join an existing cross-mission swarm.
   */
  async joinSwarm(req: SwarmJoinRequest, orgId: number): Promise<{ success: boolean; message: string }> {
    const entry = await this.getSwarm(orgId, req.swarmId);
    if (!entry) return { success: false, message: "Swarm not found" };
    if (entry.status === "dissolved" || entry.status === "dissolving") {
      return { success: false, message: "Swarm is no longer active" };
    }

    // Add mission + agent if not already present
    if (!entry.missionIds.includes(req.missionId)) entry.missionIds.push(req.missionId);
    if (!entry.agentIds.includes(req.agentId)) entry.agentIds.push(req.agentId);
    if (entry.status === "forming") entry.status = "active";

    await this.upsertEntry(orgId, entry);

    await eventStream.publish("cross_mission_swarm.agent_joined", {
      swarmId: req.swarmId,
      missionId: req.missionId,
      agentId: req.agentId,
      orgId,
    });

    logger.info(`[CrossMissionSwarmRegistry] Agent ${req.agentId} from mission ${req.missionId} joined swarm ${req.swarmId}`);
    return { success: true, message: "Joined swarm" };
  }

  /**
   * Removes an agent from a swarm. If no agents remain, dissolves it.
   */
  async leaveSwarm(swarmId: string, agentId: string, orgId: number): Promise<void> {
    const entry = await this.getSwarm(orgId, swarmId);
    if (!entry) return;

    entry.agentIds = entry.agentIds.filter(id => id !== agentId);
    if (entry.agentIds.length === 0) entry.status = "dissolved";

    await this.upsertEntry(orgId, entry);
    logger.info(`[CrossMissionSwarmRegistry] Agent ${agentId} left swarm ${swarmId}`);
  }

  /**
   * Returns swarms that a given mission is participating in.
   */
  async getSwarmsByMission(orgId: number, missionId: number): Promise<CrossMissionSwarmEntry[]> {
    const all = await this.listActiveSwarms(orgId);
    return all.filter(s => s.missionIds.includes(missionId));
  }

  // =========================================================================
  // INTERNAL HELPERS
  // =========================================================================

  private async upsertEntry(orgId: number, entry: CrossMissionSwarmEntry): Promise<void> {
    const existing = await this.listActiveSwarms(orgId);
    const idx = existing.findIndex(s => s.swarmId === entry.swarmId);
    if (idx >= 0) {
      existing[idx] = entry;
    } else {
      existing.push(entry);
    }
    await redis.set(this.registryKey(orgId), JSON.stringify(existing), "EX", REGISTRY_TTL_SECONDS);
  }
}

export const crossMissionSwarmRegistry = new CrossMissionSwarmRegistryService();
