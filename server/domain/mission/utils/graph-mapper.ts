
import { db } from "../../../database_service.js";
import { missions, missionRuns, jobs, missionMembers, apps, datasets } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";

export interface GraphNode {
    id: string;
    label: string;
    type: 'mission' | 'job' | 'app' | 'dataset' | 'pipeline';
    level: number; // 0=Trigger, 1=Core, 2=Artifact
    tags?: string[];
    metadata?: any;
}

export interface GraphEdge {
    source: string;
    target: string;
    relationship: string;
}

export const graphMapper = {
    /**
     * Generates a structural graph of the Oddjob system's current state,
     * scoped to a single organization.
     *
     * Every query here is tenant-filtered. `missionMembers` carries no
     * organization column of its own, so recruitment edges are constrained to
     * the missions we already resolved for this org rather than read wholesale.
     */
    async getSystemGraph(organizationId: number) {
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];

        // 1. Fetch Missions
        const allMissions = await db.select().from(missions).where(eq(missions.organizationId, organizationId));
        for (const m of allMissions) {
            nodes.push({ id: `m_${m.id}`, label: m.name || "Unnamed Mission", type: 'mission', level: 0, metadata: { objective: m.objective } });
        }

        // 2. Fetch Jobs & Recruitment
        const allJobs = await db.select().from(jobs).where(eq(jobs.organizationId, organizationId));
        for (const j of allJobs) {
            nodes.push({ id: `j_${j.id}`, label: j.name, type: 'job', level: 1, metadata: { persona: (j.config as any)?.persona } });
        }

        // Recruitment edges inherit their tenancy from the parent mission.
        const missionIds = allMissions.map(m => m.id);
        const jobIds = new Set(allJobs.map(j => j.id));
        if (missionIds.length > 0) {
            const recruitment = await db.select().from(missionMembers).where(inArray(missionMembers.missionId, missionIds));
            for (const r of recruitment) {
                // Drop edges pointing at jobs outside this org so the graph never
                // implies the existence of another tenant's node.
                if (r.entityType === 'job' && jobIds.has(r.entityId)) {
                    edges.push({ source: `m_${r.missionId}`, target: `j_${r.entityId}`, relationship: 'recruited' });
                }
            }
        }

        // 3. Fetch Forged Apps
        const missionIdSet = new Set(missionIds);
        const allApps = await db.select().from(apps).where(eq(apps.organizationId, organizationId));
        for (const a of allApps) {
            nodes.push({ id: `a_${a.id}`, label: a.name, type: 'app', level: 2, metadata: { version: a.version, slug: a.slug } });
            // Link to the mission that forged it if available in manifest
            const forgedBy = (a.vNextManifest as any)?.oddjob_mission_id;
            if (forgedBy && missionIdSet.has(Number(forgedBy))) {
                edges.push({ source: `m_${forgedBy}`, target: `a_${a.id}`, relationship: 'forged' });
            }
        }

        // 4. Fetch Datasets
        const allDatasets = await db.select().from(datasets).where(eq(datasets.organizationId, organizationId));
        for (const d of allDatasets) {
            nodes.push({ id: `d_${d.id}`, label: d.name, type: 'dataset', level: 2 });
        }

        return { nodes, edges };
    }
};
