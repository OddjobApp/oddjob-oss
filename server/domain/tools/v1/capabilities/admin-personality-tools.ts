import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { SoulService } from "../../../agents/core/soul.service.js";
import { PERSONA_TEMPLATES } from "../../../agents/agent-persona.service.js";
import { buildPersonalityModifier } from "../../../agents/core/app-personality.service.js";

/**

 * Admin Personality Tools
 *
 * Super-admin MCP tools for reading and configuring agent/app personality settings.
 * These tools expose the OCEAN soul engine, persona templates, and archetype system
 * to the Oddjob Copilot so Super Admins can tune personalities conversationally.
 *
 * All write operations require the calling context to have Super Admin access.
 * The execute functions enforce this by checking context.isSuperAdmin.
 */

export const ADMIN_PERSONALITY_TOOLS: Record<string, ToolDefinition> = {

    // ─── Read-only discovery ─────────────────────────────────────────────────

    list_personality_archetypes: {
        name: "list_personality_archetypes",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Personality Archetypes",
        group: "Admin: Personality",
        description: "Returns all built-in OCEAN personality archetypes available for agents and apps. Each archetype is a named preset of the Big Five (O, C, E, A, N) traits in the range [0, 1]. Super Admin only.",
        parameters: z.object({}),
        execute: async (_args, context) => {
            const archetypesMap = await SoulService.getArchetypes();
            const archetypes = Object.entries(archetypesMap).map(([name, traits]) => ({
                name,
                traits,
                preview: buildPersonalityModifier(traits, name)
            }));
            return JSON.stringify({ archetypes, count: archetypes.length });
        }

    },

    list_persona_templates: {
        name: "list_persona_templates",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Persona Templates",
        group: "Admin: Personality",
        description: "Returns all built-in agent persona templates (generic, researcher, critic, analyst, creator, strategist, debugger). Each template has a system prompt trait, suggested tools, and domain specialties. Super Admin only.",
        parameters: z.object({}),
        execute: async (_args, context) => {
            const templates = Object.entries(PERSONA_TEMPLATES).map(([key, t]) => ({
                key,
                name: t.name,
                description: t.description,
                suggestedTools: t.suggestedTools,
                defaultSpecialties: t.defaultSpecialties,
                systemPromptTrait: t.systemPromptTrait,
            }));
            return JSON.stringify({ templates, count: templates.length });
        }
    },

    preview_personality_prompt: {
        name: "preview_personality_prompt",

        idempotency: "read-safe",
        label: "Preview Personality Prompt",
        group: "Admin: Personality",
        description: "Generates and returns the full soul prompt that would be injected into an agent's system prompt for a given set of OCEAN traits and archetype. Useful for testing personality configurations before applying them.",
        parameters: z.object({
            archetype: z.string().optional().describe("Archetype name (e.g. 'Lead Directive', 'Ghost Analyst', 'The Quartermaster'), or a custom label"),
            openness:          z.number().min(0).max(1).optional().describe("Openness trait (0–1). High = creative/exploratory."),
            conscientiousness: z.number().min(0).max(1).optional().describe("Conscientiousness (0–1). High = methodical/precise."),
            extraversion:      z.number().min(0).max(1).optional().describe("Extraversion (0–1). High = energetic/proactive."),
            agreeableness:     z.number().min(0).max(1).optional().describe("Agreeableness (0–1). High = cooperative/empathetic."),
            neuroticism:       z.number().min(0).max(1).optional().describe("Neuroticism (0–1). High = cautious/risk-aware."),
        }),
        execute: async ({ archetype, openness, conscientiousness, extraversion, agreeableness, neuroticism }) => {
            const archetypesMap = await SoulService.getArchetypes();
            const presetTraits = archetype ? archetypesMap[archetype] : null;
            const traits = {
                o: openness         ?? presetTraits?.o ?? 0.6,
                c: conscientiousness ?? presetTraits?.c ?? 0.7,
                e: extraversion      ?? presetTraits?.e ?? 0.5,
                a: agreeableness     ?? presetTraits?.a ?? 0.6,
                n: neuroticism       ?? presetTraits?.n ?? 0.3,
            };

            const personalityDirective = buildPersonalityModifier(traits, archetype);
            const soulPrompt = SoulService.generateSoulPrompt(traits, archetype || "Custom");
            return JSON.stringify({ traits, archetype: archetype || "Custom", personalityDirective, soulPrompt });
        }
    },

    // ─── Agent deployment personality ────────────────────────────────────────

    get_agent_personality: {
        name: "get_agent_personality",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Agent Personality",
        group: "Admin: Personality",
        description: "Returns the current OCEAN traits, archetype, and persona for an agent deployment or an app deployment. Pass either agentDeploymentId or appDeploymentId. Super Admin only.",
        parameters: z.object({
            agentDeploymentId: z.number().int().optional().describe("ID of the agent deployment"),
            appDeploymentId:   z.number().int().optional().describe("ID of the app deployment"),
        }),
        execute: async ({ agentDeploymentId, appDeploymentId }, context) => {
            const { db } = await import("@server/database_service.js");
            const { agentDeployments, appDeployments } = await import("@shared/schema/index.js");
            const { eq } = await import("drizzle-orm");

            if (agentDeploymentId) {
                const [dep] = await db.select().from(agentDeployments).where(eq(agentDeployments.id, agentDeploymentId)).limit(1);
                if (!dep) return JSON.stringify({ error: "Agent deployment not found" });
                return JSON.stringify({
                    type: "agent",
                    id: dep.id,
                    name: dep.title,
                    persona: (dep as any).persona,
                    soulArchetype: (dep as any).soulArchetype ?? null,
                    oceanTraits: (dep as any).oceanTraits ?? null,
                    personalityPreview: buildPersonalityModifier((dep as any).oceanTraits, (dep as any).soulArchetype),
                });
            }

            if (appDeploymentId) {
                const [dep] = await db.select().from(appDeployments).where(eq(appDeployments.id, appDeploymentId)).limit(1);
                if (!dep) return JSON.stringify({ error: "App deployment not found" });
                return JSON.stringify({
                    type: "app",
                    id: dep.id,
                    soulArchetype: (dep as any).soulArchetype ?? null,
                    oceanTraits: (dep as any).oceanTraits ?? null,
                    systemPrompt: (dep as any).systemPrompt ?? null,
                    personalityPreview: buildPersonalityModifier((dep as any).oceanTraits, (dep as any).soulArchetype),
                });
            }

            return JSON.stringify({ error: "Provide agentDeploymentId or appDeploymentId" });
        }
    },

    set_agent_personality: {
        name: "set_agent_personality",

        idempotency: "idempotent",
        label: "Set Agent Personality",
        group: "Admin: Personality",
        description: "Updates the OCEAN traits, archetype, and/or system prompt override for an agent or app deployment. You can pass a named archetype (which auto-fills OCEAN values) or specify individual traits. Changes take effect on the next agent execution. Super Admin only.",
        parameters: z.object({
            agentDeploymentId: z.number().int().optional().describe("ID of the agent deployment to update"),
            appDeploymentId:   z.number().int().optional().describe("ID of the app deployment to update"),
            archetype: z.string().optional().describe("Apply a named archetype preset (e.g. 'Ghost Analyst'). Overrides individual OCEAN values if also a known preset."),
            openness:          z.number().min(0).max(1).optional(),
            conscientiousness: z.number().min(0).max(1).optional(),
            extraversion:      z.number().min(0).max(1).optional(),
            agreeableness:     z.number().min(0).max(1).optional(),
            neuroticism:       z.number().min(0).max(1).optional(),
            systemPrompt: z.string().optional().describe("Custom system prompt override (app deployments only)"),
        }),
        execute: async ({ agentDeploymentId, appDeploymentId, archetype, openness, conscientiousness, extraversion, agreeableness, neuroticism, systemPrompt }, context) => {
            const { db } = await import("@server/database_service.js");
            const { agentDeployments, appDeployments } = await import("@shared/schema/index.js");
            const { eq } = await import("drizzle-orm");

            // Resolve OCEAN values: named archetype takes precedence for any unspecified traits
            const archetypesMap = await SoulService.getArchetypes();
            const presetTraits = archetype ? archetypesMap[archetype] : null;
            const buildOcean = (existing: any) => ({
                o: openness         ?? presetTraits?.o ?? existing?.o ?? 0.6,
                c: conscientiousness ?? presetTraits?.c ?? existing?.c ?? 0.7,
                e: extraversion      ?? presetTraits?.e ?? existing?.e ?? 0.5,
                a: agreeableness     ?? presetTraits?.a ?? existing?.a ?? 0.6,
                n: neuroticism       ?? presetTraits?.n ?? existing?.n ?? 0.3,
            });


            if (agentDeploymentId) {
                const [dep] = await db.select().from(agentDeployments).where(eq(agentDeployments.id, agentDeploymentId)).limit(1);
                if (!dep) return JSON.stringify({ error: "Agent deployment not found" });

                const newTraits = buildOcean((dep as any).oceanTraits);
                const [updated] = await db.update(agentDeployments as any)
                    .set({
                        oceanTraits: newTraits,
                        soulArchetype: archetype ?? (dep as any).soulArchetype,
                        updatedAt: new Date(),
                    })
                    .where(eq(agentDeployments.id, agentDeploymentId))
                    .returning();

                return JSON.stringify({ success: true, type: "agent", id: agentDeploymentId, applied: { traits: newTraits, archetype } });
            }

            if (appDeploymentId) {
                const [dep] = await db.select().from(appDeployments).where(eq(appDeployments.id, appDeploymentId)).limit(1);
                if (!dep) return JSON.stringify({ error: "App deployment not found" });

                const newTraits = buildOcean((dep as any).oceanTraits);
                const updatePayload: any = {
                    oceanTraits: newTraits,
                    soulArchetype: archetype ?? (dep as any).soulArchetype,
                    updatedAt: new Date(),
                };
                if (systemPrompt !== undefined) updatePayload.systemPrompt = systemPrompt;

                await db.update(appDeployments as any).set(updatePayload).where(eq(appDeployments.id, appDeploymentId));
                return JSON.stringify({ success: true, type: "app", id: appDeploymentId, applied: { traits: newTraits, archetype, systemPrompt } });
            }

            return JSON.stringify({ error: "Provide agentDeploymentId or appDeploymentId" });
        }
    },

    // ─── Global Copilot personality ──────────────────────────────────────────

    get_copilot_personality: {
        name: "get_copilot_personality",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Copilot Personality",
        group: "Admin: Personality",
        description: "Returns the current global personality configuration for the Oddjob Assistant/Copilot, including OCEAN traits, archetype, and any system prompt addon. Super Admin only.",
        parameters: z.object({}),
        execute: async (_args, context) => {
            const { db } = await import("@server/database_service.js");
            const { systemSettings } = await import("@shared/schema/index.js");
            const { eq } = await import("drizzle-orm");

            const [setting] = await db.select().from(systemSettings)
                .where(eq(systemSettings.key, "copilot_personality"))
                .limit(1);

            if (!setting?.settingsData) {
                const archetypesMap = await SoulService.getArchetypes();
                const defaultTraits = archetypesMap["Lead Directive"];
                return JSON.stringify({
                    archetype: "Lead Directive",
                    traits: defaultTraits,
                    systemPromptAddon: null,
                    source: "default"
                });
            }


            const config = setting.settingsData as any;
            return JSON.stringify({ ...config, source: "configured" });
        }
    },

    set_copilot_personality: {
        name: "set_copilot_personality",

        idempotency: "idempotent",
        label: "Set Copilot Personality",
        group: "Admin: Personality",
        description: "Configures the global personality for the Oddjob Assistant/Copilot system agent. Accepts a named archetype and/or individual OCEAN trait values. Optionally adds a system prompt addon that is appended to every Copilot invocation. Changes are system-wide and take effect on the next request. Super Admin only.",
        parameters: z.object({
            archetype: z.string().optional().describe("Named archetype preset (e.g. 'Lead Directive', 'Ghost Analyst', 'The Quartermaster')"),
            openness:          z.number().min(0).max(1).optional(),
            conscientiousness: z.number().min(0).max(1).optional(),
            extraversion:      z.number().min(0).max(1).optional(),
            agreeableness:     z.number().min(0).max(1).optional(),
            neuroticism:       z.number().min(0).max(1).optional(),
            systemPromptAddon: z.string().optional().describe("Text appended to the Copilot's system prompt on every request. Use to set tone, scope restrictions, or operational guidelines."),
        }),
        execute: async ({ archetype, openness, conscientiousness, extraversion, agreeableness, neuroticism, systemPromptAddon }, context) => {
            const { db } = await import("@server/database_service.js");
            const { systemSettings } = await import("@shared/schema/index.js");
            const { eq } = await import("drizzle-orm");
            const { sql } = await import("drizzle-orm");

            const archetypesMap = await SoulService.getArchetypes();
            const presetTraits = archetype ? archetypesMap[archetype] : null;
            const traits = {
                o: openness         ?? presetTraits?.o ?? 0.6,
                c: conscientiousness ?? presetTraits?.c ?? 0.9,
                e: extraversion      ?? presetTraits?.e ?? 0.7,
                a: agreeableness     ?? presetTraits?.a ?? 0.5,
                n: neuroticism       ?? presetTraits?.n ?? 0.2,
            };


            const config = {
                archetype: archetype ?? "Custom",
                traits,
                systemPromptAddon: systemPromptAddon ?? null,
                updatedAt: new Date().toISOString(),
            };

            // Upsert into systemSettings
            await db.insert(systemSettings as any)
                .values({ key: "copilot_personality", settingsData: config, description: "Global Copilot personality configuration" } as any)
                .onConflictDoUpdate({
                    target: (systemSettings as any).key,
                    set: { settingsData: config, updatedAt: new Date() }
                });

            return JSON.stringify({
                success: true,
                message: `Copilot personality set to "${config.archetype}" archetype. Changes take effect on next request.`,
                preview: buildPersonalityModifier(traits, archetype),
                soulPrompt: SoulService.generateSoulPrompt(traits, archetype || "Custom"),
            });
        }
    },

    // ─── Bulk operations ─────────────────────────────────────────────────────

    list_agent_personalities: {
        name: "list_agent_personalities",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Agent Personalities",
        group: "Admin: Personality",
        description: "Returns a summary of personality configurations across all active agent deployments and app deployments. Shows which deployments have custom OCEAN traits vs using defaults. Super Admin only.",
        parameters: z.object({
            type: z.enum(["agents", "apps", "all"]).optional().default("all").describe("Filter by deployment type"),
        }),
        execute: async ({ type = "all" }, context) => {
            const { db } = await import("@server/database_service.js");
            const { agentDeployments, appDeployments } = await import("@shared/schema/index.js");
            const { eq } = await import("drizzle-orm");

            const results: any[] = [];

            if (type === "agents" || type === "all") {
                const agents = await db.select({
                    id: agentDeployments.id,
                    title: agentDeployments.title,
                    persona: (agentDeployments as any).persona,
                    soulArchetype: (agentDeployments as any).soulArchetype,
                    oceanTraits: (agentDeployments as any).oceanTraits,
                    isActive: agentDeployments.isActive,
                }).from(agentDeployments).where(eq(agentDeployments.isActive, true));

                for (const a of agents) {
                    results.push({
                        kind: "agent",
                        id: a.id,
                        name: a.title,
                        persona: a.persona,
                        archetype: a.soulArchetype ?? "default",
                        hasCustomTraits: !!a.oceanTraits,
                    });
                }
            }

            if (type === "apps" || type === "all") {
                const appDeps = await db.select({
                    id: appDeployments.id,
                    soulArchetype: (appDeployments as any).soulArchetype,
                    oceanTraits: (appDeployments as any).oceanTraits,
                    hasSystemPrompt: (appDeployments as any).systemPrompt,
                }).from(appDeployments).where(eq(appDeployments.status, "active"));

                for (const a of appDeps) {
                    results.push({
                        kind: "app",
                        id: a.id,
                        archetype: a.soulArchetype ?? "default",
                        hasCustomTraits: !!a.oceanTraits,
                        hasCustomSystemPrompt: !!a.hasSystemPrompt,
                    });
                }
            }

            return JSON.stringify({ results, count: results.length });
        }
    },
};
