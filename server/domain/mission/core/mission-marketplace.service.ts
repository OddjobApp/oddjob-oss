import { db } from "@server/database_service.js";
import { missionTemplates, missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { MissionManifestSchema, type MissionManifest } from "@shared/manifests/mission-manifest.schema.js";
import { createLogger } from "@server/utils/logger.js";
import { NotFoundError, ValidationError } from "@server/utils/errors.js";

const logger = createLogger("MissionMarketplace");

export class MissionMarketplaceService {
    /**
     * Packages an existing mission into a portable manifest.
     */
    async packageMission(missionId: number): Promise<MissionManifest> {
        const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
        if (!mission) throw new NotFoundError("Mission not found");

        const config = (mission as any).config || {};
        
        const manifest: MissionManifest = {
            manifest_version: "1.0.0",
            metadata: {
                name: mission.name,
                description: mission.objective ?? undefined,
                tags: [],
                version: "1.0.0",
            },
            archetypes: (config.members || []).map((m: any) => ({
                role: m.role,
                description: m.description || "Mission member",
                archetype: m.archetype || "professional",
                personality: m.personality
            })),
            requirements: {
                mcp_servers: config.mcp_servers || [],
                required_api_keys: [],
                min_model_capability: "pro"
            },
            logic: {
                objective: mission.objective || "",
                reasoning_protocol: mission.reasoningProtocol as any || "collaborative_swarm",
                execution_strategy: mission.executionStrategy as any || "pre_planned"
            },
            initial_blackboard: mission.blackboard || {}
        };

        return MissionManifestSchema.parse(manifest);
    }

    /**
     * Unpacks a manifest and creates a new Mission Template.
     */
    async installManifest(manifestData: any, orgId: number, userId: string): Promise<number> {
        const manifest = MissionManifestSchema.parse(manifestData);
        
        logger.info(`Installing Mission Manifest: ${manifest.metadata.name}`);

        const config = {
            objective: manifest.logic.objective,
            members: manifest.archetypes,
            reasoningProtocol: manifest.logic.reasoning_protocol,
            executionStrategy: manifest.logic.execution_strategy,
            mcp_servers: manifest.requirements.mcp_servers,
            initial_blackboard: manifest.initial_blackboard
        };

        const [template] = await db.insert(missionTemplates).values({
            name: manifest.metadata.name,
            description: manifest.metadata.description,
            config,
            organizationId: orgId,
            createdBy: userId,
            version: manifest.metadata.version
        }).returning();

        return template.id;
    }
}

export const missionMarketplaceService = new MissionMarketplaceService();
