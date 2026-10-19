import { FORGE_STAGE_COUNT, forgeStageAt } from "./forge-stages.js";

/**
 * The structured event model for a forge run, and the fold that turns a stream
 * of them into studio state.
 *
 * The forge already streams everything the studio needs — stage indices, the
 * gallery blocks it selected, an OpenAPI contract, the files it wrote — but it
 * streams them as whole-snapshot frames with a log line attached. That is fine
 * for a page that only ever renders the latest frame, and wrong for a studio
 * that has to survive a reconnect: a snapshot tells you what is true now but not
 * what you missed, and re-applying one after reconnecting can move state
 * backwards if it arrives out of order.
 *
 * So the wire format is left alone and translated here. `toStudioEvents` reads a
 * frame and says what happened; `reduceForgeStudio` folds those into state that
 * is idempotent (the same event twice changes nothing) and monotonic (a late or
 * duplicated frame cannot un-complete a step). Both are pure, which is what
 * makes the reconnect behaviour testable without a server.
 */

export interface GalleryComponentRef {
    module: string;
    componentName: string;
    category: string;
    status: "selected" | "assembling" | "mounted" | "failed";
}

export interface ForgeErrorInfo {
    message: string;
    stage?: number;
}

/** The DPLL scaffold-pack resolution. Diagnostics only — never the primary UI. */
export interface ForgeScaffoldProof {
    requestedPacks: string[];
    selectedPacks: string[];
    executionOrder: string[];
    proofExplanation: string;
}

/** One line of build telemetry, kept for the diagnostics panel. */
export interface ForgeLogLine {
    message: string;
    level: "info" | "warn" | "error" | "success";
}

/**
 * Telemetry is bounded. A long build emits thousands of lines and an unbounded
 * array in React state is a leak that degrades the room it renders in.
 */
export const FORGE_LOG_LIMIT = 200;

export type ForgeStudioEvent =
    | { type: "step.started"; step: number; total: number; label: string }
    | { type: "status"; message: string; progress?: number; level?: "info" | "warn" | "error" | "success" }
    | { type: "component.selected"; component: GalleryComponentRef }
    | { type: "component.generated"; component: GalleryComponentRef }
    | { type: "file.started"; path: string }
    | { type: "file.completed"; path: string }
    | { type: "api.spec.updated"; contract: Record<string, unknown> }
    | { type: "preview.updated"; revision: string }
    | { type: "approval.required"; approval: { kind: string; message: string } }
    | { type: "build.failed"; error: ForgeErrorInfo }
    | { type: "build.completed"; appId: number; slug?: string }
    /*
     * Beyond the listed union, and deliberately so. SAT/DPLL must keep running
     * internally and stay out of the primary build experience, but it is named
     * as diagnostics content — which it cannot be if nothing carries it.
     */
    | { type: "diagnostic.proof"; proof: ForgeScaffoldProof };

/** A file the run has touched, and how far it got. */
export interface ForgeFileState {
    path: string;
    status: "writing" | "written";
}

export interface ForgeStudioState {
    /** 0-based emitted stage index, or null before the first one arrives. */
    stage: number | null;
    totalSteps: number;
    stepLabel: string | null;
    /** Latest human-readable line, for the compact progress row. */
    status: string | null;
    statusLevel: "info" | "warn" | "error" | "success";
    progress: number;
    phase: "idle" | "running" | "awaiting_approval" | "completed" | "failed";
    components: GalleryComponentRef[];
    files: ForgeFileState[];
    apiContract: Record<string, unknown> | null;
    previewRevision: string | null;
    approval: { kind: string; message: string } | null;
    error: ForgeErrorInfo | null;
    /** Detailed events, preserved for the diagnostics panel rather than the progress row. */
    log: ForgeLogLine[];
    scaffoldProof: ForgeScaffoldProof | null;
    appId: number | null;
    slug: string | null;
}

