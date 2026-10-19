/**
 * Learned computer-use skills: record a person's actions in the desktop browser, turn the
 * recording into a reviewed skill, find a skill for a new task, and replay it.
 *
 *   recording  --stop-->  draft skill  --approve-->  active skill  --match/replay-->  task
 *
 * Replay is deterministic (Playwright over CDP) and checked step by step: each target must
 * resolve to exactly one element. The first step that does not match, and any secret slot,
 * ends replay; the Gemini computer-use loop continues from there with the skill's written
 * procedure as guidance. Only `active` skills are matched, and approving one is an admin
 * decision, because a skill acts on whatever accounts are logged in on the desktop.
 *
 * Distinct from computer-use-skills.ts, which holds eight fixed prompt templates.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Locator, Page } from "playwright";
import { db } from "../../../db/index.js";
import { createLogger } from "../../../utils/logger.js";
import { BadRequestError, ConfigurationError, ForbiddenError, NotFoundError } from "../../../utils/errors.js";
import {
    computerUseRecordings,
    computerUseSkills,
    trycuaComputerUseTasks,
    trycuaComputerUseTaskSteps,
    type ComputerUseRecordingRow,
    type ComputerUseSkillRow,
} from "../../../../shared/schema/index.js";
import { orgDesktopService } from "./org-desktop.service.js";
import { connectDesktopBrowser, startRecorder, type RecordedStep, type RecorderHandle, type TargetDescriptor } from "./skill-recorder.js";
import { geminiJson } from "./gemini-computer-use.js";
import { resolveGeminiApiKey } from "./computer-intelligence.service.js";
import { skillDefinitionSchema, type SkillInput } from "../../../../shared/computer-use-skill.js";
import { extractDom } from "./dom-extraction.js";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { evaluateAndAttemptReflexion, markReflexionResolved, type ReflexionEntry, type ReflexionLocatorStrategy } from "./reflexion.js";

const logger = createLogger("LearnedSkills");

export type { SkillInput } from "../../../../shared/computer-use-skill.js";

export interface ReplayResult {
    outputs?: Record<string, unknown>;
    completed: boolean;
    /** Steps that ran, 0-based count. */
    stepsRun: number;
    totalSteps: number;
    /** Why replay stopped early: a mismatch, a secret slot, or an error. */
    stoppedAt?: { step: number; reason: string };
    /** URL of the replay tab when it finished or stopped. */
    finalUrl?: string;
    /**
     * Steps whose element was found by a weaker strategy than the one recorded, and what
     * was written back. A skill that keeps repairing itself is still working, but its
     * site has moved under it — which is worth saying out loud rather than absorbing.
     */
    repairs?: Array<{ step: number; expected: LocatorStrategy; foundVia: LocatorStrategy; healed: boolean }>;
    /**
     * Verbal reflections and self-healing critiques generated during execution
     * according to Noah Shinn's Reflexion paradigm.
     */
    reflexions?: ReflexionEntry[];
}

const ACTIVE_FLUSH_MS = 5000;

class LearnedSkillsService {
    /** One recording per org desktop at a time. */
    private readonly active = new Map<number, { id: string; handle: RecorderHandle; flush: NodeJS.Timeout }>();

    // -----------------------------------------------------------------------
    // Recordings
    // -----------------------------------------------------------------------

    async startRecording(input: { organizationId: number; userId: string; taskId?: string; trigger: "manual" | "takeover" }): Promise<ComputerUseRecordingRow> {
        if (this.active.has(input.organizationId)) {
            throw new BadRequestError("A recording is already running on this organization's desktop");
        }
        const cdp = await this.requireCdp(input.organizationId);
        const [row] = await db.insert(computerUseRecordings).values({
            organizationId: input.organizationId,
            userId: input.userId,
            taskId: input.taskId,
            trigger: input.trigger,
            status: "recording",
        }).returning();

        let handle: RecorderHandle;
        try {
            handle = await startRecorder(cdp);
        } catch (error) {
            await db.update(computerUseRecordings).set({ status: "discarded", stoppedAt: new Date(), updatedAt: new Date() })
                .where(eq(computerUseRecordings.id, row.id));
            throw error;
        }
        // Flush periodically so a server restart loses seconds, not the whole takeover.
        const flush = setInterval(() => void this.persistSteps(row.id, handle.steps).catch(() => undefined), ACTIVE_FLUSH_MS);
        flush.unref?.();
        this.active.set(input.organizationId, { id: row.id, handle, flush });
        logger.info("Recording started", { organizationId: input.organizationId, recordingId: row.id, trigger: input.trigger, taskId: input.taskId });
        return row;
    }

    /** Stops the org's running recording, if any, and returns the saved row. */
    async stopRecording(organizationId: number, recordingId?: string): Promise<ComputerUseRecordingRow | undefined> {
        const running = this.active.get(organizationId);
        if (!running || (recordingId && running.id !== recordingId)) {
            if (recordingId) return this.getRecording(organizationId, recordingId);
            return undefined;
        }
        this.active.delete(organizationId);
        clearInterval(running.flush);
        const steps = await running.handle.stop();
        const [row] = await db.update(computerUseRecordings).set({
            status: "stopped",
            steps: steps as unknown as Record<string, unknown>[],
            stepCount: steps.length,
            startUrl: steps.find((s) => s.kind === "navigate")?.url ?? steps[0]?.url ?? null,
            stoppedAt: new Date(),
            updatedAt: new Date(),
        }).where(eq(computerUseRecordings.id, running.id)).returning();
        logger.info("Recording stopped", { organizationId, recordingId: running.id, steps: steps.length });
        return row;
    }

    /** Stops the recording started for this task's takeover, if one is running. */
    async stopRecordingForTask(organizationId: number, taskId: string): Promise<ComputerUseRecordingRow | undefined> {
        const running = this.active.get(organizationId);
        if (!running) return undefined;
        const [row] = await db.select({ taskId: computerUseRecordings.taskId }).from(computerUseRecordings)
            .where(eq(computerUseRecordings.id, running.id)).limit(1);
        if (row?.taskId !== taskId) return undefined;
        return this.stopRecording(organizationId, running.id);
    }

    isRecording(organizationId: number): string | undefined {
        return this.active.get(organizationId)?.id;
    }

    async listRecordings(organizationId: number, limit = 50): Promise<ComputerUseRecordingRow[]> {
        return db.select().from(computerUseRecordings)
            .where(eq(computerUseRecordings.organizationId, organizationId))
            .orderBy(desc(computerUseRecordings.createdAt)).limit(Math.min(Math.max(limit, 1), 100));
    }

    async getRecording(organizationId: number, id: string): Promise<ComputerUseRecordingRow> {
        const [row] = await db.select().from(computerUseRecordings)
            .where(and(eq(computerUseRecordings.id, id), eq(computerUseRecordings.organizationId, organizationId))).limit(1);
        if (!row) throw new NotFoundError("Recording not found");
        return row;
    }

    async discardRecording(organizationId: number, id: string): Promise<void> {
        if (this.active.get(organizationId)?.id === id) await this.stopRecording(organizationId, id);
        await this.getRecording(organizationId, id);
        await db.update(computerUseRecordings).set({ status: "discarded", steps: [], stepCount: 0, updatedAt: new Date() })
            .where(and(eq(computerUseRecordings.id, id), eq(computerUseRecordings.organizationId, organizationId)));
    }

