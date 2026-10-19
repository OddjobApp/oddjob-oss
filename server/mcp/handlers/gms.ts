/**
 * GMS (Generative Mission Synthesis) MCP Tool Handlers
 * 
 * Exposes the 4-phase synthesis pipeline as MCP tools.
 */

import { errorResponse, type ToolContext, validateWithSchema } from "./utils.js";
import type { BlueprintCandidate } from "@server/core/gms/common/types.js";
import {
    GMSScoreBlueprintInput,
    GMSSynthesizeMissionsInput,
    GMSShadowValidateInput,
    GMSFindSkillsInput,
    GMSEvolveSkillInput,
    GMSComposeMissionInput,
} from "../tools/gms.js";

/**
 * gms_score_blueprint — Score a mission blueprint using the Neural Mission Verifier
 */
export async function handleGMSScoreBlueprint(args: unknown, _context?: ToolContext) {
    const v = validateWithSchema(args, GMSScoreBlueprintInput);
    if ('isError' in v) return v;
    const { blueprint } = v;

    try {
        const { getGMSOrchestrator } = await import("@server/core/gms/api/gms-orchestrator.js");
        const orchestrator = await getGMSOrchestrator();
        const score = await orchestrator.scoreMission(blueprint);
        return { success: true, score };
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * gms_synthesize_missions — Generate diverse mission candidates from a request
 */
export async function handleGMSSynthesizeMissions(args: unknown, _context?: ToolContext) {
    const v = validateWithSchema(args, GMSSynthesizeMissionsInput);
    if ('isError' in v) return v;
    const { request, nCandidates, topK, context } = v;

    try {
        const { getGMSOrchestrator } = await import("@server/core/gms/api/gms-orchestrator.js");
        const orchestrator = await getGMSOrchestrator();
        const response = await orchestrator.synthesizeMissions({
            request,
            options: {
                nCandidates,
                topK,
                ...context
            }
        });
        const candidates = response.candidates;
        return { success: true, candidates };
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * gms_shadow_validate — Run isolated shadow validations for mission candidates
 */
export async function handleGMSShadowValidate(args: unknown, _context?: ToolContext) {
    const v = validateWithSchema(args, GMSShadowValidateInput);
    if ('isError' in v) return v;
    const { candidates, variationsPerCandidate, isolationLevel } = v;

    try {
        const { getGMSOrchestrator } = await import("@server/core/gms/api/gms-orchestrator.js");
        const orchestrator = await getGMSOrchestrator();
        // The schema validates `candidates` as an array of objects; the deeper
        // BlueprintCandidate shape is the orchestrator's own contract and went entirely
        // unchecked while `args` was `any`. The cast preserves that behaviour rather than
        // inventing a stricter schema here — the orchestrator still validates what it needs.
        const validationResults = await orchestrator.shadowValidate(candidates as unknown as BlueprintCandidate[], {
            variationsPerCandidate,
            isolationLevel
        });
        return { success: true, results: validationResults };
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * gms_find_skills — Search the Skill Library semantically
 */
export async function handleGMSFindSkills(args: unknown, _context?: ToolContext) {
    const v = validateWithSchema(args, GMSFindSkillsInput);
    if ('isError' in v) return v;
    const { query, limit, requiredTags } = v;

    try {
        const { getGMSOrchestrator } = await import("@server/core/gms/api/gms-orchestrator.js");
        const orchestrator = await getGMSOrchestrator();
        const skills = await orchestrator.findSkills(query, { limit, requiredTags });
        return { success: true, skills };
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * gms_evolve_skill — Evolve a skill to improve performance
 */
export async function handleGMSEvolveSkill(args: unknown, _context?: ToolContext) {
    const v = validateWithSchema(args, GMSEvolveSkillInput);
    if ('isError' in v) return v;
    const { skillId } = v;

    try {
        const { getGMSOrchestrator } = await import("@server/core/gms/api/gms-orchestrator.js");
        const orchestrator = await getGMSOrchestrator();
        const result = await orchestrator.evolveSkill(skillId);
        return result;
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * gms_compose_mission — Automatically compose a complex mission blueprint
 */
export async function handleGMSComposeMission(args: unknown, _context?: ToolContext) {
    const v = validateWithSchema(args, GMSComposeMissionInput);
    if ('isError' in v) return v;
    const { goal } = v;

    try {
        const { getGMSOrchestrator } = await import("@server/core/gms/api/gms-orchestrator.js");
        const orchestrator = await getGMSOrchestrator();
        const blueprint = await orchestrator.composeMission(goal);
        return { success: true, blueprint };
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * gms_get_status — Get GMS engine health and metrics
 */
export async function handleGMSGetStatus(_args: unknown, _context?: ToolContext) {
    try {
        const { getGMSOrchestrator } = await import("@server/core/gms/api/gms-orchestrator.js");
        const orchestrator = await getGMSOrchestrator();
        const status = await orchestrator.getStatus();
        return { success: true, status };
    } catch (err: any) {
        return errorResponse(err.message);
    }
}
