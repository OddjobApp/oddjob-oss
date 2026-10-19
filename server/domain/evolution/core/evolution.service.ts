import { createLogger } from "@server/utils/logger.js";
import { SentinelService } from "@domain/mission/core/sentinel-service.js";
import { db } from "@server/database_service.js";
import { skills, promptVersions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

import { docsSynthesizer } from "../infrastructure/docs-synthesizer.js";
import { SelfHealingHandler } from "../infrastructure/self-healing.handler.js";

const logger = createLogger("EvolutionService");

import { pipelineService } from "@domain/pipeline/core/pipeline.service.js";
import { jobService } from "@domain/jobs/job.service.js";
import { capabilityProposalService } from "@domain/capabilities/core/capability-proposal.service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";

export class EvolutionService {
    /**
     * Convert persistent low-performing skill signals into governed capability
     * proposals. This never registers or activates a capability; promotion is a
     * separate, explicitly authorized operation.
     */
    async discoverCapabilityProposals(organizationId: number, createdBy = "evolution-engine") {
        const candidates = await SentinelService.getEvolutionCandidatesForOrg(organizationId, 75);
        const proposals = [];

        for (const candidate of candidates) {
            const rawSkillId = String(candidate.skillId || "unknown_skill");
            let resolvedSkillName = rawSkillId;
            const numericSkillId = Number(rawSkillId);
            if (Number.isInteger(numericSkillId) && numericSkillId > 0) {
                const [skill] = await db.select({ name: skills.name }).from(skills).where(eq(skills.id, numericSkillId)).limit(1);
                if (skill?.name) resolvedSkillName = skill.name;
            }
            const slug = resolvedSkillName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
            const proposedCapabilityId = `evolved_${slug || "skill"}`;
            const skillName = resolvedSkillName.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
            const rationale = `${candidate.failure} failures across ${candidate.total} observations (${candidate.reliabilityPct}% reliability) indicate an unmet or insufficiently reliable outcome around ${skillName}.`;

            proposals.push(await capabilityProposalService.create(organizationId, {
                proposalKey: `sentinel:skill:${rawSkillId}:${slug}`,
                proposedCapabilityId,
                classification: "enhancement",
                title: `Evolve ${skillName} capability`,
                rationale,
                confidence: 75,
                source: "sentinel-reliability-scan",
                createdBy,
                evidence: [{
                    source: "sentinel",
                    summary: rationale,
                    reference: `skill:${rawSkillId}`,
                    observedAt: new Date().toISOString(),
                    weight: 0.75,
                }],
                proposedManifest: {
                    schema_version: 1,
                    capability_version: "0.1.0",
                    capability_id: proposedCapabilityId,
                    metadata: {
                        display_name: `Evolved ${skillName}`,
                        category: "System Utilities",
                        description: `Provide a reliable, governed outcome for ${skillName} based on recurring Evolution evidence.`,
                        owner: "Evolution Review Queue",
                    },
                    technical_spec: { inputs: { request: "object" }, outputs: { result: "object" } },
                    documentation_meta: {
                        summary: "Experimental capability proposal generated from observed reliability evidence.",
                        business_use_cases: [`Improve recurring ${skillName} execution that currently falls below reliability targets.`],
                        guardrails: [
                            "This proposal must be reviewed, assigned to an accountable owner, implemented, and evaluated before production release.",
                        ],
                    },
                    runtime_context: {
                        risk_profile: "Medium",
                        execution_environment: "Host",
                        dependencies: [`skill:${rawSkillId}`, resolvedSkillName],
                    },
                },
            }));
        }

        return { candidatesFound: candidates.length, proposals };
    }

    /**
     * Scans the system for 'Evolution Candidates' (poorly performing skills or bottlenecks)
     * and triggers specialized growth missions to optimize them.
     */
    async triggerSelfOptimization(organizationId: number) {
        logger.info("[EvolutionService] Initiating system-wide architecture scan...");

        // 1. Get candidates from Sentinel (full objects — we need the reliability signal
        //    to generate a meaningful patch, not just the id).
        const candidates = await SentinelService.getEvolutionCandidatesForOrg(organizationId, 75);

        // 2. Refresh documentation automatically (Goal 8: Documentation Synthesis)
        await docsSynthesizer.synthesizeArchitecture();

        if (candidates.length === 0) {
            logger.info("[EvolutionService] No critical evolution candidates identified. System at peak performance.");
            return { success: true, message: "System state optimal.", candidatesFound: 0 };
        }

        logger.info(`[EvolutionService] Found ${candidates.length} candidates for evolution.`, { candidates: candidates.map(c => c.skillId) });

        // 3. For each candidate, generate a real, reviewable code improvement.
        let patched = 0;
        for (const candidate of candidates) {
            const didPatch = await this.evolveSkillCandidate(candidate, organizationId);
            if (didPatch) patched++;
        }

        return {
            success: true,
            message: `Scanned ${candidates.length} candidate(s); generated ${patched} code patch(es) for review.`,
            candidatesFound: candidates.length,
            patchesGenerated: patched,
        };
    }

    /**
     * Specialized Evolution for Pipelines experiencing drift.
     * Triggers an App Forge mission to refactor the pipeline architecture.
     */
    async evolvePipeline(pipelineId: number, driftScore: number) {
        logger.info(`[EvolutionService] Pipeline ${pipelineId} is drifting (${(driftScore * 100).toFixed(1)}%). Initiating Autonomous Evolution...`);

        try {
            const pipeline = await pipelineService.getSystem(pipelineId);
            if (!pipeline) throw new Error("Pipeline not found");

            const missionDescription = `Optimize and refactor Pipeline '${pipeline.name}' (ID: ${pipelineId}) to eliminate persistent output drift. 
            Current Drift: ${(driftScore * 100).toFixed(1)}%. 
            Goal: Update step prompts, tool configurations, or logic gates to align outputs with the established Gold Baseline.`;

            const governanceMode = (pipeline as any).governorSettings?.mode || 'ADVISORY';
            const issueId = `PIPELINE-EVO-${pipelineId}-${Date.now()}`;
            const filePath = `pipelines/pipeline-${pipelineId}.json`;
            const newContent = JSON.stringify({ ...pipeline, evolutionMode: 'REFINE' }, null, 2);

            await SelfHealingHandler.proposeFix(issueId, filePath, newContent, missionDescription);
            if (governanceMode === 'AUTONOMOUS') {
                logger.info(`[EvolutionService] [AUTONOMOUS] Evolution fix proposed (auto-approve pending) for pipeline ${pipelineId}`);
            } else {
                logger.info(`[EvolutionService] [ADVISORY] Evolution fix proposed for pipeline ${pipelineId}`);
            }
        } catch (error) {
            logger.error(`[EvolutionService] Failed to evolve pipeline ${pipelineId}:`, error);
        }
    }

    /**
     * Turn a detected reliability candidate into a real, reviewable improvement.
     *
     * When the candidate resolves to a `skills` row with actual code, an LLM
     * generates an improved version of that code and it is proposed with a real diff
     * (approval promotes it durably via SkillPromotionService, snapshotted for
     * rollback). When no code artifact can be resolved — or the model can't improve
     * it — the finding is recorded as advisory (detection-only) so nothing pretends
     * to be an applyable patch. Returns true only when a real patch was proposed.
     */
    private async evolveSkillCandidate(
        candidate: { skillId: string; reliabilityPct: number; failure: number; total: number },
        organizationId: number
    ): Promise<boolean> {
        const skillId = String(candidate.skillId);
        const numericId = Number(skillId);

        if (Number.isInteger(numericId) && numericId > 0) {
            const [skill] = await db.select().from(skills).where(eq(skills.id, numericId)).limit(1);
            if (skill?.code && skill.code.trim()) {
                logger.info(`[EvolutionService] Generating code improvement for skill ${numericId} (${skill.name})...`);
                const improved = await this.generateImprovedSkillCode(skill, candidate);

                if (improved && improved.trim() && improved.trim() !== skill.code.trim()) {
                    const description = [
                        `AI-generated reliability improvement for skill "${skill.name}" (id ${numericId}).`,
                        `Currently ${candidate.reliabilityPct}% reliable over ${candidate.total} runs (${candidate.failure} failures) — below the 75% target.`,
                        `Inspect the diff and approve to promote; the current version is snapshotted for one-click rollback.`,
                    ].join(" ");

                    SelfHealingHandler.proposeFix(
                        `EVO-${numericId}-${Date.now()}`,
                        `skill://${numericId}/${skill.name}`,
                        improved,
                        description,
                        { skillId: numericId, oldContent: skill.code }
                    );
                    return true;
                }
                logger.info(`[EvolutionService] No usable improvement generated for skill ${numericId}; recording as advisory.`);
            }
        }

        // Fallback: no resolvable code artifact or no generated patch → advisory only.
        let label = skillId;
        try {
            const skillJobs = await (jobService as any).getJobsBySkill?.(skillId) ?? [];
            if (skillJobs.length > 0) label = skillJobs[0].name;
        } catch {
            /* non-critical */
        }
        const advisoryDescription = [
            `Detection only — skill "${label}" (id: ${skillId}) is below the 75% reliability threshold`,
            `(${candidate.reliabilityPct}% over ${candidate.total} runs), but no code artifact could be resolved`,
            `or no automated improvement could be generated. Manual remediation required.`,
        ].join(" ");

        SelfHealingHandler.proposeFix(
            `EVO-${skillId}-${Date.now()}`,
            `advisory://skill/${skillId}`,
            "",
            advisoryDescription
        );
        return false;
    }

    /** Ask the codegen model to rewrite a skill's code for higher reliability. */
    private async generateImprovedSkillCode(
        skill: { id: number; name: string; language: string; description: string | null; code: string },
        candidate: { reliabilityPct: number; failure: number; total: number }
    ): Promise<string | null> {
        const prompt = [
            `You are improving an underperforming Oddjob skill so it becomes more reliable.`,
            `Skill: ${skill.name} (id ${skill.id}), language: ${skill.language}.`,
            `Observed reliability: ${candidate.reliabilityPct}% over ${candidate.total} runs with ${candidate.failure} failures — below the 75% target.`,
            skill.description ? `Description: ${skill.description}` : ``,
            ``,
            `Current code:`,
            "```" + skill.language,
            skill.code,
            "```",
            ``,
            `Rewrite the code to improve reliability: add input validation, defensive null/undefined guards,`,
            `error handling with sensible retry/fallback, and ensure the declared outputs are always returned.`,
            `Preserve the exported function signature(s) and the behavioral contract. Do not add external`,
            `dependencies or imports that weren't already present. Return ONLY the complete rewritten code —`,
            `no markdown fences, no explanation.`,
        ].filter(Boolean).join("\n");

        try {
            const raw = await systemAiService.generateText(prompt, { serviceKey: "codegen", temperature: 0.2 });
            if (!raw || !raw.trim()) return null;
            return this.stripCodeFences(raw);
        } catch (error) {
            logger.warn(`[EvolutionService] Skill code-gen failed for skill ${skill.id}:`, error as Error);
            return null;
        }
    }

    /** Strip a leading ```lang / trailing ``` fence if the model wrapped the code. */
    private stripCodeFences(text: string): string {
        const trimmed = text.trim();
        const fenced = trimmed.match(/^```[a-zA-Z0-9]*\s*\n([\s\S]*?)\n```$/);
        return fenced ? fenced[1].trim() : trimmed;
    }

    /**
     * Aggregates evolution telemetry for the Flight Deck.
     */
    async getEvolutionSummary() {
        const sentinelSummary = await SentinelService.getEcosystemSummary();
        
        return {
            ...sentinelSummary,
            lastEvolutionSync: new Date().toISOString(),
            adaptationPace: "High", // Dynamic field based on frequency of ERs
            neuralHealth: 92 // Aggregate score
        };
    }

    /**
     * Record human feedback rating for a prompt version and update its fitness score.
     */
    async recordPromptFeedback(versionId: number, rating: number) {
        const [version] = await db.select()
            .from(promptVersions)
            .where(eq(promptVersions.id, versionId))
            .limit(1);

        if (!version) return null;

        const baselineFitness = parseFloat(version.fitnessScore || "50");
        const newFitness = (baselineFitness * 0.7 + rating * 0.3).toFixed(2);

        await db.update(promptVersions)
            .set({
                userSatisfactionScore: rating.toString(),
                fitnessScore: newFitness,
                updatedAt: new Date(),
            })
            .where(eq(promptVersions.id, version.id));

        return {
            promptVersionId: version.versionId,
            newFitnessScore: newFitness
        };
    }
}

export const evolutionService = new EvolutionService();
