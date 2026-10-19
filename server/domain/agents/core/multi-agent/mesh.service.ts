/**
 * Agent Mesh Service
 * 
 * Manages the service mesh topology for multi-agent coordination.
 * Handles agent registration, health monitoring, load balancing,
 * and inter-agent communication channels.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { createLogger } from '../../../../utils/logger.js';
import {
  AgentMesh,
  AgentMeshNode,
  AgentMeshEdge,
  CreateMeshRequest,
  MeshStatusResponse,
  AgentMeshNodeSchema,
  AgentMeshEdgeSchema
} from '../../../../../shared/schema/multi-agent.js';

const logger = createLogger('AgentMeshService');

interface MeshHealthMetrics {
  heartbeats: Map<string, number>;
  failures: Map<string, number>;
  latencies: Map<string, number[]>;
}

export class AgentMeshService extends EventEmitter {
  private meshes: Map<string, AgentMesh> = new Map();
  private healthMetrics: Map<string, MeshHealthMetrics> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.startHealthMonitoring();
  }

  /**
   * Create a new agent mesh
   */
  async createMesh(request: CreateMeshRequest): Promise<AgentMesh> {
    const meshId = randomUUID();
    const now = new Date().toISOString();

    const nodes: AgentMeshNode[] = request.initialNodes?.map((node) => ({
      ...node,
      id: randomUUID(),
      health: 'healthy',
      load: 0,
      lastHeartbeat: now
    })) || [];

    const mesh: AgentMesh = {
      id: meshId,
      name: request.name,
      description: request.description,
      nodes,
      edges: this.buildInitialTopology(nodes),
      createdAt: now,
      updatedAt: now
    };

    this.meshes.set(meshId, mesh);
    this.healthMetrics.set(meshId, {
      heartbeats: new Map(),
      failures: new Map(),
      latencies: new Map()
    });

    logger.info('Created agent mesh', { meshId, name: request.name, nodeCount: nodes.length });
    this.emit('mesh:created', { meshId, nodeCount: nodes.length });

    return mesh;
  }

  /**
   * Build initial topology edges between nodes
   */
  private buildInitialTopology(nodes: AgentMeshNode[]): AgentMeshEdge[] {
    const edges: AgentMeshEdge[] = [];

    // Create a hub-and-spoke topology for initial setup
    const orchestrators = nodes.filter((n) => n.type === 'orchestrator');
    const workers = nodes.filter((n) => n.type === 'worker');
    const specialists = nodes.filter((n) => n.type === 'specialist');

    // Connect orchestrators to each other (fully connected)
    for (let i = 0; i < orchestrators.length; i++) {
      for (let j = i + 1; j < orchestrators.length; j++) {
        edges.push({
          id: randomUUID(),
          sourceId: orchestrators[i].id,
          targetId: orchestrators[j].id,
          protocol: 'internal',
          bidirectional: true,
          active: true
        });
      }
    }

    // Connect workers to orchestrators
    workers.forEach((worker) => {
      orchestrators.forEach((orch) => {
        edges.push({
          id: randomUUID(),
          sourceId: orch.id,
          targetId: worker.id,
          protocol: 'internal',
          bidirectional: true,
          active: true
        });
      });
    });

    // Connect specialists to orchestrators
    specialists.forEach((spec) => {
      orchestrators.forEach((orch) => {
        edges.push({
          id: randomUUID(),
          sourceId: orch.id,
          targetId: spec.id,
          protocol: 'internal',
          bidirectional: true,
          active: true
        });
      });
    });

    // Connect related specialists (same capability)
    const capabilityGroups = new Map<string, AgentMeshNode[]>();
    specialists.forEach((spec) => {
      spec.capabilities.forEach((cap) => {
        if (!capabilityGroups.has(cap)) {
          capabilityGroups.set(cap, []);
        }
        capabilityGroups.get(cap)!.push(spec);
      });
    });

    capabilityGroups.forEach((group) => {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          edges.push({
            id: randomUUID(),
            sourceId: group[i].id,
            targetId: group[j].id,
            protocol: 'internal',
            bidirectional: true,
            active: true
          });
        }
      }
    });

    return edges;
  }

  /**
   * Register a new agent to the mesh
   */
  async registerAgent(
    meshId: string,
    node: Omit<AgentMeshNode, 'id' | 'health' | 'load'>
  ): Promise<AgentMeshNode> {
    const mesh = this.meshes.get(meshId);
    if (!mesh) {
      throw new Error(`Mesh ${meshId} not found`);
    }

    const newNode: AgentMeshNode = {
      ...node,
      id: randomUUID(),
      health: 'healthy',
      load: 0,
      lastHeartbeat: new Date().toISOString()
    };

    mesh.nodes.push(newNode);
    mesh.updatedAt = new Date().toISOString();

    // Create edges to orchestrators
    const orchestrators = mesh.nodes.filter((n) => n.type === 'orchestrator');
    orchestrators.forEach((orch) => {
      mesh.edges.push({
        id: randomUUID(),
        sourceId: orch.id,
        targetId: newNode.id,
        protocol: node.endpoint ? 'http' : 'internal',
        bidirectional: true,
        active: true
      });
    });

    // Initialize health metrics for this node
    const metrics = this.healthMetrics.get(meshId)!;
    metrics.heartbeats.set(newNode.id, Date.now());
    metrics.failures.set(newNode.id, 0);
    metrics.latencies.set(newNode.id, []);

    logger.info('Agent registered to mesh', { meshId, agentId: newNode.id, name: node.name });
    this.emit('agent:registered', { meshId, agentId: newNode.id });

    return newNode;
  }

  /**
   * Unregister an agent from the mesh
   */
  async unregisterAgent(meshId: string, agentId: string): Promise<void> {
    const mesh = this.meshes.get(meshId);
    if (!mesh) {
      throw new Error(`Mesh ${meshId} not found`);
    }

    mesh.nodes = mesh.nodes.filter((n) => n.id !== agentId);
    mesh.edges = mesh.edges.filter((e) => e.sourceId !== agentId && e.targetId !== agentId);
    mesh.updatedAt = new Date().toISOString();

    // Clean up health metrics
    const metrics = this.healthMetrics.get(meshId);
    if (metrics) {
      metrics.heartbeats.delete(agentId);
      metrics.failures.delete(agentId);
      metrics.latencies.delete(agentId);
    }

    logger.info('Agent unregistered from mesh', { meshId, agentId });
    this.emit('agent:unregistered', { meshId, agentId });
  }

  /**
   * Record agent heartbeat
   */
  async heartbeat(meshId: string, agentId: string, metrics?: { load?: number; latency?: number }): Promise<void> {
    const mesh = this.meshes.get(meshId);
    if (!mesh) return;

    const node = mesh.nodes.find((n) => n.id === agentId);
    if (!node) return;

    const now = Date.now();
    node.lastHeartbeat = new Date().toISOString();

    if (metrics?.load !== undefined) {
      node.load = metrics.load;
    }

    const healthMetrics = this.healthMetrics.get(meshId);
    if (healthMetrics) {
      healthMetrics.heartbeats.set(agentId, now);

      if (metrics?.latency !== undefined) {
        const latencies = healthMetrics.latencies.get(agentId) || [];
        latencies.push(metrics.latency);
        // Keep last 100 measurements
        if (latencies.length > 100) latencies.shift();
        healthMetrics.latencies.set(agentId, latencies);
      }
    }

    // Update health status based on load
    if (node.load > 90) {
      node.health = 'degraded';
    } else if (node.load < 95) {
      node.health = 'healthy';
    }
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(() => {
      const now = Date.now();
      const HEARTBEAT_TIMEOUT = 30000; // 30 seconds

      this.meshes.forEach((mesh, meshId) => {
        const metrics = this.healthMetrics.get(meshId);
        if (!metrics) return;

        mesh.nodes.forEach((node) => {
          const lastHeartbeat = metrics.heartbeats.get(node.id);
          if (!lastHeartbeat || now - lastHeartbeat > HEARTBEAT_TIMEOUT) {
            node.health = 'unhealthy';
            const failures = (metrics.failures.get(node.id) || 0) + 1;
            metrics.failures.set(node.id, failures);

            if (failures >= 3) {
              node.health = 'offline';
              logger.warn('Agent marked offline', { meshId, agentId: node.id, failures });
              this.emit('agent:offline', { meshId, agentId: node.id });
            }
          }
        });
      });
    }, 10000); // Check every 10 seconds
  }

  /**
   * Get mesh by ID
   */
  getMesh(meshId: string): AgentMesh | undefined {
    return this.meshes.get(meshId);
  }

  /**
   * Get all meshes
   */
  getAllMeshes(): AgentMesh[] {
    return Array.from(this.meshes.values());
  }

  /**
   * Get mesh status with health metrics
   */
  async getMeshStatus(meshId: string): Promise<MeshStatusResponse> {
    const mesh = this.meshes.get(meshId);
    if (!mesh) {
      throw new Error(`Mesh ${meshId} not found`);
    }

    const metrics = this.healthMetrics.get(meshId)!;
    const healthyNodes = mesh.nodes.filter((n) => n.health === 'healthy').length;
    const activeEdges = mesh.edges.filter((e) => e.active).length;

    // Calculate load distribution
    const loads = mesh.nodes.map((n) => n.load);
    const avgLoad = loads.length > 0 ? loads.reduce((a, b) => a + b, 0) / loads.length : 0;
    const maxLoad = loads.length > 0 ? Math.max(...loads) : 0;

    // Calculate latencies
    let allLatencies: number[] = [];
    metrics.latencies.forEach((lats) => {
      allLatencies = allLatencies.concat(lats);
    });

    const avgLatency = allLatencies.length > 0
      ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length
      : 0;

    const sortedLatencies = [...allLatencies].sort((a, b) => a - b);
    const p95 = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0;
    const p99 = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || 0;

    const loadByNode: Record<string, number> = {};
    mesh.nodes.forEach((n) => {
      loadByNode[n.id] = n.load;
    });

    let overallHealth: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (healthyNodes < mesh.nodes.length * 0.5) {
      overallHealth = 'unhealthy';
    } else if (healthyNodes < mesh.nodes.length * 0.8 || maxLoad > 80) {
      overallHealth = 'degraded';
    }

    return {
      meshId,
      health: {
        overall: overallHealth,
        healthyNodes,
        totalNodes: mesh.nodes.length,
        activeEdges
      },
      load: {
        average: Math.round(avgLoad),
        max: maxLoad,
        byNode: loadByNode
      },
      latency: {
        average: Math.round(avgLatency),
        p95: Math.round(p95),
        p99: Math.round(p99)
      }
    };
  }

  /**
   * Find best agent for a task based on capability and load
   */
  findBestAgent(meshId: string, requiredCapabilities: string[]): AgentMeshNode | null {
    const mesh = this.meshes.get(meshId);
    if (!mesh) return null;

    const candidates = mesh.nodes.filter(
      (n) =>
        n.health === 'healthy' &&
        requiredCapabilities.every((cap) => n.capabilities.includes(cap))
    );

    if (candidates.length === 0) return null;

    // Score by load (lower is better) and capability match
    const scored = candidates.map((node) => {
      const loadScore = 100 - node.load;
      const capabilityScore = requiredCapabilities.filter((cap) =>
        node.capabilities.includes(cap)
      ).length;
      return { node, score: loadScore + capabilityScore * 10 };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].node;
  }

  /**
   * Update agent load
   */
  async updateLoad(meshId: string, agentId: string, load: number): Promise<void> {
    const mesh = this.meshes.get(meshId);
    if (!mesh) return;

    const node = mesh.nodes.find((n) => n.id === agentId);
    if (node) {
      node.load = Math.max(0, Math.min(100, load));
    }
  }

  /**
   * Get mesh topology for visualization
   */
  getTopology(meshId: string): { nodes: AgentMeshNode[]; edges: AgentMeshEdge[] } | null {
    const mesh = this.meshes.get(meshId);
    if (!mesh) return null;

    return {
      nodes: mesh.nodes,
      edges: mesh.edges
    };
  }

  /**
   * Delete a mesh
   */
  async deleteMesh(meshId: string): Promise<void> {
    this.meshes.delete(meshId);
    this.healthMetrics.delete(meshId);
    logger.info('Mesh deleted', { meshId });
    this.emit('mesh:deleted', { meshId });
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.removeAllListeners();
  }
}

export const meshService = new AgentMeshService();
