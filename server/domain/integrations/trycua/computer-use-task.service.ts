import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../../db/index.js";
import { BadRequestError, NotFoundError } from "../../../utils/errors.js";
import {
    approvalRequests,
    trycuaComputerUseTasks,
    trycuaComputerUseTaskSteps,
    type TrycuaComputerUseTaskRow,
    type TrycuaComputerUseTaskStepRow,
} from "../../../../shared/schema/index.js";
import { trycuaService, type TrycuaAction, type TrycuaActionInput } from "./trycua-service.js";
import {
    trycuaComputerIntelligenceService,
    type TrycuaGuidedActionInput,
    type TrycuaGuidedActionResult,
} from "./computer-intelligence.service.js";
import {
    resolveAndCreateComputerUseLoop,
    resolveComputerUseProviderConfig,
} from "./computer-use-provider.service.js";
import type {
    ComputerUseCall,
    ComputerUseLoopOptions,
    ComputerUseLoopState,
    PauseKind,
} from "./computer-use-loop.js";
import { learnedSkillsService, skillReliability } from "./learned-skills.service.js";
import { executeRespectingRateLimit } from "./rate-limit-retry.js";
import type { ComputerUseSkillRow } from "../../../../shared/schema/index.js";
import { createLogger } from "../../../utils/logger.js";

/**
 * Push to the person who started the task when it stops for them: a handoff
 * (yield_to_user) or the model asking before a risky action. Supervised-mode pauses
 * are not pushed; that person chose to approve every action and is watching.
 * A verified phone number also gets a signed solver link (Pillar 4), so the
 * challenge can be answered from the device that got the text.
 */
export async function notifyPause(task: Pick<TrycuaComputerUseTaskRow, "id" | "sessionId" | "userId" | "task" | "organizationId">, kind: "yield" | "safety", explanation?: string): Promise<void> {
    try {
        const { pushService } = await import("../../core/notifications/push.service.js");
        await pushService.sendToUser(task.userId, {
            title: kind === "yield" ? "The computer needs you" : "A computer action needs your approval",
            body: explanation?.trim() || task.task,
            // orgId: the phone app reads the task in that org, which need not be
            // the session's default.
            url: `/workspace/computer-use?session=${encodeURIComponent(task.sessionId)}&task=${encodeURIComponent(task.id)}&orgId=${task.organizationId}`,
            tag: `computer-use-${task.id}`,
        });
    } catch (error: any) {
        logger.warn("Computer-use pause push failed", { taskId: task.id, error: error?.message });
    }

    const { sendSolverLink } = await import("./hil-solver.js");
    await sendSolverLink(task);
}

const logger = createLogger("ComputerUseTasks");

type ComputerUseTaskStatus =
    | "queued"
    | "running"
    | "needs_confirmation"
    | "blocked"
    | "succeeded"
    | "failed"
    | "cancelled";

export interface CreateComputerUseTaskInput {
    sessionId: string;
    organizationId: number;
    userId: string;
    task: string;
    goal?: string;
    instruction?: string;
    action?: TrycuaAction;
    text?: string;
    target?: {
        x?: number;
        y?: number;
        label?: string;
        role?: string;
    };
    key?: string;
    hotkey?: string[];
    scroll?: {
        x?: number;
        y?: number;
        clicks?: number;
    };
    drag?: {
        startX?: number;
        startY?: number;
        endX?: number;
        endY?: number;
        durationMs?: number;
    };
    clipboardText?: string;
    waitMs?: number;
    maxSteps?: number;
    requireConfirmation?: boolean;
    allowSensitive?: boolean;
    executeImmediately?: boolean;
    /** Run this approved learned skill first (otherwise one is matched to the task). */
    skillId?: string;
    /** Values for the skill's inputs; anything missing is extracted from the task text. */
    skillInputs?: Record<string, string>;
    /** Set only by the admin skill-test route. Tests never fall through to autonomous recovery. */
    skillTest?: boolean;
    /**
     * Resume from a prior task's Gemini interaction chain. The new task starts from the
     * screen state left by the prior task, with the model retaining full context of what
     * it already did. Only works within the same sessionId and organizationId.
     */
    previousTaskId?: string;
}

export interface ConfirmComputerUseTaskInput {
    taskId: string;
    organizationId: number;
    userId?: string;
    allow: boolean;
    text?: string;
    clipboardText?: string;
    includeVerificationObservation?: boolean;
}

export interface ComputerUseTaskWithSteps {
    task: TrycuaComputerUseTaskRow;
    steps: TrycuaComputerUseTaskStepRow[];
}

