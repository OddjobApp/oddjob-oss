import { createLogger } from "@server/utils/logger.js";
import { redis } from "./redis/redis-client.js";
import { moeRoutingService } from "./moe-routing.service.js";
import { createRemotePodProxy } from "./remote-pod-proxy.js";
import { randomUUID } from "crypto";

const logger = createLogger("PodRegistry");

/**
 * Simple LRU cache for remote pod locations to avoid repeated Redis lookups
 */
class RemotePodCache {
    private cache = new Map<string, { url: string; apiKey: string; timestamp: number }>();
    private maxSize = 500;
    private ttl = 30000; // 30s TTL matches heartbeat interval

    get(podName: string): { url: string; apiKey: string } | null {
        const entry = this.cache.get(podName);
        if (!entry) return null;

        // Check if entry is still valid
        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(podName);
            return null;
        }

        // Move to end (most recently used)
        this.cache.delete(podName);
        this.cache.set(podName, entry);
        return { url: entry.url, apiKey: entry.apiKey };
    }

    set(podName: string, url: string, apiKey: string): void {
        if (this.cache.size >= this.maxSize) {
            // Remove least recently used (first entry)
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
        this.cache.set(podName, { url, apiKey, timestamp: Date.now() });
    }

    invalidate(podName: string): void {
        this.cache.delete(podName);
    }

    clear(): void {
        this.cache.clear();
    }
}

/**
 * PodRegistry
 * 
 * A central service for domain "pods" to register their public interfaces.
 * Now enhanced for distributed operation:
 * 1. Tracks local pods in memory.
 * 2. Syncs pod locations in Redis for global discovery.
 * 3. Transparently proxies calls to remote pods via RPC if not local.
 * 4. Caches remote pod locations to reduce Redis lookups.
 */
class PodRegistry {
    private localPods = new Map<string, any>();
    private initializationOrder: string[] = [];
    private listeners: (() => void)[] = [];
    
    // Unique identifier for this server instance
    public readonly serverId = `server-${randomUUID().slice(0, 8)}`;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private remotePodCache = new RemotePodCache();

    /**
     * Registers a pod's public facade locally and globally.
     * Kept synchronous so all existing callers don't need to change.
     * Redis registration is fire-and-forget (non-critical path).
     */
    register(podName: string, facade: any): void {
        if (this.localPods.has(podName)) {
            logger.warn(`Pod [${podName}] is already registered locally. Overwriting.`);
        }
        this.localPods.set(podName, facade);
        this.initializationOrder.push(podName);
        logger.info(`Pod [${podName}] successfully registered in local registry.`);

        // Register with MoE routing if enabled
        if (process.env.ENABLE_MOE_ROUTING === "true") {
            moeRoutingService.registerExpert(podName, this.inferPodExpertise(podName));
        }

        // Fire-and-forget global registration — never blocks the caller
        if (redis) {
            const serverUrl = process.env.INTERNAL_URL || `http://localhost:${process.env.PORT || 5000}`;
            redis.hset("pods:registry", podName, JSON.stringify({
                serverId: this.serverId,
                url: serverUrl,
                lastSeen: Date.now()
            })).catch(err =>
                logger.warn(`[PodRegistry] Global registration failed for ${podName}: ${err.message}`)
            );
        }
    }

    /**
     * Start the heartbeat to keep global registration alive.
     * Uses Redis pipeline to batch operations and reduce network round-trips.
     */
    startHeartbeat() {
        if (this.heartbeatInterval) return;
        
        this.heartbeatInterval = setInterval(async () => {
            try {
                if (!redis) return;
                const podNames = Array.from(this.localPods.keys());
                const serverUrl = process.env.INTERNAL_URL || `http://localhost:${process.env.PORT || 5000}`;
                
                if (podNames.length === 0) return;

                // Use Redis pipeline for single round-trip batch operation
                const pipeline = redis.multi();
                for (const name of podNames) {
                    pipeline.hset("pods:registry", name, JSON.stringify({
                        serverId: this.serverId,
                        url: serverUrl,
                        lastSeen: Date.now()
                    }));
                }
                await pipeline.exec();
                
                logger.debug(`[PodRegistry] Heartbeat completed for ${podNames.length} pods via pipeline`);
            } catch (err) {
                logger.error("PodRegistry heartbeat failure", err);
            }
        }, 30000); // 30s heartbeat
    }

    /**
     * Registers a listener initialization function.
     */
    registerListener(initFn: () => void): void {
        this.listeners.push(initFn);
    }

