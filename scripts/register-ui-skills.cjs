
const { Client } = require('pg');

async function registerUISkills() {
    const client = new Client({
        connectionString: "postgresql://postgres:postgres@127.0.0.1:5433/oddjob"
    });

    console.log("🎨 Registering UI Specialization Skills...");

    try {
        await client.connect();

        const skills = [
            {
                name: "UI Architect",
                description: "Specializes in high-fidelity application structure, component hierarchy, responsive layout logic, and Oddjob primitive integration.",
                code: "// Persona: UI Architect\n// Focus: Structure & UX\nconsole.log('UI Architect Active');",
                metadata: {
                    persona: "architect",
                    specialization: "ux_structure",
                    system_prompt: "You are the UI Architect. Your goal is to design clean, accessible, and high-performance React component structures using Stitch."
                }
            },
            {
                name: "UI Designer",
                description: "Specializes in aesthetics, branding, motion, and visual harmony. Expert in Stitch design systems, glassmorphism, and premium aesthetics.",
                code: "// Persona: UI Designer\n// Focus: Aesthetics & Branding\nconsole.log('UI Designer Active');",
                metadata: {
                    persona: "designer",
                    specialization: "visual_design",
                    system_prompt: "You are the UI Designer. Your goal is to transform structural layouts into premium, 'God-Tier' visual experiences using Stitch variants and tokens."
                }
            }
        ];

        for (const skill of skills) {
            const checkQuery = "SELECT id FROM skills WHERE name = $1";
            const checkResult = await client.query(checkQuery, [skill.name]);

            if (checkResult.rowCount > 0) {
                console.log(`♻️ Skill '${skill.name}' already exists. Updating...`);
                const updateQuery = `
                    UPDATE skills 
                    SET description = $1, code = $2, metadata = $3, updated_at = NOW()
                    WHERE name = $4
                `;
                await client.query(updateQuery, [skill.description, skill.code, JSON.stringify(skill.metadata), skill.name]);
            } else {
                console.log(`🆕 Creating skill: ${skill.name}`);
                const insertQuery = `
                    INSERT INTO skills (name, description, code, metadata, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, NOW(), NOW())
                `;
                await client.query(insertQuery, [skill.name, skill.description, skill.code, JSON.stringify(skill.metadata)]);
            }
        }

        console.log("✅ UI Specialization Skills successfully registered.");
        await client.end();
        process.exit(0);
    } catch (err) {
        console.error("❌ Error registering skills:", err);
        if (client) await client.end();
        process.exit(1);
    }
}

registerUISkills();