export class TrycuaComputerUseTaskService {
    async createTask(input: CreateComputerUseTaskInput): Promise<ComputerUseTaskWithSteps> {
        if (!input.task.trim()) {
            throw new BadRequestError("task is required");
        }

        const session = await trycuaService.getSession(input.sessionId, input.organizationId);
        if (session.userId !== input.userId) {
            throw new BadRequestError("Trycua session does not belong to the requesting user");
        }

        // Model turns for the Gemini loop (one turn can carry several actions).
        const maxSteps = clampInteger(input.maxSteps, 1, 50, 15);
        const requireConfirmation = input.requireConfirmation ?? false;

        // If previousTaskId is provided, inherit the provider conversation state from that task
        // so the model continues from the same conversation context and screen state.
        let inheritedLoopState: ComputerUseLoopState | undefined;
        if (input.previousTaskId) {
            const prev = await this.getTask(input.previousTaskId, input.organizationId, input.userId);
            if (prev.sessionId !== input.sessionId) {
                throw new BadRequestError("Previous computer-use task belongs to a different session");
            }
            if (["queued", "running", "needs_confirmation"].includes(prev.status)) {
                throw new BadRequestError("Previous computer-use task must finish or be cancelled before continuation");
            }
            if (prev) {
                inheritedLoopState = loopStateFromTask(prev);
                if (inheritedLoopState.providerState || inheritedLoopState.pendingCalls?.length) {
                    logger.info("Resuming from prior task conversation state", {
                        previousTaskId: input.previousTaskId,
                    });
                }
            }
        }

        const metadata = {
            guidedInput: redactGuidedInput(input),
            textRequiredOnConfirm: input.text !== undefined && requireConfirmation,
            clipboardTextRequiredOnConfirm: input.clipboardText !== undefined && requireConfirmation,
            ...(input.skillId ? { skillId: input.skillId } : {}),
            ...(input.skillTest ? { skillTest: true } : {}),
            // Input values are task data like the goal itself; they are not secrets (skills never hold those).
            ...(input.skillInputs ? { skillInputs: input.skillInputs } : {}),
            ...(inheritedLoopState ? { loopState: inheritedLoopState } : {}),
        };

        const [task] = await db.insert(trycuaComputerUseTasks).values({
            sessionId: input.sessionId,
            organizationId: input.organizationId,
            userId: input.userId,
            status: "queued",
            task: input.task.trim(),
            maxSteps,
            requireConfirmation,
            allowSensitive: input.allowSensitive ?? false,
            metadata,
        }).returning();

        if (input.executeImmediately === false) {
            return this.getTaskWithSteps(task.id, input.organizationId, input.userId);
        }

        // A goal with no explicit action needs planning: run the Gemini loop. Explicit
        // actions (click here, type this) keep the deterministic single-step path.
        if (isGoalOnly(input)) {
            return this.runAutonomousLoop(task.id, input.organizationId, input.userId);
        }

        return this.runInitialStep(task, input);
    }

    async listTasks(input: {
        organizationId: number;
        userId?: string;
        limit?: number;
    }): Promise<TrycuaComputerUseTaskRow[]> {
        return db
            .select()
            .from(trycuaComputerUseTasks)
            .where(and(
                eq(trycuaComputerUseTasks.organizationId, input.organizationId),
                input.userId ? eq(trycuaComputerUseTasks.userId, input.userId) : sql`true`,
            ))
            .orderBy(desc(trycuaComputerUseTasks.createdAt))
            .limit(clampInteger(input.limit, 1, 100, 50));
    }

    async getTaskWithSteps(taskId: string, organizationId: number, userId?: string): Promise<ComputerUseTaskWithSteps> {
        const task = await this.getTask(taskId, organizationId, userId);
        const steps = await db
            .select()
            .from(trycuaComputerUseTaskSteps)
            .where(and(
                eq(trycuaComputerUseTaskSteps.taskId, task.id),
                eq(trycuaComputerUseTaskSteps.organizationId, organizationId),
            ))
            .orderBy(trycuaComputerUseTaskSteps.stepNumber);

        return { task, steps };
    }

    async replay(taskId: string, organizationId: number, userId?: string): Promise<ComputerUseTaskWithSteps> {
        return this.getTaskWithSteps(taskId, organizationId, userId);
    }

    async confirmTask(input: ConfirmComputerUseTaskInput): Promise<ComputerUseTaskWithSteps> {
        const task = await this.getTask(input.taskId, input.organizationId, input.userId);
        if (task.status !== "needs_confirmation") {
            throw new BadRequestError(`Computer-use task is ${task.status}, not needs_confirmation`);
        }
        if (!input.allow) {
            await this.insertStep(task, {
                phase: "confirmation",
                status: "cancelled",
                decision: "rejected",
                result: { allow: false },
            });
            await this.updateTask(task.id, "cancelled", {
                needsConfirmation: false,
                result: { cancelledByUser: true },
                completedAt: new Date(),
            });
            return this.getTaskWithSteps(task.id, task.organizationId, input.userId);
        }

        if (pendingGovernance(task)) {
            return this.runAutonomousLoop(task.id, input.organizationId, input.userId);
        }

        if (loopStateFromTask(task).pendingCalls?.length) {
            // Resume the paused model run. For a yield_to_user pause, `text` is the
            // user's reply to the model (e.g. "done, I logged in").
            await this.insertStep(task, {
                phase: "confirmation",
                status: "approved",
                decision: "approved",
                result: { allow: true, replied: input.text !== undefined },
            });
            await this.captureTakeoverAsSkill(task);
            await this.updateTask(task.id, "running");
            await this.driveLoop(task, { approved: true, userResponse: input.text });
            return this.getTaskWithSteps(task.id, task.organizationId, input.userId);
        }

        const guidedInput = this.guidedInputFromTask(task, {
            text: input.text,
            clipboardText: input.clipboardText,
            includeVerificationObservation: input.includeVerificationObservation,
        });
        const result = await trycuaComputerIntelligenceService.executeGuidedAction({
            ...guidedInput,
            execute: true,
            allowSensitive: true,
        });
        await this.insertStep(task, stepFromGuidedResult(result, "confirmation_execution"));
        await this.updateFromGuidedResult(task.id, result);

        return this.getTaskWithSteps(task.id, task.organizationId, input.userId);
    }

