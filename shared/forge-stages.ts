/**
 * Canonical App Forge stage model, shared by the emitter and every surface that
 * renders progress.
 *
 * The server stamps a stage index onto every FORGE_LOG event it publishes
 * (`STAGE_PROGRESS` in app-forge.service.ts) and there are SEVEN of them, 0..6.
 * The App Forge page carried its own list of EIGHT labels, inserting a
 * "Provisioning" step between Architecture and Assembly, and the stream handler
 * lights lamp `i === data.stage`. So from index 3 onward every emitted stage lit
 * the wrong lamp: server 3 (UI assembly) lit "Provisioning", server 4
 * (Hardening) lit "Assembly", server 6 (Ignition) lit "Industrialization" — and
 * "Ignition" never activated at all, only ever turning green via the terminal
 * completion handler that marks the whole list done.
 *
 * Provisioning is not a stage of its own. It is emitted at index 3 alongside UI
 * assembly ("Provisioning: Claimed warm container on port …", stage 3). One list
 * on both sides of the stream is what keeps the two from drifting again.
 */

export type ForgeStageKey =
    | "discovery"
    | "strategy"
    | "architecture"
    | "assembly"
    | "hardening"
    | "industrialization"
    | "ignition";

export interface ForgeStageDefinition {
    /** The index the server emits on FORGE_LOG events. */
    index: number;
    key: ForgeStageKey;
    /** Short label for a progress row. */
    label: string;
    /** What the stage is doing, for the line under the label. */
    description: string;
    /** Percentage the server reports on entering this stage. */
    progress: number;
}

export const FORGE_STAGES: readonly ForgeStageDefinition[] = [
    { index: 0, key: "discovery", label: "Discovery", description: "Reading the request and the existing scaffolds", progress: 5 },
    { index: 1, key: "strategy", label: "Strategy", description: "Planning requirements and the wave plan", progress: 15 },
    { index: 2, key: "architecture", label: "Architecture", description: "Mapping the design onto gallery components", progress: 25 },
    { index: 3, key: "assembly", label: "Assembly", description: "Provisioning the container and mounting the composition", progress: 40 },
    { index: 4, key: "hardening", label: "Hardening", description: "Validating the workspace and resolving findings", progress: 65 },
    { index: 5, key: "industrialization", label: "Industrialization", description: "Promoting build artifacts to a production image", progress: 85 },
    { index: 6, key: "ignition", label: "Ignition", description: "Governance, registration and container launch", progress: 98 },
] as const;

/** Total stages a forge run reports. Seven, not eight. */
export const FORGE_STAGE_COUNT = FORGE_STAGES.length;

/** The stage a server-emitted index refers to, or null if it is out of range. */
export function forgeStageAt(index: number | null | undefined): ForgeStageDefinition | null {
    if (typeof index !== "number" || !Number.isInteger(index)) return null;
    return FORGE_STAGES[index] ?? null;
}

/**
 * Percentage to render for an emitted stage index.
 *
 * Falls back to the stage table rather than trusting a `progress` the event may
 * not carry: only events that pass a stage get one, so a bare log line would
 * otherwise reset a progress bar to zero.
 */
export function forgeProgressPercent(index: number | null | undefined): number {
    return forgeStageAt(index)?.progress ?? 0;
}

/** "Step 4 of 7 — Assembly", the compact progress row's heading. */
export function forgeStageHeading(index: number | null | undefined): string {
    const stage = forgeStageAt(index);
    if (!stage) return "Preparing…";
    return `Step ${stage.index + 1} of ${FORGE_STAGE_COUNT} — ${stage.label}`;
}
