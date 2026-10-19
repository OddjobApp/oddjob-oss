
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

async function createBlueprint() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    try {
        const client = await pool.connect();
        try {
            console.log("Creating SDM Mission: Software Registry Alignment...");
            
            // 1. Create the Mission
            const missionRes = await client.query(`
                INSERT INTO missions (name, objective, type, execution_strategy, created_by, organization_id, blackboard)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id;
            `, [
                "Software Registry Alignment",
                "Scan the 'server/domain/' directory for new domain modules, verify they are registered in the Engineering Registry, and update documentation if missing.",
                "supervisor_led",
                "dynamic_autonomous",
                "system",
                1,
                JSON.stringify({
                    scan_path: "server/domain/",
                    registry_check: true,
                    auto_fix: false,
                    messages: [
                        { role: "system", content: "Initiating registry alignment audit. Goal: 100% module visibility." }
                    ]
                })
            ]);

            const missionId = missionRes.rows[0].id;
            console.log(`Created Mission ID: ${missionId}`);

            // 2. Add Member (Job 1: Autonomous Architect)
            // Just in case it's not ID 1, we try to find a job first
            const jobRes = await client.query("SELECT id FROM jobs WHERE type = 'ai_agent' LIMIT 1;");
            const jobId = jobRes.rows[0]?.id || 1;

            await client.query(`
                INSERT INTO mission_members (mission_id, entity_type, entity_id, role)
                VALUES ($1, $2, $3, $4);
            `, [missionId, 'job', jobId, 'lead_architect']);

            // 3. Save as Master Blueprint
            const blueprintConfig = {
                objective: "Scan project domains and synchronize with Engineering Registry.",
                type: "engineering_audit",
                members: [
                    { role: "Lead Architect", entityType: "job", entityId: jobId }
                ],
                blackboard_defaults: {
                    scan_path: "server/domain/",
                    registry_check: true
                }
            };

            await client.query(`
                INSERT INTO mission_templates (name, description, config, version, star_rating, created_by, organization_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7);
            `, [
                "SDM: Software Registry Hygiene",
                "Built-in SDM mission to keep the Engineering Registry in sync with the codebase.",
                JSON.stringify(blueprintConfig),
                "1.0.0",
                5,
                "system",
                1
            ]);

            console.log("SDM Blueprint successfully created and saved to gallery.");
        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error("Error creating blueprint:", err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

createBlueprint();