    async cancelTask(taskId: string, organizationId: number, userId?: string): Promise<ComputerUseTaskWithSteps> {
        const task = await this.getTask(taskId, organizationId, userId);
        if (task.status === "succeeded" || task.status === "failed" || task.status === "cancelled") {
            return this.getTaskWithSteps(task.id, organizationId, userId);
        }

        await this.insertStep(task, {
            phase: "cancel",
            status: "cancelled",
            result: { cancelled: true },
        });
        await this.updateTask(task.id, "cancelled", {
            needsConfirmation: false,
            result: { cancelled: true },
            completedAt: new Date(),
        });
        return this.getTaskWithSteps(task.id, organizationId, userId);
    }

    /**
     * Record a direct desktop/browser action as a task step.
     * Appends to the session's active task if one exists; otherwise provisions
     * an interactive task so all computer-use actions are visible in the TaskDock.
     */
    async recordDirectAction(input: {
        sessionId: string;
        organizationId: number;
        userId: string;
        action: string;
        phase?: string;
        decision?: string;
        payload?: Record<string, unknown>;
        result?: Record<string, unknown>;
        error?: string;
    }): Promise<TrycuaComputerUseTaskStepRow> {
        let [task] = await db
            .select()
            .from(trycuaComputerUseTasks)
            .where(and(
                eq(trycuaComputerUseTasks.sessionId, input.sessionId),
                eq(trycuaComputerUseTasks.organizationId, input.organizationId),
                sql`${trycuaComputerUseTasks.status} IN ('running', 'queued', 'needs_confirmation')`
            ))
            .orderBy(desc(trycuaComputerUseTasks.createdAt))
            .limit(1);

        if (!task) {
            const [newTask] = await db.insert(trycuaComputerUseTasks).values({
                sessionId: input.sessionId,
                organizationId: input.organizationId,
                userId: input.userId,
                status: "running",
                task: `Interactive Desktop Action: ${input.action}`,
                maxSteps: 100,
                requireConfirmation: false,
                allowSensitive: true,
                metadata: { interactive: true, directAction: true },
            }).returning();
            task = newTask;
        }

        // insertStep returns the row it wrote. Reading it back by (taskId, stepCount)
        // was both a wasted query and a guess: concurrent actions move the counter.
        return this.insertStep(task, {
            phase: input.phase ?? "direct_action",
            status: input.error ? "failed" : "succeeded",
            decision: input.decision ?? "execute",
            action: input.action,
            payload: input.payload ?? {},
            result: input.result ?? {},
            error: input.error,
        });
    }

    private async runInitialStep(
        task: TrycuaComputerUseTaskRow,
        input: CreateComputerUseTaskInput,
    ): Promise<ComputerUseTaskWithSteps> {
        await this.updateTask(task.id, "running");

        const guidedInput = createGuidedInput(task, input);
        const result = input.requireConfirmation ?? false
            ? await trycuaComputerIntelligenceService.planNextAction(guidedInput)
            : await trycuaComputerIntelligenceService.executeGuidedAction({
                ...guidedInput,
                execute: true,
            });

        await this.insertStep(task, stepFromGuidedResult(result, (input.requireConfirmation ?? false) ? "plan" : "action"));

        if (input.requireConfirmation ?? false) {
            await this.updateFromPlan(task.id, result);
        } else {
            await this.updateFromGuidedResult(task.id, result);
        }

        return this.getTaskWithSteps(task.id, task.organizationId, task.userId);
    }

    private async getTask(taskId: string, organizationId: number, userId?: string): Promise<TrycuaComputerUseTaskRow> {
        const [task] = await db
            .select()
            .from(trycuaComputerUseTasks)
            .where(and(
                eq(trycuaComputerUseTasks.id, taskId),
                eq(trycuaComputerUseTasks.organizationId, organizationId),
                userId ? eq(trycuaComputerUseTasks.userId, userId) : sql`true`,
            ))
            .limit(1);

        if (!task) {
            throw new NotFoundError("Computer-use task not found");
        }
        return task;
    }

