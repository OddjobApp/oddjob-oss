
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

async function seedCrewToolkit() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    try {
        const client = await pool.connect();
        try {
            console.log("Seeding CREW Toolkit (Jobs & Skills)...");

            // 1. Seed Skills (Metacognition)
            const skillsToSeed = [
                {
                    name: "vibe_auditor",
                    description: "Analyzes output against qualitative vibe intent and identifies drift.",
                    language: "javascript",
                    code: `
                    export async function execute(params, context) {
                        const { output, vibe_intent } = params;
                        // In a real implementation, this would call an LLM to compare
                        return {
                            alignment_score: 0.85,
                            drift_detected: false,
                            critique: "Output matches the qualitative intent well."
                        };
                    }`
                },
                {
                    name: "strategic_reflector",
                    description: "Synthesizes wave results into lessons learned and backlog updates.",
                    language: "javascript",
                    code: `
                    export async function execute(params, context) {
                        const { results, previous_backlog } = params;
                        };
                    }`
                },
                {
                    name: "app_forger",
                    description: "Triggers the industrial App Forge to scaffold and containerize a new mini-app based on a blueprint.",
                    language: "javascript",
                    code: `
                    import { appForgeService } from "../../domain/apps/app-forge.service.js";
                    export async function execute(params, context) {
                        const { blueprint_slug, app_name, app_slug, description } = params;
                        const result = await appForgeService.forgeApp(blueprint_slug, {
                            name: app_name,
                            slug: app_slug,
                            description: description,
                            oddjobMissionId: context.missionId
                        });
                        return result;
                    }`
                }
            ];

            for (const skill of skillsToSeed) {
                const { rows } = await client.query("SELECT id FROM skills WHERE name = $1", [skill.name]);
                if (rows.length === 0) {
                    await client.query(
                        "INSERT INTO skills (name, description, language, code) VALUES ($1, $2, $3, $4);",
                        [skill.name, skill.description, skill.language, skill.code]
                    );
                    console.log(`- Created skill: ${skill.name}`);
                }
            }

            // 2. Seed Jobs (The Crew & Specialized Connectors)
            const jobsToSeed = [
                {
                    name: "Strategist Lead",
                    type: "ai_agent",
                    description: "Senior orchestrator focused on long-term mission intent and vibe governance.",
                    tool: "None",
                    config: JSON.stringify({ persona: "strategist", defaultModel: "gemini-2.0-flash-exp" }),
                    createdBy: "system"
                },
                {
                    name: "Technical Developer",
                    type: "ai_agent",
                    description: "Implementation specialist optimized for deep research and artifact synthesis.",
                    tool: "None",
                    config: JSON.stringify({ persona: "creator", defaultModel: "gemini-2.0-flash-exp" }),
                    createdBy: "system"
                },
                {
                    name: "Vibe Critic",
                    type: "ai_agent",
                    description: "Recursive reviewer focused on finding flaws, technical drift, and aesthetic inconsistencies.",
                    tool: "None",
                    config: JSON.stringify({ persona: "critic", defaultModel: "gemini-2.0-flash-exp" }),
                    createdBy: "system"
                },
                {
                    name: "Perplexity Researcher",
                    type: "ai_agent",
                    description: "Specialized research agent with live web-access for deep-breadth exploration.",
                    tool: "perplex_research",
                    config: JSON.stringify({ persona: "researcher", defaultModel: "sonar-reasoning" }),
                    createdBy: "system"
                },
                {
                    name: "Claude Reasoning Agent",
                    type: "ai_agent",
                    description: "High-fidelity reasoning agent optimized for complex code architecture and technical synthesis.",
                    tool: "claude_reason",
                    config: JSON.stringify({ persona: "architect", defaultModel: "claude-3-5-sonnet" }),
                    createdBy: "system"
                }
            ];

            for (const job of jobsToSeed) {
                const { rows } = await client.query("SELECT id FROM jobs WHERE name = $1", [job.name]);
                if (rows.length === 0) {
                    await client.query(
                        "INSERT INTO jobs (name, type, description, tool, config, created_by) VALUES ($1, $2, $3, $4, $5, $6);",
                        [job.name, job.type, job.description, job.tool, job.config, job.createdBy]
                    );
                    console.log(`- Created job: ${job.name}`);
                }
            }

            console.log("CREW Toolkit seeded successfully.");
        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error("Database error:", err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

seedCrewToolkit();