    private async persistSteps(id: string, steps: RecordedStep[]) {
        await db.update(computerUseRecordings).set({
            steps: steps as unknown as Record<string, unknown>[],
            stepCount: steps.length,
            updatedAt: new Date(),
        }).where(eq(computerUseRecordings.id, id));
    }

    private async requireCdp(organizationId: number): Promise<string> {
        const type = (process.env.TRYCUA_PROVIDER_TYPE || "").toLowerCase();
        if ((process.env.TRYCUA_PROVIDER || "").toLowerCase() !== "cua" || type !== "org_desktop") {
            throw new ConfigurationError("Recording and replaying skills needs TRYCUA_PROVIDER=cua with TRYCUA_PROVIDER_TYPE=org_desktop");
        }
        return orgDesktopService.ensureBrowser(organizationId);
    }

    // -----------------------------------------------------------------------
    // Synthesis: recording -> draft skill
    // -----------------------------------------------------------------------

    async createSkillFromRecording(input: { organizationId: number; userId: string; recordingId: string; goal?: string; name?: string }): Promise<ComputerUseSkillRow> {
        const recording = await this.getRecording(input.organizationId, input.recordingId);
        if (recording.status === "recording") throw new BadRequestError("Stop the recording before turning it into a skill");
        const steps = cleanSteps(recording.steps as unknown as RecordedStep[]);
        if (steps.length === 0) throw new BadRequestError("The recording has no steps to learn from");

        const synthesized = await synthesize(input.organizationId, steps, input.goal).catch((error) => {
            logger.warn("Skill synthesis fell back to the plain recording", { error: error?.message });
            return fallbackSynthesis(steps, input.goal);
        });

        const [skill] = await db.insert(computerUseSkills).values({
            organizationId: input.organizationId,
            name: input.name?.trim() || synthesized.name,
            description: synthesized.description,
            site: siteOf(steps),
            goalExample: input.goal ?? null,
            inputs: synthesized.inputs as unknown as Record<string, unknown>[],
            steps: synthesized.steps as unknown as Record<string, unknown>[],
            procedure: synthesized.procedure,
            status: "draft",
            riskClass: riskOf(steps),
            sourceRecordingId: recording.id,
            createdBy: input.userId,
        }).returning();
        await db.update(computerUseRecordings).set({ status: "converted", updatedAt: new Date() })
            .where(eq(computerUseRecordings.id, recording.id));
        return skill;
    }

    /**
     * Turn a task's recorded steps into a draft skill a browser can replay.
     *
     * Only what was actually recorded becomes a step. The Gemini desktop loop
     * drives by screen coordinates and stores its executed actions under
     * `payload.actions`, with no page URL and no element - none of that can be
     * replayed against a DOM, so such a run is refused here rather than saved as
     * a draft full of invented `https://localhost` targets. Anything the mapping
     * cannot honestly express is returned in `skipped`, so the caller can say so.
     */
    async createSkillFromTask(input: {
        organizationId: number;
        userId: string;
        taskId: string;
        name?: string;
        goal?: string;
    }): Promise<{ skill: ComputerUseSkillRow; skipped: SkippedTaskAction[] }> {
        const [task] = await db
            .select()
            .from(trycuaComputerUseTasks)
            .where(and(
                eq(trycuaComputerUseTasks.id, input.taskId),
                eq(trycuaComputerUseTasks.organizationId, input.organizationId),
            ))
            .limit(1);

        if (!task) throw new NotFoundError("Task not found");

        const steps = await db
            .select()
            .from(trycuaComputerUseTaskSteps)
            .where(and(
                eq(trycuaComputerUseTaskSteps.taskId, task.id),
                eq(trycuaComputerUseTaskSteps.organizationId, input.organizationId),
            ))
            .orderBy(trycuaComputerUseTaskSteps.stepNumber);

        if (steps.length === 0) {
            throw new BadRequestError("The task has no steps to save as a skill");
        }

        const taskGoal = input.goal || task.task;
        const { steps: recordedSteps, skipped } = browserStepsFromTask(steps);

        if (recordedSteps.length === 0) {
            throw new BadRequestError(
                skipped.some((s) => s.reason === COORDINATE_ONLY)
                    ? "This run drove the desktop by screen coordinates, so there is no page or element for a browser skill to replay. Use Teach a Task to demonstrate it on the desktop instead."
                    : "None of this task's steps describe a page interaction that can be replayed.",
            );
        }

        const stepsToLearn = cleanSteps(recordedSteps);
        if (stepsToLearn.length === 0) {
            throw new BadRequestError("None of this task's steps survived normalization; record the task with Teach a Task instead.");
        }

        const synthesized = await synthesize(input.organizationId, stepsToLearn, taskGoal).catch((error) => {
            logger.warn("Skill synthesis fell back to plain recording", { error: error?.message });
            return fallbackSynthesis(stepsToLearn, taskGoal);
        });

        // The same gate an approval applies. A draft that cannot pass it is a draft
        // nobody can ever activate, so say so now rather than at the approve click.
        const definition = skillDefinitionSchema.safeParse({ inputs: synthesized.inputs, steps: synthesized.steps });
        if (!definition.success) {
            throw new BadRequestError(`The steps from this task do not form a replayable skill: ${definition.error.issues.map((i) => i.message).join("; ")}`);
        }

        const [skill] = await db.insert(computerUseSkills).values({
            organizationId: input.organizationId,
            name: input.name?.trim() || synthesized.name,
            description: synthesized.description,
            site: siteOf(stepsToLearn),
            goalExample: taskGoal,
            inputs: synthesized.inputs as unknown as Record<string, unknown>[],
            steps: synthesized.steps as unknown as Record<string, unknown>[],
            procedure: synthesized.procedure,
            status: "draft",
            riskClass: riskOf(stepsToLearn),
            createdBy: input.userId,
        }).returning();

        if (skipped.length) {
            logger.info("Saved a task as a draft skill with unmappable steps left out", {
                skillId: skill.id, taskId: task.id, skipped: skipped.length,
            });
        }

        return { skill, skipped };
    }

    /**
     * Create a draft skill directly from an array of recorded steps.
     * Bridges external recordings, agent runs, and knowledge guides into the learned-skills catalog.
     */
    async createSkillFromSteps(input: {
        organizationId: number;
        userId: string;
        steps: RecordedStep[];
        goal?: string;
        name?: string;
    }): Promise<ComputerUseSkillRow> {
        if (!input.steps || input.steps.length === 0) {
            throw new BadRequestError("The recording has no steps to learn from");
        }
        const stepsToLearn = cleanSteps(input.steps);
        if (stepsToLearn.length === 0) {
            throw new BadRequestError("None of the provided steps survived normalization");
        }

        const taskGoal = input.goal;
        const synthesized = await synthesize(input.organizationId, stepsToLearn, taskGoal).catch((error) => {
            logger.warn("Skill synthesis fell back to plain recording", { error: error?.message });
            return fallbackSynthesis(stepsToLearn, taskGoal);
        });

        const definition = skillDefinitionSchema.safeParse({ inputs: synthesized.inputs, steps: synthesized.steps });
        if (!definition.success) {
            throw new BadRequestError(`The steps do not form a replayable skill: ${definition.error.issues.map((i) => i.message).join("; ")}`);
        }

        const [skill] = await db.insert(computerUseSkills).values({
            organizationId: input.organizationId,
            name: input.name?.trim() || synthesized.name,
            description: synthesized.description,
            site: siteOf(stepsToLearn),
            goalExample: taskGoal ?? null,
            inputs: synthesized.inputs as unknown as Record<string, unknown>[],
            steps: synthesized.steps as unknown as Record<string, unknown>[],
            procedure: synthesized.procedure,
            status: "draft",
            riskClass: riskOf(stepsToLearn),
            createdBy: input.userId,
        }).returning();

        return skill;
    }