    /**
     * Append a step and return it.
     *
     * The step number comes from the counter's own UPDATE ... RETURNING, not from
     * the caller's copy of the task row: direct actions are recorded from ten call
     * sites without awaiting each other, and two of them reading `stepCount` before
     * either wrote would have produced two steps with the same number.
     */
    private async insertStep(
        task: TrycuaComputerUseTaskRow,
        input: {
            phase: string;
            status: string;
            decision?: string;
            action?: string;
            observation?: Record<string, unknown>;
            plan?: Record<string, unknown>;
            payload?: Record<string, unknown>;
            result?: Record<string, unknown>;
            error?: string;
        },
    ): Promise<TrycuaComputerUseTaskStepRow> {
        const [counted] = await db.update(trycuaComputerUseTasks)
            .set({
                stepCount: sql`${trycuaComputerUseTasks.stepCount} + 1`,
                updatedAt: new Date(),
            })
            .where(eq(trycuaComputerUseTasks.id, task.id))
            .returning({ stepCount: trycuaComputerUseTasks.stepCount });

        const stepNumber = counted?.stepCount ?? task.stepCount + 1;
        const [step] = await db.insert(trycuaComputerUseTaskSteps).values({
            taskId: task.id,
            sessionId: task.sessionId,
            organizationId: task.organizationId,
            userId: task.userId,
            stepNumber,
            phase: input.phase,
            status: input.status,
            decision: input.decision,
            action: input.action,
            observation: input.observation ?? {},
            plan: input.plan ?? {},
            payload: input.payload ?? {},
            result: input.result ?? {},
            error: input.error,
        }).returning();

        task.stepCount = stepNumber;
        return step;
    }

    private async updateFromPlan(taskId: string, result: TrycuaGuidedActionResult) {
        if (result.plan.decision === "blocked") {
            await this.updateTask(taskId, "blocked", {
                needsConfirmation: false,
                result: { plan: result.plan },
                completedAt: new Date(),
            });
            return;
        }

        if (result.plan.decision === "observe_only") {
            await this.updateTask(taskId, "succeeded", {
                needsConfirmation: false,
                result: { observation: result.observation, plan: result.plan },
                completedAt: new Date(),
            });
            return;
        }

        await this.updateTask(taskId, "needs_confirmation", {
            needsConfirmation: true,
            result: {
                plan: result.plan,
                pendingAction: result.plan.proposedAction,
            },
        });
    }

    private async updateFromGuidedResult(taskId: string, result: TrycuaGuidedActionResult) {
        if (result.result) {
            await this.updateTask(taskId, "succeeded", {
                needsConfirmation: false,
                result: {
                    plan: result.plan,
                    actionResult: result.result,
                    verification: result.verification,
                },
                completedAt: new Date(),
            });
            return;
        }

        const status: ComputerUseTaskStatus = result.plan.decision === "blocked"
            ? "blocked"
            : (result.plan.decision === "observe_only" ? "succeeded" : "needs_confirmation");
        await this.updateTask(taskId, status, {
            needsConfirmation: status === "needs_confirmation",
            result: {
                observation: result.observation,
                plan: result.plan,
            },
            completedAt: status === "needs_confirmation" ? undefined : new Date(),
        });
    }

    private async updateTask(
        taskId: string,
        status: ComputerUseTaskStatus,
        patch?: {
            needsConfirmation?: boolean;
            result?: Record<string, unknown>;
            error?: string;
            completedAt?: Date;
        },
    ) {
        await db.update(trycuaComputerUseTasks)
            .set({
                status,
                needsConfirmation: patch?.needsConfirmation ?? false,
                result: patch?.result,
                error: patch?.error,
                completedAt: patch?.completedAt,
                updatedAt: new Date(),
            })
            .where(and(
                eq(trycuaComputerUseTasks.id, taskId),
                // Cancellation can arrive while an action or model request is in flight.
                // A late completion must never resurrect that cancelled task.
                status === "cancelled" ? sql`true` : sql`${trycuaComputerUseTasks.status} <> 'cancelled'`,
            ));
    }

