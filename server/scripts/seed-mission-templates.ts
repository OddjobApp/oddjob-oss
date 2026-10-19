
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

async function seed() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    try {
        const client = await pool.connect();
        try {
            console.log("Seeding mission templates...");
            
            const templates = [
                {
                    name: "Autonomous Research & Intelligence",
                    description: "End-to-end research mission with competitive analysis and synthesis.",
                    config: {
                        objective: "Conduct deep research on a specific topic, gathering info from web and internal logs, then synthesize into a briefing.",
                        type: "market_research",
                        members: [
                            { role: "Researcher", entityType: "job", skills: ["web_search", "document_parsing"] },
                            { role: "Analyst", entityType: "job", skills: ["content_synthesis", "logic_validation"] }
                        ]
                    },
                    version: "1.2.0",
                    star_rating: 5,
                    created_by: "system"
                },
                {
                    name: "Software Project Architect",
                    description: "Blueprint for initiating new software projects with registry entry and structure.",
                    config: {
                        objective: "Define project scope, register in Engineering Registry, and scaffold initial mission directives.",
                        type: "engineering",
                        members: [
                            { role: "Architect", entityType: "job", skills: ["design_patterns", "registry_management"] },
                            { role: "Scaffolder", entityType: "job", skills: ["fs_ops", "template_instantiation"] }
                        ]
                    },
                    version: "1.0.5",
                    star_rating: 4,
                    created_by: "system"
                },
                {
                    name: "Security Audit & Hardening",
                    description: "Cyclic dependency check and vulnerability assessment mission.",
                    config: {
                        objective: "Scan codebase for security vulnerabilities, audit dependency graphs, and suggest hardening PRs.",
                        type: "security",
                        members: [
                            { role: "Security Auditor", entityType: "job", skills: ["vulnerability_scanning", "static_analysis"] },
                            { role: "DevSecOps", entityType: "job", skills: ["pr_automation", "security_hardening"] }
                        ]
                    },
                    version: "2.1.0",
                    star_rating: 5,
                    created_by: "system"
                }
            ];

            for (const t of templates) {
                await client.query(
                    "INSERT INTO mission_templates (name, description, config, version, star_rating, created_by) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING;",
                    [t.name, t.description, JSON.stringify(t.config), t.version, t.star_rating, t.created_by]
                );
            }
            
            console.log("Seeding complete.");
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

seed();