export function initialForgeStudioState(): ForgeStudioState {
    return {
        stage: null,
        totalSteps: FORGE_STAGE_COUNT,
        stepLabel: null,
        status: null,
        statusLevel: "info",
        progress: 0,
        phase: "idle",
        components: [],
        files: [],
        apiContract: null,
        previewRevision: null,
        approval: null,
        error: null,
        log: [],
        scaffoldProof: null,
        appId: null,
        slug: null,
    };
}

/** Terminal phases. Nothing reopens a run that has finished. */
const TERMINAL = new Set<ForgeStudioState["phase"]>(["completed", "failed"]);

/**
 * Fold one event into state.
 *
 * Returns the SAME object when nothing changed, so a caller can use identity to
 * skip a render — and so replaying a backlog after a reconnect is cheap.
 *
 * Two rules make reconnection safe:
 *
 *  - Monotonic step: a stage index lower than the one already reached is a
 *    replayed frame, not a regression, so it is ignored. Without this a
 *    reconnect that redelivers earlier frames would walk the progress row
 *    backwards in front of the author.
 *  - Terminal is terminal: once a run has completed or failed, later status
 *    lines update the text but cannot revive it. Reconnects commonly redeliver
 *    mid-run frames after the completion frame has already been seen.
 */
export function reduceForgeStudio(state: ForgeStudioState, event: ForgeStudioEvent): ForgeStudioState {
    switch (event.type) {
        case "step.started": {
            if (state.stage !== null && event.step <= state.stage) return state;
            if (TERMINAL.has(state.phase)) return state;
            return {
                ...state,
                stage: event.step,
                totalSteps: event.total || state.totalSteps,
                stepLabel: event.label,
                progress: Math.max(state.progress, forgeStageAt(event.step)?.progress ?? state.progress),
                phase: "running",
            };
        }

        case "status": {
            const progress = typeof event.progress === "number" ? Math.max(state.progress, event.progress) : state.progress;
            if (state.status === event.message && progress === state.progress) return state;
            const level = event.level ?? "info";
            // Consecutive duplicates are not appended: a redelivered frame must
            // not double every line in the telemetry panel.
            const last = state.log[state.log.length - 1];
            const log =
                last && last.message === event.message && last.level === level
                    ? state.log
                    : [...state.log, { message: event.message, level }].slice(-FORGE_LOG_LIMIT);
            return {
                ...state,
                status: event.message,
                statusLevel: level,
                progress,
                log,
                phase: TERMINAL.has(state.phase) ? state.phase : "running",
            };
        }

        case "component.selected":
        case "component.generated": {
            // Keyed by module: the same block arrives repeatedly as its status
            // advances, and appending would show one component many times.
            const next = event.type === "component.generated"
                ? { ...event.component, status: "mounted" as const }
                : event.component;
            const existing = state.components.find((c) => c.module === next.module);
            if (existing && existing.status === next.status) return state;
            return {
                ...state,
                components: existing
                    ? state.components.map((c) => (c.module === next.module ? { ...c, ...next } : c))
                    : [...state.components, next],
            };
        }

        case "file.started":
        case "file.completed": {
            const status = event.type === "file.completed" ? "written" : "writing";
            const existing = state.files.find((f) => f.path === event.path);
            // A "writing" frame arriving after "written" is a replay; a file
            // does not become unwritten.
            if (existing && (existing.status === status || existing.status === "written")) return state;
            return {
                ...state,
                files: existing
                    ? state.files.map((f) => (f.path === event.path ? { ...f, status } : f))
                    : [...state.files, { path: event.path, status }],
            };
        }

        case "diagnostic.proof":
            return { ...state, scaffoldProof: event.proof };

        case "api.spec.updated":
            return { ...state, apiContract: event.contract };

        case "preview.updated":
            if (state.previewRevision === event.revision) return state;
            return { ...state, previewRevision: event.revision };

        case "approval.required":
            return { ...state, approval: event.approval, phase: "awaiting_approval" };

        case "build.failed":
            return { ...state, error: event.error, phase: "failed", status: event.error.message, statusLevel: "error" };

        case "build.completed":
            return {
                ...state,
                phase: "completed",
                progress: 100,
                appId: event.appId,
                slug: event.slug ?? state.slug,
                approval: null,
                // Every declared file is written by the time a build completes;
                // a frame for the last one is often never sent.
                files: state.files.map((f) => (f.status === "written" ? f : { ...f, status: "written" as const })),
            };

        default:
            return state;
    }
}