    /**
     * Autonomous multi-step run, driven by Gemini Computer Use: the model sees a
     * screenshot, returns actions, we execute them and send the new screenshot back,
     * until it stops calling actions. Replaces the old regex planner, whose "plan" was
     * the same pattern match on the goal text at every step.
     *
     * Runs start directly after the caller's org/session authorization. Explicit
     * supervised mode, model safety decisions, and human takeovers still pause
     * individual actions when needed.
     */
    async runAutonomousLoop(
        taskId: string,
        organizationId: number,
        userId?: string,
    ): Promise<ComputerUseTaskWithSteps> {
        const task = await this.getTask(taskId, organizationId, userId);

        // Compatibility for runs paused by the retired start-approval gate.
        // Resume unanswered requests, but respect an explicit prior refusal.
        const waiting = pendingGovernance(task);
        if (waiting) {
            const decided = await this.readGovernanceDecision(task, waiting.approvalRequestId);
            if (decided !== "approved") return this.getTaskWithSteps(task.id, organizationId, userId);
            await this.updateTask(task.id, "running", { needsConfirmation: false, result: { ...(isRecord(task.result) ? task.result : {}), pending: undefined } });
            task.status = "running";
        }

        if (task.status !== "queued" && task.status !== "running") {
            return this.getTaskWithSteps(task.id, organizationId, userId);
        }

        if ((await this.getTask(task.id, organizationId, userId)).status === "cancelled") {
            return this.getTaskWithSteps(task.id, organizationId, userId);
        }
        if (learnedSkillsService.isRecording(task.organizationId)) throw new BadRequestError("Stop the desktop recording before starting a task");
        await this.updateTask(task.id, "running");
        const skillRun = await this.replaySkillIfAny(task);
        if (isRecord(task.metadata) && task.metadata.skillTest === true) {
            if ((await this.getTask(task.id, organizationId, userId)).status !== "cancelled") {
                await this.updateTask(task.id, skillRun?.completed ? "succeeded" : "failed", {
                    result: { summary: skillRun?.completed ? "Skill test completed. Review the steps and outputs before approval." : "Skill test stopped. Review the steps, correct the skill, or demonstrate the missing steps." },
                    completedAt: new Date(),
                });
            }
            return this.getTaskWithSteps(task.id, organizationId, userId);
        }
        await this.driveLoop(task, undefined, skillRun?.goal);
        if (skillRun) {
            const finished = await this.getTask(task.id, task.organizationId);
            await learnedSkillsService.recordOutcome(skillRun.skillId, skillRun.completed && finished.status === "succeeded").catch(() => undefined);
        }
        return this.getTaskWithSteps(task.id, organizationId, userId);
    }

    /**
     * Before the Gemini loop: replay an approved skill that matches the task (or the one the
     * task names in metadata.skillId). Returns the goal text the loop should start from, which
     * tells the model how far the replay got and hands it the skill's procedure.
     */
    private async replaySkillIfAny(task: TrycuaComputerUseTaskRow): Promise<{ skillId: string; completed: boolean; goal: string } | undefined> {
        if (loopStateFromTask(task).providerState) return undefined; // resuming, not starting
        const metadata = isRecord(task.metadata) ? task.metadata : {};
        let skill: ComputerUseSkillRow | undefined;
        try {
            if (typeof metadata.skillId === "string") {
                skill = await learnedSkillsService.getSkill(task.organizationId, metadata.skillId);
                if (skill.status !== "active" && !(metadata.skillTest === true && skill.status === "draft")) throw new BadRequestError(`Skill "${skill.name}" is ${skill.status}, not active`);
            } else if (process.env.TRYCUA_SKILLS_AUTOMATCH !== "false") {
                skill = await learnedSkillsService.findSkillForGoal(task.organizationId, task.task);
            }
        } catch (error: any) {
            await this.insertStep(task, { phase: "skill_replay", status: "skipped", error: error?.message });
            return undefined;
        }
        if (!skill) return undefined;
        const chosen = skill;

        // Recorded beside every decision this skill drives: a run that went wrong should
        // say how much the skill had earned before it was trusted with the task.
        const reliability = Number(skillReliability(chosen).toFixed(3));
        const guidance = `Saved procedure "${chosen.name}":\n${chosen.procedure}`;
        if (task.requireConfirmation) {
            // Direct browser replay has no per-action approval gate. In supervised
            // mode, let the model follow the procedure through the gated loop.
            // Recorded so the studio can show which skill the run is following.
            await this.insertStep(task, { phase: "skill_replay", status: "guided", action: chosen.name, result: { skillId: chosen.id, reliability, reason: "supervised: following the saved procedure step by step" } });
            return { skillId: chosen.id, completed: false, goal: `${task.task}\n\n${guidance}` };
        }
        const provided = isRecord(metadata.skillInputs)
            ? Object.fromEntries(Object.entries(metadata.skillInputs).map(([k, v]) => [k, String(v)]))
            : {};
        const values = await learnedSkillsService.resolveInputs(task.organizationId, chosen, task.task, provided).catch(() => undefined);
        if (!values) {
            await this.insertStep(task, { phase: "skill_replay", status: "skipped", action: chosen.name, result: { skillId: chosen.id, reason: "inputs could not be resolved from the task" } });
            return { skillId: chosen.id, completed: false, goal: `${task.task}\n\n${guidance}` };
        }

        let result;
        try {
            result = await learnedSkillsService.replay(task.organizationId, chosen, values, async (index, step) => {
                await this.insertStep(task, {
                    phase: "skill_replay",
                    status: "succeeded",
                    decision: "execute",
                    action: step.kind,
                    plan: { skillId: chosen.id, skill: chosen.name, step: index + 1 },
                    payload: { target: step.target ?? null, url: step.url, templated: typeof step.value === "string" && step.value.includes("{{") },
                });
            }, async () => (await this.getTask(task.id, task.organizationId)).status === "cancelled");
        } catch (error: any) {
            // CDP unavailable (older desktop image, other provider): the procedure still helps.
            await this.insertStep(task, { phase: "skill_replay", status: "skipped", action: chosen.name, error: error?.message });
            return { skillId: chosen.id, completed: false, goal: `${task.task}\n\n${guidance}` };
        }

        await this.insertStep(task, {
            phase: "skill_replay",
            status: result.completed ? "succeeded" : "stopped",
            action: chosen.name,
            result: { skillId: chosen.id, reliability, ...result },
        });
        let goal = result.completed
            ? `${task.task}\n\nThe saved skill "${chosen.name}" has just run all ${result.totalSteps} of its steps in the browser. `
                + "Check the screen: if the task is complete, stop and report the result; otherwise finish it.\n" + guidance
            : `${task.task}\n\nThe saved skill "${chosen.name}" ran ${result.stepsRun} of ${result.totalSteps} steps and stopped at step `
                + `${(result.stoppedAt?.step ?? 0) + 1} (${result.stoppedAt?.reason}). Continue from the current screen, following the procedure from that step.\n` + guidance;

        if (result.reflexions && result.reflexions.length > 0) {
            const latest = result.reflexions[result.reflexions.length - 1];
            goal += `\n\n[Reflexion Diagnostic - Self-Healing Critique]\nCritique: ${latest.critique}\nRecommended Action: ${latest.correctiveAction}`;
        }
        return { skillId: chosen.id, completed: result.completed, goal };
    }

