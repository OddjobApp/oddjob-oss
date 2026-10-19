
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

async function seedWavePlan() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    try {
        const client = await pool.connect();
        try {
            console.log("Seeding SDM Wave Plan Blueprint...");
            
            const wavePlan = {
                name: "Wave Plan: Mini-App Scaffolder",
                description: "Standard SDM blueprint for building agent-native mini-apps with CopilotKit primitives.",
                config: {
                    objective: "Scaffold a new Next.js mini-app, integrate CopilotKit (Chat/Sidebar), and register it in the Engineering Registry.",
                    type: "wave_plan",
                    category: "SDM",
                    stack: "Next.js + Tailwind + CopilotKit",
                    primitives: ["@copilotkit/react-core", "@copilotkit/react-ui"],
                    members: [
                        { role: "Software Architect", entityType: "job", skills: ["design_patterns", "sdlc_automation"] },
                        { role: "Frontend Lead", entityType: "job", skills: ["react", "copilotkit_integration"] }
                    ],
                    blackboard_defaults: {
                        wave_id: `WAVE-${Date.now()}`,
                        use_copilot_proxy: true,
                        auto_registry_sync: true
                    }
                },
                version: "1.0.0",
                star_rating: 5,
                created_by: "system"
            };

            await client.query(
                "INSERT INTO mission_templates (name, description, config, version, star_rating, created_by) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (name) DO UPDATE SET config = $3, description = $2;",
                [wavePlan.name, wavePlan.description, JSON.stringify(wavePlan.config), wavePlan.version, wavePlan.star_rating, wavePlan.created_by]
            );
            
            console.log("SDM Wave Plan seeded successfully.");
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

seedWavePlan();