    // -----------------------------------------------------------------------
    // Skills: review and lifecycle
    // -----------------------------------------------------------------------

    async listSkills(organizationId: number, status?: string): Promise<ComputerUseSkillRow[]> {
        return db.select().from(computerUseSkills)
            .where(and(
                eq(computerUseSkills.organizationId, organizationId),
                status ? eq(computerUseSkills.status, status) : sql`true`,
            ))
            .orderBy(desc(computerUseSkills.updatedAt)).limit(200);
    }

    async getSkill(organizationId: number, id: string): Promise<ComputerUseSkillRow> {
        const [row] = await db.select().from(computerUseSkills)
            .where(and(eq(computerUseSkills.id, id), eq(computerUseSkills.organizationId, organizationId))).limit(1);
        if (!row) throw new NotFoundError("Skill not found");
        return row;
    }

    /** Edits a skill. Any change to an active skill's behaviour sends it back to draft. */
    async updateSkill(organizationId: number, id: string, patch: Partial<Pick<ComputerUseSkillRow, "name" | "description" | "site" | "goalExample" | "procedure" | "riskClass">> & { inputs?: SkillInput[]; steps?: RecordedStep[] }): Promise<ComputerUseSkillRow> {
        const skill = await this.getSkill(organizationId, id);
        const parsed = skillDefinitionSchema.safeParse({ inputs: patch.inputs ?? skill.inputs, steps: patch.steps ?? skill.steps });
        if (!parsed.success) throw new BadRequestError(parsed.error.issues.map(i => i.message).join("; "));
        const behaviourChanged = patch.steps !== undefined || patch.inputs !== undefined || patch.site !== undefined || patch.procedure !== undefined || patch.riskClass !== undefined;
        const [row] = await db.update(computerUseSkills).set({
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.description !== undefined ? { description: patch.description } : {}),
            ...(patch.site !== undefined ? { site: patch.site?.toLowerCase() || null } : {}),
            ...(patch.goalExample !== undefined ? { goalExample: patch.goalExample } : {}),
            ...(patch.procedure !== undefined ? { procedure: patch.procedure } : {}),
            ...(patch.riskClass !== undefined ? { riskClass: patch.riskClass } : {}),
            ...(patch.inputs !== undefined ? { inputs: patch.inputs as unknown as Record<string, unknown>[] } : {}),
            ...(patch.steps !== undefined ? { steps: parsed.data.steps as unknown as Record<string, unknown>[] } : {}),
            ...(behaviourChanged && skill.status === "active" ? { status: "draft", approvedBy: null, approvedAt: null, version: skill.version + 1 } : {}),
            updatedAt: new Date(),
        }).where(eq(computerUseSkills.id, id)).returning();
        return row;
    }

    async approveSkill(ctx: { organizationId: number; userId: string; isAdmin: boolean }, id: string): Promise<ComputerUseSkillRow> {
        if (!ctx.isAdmin) throw new ForbiddenError("Only an organization admin can approve a computer-use skill");
        const skill = await this.getSkill(ctx.organizationId, id);
        const definition = skillDefinitionSchema.safeParse({ inputs: skill.inputs, steps: skill.steps });
        if (!definition.success) throw new BadRequestError(definition.error.issues.map(i => i.message).join("; "));
        if (skill.status === "archived") throw new BadRequestError("Restore an archived skill before approving it");
        const [row] = await db.update(computerUseSkills).set({
            status: "active", approvedBy: ctx.userId, approvedAt: new Date(), updatedAt: new Date(),
        }).where(eq(computerUseSkills.id, id)).returning();
        return row;
    }

    async archiveSkill(organizationId: number, id: string): Promise<ComputerUseSkillRow> {
        await this.getSkill(organizationId, id);
        const [row] = await db.update(computerUseSkills).set({ status: "archived", updatedAt: new Date() })
            .where(eq(computerUseSkills.id, id)).returning();
        return row;
    }

    async recordOutcome(id: string, success: boolean): Promise<void> {
        await db.update(computerUseSkills).set({
            ...(success
                ? { successCount: sql`${computerUseSkills.successCount} + 1` }
                : { failureCount: sql`${computerUseSkills.failureCount} + 1` }),
            lastUsedAt: new Date(),
        }).where(eq(computerUseSkills.id, id));
    }

    // -----------------------------------------------------------------------
    // Matching
    // -----------------------------------------------------------------------

    async findSkillForGoal(organizationId: number, goal: string): Promise<ComputerUseSkillRow | undefined> {
        const skills = await this.listSkills(organizationId, "active");
        return matchSkill(skills, goal);
    }

    /** An explicit re-demonstration replaces one step, then returns the skill to review. */
    async repairFromRecording(organizationId: number, id: string, recordingId: string, stepIndex: number): Promise<ComputerUseSkillRow> {
        const skill = await this.getSkill(organizationId, id);
        const original = skill.steps as unknown as RecordedStep[];
        if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= original.length) throw new BadRequestError("Choose a step to replace");
        const recording = await this.getRecording(organizationId, recordingId);
        if (recording.status !== "stopped" || !recording.stepCount) throw new BadRequestError("Stop a nonempty recording before applying a repair");
        const captured = cleanSteps(recording.steps as unknown as RecordedStep[]);
        // Stay on the page left by the preceding steps. The recorder inserts the initial
        // page as a navigation, but replaying it would discard the state being repaired.
        if (captured[0]?.kind === "navigate") captured.shift();
        if (!captured.length) throw new BadRequestError("Record the replacement interactions, not only navigation");
        const steps = [...original.slice(0, stepIndex), ...captured, ...original.slice(stepIndex + 1)];
        return this.updateSkill(organizationId, id, { steps, procedure: steps.map((s, i) => `${i + 1}. ${describeStep(s)}`).join("\n") });
    }

    // -----------------------------------------------------------------------
    // Replay
    // -----------------------------------------------------------------------

    /** Values for a skill's inputs, from explicit values first, then extracted from the goal. */
    async resolveInputs(organizationId: number, skill: ComputerUseSkillRow, goal: string, provided: Record<string, string> = {}): Promise<Record<string, string> | undefined> {
        const inputs = (skill.inputs as unknown as SkillInput[]) ?? [];
        const values: Record<string, string> = { ...provided };
        const missing = inputs.filter((i) => values[i.name] === undefined);
        if (missing.length > 0) {
            const apiKey = await resolveGeminiApiKey(organizationId);
            if (apiKey) {
                const extracted = await geminiJson<Record<string, string | null>>({
                    apiKey,
                    prompt: [
                        "Extract values for these inputs from the task. Answer with only a JSON object mapping each input name",
                        "to its value as a string, or null when the task does not say.",
                        `Task: ${goal}`,
                        `Inputs: ${JSON.stringify(missing.map((i) => ({ name: i.name, description: i.description, example: i.example })))}`,
                    ].join("\n"),
                }).catch(() => ({} as Record<string, string | null>));
                for (const [k, v] of Object.entries(extracted)) if (typeof v === "string" && v.trim()) values[k] = v.trim();
            }
        }
        const unresolved = inputs.filter((i) => i.required !== false && !values[i.name]?.trim());
        if (unresolved.length) return undefined;
        for (const input of inputs) {
            const value = values[input.name];
            if (value === undefined) continue;
            if (input.type === "number" && (!value.trim() || !Number.isFinite(Number(value)))) throw new BadRequestError(`${input.name} must be a number`);
            if (input.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new BadRequestError(`${input.name} must be a valid YYYY-MM-DD date`);
        }
        return values;
    }

    /**
     * Replays the skill in the org's desktop browser. Never throws for a step that does not
     * match: it reports where it stopped so the Gemini loop can continue from there.
     */
    async replay(organizationId: number, skill: ComputerUseSkillRow, values: Record<string, string>, onStep?: (index: number, step: RecordedStep) => Promise<void> | void, isCancelled?: () => Promise<boolean>): Promise<ReplayResult> {
        const steps = skill.steps as unknown as RecordedStep[];
        const cdp = await this.requireCdp(organizationId);
        const browser = await connectDesktopBrowser(cdp);
        // Declared out here so the write-back in `finally` can see what was healed.
        const repairs: NonNullable<ReplayResult["repairs"]> = [];
        const reflexions: ReflexionEntry[] = [];
        const outputs: Record<string, unknown> = {};
        try {
            // Replay in a tab of its own, in front: which existing tab a person is on cannot be
            // told reliably, and the Gemini loop that follows sees whatever is in front.
            const context = browser.contexts()[0];
            let page = await context.newPage();
            await page.bringToFront().catch(() => undefined);
            const known = new Set(context.pages());
            const stop = (i: number, reason: string): ReplayResult =>
                ({ completed: false, stepsRun: i, totalSteps: steps.length, stoppedAt: { step: i, reason }, finalUrl: page.url(), outputs, ...(repairs.length ? { repairs } : {}), ...(reflexions.length ? { reflexions } : {}) });
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                try {
                    if (await isCancelled?.()) return stop(i, "Cancelled");
                    const run = await replayStep(page, step, values, organizationId, i, skill.id, skill.site ?? undefined);
                    if (run.reflexion) reflexions.push(run.reflexion);
                    if (step.output && run.output !== undefined) outputs[step.output] = run.output;
                    const expected = step.target ? locatorCandidates(page, step.target)[0]?.via : undefined;
                    if (run.via && expected && run.via !== expected) {
                        // Found, but not where it should have been. Write back what the
                        // element calls itself now, so the next replay uses the strong
                        // strategy again instead of leaning on the CSS path forever.
                        const healedTarget = run.observed ? repairTarget(step.target!, run.observed) : undefined;
                        if (healedTarget) steps[i] = { ...step, target: healedTarget };
                        repairs.push({ step: i, expected, foundVia: run.via, healed: Boolean(healedTarget || run.reflexion?.resolved) });
                    }
                    if (run.outcome !== "ok") return stop(i, run.outcome);
                    await markReflexionResolved({ organizationId, skillId: skill.id, stepIndex: i });
                    await onStep?.(i, step);
                    // A click that opened a new tab: follow it.
                    const opened = context.pages().filter((p) => !known.has(p));
                    if (opened.length) {
                        page = opened[opened.length - 1];
                        opened.forEach((p) => known.add(p));
                        await page.waitForLoadState("domcontentloaded").catch(() => undefined);
                        await page.bringToFront().catch(() => undefined);
                    }
                } catch (error: any) {
                    return stop(i, String(error?.message ?? error).slice(0, 300));
                }
            }
            return { completed: true, stepsRun: steps.length, totalSteps: steps.length, finalUrl: page.url(), outputs, ...(repairs.length ? { repairs } : {}), ...(reflexions.length ? { reflexions } : {}) };
        } finally {
            // Whatever the run did, a healed step is worth keeping: the next replay
            // should not have to find the same element the hard way again.
            if (repairs.some((r) => r.healed)) {
                await db.update(computerUseSkills)
                    .set({ steps: steps as unknown as ComputerUseSkillRow["steps"], updatedAt: new Date() })
                    .where(and(eq(computerUseSkills.id, skill.id), eq(computerUseSkills.organizationId, organizationId), eq(computerUseSkills.updatedAt, skill.updatedAt)))
                    .catch(() => undefined);
            }
            await browser.close().catch(() => undefined);
        }
    }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Drops noise: repeated navigations, navigations caused by the previous click, navigations
 * in some other tab, focus-only presses. Makes sure the skill starts by going to the page
 * where the first interaction happened.
 */
