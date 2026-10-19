import { Job, Pipeline } from "@shared/schema/index.js";
import type { MediaTakeConfig } from "@shared/schema/index.js";
import type { ProductionView, ShotView, TakeView } from "@shared/media-studio.js";
import { type VariableContext } from "@server/core/variable-resolver.js";
import { type StepExecutionResult } from "@server/core/pipeline-step-runner.js";
import { type JobExecutor } from "./index.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("MediaTakeExecutor");

function failed(error: string): StepExecutionResult {
    return { success: false, output: "", status: "failed", error };
}

function allShots(view: ProductionView): ShotView[] {
    return view.scenes.flatMap((scene) => scene.shots);
}

/** The take requestTake just inserted: the shot's highest-numbered take. */
function latestTake(view: ProductionView, shotId: number): TakeView | undefined {
    const shot = allShots(view).find((s) => s.id === shotId);
    if (!shot || shot.takes.length === 0) return undefined;
    return shot.takes.reduce((a, b) => (b.takeNumber > a.takeNumber ? b : a));
}

/**
 * MediaTakeExecutor
 *
 * Requests one Media Studio take per resolved shot — every shot of a scene, or
 * an explicit shot list — then hands the step to the async poller unless every
 * take came back a simulation (no provider configured), in which case there is
 * nothing to wait on.
 */
export class MediaTakeExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "media_take";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> }
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as MediaTakeConfig;
        const organizationId = pipeline.organizationId ?? job.organizationId;
        if (organizationId == null) {
            return failed("media_take requires an organization on the pipeline or job");
        }

        const userId = (context as any).userId ?? "workflow-runtime";
        const ctx = { ...getSystemOrgContext(organizationId), userId };
        // resolvedConfig is template-resolved, not schema-parsed — apply the
        // schema defaults so unset fields behave as configured.
        const maxTakes = config.maxTakes ?? 10;
        const waitFor = config.waitFor ?? "approved";

        try {
            const { mediaStudio } = await import("@domain/media-studio/core/media-studio.service.js");

            const production = await mediaStudio.getProduction(ctx, config.productionId);
            const productionShots = allShots(production);

            let shotIds: number[];
            if (config.sceneId != null) {
                const scene = production.scenes.find((s) => s.id === config.sceneId);
                if (!scene) {
                    return failed(`Scene ${config.sceneId} is not part of production ${config.productionId}`);
                }
                shotIds = scene.shots.map((s) => s.id);
                if (shotIds.length === 0) {
                    return failed(`Scene ${config.sceneId} has no shots to take`);
                }
            } else {
                const known = new Set(productionShots.map((s) => s.id));
                const missing = (config.shotIds ?? []).filter((id) => !known.has(id));
                if (missing.length > 0) {
                    return failed(`Shot(s) ${missing.join(", ")} are not part of production ${config.productionId}`);
                }
                shotIds = [...new Set(config.shotIds ?? [])];
            }

            if (shotIds.length === 0) {
                return failed("media_take resolved no shots to request takes for");
            }
            if (shotIds.length > maxTakes) {
                return failed(`media_take would request ${shotIds.length} takes, exceeding maxTakes (${maxTakes})`);
            }

            const takes: { takeId: number; shotId: number; status: string }[] = [];
            for (const shotId of shotIds) {
                const view = await mediaStudio.requestTake(ctx, shotId, {
                    note: config.note,
                    endOnNextKeyframe: config.endOnNextKeyframe,
                    generateAudio: config.generateAudio,
                }, {});
                const take = latestTake(view, shotId);
                if (!take) {
                    return failed(`No take was recorded for shot ${shotId}`);
                }
                takes.push({ takeId: take.id, shotId, status: take.status });
            }

            const takeIds = takes.map((t) => t.takeId);

            if (takes.every((t) => t.status === "simulated")) {
                return {
                    success: true,
                    output: JSON.stringify({
                        _type: "media_takes",
                        mode: "simulation",
                        productionId: config.productionId,
                        takeIds,
                        takes,
                    }),
                    status: "success",
                };
            }

            return {
                success: true,
                status: "waiting_async",
                output: JSON.stringify({
                    _type: "media_takes",
                    productionId: config.productionId,
                    takeIds,
                    waitFor,
                    requestedAt: new Date().toISOString(),
                }),
                suspensionMetadata: {
                    waitReason: "media_render",
                    takeIds,
                },
            } as StepExecutionResult;
        } catch (error: any) {
            logger.error(`[MediaTake] Production ${config.productionId} take request failed: ${error?.message ?? error}`);
            return failed(error instanceof Error ? error.message : String(error));
        }
    }
}
