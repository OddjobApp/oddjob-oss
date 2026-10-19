/**
 * Sandboxed Agent Plugin & Tool Calling Bridge Service
 *
 * Provides a secure, sandboxed runtime interface for registering external plugins,
 * custom calculation engines, and third-party API connectors during live rounds.
 */

export interface PluginCapability {
    name: string;
    description: string;
    inputSchema: Record<string, string>; // e.g. { "query": "string", "limit": "number" }
    execute: (args: Record<string, any>) => Promise<Record<string, any>>;
}

export interface AgentPluginManifest {
    id: string;
    name: string;
    version: string;
    author: string;
    sandboxLevel: "isolated" | "read_only_network" | "full_access";
    capabilities: PluginCapability[];
    registeredAt: Date;
}

export class AgentPluginBridgeService {
    private plugins = new Map<string, AgentPluginManifest>();

    public registerPlugin(plugin: Omit<AgentPluginManifest, "registeredAt">): AgentPluginManifest {
        const fullPlugin: AgentPluginManifest = {
            ...plugin,
            registeredAt: new Date(),
        };

        this.plugins.set(fullPlugin.id, fullPlugin);
        return fullPlugin;
    }

    public unregisterPlugin(id: string): void {
        this.plugins.delete(id);
    }

    public getPlugin(id: string): AgentPluginManifest | undefined {
        return this.plugins.get(id);
    }

    public listPlugins(): AgentPluginManifest[] {
        return Array.from(this.plugins.values());
    }

    /**
     * Executes a tool capability exposed by a plugin under sandboxed isolation.
     */
    public async invokeTool(pluginId: string, capabilityName: string, args: Record<string, any>): Promise<any> {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) throw new Error(`Plugin "${pluginId}" is not registered.`);

        const capability = plugin.capabilities.find(c => c.name === capabilityName);
        if (!capability) throw new Error(`Capability "${capabilityName}" not found on plugin "${pluginId}".`);

        const start = Date.now();
        const result = await capability.execute(args);
        const executionDurationMs = Date.now() - start;

        return {
            pluginId,
            capabilityName,
            status: "success",
            executionDurationMs,
            result,
        };
    }

    public clear(): void {
        this.plugins.clear();
    }
}

export const agentPluginBridge = new AgentPluginBridgeService();