/** Fold a whole backlog, for a client catching up after a reconnect. */
export function reduceForgeStudioAll(state: ForgeStudioState, events: ForgeStudioEvent[]): ForgeStudioState {
    return events.reduce(reduceForgeStudio, state);
}

/**
 * Translate one FORGE_LOG frame into the events it represents.
 *
 * The frame is a snapshot with a log line attached, which is why this exists:
 * the studio needs to know what CHANGED, and a snapshot only says what is. The
 * wire format is deliberately untouched — the standalone Forge page still parses
 * it directly, and changing it to suit the studio would fork the two.
 */
export function toStudioEvents(frame: Record<string, any>): ForgeStudioEvent[] {
    const events: ForgeStudioEvent[] = [];
    if (!frame || typeof frame !== "object") return events;

    if (typeof frame.stage === "number" && forgeStageAt(frame.stage)) {
        events.push({
            type: "step.started",
            step: frame.stage,
            total: FORGE_STAGE_COUNT,
            label: forgeStageAt(frame.stage)!.label,
        });
    }

    if (typeof frame.message === "string" && frame.message) {
        events.push({
            type: "status",
            message: frame.message,
            progress: typeof frame.progress === "number" ? frame.progress : undefined,
            level: frame.level === "warn" || frame.level === "error" || frame.level === "success" ? frame.level : "info",
        });
    }

    const assembly = frame.liveAssembly ?? frame.options?.liveAssembly;
    if (assembly && typeof assembly === "object") {
        for (const block of Array.isArray(assembly.blocks) ? assembly.blocks : []) {
            if (!block?.module) continue;
            const component: GalleryComponentRef = {
                module: String(block.module),
                componentName: String(block.componentName ?? block.module),
                category: String(block.category ?? "uncategorised"),
                status: block.status ?? "selected",
            };
            events.push(
                block.status === "mounted"
                    ? { type: "component.generated", component }
                    : { type: "component.selected", component },
            );
        }

        for (const path of Array.isArray(assembly.files) ? assembly.files : []) {
            if (typeof path !== "string" || !path) continue;
            // The assembly lists files it has written, not files in flight.
            events.push({ type: "file.completed", path });
        }

        if (assembly.api) events.push({ type: "api.spec.updated", contract: assembly.api });

        if (assembly.previewUrl || assembly.updatedAt) {
            events.push({ type: "preview.updated", revision: String(assembly.updatedAt ?? assembly.previewUrl) });
        }
    }

    const plan = frame.assemblyPlan ?? frame.options?.assemblyPlan;
    if (plan && typeof plan === "object" && typeof plan.proofExplanation === "string") {
        events.push({
            type: "diagnostic.proof",
            proof: {
                requestedPacks: Array.isArray(plan.requestedPacks) ? plan.requestedPacks : [],
                selectedPacks: Array.isArray(plan.selectedPacks) ? plan.selectedPacks : [],
                executionOrder: Array.isArray(plan.executionOrder) ? plan.executionOrder : [],
                proofExplanation: plan.proofExplanation,
            },
        });
    }

    // Approval gates arrive as a status, not as a distinct field, so the run's
    // own vocabulary is what identifies them.
    if (typeof frame.status === "string" && frame.status.startsWith("awaiting_")) {
        events.push({
            type: "approval.required",
            approval: { kind: frame.status, message: frame.message ?? "This build needs a decision before it continues." },
        });
    }

    if (frame.level === "error" || frame.status === "failed") {
        events.push({
            type: "build.failed",
            error: { message: frame.message ?? "The build failed.", stage: typeof frame.stage === "number" ? frame.stage : undefined },
        });
    }

    if (frame.status === "completed" && typeof frame.appId === "number") {
        events.push({ type: "build.completed", appId: frame.appId, slug: frame.slug });
    }

    return events;
}
