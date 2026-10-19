import AdmZip from "adm-zip";
import { Job, AIAgentConfig, Skill } from "@shared/schema/index.js";

export class SkillExportService {
    /**
     * Export an Oddjob agent as an OpenClaw Agent Bundle (Zip)
     */
    static async exportAsOpenClaw(job: Job): Promise<Buffer> {
        if (job.type !== "ai_agent") {
            throw new Error("Only AI Agents can be exported as OpenClaw bundles.");
        }

        const config = job.config as AIAgentConfig;
        const zip = new AdmZip();
        const dir = job.name.toLowerCase().replace(/[^a-z0-9]/g, "-");

        // 1. SKILL.md (Instructions + YAML)
        const skillYaml = `---
name: ${job.name}
description: ${job.description || ""}
tools:
${(config.allowedTools || []).map(t => `  - ${t}`).join('\n')}
---
${config.goal}`;
        zip.addFile(`${dir}/SKILL.md`, Buffer.from(skillYaml));

        // 2. SOUL.md (Core Values - mapped from persona if possible)
        const soulText = `Be helpful, concise, and professional. Follow the persona of a ${config.persona || "generic assistant"}.`;
        zip.addFile(`${dir}/SOUL.md`, Buffer.from(soulText));

        // 3. IDENTITY.md (Persona details)
        const identityText = `Name: ${job.name}
Role: ${config.persona || "Assistant"}
Expertise: ${(config.specialties || []).join(", ") || "General Tasks"}`;
        zip.addFile(`${dir}/IDENTITY.md`, Buffer.from(identityText));

        // 4. AGENTS.md (Safety & System Prompt)
        if (config.systemPrompt) {
            zip.addFile(`${dir}/AGENTS.md`, Buffer.from(config.systemPrompt));
        }

        return zip.toBuffer();
    }

    /**
     * Export a native Skill Registry primitive as an OpenClaw Skill template
     */
    static async exportSkillAsOpenClaw(skill: Skill): Promise<Buffer> {
        const zip = new AdmZip();
        const dir = skill.name.toLowerCase().replace(/[^a-z0-9]/g, "-");

        const skillYaml = `---
name: ${skill.name}
description: ${skill.description || ""}
language: ${skill.language}
type: uci_primitive
---
# ${skill.name}

${skill.description || ""}

## Code (${skill.language})
\`\`\`${skill.language}
${skill.code}
\`\`\`
`;
        zip.addFile(`${dir}/SKILL.md`, Buffer.from(skillYaml));
        return zip.toBuffer();
    }

    /**
     * Export an Oddjob agent for use in OpenAI Custom GPTs / Assistants
     */
    static async exportAsOpenAI(job: Job): Promise<Buffer> {
        if (job.type !== "ai_agent") {
            throw new Error("Only AI Agents can be exported as OpenAI bundles.");
        }

        const config = job.config as AIAgentConfig;
        const zip = new AdmZip();

        // 1. Instructions.md
        const instructions = `# ${job.name} - Instructions

## Goal
${config.goal}

## Persona & Protocol
You are acting as a ${config.persona || "generic assistant"}.
${config.systemPrompt || ""}

## Specializations
${(config.specialties || []).map(s => `- ${s}`).join('\n')}
`;
        zip.addFile("Instructions.md", Buffer.from(instructions));

        // 2. Actions_OpenAPI.json
        const openApiSpec = this.generateOpenApiForTools(job.name, config.allowedTools || []);
        zip.addFile("Actions_OpenAPI.json", Buffer.from(JSON.stringify(openApiSpec, null, 2)));

        // 3. README.md
        const readme = `# OpenAI Export: ${job.name}

This package contains everything you need to recreate this agent in OpenAI's GPT Editor or Assistants API.

## Setup Instructions

1. **Instructions**: Copy the contents of \`Instructions.md\` into the "Instructions" field of your Custom GPT or Assistant.
2. **Actions**:
   - Go to the "Actions" section in the GPT Editor.
   - Click "Create New Action".
   - Copy the contents of \`Actions_OpenAPI.json\` into the "Schema" field.
   - **Important**: You will need to provide your Oddjob API URL and an API Key in the "Authentication" section of the OpenAI Action settings.
`;
        zip.addFile("README.md", Buffer.from(readme));

        return zip.toBuffer();
    }

    /**
     * Export a native Skill Registry primitive as an OpenAI Action spec
     */
    static async exportSkillAsOpenAI(skill: Skill): Promise<Buffer> {
        const zip = new AdmZip();
        const openApiSpec = this.generateOpenApiForTools(skill.name, [skill.name]);
        zip.addFile(`${skill.name}_openapi.json`, Buffer.from(JSON.stringify(openApiSpec, null, 2)));
        
        const readme = `# OpenAI Action: ${skill.name}
        
1. Create a new Action in your OpenAI GPT/Assistant.
2. Paste the contents of \`${skill.name}_openapi.json\` into the Schema.
3. Use your Oddjob API endpoint and key for authentication.`;
        zip.addFile("README.md", Buffer.from(readme));

        return zip.toBuffer();
    }

    /**
     * Generate a basic OpenAPI specification for the allowed tools
     */
    private static generateOpenApiForTools(title: string, tools: string[]) {
        const paths: Record<string, any> = {};

        for (const tool of tools) {
            const toolName = tool.toLowerCase();
            paths[`/tools/${toolName}`] = {
                post: {
                    operationId: `${toolName}_exec`,
                    summary: `Execute the ${tool} tool`,
                    description: `Runs the ${tool} tool with the provided arguments.`,
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        input: { type: "string", description: "The input for the tool" },
                                        args: { type: "object", description: "Additional arguments for the tool" }
                                    }
                                }
                            }
                        }
                    },
                    responses: {
                        "200": {
                            description: "The result of the tool execution",
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            output: { type: "string" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            };
        }

        return {
            openapi: "3.0.0",
            info: {
                title: `${title} Tools`,
                version: "1.0.0",
                description: `API for executing tools allowed for the ${title} agent.`
            },
            paths
        };
    }
}