export const COORDINATE_ONLY = "a screen-coordinate action has no element to replay";

export interface SkippedTaskAction {
    /** The action name as the run recorded it. */
    action: string;
    reason: string;
}

/** One executed action, as a task step stores it. */
interface ExecutedAction {
    action: string;
    params: Record<string, any>;
}

/**
 * The actions a task step actually performed.
 *
 * The Gemini loop records a turn as `payload.actions: [{action, params}]` - one
 * turn can carry several - while the guided and CDP paths put a single action's
 * fields on the payload itself. Reading only the top level (as the first version
 * of this did) saw neither the coordinates nor the keys and silently invented
 * both.
 */
function executedActions(step: { action: string | null; payload: unknown; plan: unknown }): ExecutedAction[] {
    const payload = (step.payload ?? {}) as Record<string, any>;
    if (Array.isArray(payload.actions)) {
        return payload.actions
            .filter((entry: unknown): entry is Record<string, any> => !!entry && typeof entry === "object")
            .map((entry: Record<string, any>) => ({
                action: String(entry.action ?? step.action ?? "").toLowerCase(),
                params: (entry.params ?? {}) as Record<string, any>,
            }));
    }
    return [{ action: String(step.action ?? "").toLowerCase(), params: payload.params ?? payload }];
}

function httpUrl(value: unknown): string | undefined {
    return typeof value === "string" && /^https?:\/\//i.test(value) ? value : undefined;
}

/** A DOM target from whatever the recorder captured, or nothing. */
function targetFrom(params: Record<string, any>, payload: Record<string, any>): RecordedStep["target"] | undefined {
    const candidate = params.target ?? payload.target;
    if (candidate && typeof candidate === "object") {
        const css = typeof candidate.css === "string" && candidate.css.trim() ? candidate.css : undefined;
        if (css) return { ...candidate, css } as RecordedStep["target"];
    }
    const selector = params.selector ?? payload.selector;
    if (typeof selector === "string" && selector.trim()) return { tag: "*", css: selector };
    return undefined;
}

const REDACTED = /^\[REDACTED_TEXT:\d+\]$/;

/**
 * Map a task's steps to replayable browser steps, and say what was left out.
 *
 * A step is only produced where the recording carries what a replay needs: a
 * page URL, and an element for the kinds that act on one. Everything else -
 * clicks at coordinates, hotkeys against a window, redacted text - is reported
 * rather than approximated.
 */