    /**
     * Retired run-start requests no longer need a decision. Preserve explicit
     * refusals when resuming old tasks, without creating any new approval.
     */
    private async readGovernanceDecision(task: TrycuaComputerUseTaskRow, approvalRequestId?: number): Promise<"approved" | "stopped"> {
        if (!approvalRequestId) return "approved";
        const [row] = await db.select({ status: approvalRequests.status, comments: approvalRequests.comments })
            .from(approvalRequests)
            .where(and(eq(approvalRequests.id, approvalRequestId), eq(approvalRequests.organizationId, task.organizationId)))
            .limit(1);
        if (!row) return "approved";
        if (row.status === "pending" || row.status === "snoozed") return "approved";
        if (row.status === "approved") return "approved";

        await this.insertStep(task, {
            phase: "governance_block",
            status: "blocked",
            decision: "blocked",
            result: { governanceRejected: true, reason: row.comments ?? `Approval ${row.status}` },
        });
        await this.updateTask(task.id, "blocked", {
            needsConfirmation: false,
            result: { blockedByGovernance: true, reason: row.comments ?? `Approval ${row.status}` },
            completedAt: new Date(),
        });
        return "stopped";
    }

    /** At /confirm after a yield_to_user takeover: stop the recording and draft a skill from it. */
    private async captureTakeoverAsSkill(task: TrycuaComputerUseTaskRow): Promise<void> {
        try {
            const recording = await learnedSkillsService.stopRecordingForTask(task.organizationId, task.id);
            if (!recording || recording.stepCount === 0) return;
            await this.insertStep(task, { phase: "takeover_recorded", status: "succeeded", result: { recordingId: recording.id, steps: recording.stepCount } });
            // Drafting calls Gemini; the task does not wait for it. A person approves the draft later.
            void learnedSkillsService.createSkillFromRecording({
                organizationId: task.organizationId,
                userId: task.userId,
                recordingId: recording.id,
                goal: task.task,
            }).catch((error) => logger.warn("Could not draft a skill from the takeover recording", { taskId: task.id, error: error?.message }));
        } catch (error: any) {
            logger.warn("Could not stop the takeover recording", { taskId: task.id, error: error?.message });
        }
    }