    /**
     * Initializes all registered pod listeners.
     */
    initializeListeners(): void {
        logger.info(`Initializing ${this.listeners.length} pod listeners...`);
        for (const initFn of this.listeners) {
            try {
                initFn();
            } catch (err) {
                logger.error("Failed to initialize pod listener", err);
            }
        }
        this.startHeartbeat();
    }

    /**
     * Retrieves a pod facade. 
     * Returns local instance if available, otherwise attempts to return a remote proxy.
     * Uses LRU cache for remote pod locations to reduce Redis lookups.
     */
    async getPod<T = any>(podName: string): Promise<T> {
        // 1. Check local registry
        const localPod = this.localPods.get(podName);
        if (localPod) return localPod as T;

        // 2. Check cache for remote pod location
        const cached = this.remotePodCache.get(podName);
        if (cached) {
            logger.debug(`[PodRegistry] Pod [${podName}] found in cache at ${cached.url}`);
            return createRemotePodProxy<T>(podName, cached.url, cached.apiKey);
        }

        // 3. Check global registry in Redis (cache miss)
        if (redis) {
            const remoteInfoJson = await redis.hget("pods:registry", podName);
            if (remoteInfoJson) {
                const remoteInfo = JSON.parse(remoteInfoJson);
                
                // If it's not actually this server (safety check)
                if (remoteInfo.serverId !== this.serverId) {
                    const apiKey = process.env.INTERNAL_RPC_KEY || "oddjob-internal-secret";
                    logger.info(`[PodRegistry] Pod [${podName}] found on remote server ${remoteInfo.url}. Creating proxy and caching.`);
                    
                    // Cache the remote pod location
                    this.remotePodCache.set(podName, remoteInfo.url, apiKey);
                    
                    // Register with MoE routing if enabled
                    if (process.env.ENABLE_MOE_ROUTING === "true") {
                        moeRoutingService.registerExpert(podName, this.inferPodExpertise(podName));
                    }
                    
                    return createRemotePodProxy<T>(podName, remoteInfo.url, apiKey);
                }
            }
        }

        throw new Error(`PodRegistry: Pod [${podName}] not found locally or globally.`);
    }

    /**
     * Infer pod expertise from name for MoE routing
     */
    private inferPodExpertise(podName: string): string[] {
        const expertise: string[] = [];
        const nameLower = podName.toLowerCase();

        if (nameLower.includes('knowledge')) expertise.push('knowledge', 'rag', 'retrieval');
        if (nameLower.includes('agent')) expertise.push('agent', 'reasoning', 'planning');
        if (nameLower.includes('browser')) expertise.push('browser', 'selenium', 'automation');
        if (nameLower.includes('extraction')) expertise.push('extraction', 'parsing', 'data');
        if (nameLower.includes('messaging')) expertise.push('messaging', 'email', 'communication');
        if (nameLower.includes('control')) expertise.push('control', 'orchestration', 'coordination');

        return expertise.length > 0 ? expertise : ['general'];
    }

    /**
     * Sync version (will only return local pods)
     */
    getPodSync<T = any>(podName: string): T {
        const pod = this.localPods.get(podName);
        if (!pod) {
            throw new Error(`PodRegistry: Pod [${podName}] not found locally. Use async getPod() for remote discovery.`);
        }
        return pod as T;
    }

    /**
     * What the registry actually knows about each locally registered pod.
     *
     * This used to also return an `intelligenceDensity`, which was not a
     * measurement of anything: it was 0.85 for three hardcoded pod names and
     * 0.65 otherwise, plus an offset derived from the character codes of the
     * pod's own name. Two consumers presented it as real — SystemPulse rendered
     * it as a percentage with a progress bar on a five-second poll (it could
     * never change, being a pure function of the name), and the docs synthesizer
     * wrote it into generated architecture documentation as an "Intelligence
     * Density" column.
     *
     * Removed rather than replaced. Inventing a new definition would be the same
     * mistake with better arithmetic; if a density metric is wanted, it needs a
     * real source first.
     */
    getPodMetadata(): Array<{ name: string; hasFacade: boolean }> {
        return Array.from(this.localPods.keys()).map(name => ({
            name,
            hasFacade: true,
        }));
    }

    listLocalPods(): string[] {
        return Array.from(this.localPods.keys());
    }

    /** @deprecated Use listLocalPods() */
    listRegisteredPods(): string[] {
        return this.listLocalPods();
    }

    hasPod(podName: string): boolean {
        return this.localPods.has(podName);
    }
}

export const podRegistry = new PodRegistry();