export function browserStepsFromTask(
    taskSteps: Array<{ action: string | null; phase: string | null; payload: unknown; plan: unknown }>,
): { steps: RecordedStep[]; skipped: SkippedTaskAction[] } {
    const steps: RecordedStep[] = [];
    const skipped: SkippedTaskAction[] = [];
    let at = 0;
    let currentUrl: string | undefined;

    const skip = (action: string, reason: string) => skipped.push({ action: action || "unknown", reason });

    for (const taskStep of taskSteps) {
        const payload = (taskStep.payload ?? {}) as Record<string, any>;
        currentUrl = httpUrl(payload.url) ?? currentUrl;

        for (const { action, params } of executedActions(taskStep)) {
            at += 1000;
            const target = targetFrom(params, payload);
            const url = httpUrl(params.url) ?? currentUrl;

            if (action.includes("navigate") || action === "goto") {
                const destination = httpUrl(params.url) ?? httpUrl(payload.url);
                if (!destination) { skip(action, "the navigation recorded no URL"); continue; }
                currentUrl = destination;
                steps.push({ kind: "navigate", url: destination, direct: true, at });
                continue;
            }

            if (action === "click" || action === "left_click" || action === "double_click") {
                if (!url) { skip(action, COORDINATE_ONLY); continue; }
                if (!target) { skip(action, COORDINATE_ONLY); continue; }
                steps.push({ kind: "click", url, target, at });
                continue;
            }

            if (action === "type_text" || action === "type" || action === "fill") {
                const value = params.text ?? params.value ?? payload.text;
                if (!url || !target) { skip(action, COORDINATE_ONLY); continue; }
                if (typeof value !== "string" || REDACTED.test(value)) {
                    skip(action, "the typed text was redacted, so there is nothing to replay");
                    continue;
                }
                steps.push({ kind: "fill", url, target, value, at });
                continue;
            }

            if (action === "key_press" || action === "press_key" || action === "press" || action === "hotkey") {
                const key = Array.isArray(params.keys)
                    ? params.keys.filter((k: unknown) => typeof k === "string").join("+")
                    : params.key;
                if (!url) { skip(action, "no page was recorded for this key press"); continue; }
                if (typeof key !== "string" || !key) { skip(action, "the key press recorded no key"); continue; }
                steps.push({ kind: "press", url, key, at });
                continue;
            }

            if (action.includes("extract")) {
                const mode = typeof params.mode === "string" ? params.mode : "text";
                if (!url) { skip(action, "no page was recorded for this extraction"); continue; }
                if (mode !== "url" && !target) { skip(action, "the extraction recorded no selector"); continue; }
                steps.push({
                    kind: "extract",
                    url,
                    target: mode === "url" ? undefined : target,
                    extractMode: mode as RecordedStep["extractMode"],
                    // Unique per skill: two steps sharing an output name fail the
                    // definition schema, which is what a reviewer would hit at approve.
                    output: `extracted_${steps.filter((s) => s.kind === "extract").length + 1}`,
                    ...(typeof params.attribute === "string" ? { attribute: params.attribute } : {}),
                    at,
                });
                continue;
            }

            skip(action, `${action || "this action"} has no equivalent in a browser skill`);
        }
    }

    return { steps, skipped };
}

/**
 * Adapt steps from generic agent execution (e.g., Selenium/Playwright headless runs,
 * navigational memory traces, or external tool logs) into normalized RecordedStep[] format.
 */
export function adaptGenericStepsToRecordedSteps(
    genericSteps: Array<Record<string, any>>,
    defaultUrl?: string,
): RecordedStep[] {
    const steps: RecordedStep[] = [];
    let currentUrl = defaultUrl ? (defaultUrl.startsWith("http") ? defaultUrl : `https://${defaultUrl}`) : "https://localhost";
    let at = 0;

    for (const step of genericSteps ?? []) {
        if (!step || typeof step !== "object") continue;
        at += 1000;

        // If step is already a valid RecordedStep
        if (step.kind && typeof step.kind === "string" && step.url) {
            steps.push({ ...step, at: step.at ?? at } as RecordedStep);
            currentUrl = step.url;
            continue;
        }

        const action = String(step.action ?? step.kind ?? "").toLowerCase();
        const value = typeof step.value === "string" ? step.value : (typeof step.text === "string" ? step.text : undefined);
        const selector = step.selector ?? step.target?.css;

        if (action === "goto" || action === "navigate" || action.includes("navigate")) {
            const dest = value && /^https?:\/\//i.test(value) ? value : currentUrl;
            currentUrl = dest;
            steps.push({ kind: "navigate", url: dest, direct: true, at });
            continue;
        }

        if (action === "click" || action === "left_click" || action === "double_click") {
            const target: TargetDescriptor = step.target ?? { tag: "*", css: selector || "body" };
            steps.push({ kind: "click", url: currentUrl, target, at });
            continue;
        }

        if (action === "type" || action === "fill" || action === "type_text") {
            const target: TargetDescriptor = step.target ?? { tag: "input", css: selector || "input" };
            const isSecret = step.secret === "password" || (step.value === "HIDDEN_CAPTCHA_SOL");
            if (isSecret) {
                steps.push({ kind: "fill", url: currentUrl, target, secret: "password", at });
            } else {
                steps.push({ kind: "fill", url: currentUrl, target, value: value ?? "", at });
            }
            continue;
        }

        if (action === "press" || action === "key") {
            steps.push({ kind: "press", url: currentUrl, key: step.key || value || "Enter", at });
            continue;
        }

        if (action === "wait") {
            steps.push({ kind: "wait", url: currentUrl, at });
            continue;
        }

        if (action === "select") {
            const target: TargetDescriptor = step.target ?? { tag: "select", css: selector || "select" };
            steps.push({ kind: "select", url: currentUrl, target, value: value ?? "", at });
            continue;
        }

        if (action === "check") {
            const target: TargetDescriptor = step.target ?? { tag: "input", css: selector || "input[type='checkbox']" };
            steps.push({ kind: "check", url: currentUrl, target, checked: Boolean(step.checked ?? true), at });
            continue;
        }
    }

    return steps;
}

export function cleanSteps(steps: RecordedStep[]): RecordedStep[] {
    const out: RecordedStep[] = [];
    for (const step of steps ?? []) {
        if (!step || typeof step.kind !== "string") continue;
        const prev = out[out.length - 1];
        // An interaction on another origin than the navigation just before it: that
        // navigation happened in another tab (or led nowhere). Go where the person acted.
        if (step.kind !== "navigate" && prev?.kind === "navigate" && originOf(prev.url) !== originOf(step.url) && step.url) {
            out.pop();
            if (out.length === 0 || out[out.length - 1].kind !== "navigate") out.push({ kind: "navigate", url: step.url, direct: true, at: step.at });
        }
        if (step.kind !== "navigate" && out.length === 0 && /^https?:/i.test(step.url ?? "")) {
            out.push({ kind: "navigate", url: step.url, direct: true, at: step.at });
        }
        if (step.kind === "navigate") {
            if (prev?.kind === "navigate" && prev.url === step.url) continue;
            // Two direct navigations in a row: the first (often the tab that was already
            // open when recording started) led nowhere; keep only where the person went.
            if (prev?.kind === "navigate" && prev.direct && step.direct) out.pop();
            // A navigation caused by the previous click/Enter replays itself; keep only direct ones.
            if (!step.direct && out.length > 0) continue;
        }
        if (step.kind === "press" && step.key === "Tab") continue;
        if (step.secret) delete step.value;
        out.push(step);
    }
    return out;
}

/** The site the person worked on: where the first interaction happened, else the first page. */
function originOf(url: string | undefined): string | undefined {
    try {
        return url ? new URL(url).origin : undefined;
    } catch {
        return undefined;
    }
}

export function siteOf(steps: RecordedStep[]): string | null {
    const url = steps.find((s) => s.kind !== "navigate" && s.url)?.url ?? steps.find((s) => s.kind === "navigate")?.url;
    try {
        return url ? new URL(url).hostname.toLowerCase() : null;
    } catch {
        return null;
    }
}