    private async driveLoop(task: TrycuaComputerUseTaskRow, resume?: ComputerUseLoopOptions["resume"], goalOverride?: string) {
        let config: Awaited<ReturnType<typeof resolveComputerUseProviderConfig>>;
        let driver: Awaited<ReturnType<typeof resolveAndCreateComputerUseLoop>>["driver"];
        try {
            ({ config, driver } = await resolveAndCreateComputerUseLoop(task.organizationId));
        } catch (error: any) {
            await this.updateTask(task.id, "failed", {
                error: String(error?.message ?? error),
                completedAt: new Date(),
            });
            return;
        }

        const { model, provider } = config;
        const initialState = loopStateFromTask(task, provider);
        const outcome = await driver.runLoop(
            {
                screenshot: () => trycuaService.getScreenshot(task.sessionId, task.organizationId, task.userId),
                execute: (action) => executeRespectingRateLimit(() => trycuaService.executeAction(task.sessionId, task.organizationId, task.userId, action)),
                // The loop's contract is Promise<void>; insertStep returns the row it
                // wrote, which this caller does not need.
                recordStep: async (step) => void await this.insertStep(task, {
                    phase: step.acknowledged ? "confirmation_execution" : "action",
                    status: step.result.error ? "failed" : "succeeded",
                    decision: "execute",
                    action: step.call.name,
                    plan: { provider, model, intent: step.call.arguments.intent, call: redactCall(step.call) },
                    payload: { actions: step.actions.map(redactAction) },
                    result: step.result,
                    error: typeof step.result.error === "string" ? step.result.error : undefined,
                }),
                isCancelled: async () => (await this.getTask(task.id, task.organizationId)).status === "cancelled",
                actionGapMs: minActionGapMs(),
            },
            { goal: goalOverride ?? task.task, maxTurns: task.maxSteps, supervised: task.requireConfirmation, resume },
            initialState,
        );

        await this.saveLoopState(task, provider, model, outcome.state);
        if (outcome.status === "cancelled") return; // cancelTask already recorded it

        const finished = { turns: outcome.turns, provider, model };
        switch (outcome.status) {
            case "succeeded":
                await this.updateTask(task.id, "succeeded", {
                    result: { ...finished, summary: outcome.summary },
                    completedAt: new Date(),
                });
                return;
            case "needs_confirmation":
                if (outcome.kind === "yield") {
                    // A person is about to act in the browser: record it, so the takeover can become a skill.
                    await learnedSkillsService.startRecording({ organizationId: task.organizationId, userId: task.userId, taskId: task.id, trigger: "takeover" })
                        .catch((error) => logger.info("Takeover not recorded", { taskId: task.id, reason: error?.message }));
                }
                await this.insertStep(task, {
                    phase: "awaiting_confirmation",
                    status: "needs_confirmation",
                    decision: outcome.kind,
                    action: outcome.call.name,
                    plan: { provider, model, intent: outcome.call.arguments.intent, explanation: outcome.explanation, call: redactCall(outcome.call) },
                });
                await this.updateTask(task.id, "needs_confirmation", {
                    needsConfirmation: true,
                    result: {
                        ...finished,
                        pending: {
                            kind: outcome.kind,
                            explanation: outcome.explanation,
                            action: outcome.call.name,
                            // Where a person takes over (log in, solve a CAPTCHA), then /confirm.
                            viewerUrl: `/api/integrations/trycua/desktop/viewer?orgId=${task.organizationId}`,
                        },
                    },
                });
                if (outcome.kind !== "supervised") void notifyPause(task, outcome.kind, outcome.explanation);
                return;
            case "blocked":
                await this.insertStep(task, {
                    phase: "safety_block",
                    status: "blocked",
                    decision: "blocked",
                    action: outcome.call.name,
                    plan: { provider, model, explanation: outcome.explanation, call: redactCall(outcome.call) },
                });
                await this.updateTask(task.id, "blocked", {
                    result: { ...finished, reason: outcome.explanation },
                    completedAt: new Date(),
                });
                return;
            case "failed":
                await this.updateTask(task.id, "failed", {
                    result: finished,
                    error: outcome.error,
                    completedAt: new Date(),
                });
                return;
        }
    }

    private async saveLoopState(task: TrycuaComputerUseTaskRow, provider: string, model: string, state: ComputerUseLoopState) {
        const metadata = { ...(isRecord(task.metadata) ? task.metadata : {}), loopState: { provider, model, ...state } };
        await db.update(trycuaComputerUseTasks)
            .set({ metadata, updatedAt: new Date() })
            .where(eq(trycuaComputerUseTasks.id, task.id));
        task.metadata = metadata;
    }

    private guidedInputFromTask(
        task: TrycuaComputerUseTaskRow,
        overrides: {
            text?: string;
            clipboardText?: string;
            includeVerificationObservation?: boolean;
        },
    ): TrycuaGuidedActionInput {
        const metadata = isRecord(task.metadata) ? task.metadata : {};
        const stored = isRecord(metadata.guidedInput) ? metadata.guidedInput : {};
        if (metadata.textRequiredOnConfirm === true && overrides.text === undefined) {
            throw new BadRequestError("text is required to confirm this task because typed text is not stored in replay metadata");
        }
        if (metadata.clipboardTextRequiredOnConfirm === true && overrides.clipboardText === undefined) {
            throw new BadRequestError("clipboardText is required to confirm this task because clipboard text is not stored in replay metadata");
        }

        return {
            sessionId: task.sessionId,
            organizationId: task.organizationId,
            userId: task.userId,
            goal: safeString(stored.goal) ?? task.task,
            instruction: safeString(stored.instruction),
            action: safeString(stored.action) as TrycuaAction | undefined,
            text: overrides.text ?? safeString(stored.text),
            target: isRecord(stored.target) ? stored.target : undefined,
            key: safeString(stored.key),
            hotkey: Array.isArray(stored.hotkey) ? stored.hotkey.map(String) : undefined,
            scroll: isRecord(stored.scroll) ? stored.scroll : undefined,
            drag: isRecord(stored.drag) ? stored.drag : undefined,
            clipboardText: overrides.clipboardText ?? safeString(stored.clipboardText),
            waitMs: typeof stored.waitMs === "number" ? stored.waitMs : undefined,
            allowSensitive: true,
            execute: true,
            includeVerificationObservation: overrides.includeVerificationObservation ?? true,
        };
    }
}

function createGuidedInput(task: TrycuaComputerUseTaskRow, input: CreateComputerUseTaskInput): TrycuaGuidedActionInput {
    return {
        sessionId: task.sessionId,
        organizationId: task.organizationId,
        userId: task.userId,
        goal: input.goal ?? input.task,
        instruction: input.instruction,
        action: input.action,
        text: input.text,
        target: input.target,
        key: input.key,
        hotkey: input.hotkey,
        scroll: input.scroll,
        drag: input.drag,
        clipboardText: input.clipboardText,
        waitMs: input.waitMs,
        allowSensitive: input.allowSensitive ?? false,
        execute: !input.requireConfirmation,
        includeVerificationObservation: true,
    };
}

