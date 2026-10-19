/**
 * Provider-agnostic computer-use loop contract.
 *
 * The task service used to be hardcoded to Gemini's Interactions API. This
 * module defines the surface both Gemini and Anthropic drivers implement so the
 * rest of the system can switch providers without knowing the underlying API
 * shape.
 */

import type { TrycuaActionInput } from "./trycua-service.js";

export interface ComputerUseCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface ComputerUseLoopStep {
    call: ComputerUseCall;
    actions: TrycuaActionInput[];
    result: Record<string, unknown>;
    acknowledged: boolean;
}

export interface ComputerUseLoopDeps {
    screenshot(): Promise<string>;
    execute(action: TrycuaActionInput): Promise<unknown>;
    recordStep(step: ComputerUseLoopStep): Promise<void>;
    isCancelled(): Promise<boolean>;
    sleep?(ms: number): Promise<void>;
    /** Gap between consecutive desktop actions; the session rate limiter rejects faster. */
    actionGapMs?: number;
}

export interface ComputerUseLoopOptions {
    goal: string;
    maxTurns: number;
    /** Pause before every action for a human to confirm. */
    supervised: boolean;
    /** Set when resuming: the human approved the pending call. */
    resume?: { approved: true; userResponse?: string };
}

export type PauseKind = "safety" | "yield" | "supervised";

export interface ComputerUseLoopState {
    /** Provider-specific opaque state (e.g. Gemini interactionId or Anthropic messages). */
    providerState?: Record<string, unknown>;
    /** Calls from the model's last turn still to run, after a pause. */
    pendingCalls?: ComputerUseCall[];
    /** Results already produced in that turn. */
    doneResults?: { call: ComputerUseCall; result: Record<string, unknown> }[];
    /** Why the loop paused on pendingCalls[0]. */
    pauseKind?: PauseKind;
}

export type ComputerUseLoopOutcome =
    | { status: "succeeded"; summary: string; turns: number; state: ComputerUseLoopState }
    | { status: "needs_confirmation"; kind: PauseKind; explanation: string; call: ComputerUseCall; turns: number; state: ComputerUseLoopState }
    | { status: "blocked"; explanation: string; call: ComputerUseCall; turns: number; state: ComputerUseLoopState }
    | { status: "cancelled"; turns: number; state: ComputerUseLoopState }
    | { status: "failed"; error: string; turns: number; state: ComputerUseLoopState };

export interface ComputerUseLoopDriver {
    runLoop(deps: ComputerUseLoopDeps, options: ComputerUseLoopOptions, initial: ComputerUseLoopState): Promise<ComputerUseLoopOutcome>;
}

export interface ComputerUseProviderConfig {
    provider: "google" | "anthropic";
    model: string;
    apiKey: string;
    baseUrl?: string;
}