function riskOf(steps: RecordedStep[]): string {
    const text = steps.map((s) => `${s.target?.name ?? ""} ${s.target?.text ?? ""}`).join(" ").toLowerCase();
    if (steps.some((s) => s.secret === "payment") || /\b(pay|purchase|buy now|checkout|place order|transfer)\b/.test(text)) return "critical";
    if (/\b(send|post|publish|submit|delete|remove|confirm)\b/.test(text)) return "high";
    if (steps.some((s) => s.secret)) return "high";
    return "medium";
}

export interface InferredCandidate {
    stepIndex: number;
    stepDescription: string;
    inputName: string;
    recordedValue: string;
    entropy: number;
    type: "string" | "date" | "number";
    description?: string;
}

export interface InferredParameterResult {
    inputs: SkillInput[];
    steps: RecordedStep[];
    ambiguousCandidates: InferredCandidate[];
}

function sanitizeInputName(raw: string, used: Set<string>): string {
    let name = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
    if (!name || !/^[a-z]/.test(name)) {
        name = `param_${name || "input"}`;
    }
    name = name.slice(0, 35);
    let candidate = name;
    let counter = 2;
    while (used.has(candidate)) {
        candidate = `${name}_${counter++}`;
    }
    used.add(candidate);
    return candidate;
}

function extractTargetHint(target?: TargetDescriptor): string {
    if (!target) return "";
    const candidate = target.nameAttr || target.name || target.label || target.placeholder || target.testId || target.id || "";
    return candidate.replace(/\b(input|field|form-control|form|txt)\b/gi, "").trim();
}

/**
 * Deterministic Socratic parameter extraction:
 * Evaluates recorded fill/select steps against the task goal, field labels, and value patterns.
 * High-confidence variables (entropy <= 0.60) are converted to dynamic `{{input_name}}` templates.
 * Ambiguous variables (entropy > 0.60) are returned in `ambiguousCandidates` for GoodQuestionEngine clarification.
 */
export function inferParametersHeuristically(
    steps: RecordedStep[],
    goal?: string
): InferredParameterResult {
    const inputs: SkillInput[] = [];
    const ambiguousCandidates: InferredCandidate[] = [];
    const usedNames = new Set<string>();

    const clonedSteps: RecordedStep[] = steps.map((s) => ({
        ...s,
        target: s.target ? { ...s.target } : undefined,
    }));

    const normalizedGoal = (goal || "").toLowerCase().trim();

    for (let i = 0; i < clonedSteps.length; i++) {
        const step = clonedSteps[i];
        if ((step.kind !== "fill" && step.kind !== "select") || step.secret || !step.value) {
            continue;
        }

        const rawVal = step.value.trim();
        if (!rawVal || (rawVal.startsWith("{{") && rawVal.endsWith("}}"))) {
            continue;
        }

        const targetHint = extractTargetHint(step.target);
        const lowerVal = rawVal.toLowerCase();

        // Type detection
        let paramType: "string" | "date" | "number" = "string";
        if (/^\d{4}-\d{2}-\d{2}$/.test(rawVal) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(rawVal)) {
            paramType = "date";
        } else if (/^-?\d+(?:\.\d+)?$/.test(rawVal) && rawVal.length <= 10) {
            paramType = "number";
        }

        // Entropy / Ambiguity calculation
        let entropy = 0.50;
        const matchesGoal = normalizedGoal.length > 0 && normalizedGoal.includes(lowerVal);
        const hasSemanticTarget = /\b(search|query|q|email|recipient|subject|message|date|time|amount|price|first_name|last_name|name|url|phone|zip|postal)\b/i.test(targetHint);
        const isCommonStaticWord = /^(yes|no|true|false|active|inactive|default|all|none|select|choose|1|0)$/i.test(rawVal);

        if (matchesGoal) {
            entropy = 0.15;
        } else if (hasSemanticTarget) {
            entropy = 0.20;
        } else if (paramType === "date" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawVal)) {
            entropy = 0.25;
        } else if (isCommonStaticWord) {
            entropy = 0.75;
        } else if (!targetHint || targetHint.length < 3) {
            entropy = 0.65;
        }

        // Suggested input name
        let rawNameSuggestion = "";
        if (hasSemanticTarget) {
            rawNameSuggestion = targetHint;
        } else if (matchesGoal) {
            rawNameSuggestion = targetHint ? `${targetHint}_value` : "search_term";
        } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawVal)) {
            rawNameSuggestion = targetHint ? `${targetHint}_email` : "email";
        } else if (paramType === "date") {
            rawNameSuggestion = targetHint ? `${targetHint}_date` : "date";
        } else if (targetHint) {
            rawNameSuggestion = targetHint;
        } else {
            rawNameSuggestion = `input_${i + 1}`;
        }

        const inputName = sanitizeInputName(rawNameSuggestion, usedNames);

        const candidate: InferredCandidate = {
            stepIndex: i,
            stepDescription: describeStep(step),
            inputName,
            recordedValue: rawVal,
            entropy: Number(entropy.toFixed(2)),
            type: paramType,
            description: targetHint ? `Target: ${targetHint}` : `Value recorded in step ${i + 1}`,
        };

        if (entropy > 0.60) {
            ambiguousCandidates.push(candidate);
        } else {
            inputs.push({
                name: inputName,
                description: `Parameter for ${targetHint || inputName} in step ${i + 1}`,
                example: rawVal,
                required: true,
                type: paramType,
            });
            step.value = `{{${inputName}}}`;
        }
    }

    return { inputs, steps: clonedSteps, ambiguousCandidates };
}

interface Synthesized {
    name: string;
    description: string;
    inputs: SkillInput[];
    steps: RecordedStep[];
    procedure: string;
}

/** Without Gemini: the recording with heuristic parameterization, typed inputs, and a procedure written from the steps. */
export function fallbackSynthesis(steps: RecordedStep[], goal?: string): Synthesized {
    const site = siteOf(steps) ?? "the site";
    const inferred = inferParametersHeuristically(steps, goal);
    return {
        name: goal ? goal.slice(0, 80) : `Recorded task on ${site}`,
        description: `Recorded on ${site}${goal ? ` for: ${goal}` : ""}.`,
        inputs: inferred.inputs,
        steps: inferred.steps,
        procedure: inferred.steps.map((s, i) => `${i + 1}. ${describeStep(s)}`).join("\n"),
    };
}

export function describeStep(s: RecordedStep): string {
    const target = s.target ? `"${s.target.name ?? s.target.label ?? s.target.placeholder ?? s.target.text ?? s.target.testId ?? s.target.css}"` : "";
    switch (s.kind) {
        case "navigate": return `Go to ${s.url}`;
        case "click": return `Click ${target}`;
        case "fill": return s.secret ? `Ask the user to enter their ${s.secret} in ${target}` : `Type ${JSON.stringify(s.value ?? "")} into ${target}`;
        case "select": return `Choose ${JSON.stringify(s.value ?? "")} in ${target}`;
        case "check": return `${s.checked ? "Tick" : "Untick"} ${target}`;
        case "press": return `Press ${s.key}${target ? ` in ${target}` : ""}`;
        case "wait": return `Wait for ${target} to become visible`;
        case "extract": return `Return ${s.extractMode ?? "text"} from ${target || "the page"} as ${s.output}`;
    }
}