function stepFromGuidedResult(
    result: TrycuaGuidedActionResult,
    phase: string,
): {
    phase: string;
    status: string;
    decision?: string;
    action?: string;
    observation: Record<string, unknown>;
    plan: Record<string, unknown>;
    result: Record<string, unknown>;
} {
    return {
        phase,
        status: result.result ? "succeeded" : result.plan.decision,
        decision: result.plan.decision,
        action: result.plan.proposedAction?.action,
        observation: result.observation as unknown as Record<string, unknown>,
        plan: result.plan as unknown as Record<string, unknown>,
        result: {
            actionResult: result.result,
            verification: result.verification,
        },
    };
}

function redactGuidedInput(input: CreateComputerUseTaskInput): Record<string, unknown> {
    return {
        goal: input.goal ?? input.task,
        instruction: input.instruction,
        action: input.action,
        text: input.text === undefined ? undefined : `[REDACTED_TEXT:${input.text.length}]`,
        target: input.target,
        key: input.key,
        hotkey: input.hotkey,
        scroll: input.scroll,
        drag: input.drag,
        clipboardText: input.clipboardText === undefined ? undefined : `[REDACTED_TEXT:${input.clipboardText.length}]`,
        waitMs: input.waitMs,
        allowSensitive: input.allowSensitive ?? false,
    };
}

function isGoalOnly(input: CreateComputerUseTaskInput): boolean {
    return input.action === undefined
        && input.target === undefined
        && input.text === undefined
        && input.key === undefined
        && input.hotkey === undefined
        && input.scroll === undefined
        && input.drag === undefined
        && input.clipboardText === undefined
        && input.waitMs === undefined;
}

function loopStateFromTask(task: TrycuaComputerUseTaskRow, currentProvider?: string): ComputerUseLoopState {
    const metadata = isRecord(task.metadata) ? task.metadata : {};
    if (isRecord(metadata.loopState)) {
        const loopState = metadata.loopState as ComputerUseLoopState & { provider?: string; model?: string };
        // If the organization switched providers since the task was paused, we cannot resume the
        // provider-specific conversation; start fresh to avoid feeding Gemini interaction ids to
        // Anthropic (or vice versa).
        if (currentProvider && loopState.provider && loopState.provider !== currentProvider) {
            logger.info("Computer-use provider changed since task pause; starting fresh conversation", {
                taskId: task.id,
                previousProvider: loopState.provider,
                currentProvider,
            });
            return {};
        }
        return loopState;
    }
    // Backward compatibility: older tasks stored Gemini state directly under metadata.gemini.
    const gemini = isRecord(metadata.gemini) ? metadata.gemini : {};
    if (currentProvider && currentProvider !== "google") {
        return {};
    }
    return {
        providerState: typeof gemini.interactionId === "string" ? { interactionId: gemini.interactionId } : undefined,
        pendingCalls: Array.isArray(gemini.pendingCalls) ? gemini.pendingCalls as ComputerUseCall[] : undefined,
        doneResults: Array.isArray(gemini.doneResults) ? gemini.doneResults : undefined,
        pauseKind: safeString(gemini.pauseKind) as PauseKind,
    };
}

/** Step rows keep what the model did, not the text it typed (messages, form contents). */
function redactCall(call: ComputerUseCall): Record<string, unknown> {
    const args = { ...call.arguments };
    if (typeof args.text === "string") args.text = `[REDACTED_TEXT:${args.text.length}]`;
    return { name: call.name, arguments: args };
}

function redactAction(action: TrycuaActionInput): Record<string, unknown> {
    const params = { ...(action.params ?? {}) };
    if (typeof params.text === "string") params.text = `[REDACTED_TEXT:${params.text.length}]`;
    return { action: action.action, params };
}

function minActionGapMs(): number {
    // Just above the session's TRYCUA_MIN_ACTION_INTERVAL_MS (default 250), which rejects faster actions.
    const configured = Number(process.env.TRYCUA_MIN_ACTION_INTERVAL_MS);
    return (Number.isFinite(configured) && configured >= 0 ? configured : 250) + 50;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function safeString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

/**
 * The approval a run is waiting on, when it is waiting on one. Distinguishes a pause
 * for governance from the model's own pauses, which /confirm answers.
 */
export function pendingGovernance(task: Pick<TrycuaComputerUseTaskRow, "status" | "result">): { approvalRequestId?: number } | undefined {
    if (task.status !== "needs_confirmation") return undefined;
    const result = isRecord(task.result) ? task.result : {};
    const pending = isRecord(result.pending) ? result.pending : undefined;
    if (pending?.kind !== "governance") return undefined;
    const id = Number(pending.approvalRequestId);
    return { approvalRequestId: Number.isInteger(id) ? id : undefined };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

export const trycuaComputerUseTaskService = new TrycuaComputerUseTaskService();
