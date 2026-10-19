import type { RescueSession } from "@shared/schema/rescue.js";

export type RescueStatus = RescueSession["status"];

const TERMINAL_STATUSES = new Set<RescueStatus>(["COMPLETED", "FAILED", "CANCELLED"]);

export const ALLOWED_RESCUE_TRANSITIONS: Readonly<Record<RescueStatus, readonly RescueStatus[]>> = {
    ACTIVE: ["REQUESTED", "FAILED", "CANCELLED"],
    REQUESTED: ["TRIAGED", "OFFERED", "FAILED", "CANCELLED"],
    TRIAGED: ["OFFERED", "FAILED", "CANCELLED"],
    OFFERED: ["ACCEPTED", "TRIAGED", "FAILED", "CANCELLED"],
    ACCEPTED: ["ENROUTE", "TRIAGED", "FAILED", "CANCELLED"],
    ENROUTE: ["ARRIVED", "TRIAGED", "FAILED", "CANCELLED"],
    ARRIVED: ["ASSISTING", "FAILED", "CANCELLED"],
    ASSISTING: ["RELAY_ENROUTE", "COMPLETED", "FAILED", "CANCELLED"],
    RELAY_ENROUTE: ["ARRIVED", "COMPLETED", "FAILED", "CANCELLED"],
    COMPLETED: [],
    FAILED: [],
    CANCELLED: [],
};

export interface CompletionEvidence {
    providerNotes?: string;
    requesterConfirmed?: boolean;
    diagnosticCodes?: string[];
    photoUrls?: string[];
    readings?: Record<string, string | number>;
    operatorOverrideReason?: string;
}

export function canTransitionRescue(from: RescueStatus, to: RescueStatus): boolean {
    return from === to || ALLOWED_RESCUE_TRANSITIONS[from]?.includes(to) === true;
}

export function assertRescueTransition(
    from: RescueStatus,
    to: RescueStatus,
    options: { completionEvidence?: CompletionEvidence; arrivalVerified?: boolean } = {},
): void {
    if (TERMINAL_STATUSES.has(from) && from !== to) {
        throw new Error(`Rescue is terminal in ${from}; transition to ${to} is not allowed`);
    }
    if (!canTransitionRescue(from, to)) {
        throw new Error(`Invalid rescue transition: ${from} -> ${to}`);
    }
    if (to === "ASSISTING" && !options.arrivalVerified) {
        throw new Error("Arrival verification is required before assistance can begin");
    }
    if (to === "COMPLETED") {
        const evidence = options.completionEvidence;
        const hasProviderEvidence = Boolean(
            evidence?.providerNotes?.trim()
            || evidence?.diagnosticCodes?.length
            || evidence?.photoUrls?.length
            || (evidence?.readings && Object.keys(evidence.readings).length > 0),
        );
        const hasConfirmation = evidence?.requesterConfirmed === true || Boolean(evidence?.operatorOverrideReason?.trim());
        if (!hasProviderEvidence || !hasConfirmation) {
            throw new Error("Completion requires provider evidence and requester confirmation or an operator override");
        }
    }
}