async function synthesize(organizationId: number, steps: RecordedStep[], goal?: string): Promise<Synthesized> {
    const apiKey = await resolveGeminiApiKey(organizationId);
    if (!apiKey) throw new Error("no Gemini API key");
    const numbered = steps.map((s, i) => ({ i, kind: s.kind, step: describeStep(s), value: s.value }));
    const reply = await geminiJson<{ name: string; description: string; inputs: SkillInput[]; parameterize: Array<{ i: number; input: string }>; procedure: string }>({
        apiKey,
        prompt: [
            "A person performed these browser steps. Turn them into a reusable skill.",
            goal ? `They were doing this task: ${goal}` : "",
            `Steps: ${JSON.stringify(numbered)}`,
            "Answer with only JSON: {\"name\": short imperative name, \"description\": one sentence,",
            "\"inputs\": [{\"name\": snake_case, \"description\", \"example\", \"required\": true}] for values that would change between runs",
            "(search terms, recipients, dates, message text), \"parameterize\": [{\"i\": step index, \"input\": input name}] for the fill/select",
            "steps whose value is that input, \"procedure\": numbered plain-language steps a person or agent could follow if the page layout changed}.",
            "Never make an input for a password or code; those steps have no value and stay as they are.",
        ].filter(Boolean).join("\n"),
    });
    const inputs = (reply.inputs ?? []).filter((i) => i && typeof i.name === "string" && /^[a-z][a-z0-9_]{0,40}$/.test(i.name));
    const names = new Set(inputs.map((i) => i.name));
    const templated = steps.map((s) => ({ ...s }));
    for (const p of reply.parameterize ?? []) {
        const step = templated[p?.i];
        if (step && names.has(p.input) && (step.kind === "fill" || step.kind === "select") && !step.secret) {
            step.value = `{{${p.input}}}`;
        }
    }
    // Models answer "procedure" as a string or a list, and names sometimes as snake_case.
    const procedure = Array.isArray(reply.procedure)
        ? (reply.procedure as unknown[]).map((line, i) => `${i + 1}. ${String(line).replace(/^\d+[.)]\s*/, "")}`).join("\n")
        : String(reply.procedure || "");
    const rawName = String(reply.name || "").trim();
    const name = /^[a-z0-9_]+$/.test(rawName) ? rawName.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : rawName;
    return {
        name: name.slice(0, 120) || fallbackSynthesis(steps, goal).name,
        description: String(reply.description || "").slice(0, 500),
        inputs,
        steps: templated,
        procedure: procedure || fallbackSynthesis(steps, goal).procedure,
    };
}

const STOPWORDS = new Set(["the", "a", "an", "to", "of", "and", "or", "in", "on", "for", "with", "my", "me", "i", "it", "is", "at", "from", "by", "please", "then", "this", "that"]);

function tokens(text: string): Set<string> {
    return new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t)));
}

/**
 * Best active skill for a goal: the goal must point at the skill's site (a URL or the
 * site's name) and contain most of the skill's intent, meaning its name, or its example
 * goal without the example input values ("Search Wikipedia for Honolulu" -> search,
 * wikipedia). Measured against the skill, not the goal: a goal usually asks for more than
 * the skill does ("... and tell me the population"), and the Gemini loop does the rest.
 * Lexical on purpose: deterministic, testable, and it keeps working when embeddings don't.
 */
/**
 * How much a skill has earned the right to run unsupervised, from what it has actually
 * done: the lower bound of its success rate, not the rate itself.
 *
 * A skill that succeeded once is not a 100% skill — it is a skill with one data point —
 * and a replay that goes wrong costs a person's attention and, on a paid engine, money.
 * So the score is Wilson's lower bound at ~95%: it rises with evidence, and falls hard
 * when a skill that used to work stops working.
 *
 * An unproven skill scores 0.5, not 0: a person approved it, which is a statement that it
 * is good, and a skill that had to earn automatic selection before it could ever be
 * selected automatically would never earn it. Evidence then moves it either way — at
 * AUTOMATCH_FLOOR, a skill that has failed 2 of its last 3 runs stops being chosen on its
 * own, while one that has succeeded 3 of 4 keeps going.
 */
export function skillReliability(skill: Pick<ComputerUseSkillRow, "successCount" | "failureCount">): number {
    const wins = Math.max(0, skill.successCount ?? 0);
    const losses = Math.max(0, skill.failureCount ?? 0);
    const n = wins + losses;
    if (n === 0) return 0.5;
    const z = 1.96;
    const p = wins / n;
    const denominator = 1 + (z * z) / n;
    const centre = p + (z * z) / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
    return Math.max(0, (centre - margin) / denominator);
}

/** Below this, a skill is not chosen for a task by itself. Naming it still runs it. */
export const AUTOMATCH_FLOOR = 0.3;

/**
 * The skill to replay for a goal, or undefined to let the planner drive.
 *
 * Two questions, in order: does this skill claim to do this (word overlap on the same
 * site), and has it been doing it (reliability). A skill that keeps failing loses
 * automatic selection rather than burning a run every time its goal comes up.
 */
export function matchSkill(skills: ComputerUseSkillRow[], goal: string): ComputerUseSkillRow | undefined {
    const goalTokens = tokens(goal);
    let best: { skill: ComputerUseSkillRow; score: number } | undefined;
    for (const skill of skills) {
        if (skill.status !== "active") continue;
        if (skillReliability(skill) < AUTOMATCH_FLOOR) continue;
        const siteWords = skill.site ? skill.site.replace(/^www\./, "").split(".").filter((w) => w.length > 2 && !["com", "org", "net", "app"].includes(w)) : [];
        const siteHit = !skill.site || siteWords.some((w) => goalTokens.has(w)) || goal.toLowerCase().includes(skill.site);
        if (!siteHit) continue;
        const exampleValues = tokens(((skill.inputs as unknown as SkillInput[]) ?? []).map((i) => i.example ?? "").join(" "));
        const coverage = (intent: Set<string>) => {
            const words = [...intent].filter((t) => !exampleValues.has(t));
            if (words.length === 0) return { score: 0, shared: 0 };
            const shared = words.filter((t) => goalTokens.has(t)).length;
            return { score: shared / words.length, shared };
        };
        const byName = coverage(tokens(skill.name));
        const byExample = coverage(tokens(skill.goalExample ?? ""));
        const top = byName.score >= byExample.score ? byName : byExample;
        // Ties broken by evidence first, then by how much of the goal the skill's own
        // words cover: two skills that both claim the task should be settled by which
        // one has actually done it.
        const score = top.score + skillReliability(skill) / 100 + top.shared / 100_000;
        if (top.score >= 0.66 && (!best || score > best.score)) best = { skill, score }; // 2 of 3 intent words
    }
    return best?.skill;
}

export function fillTemplate(value: string | undefined, values: Record<string, string>): string | undefined {
    if (value === undefined) return undefined;
    let missing = false;
    const out = value.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_, name) => {
        if (values[name] === undefined) missing = true;
        return values[name] ?? "";
    });
    return missing ? undefined : out;
}

/** How an element was found, most durable first. `css` is the last resort. */
export type LocatorStrategy = "testId" | "role" | "label" | "placeholder" | "id" | "nameAttr" | "text" | "css" | "reflexion_fuzzy" | "reflexion_overlay_cleared";

/**
 * Locator strategies in order of how well they survive page changes, each carrying its
 * own name so replay can say WHICH one found the element. That is the difference between
 * "the skill worked" and "the skill worked by falling back to a CSS path", which is the
 * first sign a recorded skill is rotting.
 */
export function locatorCandidates(page: Page, t: TargetDescriptor): Array<{ via: LocatorStrategy; locator: Locator }> {
    const out: Array<{ via: LocatorStrategy; locator: Locator }> = [];
    if (t.testId) out.push({ via: "testId", locator: page.getByTestId(t.testId) });
    if (t.role && t.name) out.push({ via: "role", locator: page.getByRole(t.role as Parameters<Page["getByRole"]>[0], { name: t.name, exact: true }) });
    if (t.label) out.push({ via: "label", locator: page.getByLabel(t.label, { exact: true }) });
    if (t.placeholder) out.push({ via: "placeholder", locator: page.getByPlaceholder(t.placeholder, { exact: true }) });
    if (t.id) out.push({ via: "id", locator: page.locator(`#${cssEscape(t.id)}`) });
    if (t.nameAttr) out.push({ via: "nameAttr", locator: page.locator(`${t.tag}[name="${t.nameAttr.replace(/"/g, '\\"')}"]`) });
    if (t.text && (t.tag === "a" || t.tag === "button")) out.push({ via: "text", locator: page.locator(t.tag).filter({ hasText: t.text }) });
    out.push({ via: "css", locator: page.locator(t.css) });
    return out;
}

/**
 * The target as it should be recorded after finding the element somewhere other than the
 * strategy that was supposed to work: the attributes read off the element that actually
 * matched. Returns undefined when nothing worth writing changed.
 *
 * Only attributes are refreshed, never the CSS path: a path re-derived from one run is as
 * likely to encode that run's layout as to describe the page, and the attribute change
 * (a renamed test id, a regenerated id) is what breaks skills in practice.
 */
export function repairTarget(target: TargetDescriptor, observed: Partial<TargetDescriptor>): TargetDescriptor | undefined {
    const fields: Array<keyof TargetDescriptor> = ["testId", "id", "nameAttr", "placeholder", "text"];
    const next = { ...target };
    let changed = false;
    for (const field of fields) {
        const seen = observed[field];
        if (typeof seen !== "string" || !seen.trim()) continue;
        if (target[field] === seen) continue;
        next[field] = seen as never;
        changed = true;
    }
    return changed ? next : undefined;
}

function cssEscape(id: string): string {
    return id.replace(/([^\w-])/g, "\\$1");
}

async function resolveTarget(page: Page, t: TargetDescriptor): Promise<{ locator: Locator; via: LocatorStrategy } | undefined> {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
        for (const candidate of locatorCandidates(page, t)) {
            if ((await candidate.locator.count().catch(() => 0)) === 1) return { locator: candidate.locator, via: candidate.via };
        }
        await page.waitForTimeout(400);
    }
    return undefined;
}

/** What the element that actually matched calls itself now. */
async function observeTarget(locator: Locator): Promise<Partial<TargetDescriptor>> {
    const attr = async (name: string) => (await locator.getAttribute(name).catch(() => null)) ?? undefined;
    return {
        testId: (await attr("data-testid")) ?? (await attr("data-test")) ?? (await attr("data-qa")),
        id: await attr("id"),
        nameAttr: await attr("name"),
        placeholder: await attr("placeholder"),
    };
}

type StepOutcome = "ok" | string;

/** What a replayed step did, and — when it had to fall back — what it found instead. */
interface StepRun {
    output?: unknown;
    outcome: StepOutcome;
    via?: LocatorStrategy;
    observed?: Partial<TargetDescriptor>;
    reflexion?: ReflexionEntry;
}

export async function replayStep(page: Page, step: RecordedStep, values: Record<string, string>, organizationId: number, stepIndex: number = 0, skillId?: string, site?: string): Promise<StepRun> {
    if (step.kind === "navigate") {
        await page.goto(step.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        return { outcome: "ok" };
    }
    if (step.secret) return { outcome: `secret: the user must enter their ${step.secret}` };
    if (step.kind === "extract") {
        const mode = step.extractMode ?? "text";
        if (mode !== "url") await page.locator(step.target!.css).first().waitFor({ state: "visible", timeout: 15000 });
        const output = await extractDom(page, { mode, selector: step.target?.css, attribute: step.attribute });
        return { outcome: "ok", output };
    }
    if (step.kind === "wait") {
        await page.locator(step.target!.css).first().waitFor({ state: "visible", timeout: 30000 });
        return { outcome: "ok" };
    }
    if (step.kind === "press" && !step.target) {
        await page.keyboard.press(step.key ?? "Enter");
        return { outcome: "ok" };
    }
    if (!step.target) return { outcome: "step has no target" };
    let found = await resolveTarget(page, step.target);
    let reflexionEntry: ReflexionEntry | undefined;
    if (!found) {
        // Trigger Noah Shinn Reflexion evaluation and self-healing loop
        const reflexionResult = await evaluateAndAttemptReflexion(page, stepIndex, step.target, resolveTarget, {
            organizationId,
            skillId,
            site,
        });
        reflexionEntry = reflexionResult.entry;
        if (reflexionResult.resolved && reflexionResult.locator) {
            found = {
                locator: reflexionResult.locator,
                via: (reflexionResult.via as LocatorStrategy) || "reflexion_fuzzy",
            };
            if (reflexionResult.healedTarget) {
                step.target = reflexionResult.healedTarget;
            }
        } else {
            return {
                outcome: reflexionResult.entry.critique || `no unique match for ${describeStep(step)}`,
                reflexion: reflexionEntry,
            };
        }
    }
    const { locator, via } = found;
    // Only when the strategy that was supposed to work did not: reading attributes off
    // every element of every replay would cost a round trip per step for nothing.
    const preferred = locatorCandidates(page, step.target)[0]?.via;
    const observed = via !== preferred ? await observeTarget(locator) : undefined;
    const ran = (outcome: StepOutcome): StepRun => ({ outcome, via, observed, reflexion: reflexionEntry });
    switch (step.kind) {
        case "click":
            if (step.output) {
                const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), locator.click({ timeout: 10000 })]);
                const filename = `${randomUUID()}-${path.basename(download.suggestedFilename()).replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120)}`;
                const directory = path.resolve("storage", "learned-skill-artifacts", String(organizationId));
                await mkdir(directory, { recursive: true });
                await download.saveAs(path.join(directory, filename));
                return { ...ran("ok"), output: { filename: download.suggestedFilename(), path: path.join(directory, filename), url: `/api/integrations/trycua/skill-artifacts/${filename}` } };
            }
            await locator.click({ timeout: 10_000 });
            await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
            return ran("ok");
        case "fill": {
            const value = fillTemplate(step.value, values);
            if (value === undefined) return ran("missing input value");
            await locator.fill(value, { timeout: 10_000 });
            return ran("ok");
        }
        case "select": {
            const value = fillTemplate(step.value, values);
            if (value === undefined) return ran("missing input value");
            await locator.selectOption(value, { timeout: 10_000 });
            return ran("ok");
        }
        case "check":
            await locator.setChecked(Boolean(step.checked), { timeout: 10_000 });
            return ran("ok");
        case "press":
            await locator.press(step.key ?? "Enter", { timeout: 10_000 });
            await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
            return ran("ok");
        default:
            return ran(`unknown step kind ${(step as RecordedStep).kind}`);
    }
}

export const learnedSkillsService = new LearnedSkillsService();
