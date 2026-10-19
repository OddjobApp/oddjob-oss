import type { RescueSession } from "@shared/schema/rescue.js";

export interface DispatchCopilotRecommendation {
    rescueId: string;
    recommendedAction: string;
    proposedStatus?: RescueSession["status"];
    requiresApproval: boolean;
    confidence: "high" | "medium" | "low";
    reasons: string[];
    unresolvedQuestions: string[];
    evidence: Array<{ source: string; observedAt: string; summary: string }>;
}

export function recommendDispatchAction(session: RescueSession): DispatchCopilotRecommendation {
    const metadata = (session.metadata as Record<string, any>) || {};
    const rescueId = `RSC-${String(session.id).padStart(3, "0")}`;
    const evidence = [
        {
            source: "rescue_session",
            observedAt: session.updatedAt.toISOString(),
            summary: `Current state ${session.status}; severity ${session.severity || "unclassified"}`,
        },
    ];
    if (metadata.maintenanceStatus) {
        evidence.push({
            source: metadata.maintenanceSource || "asset_registry",
            observedAt: metadata.maintenanceVerifiedAt || session.updatedAt.toISOString(),
            summary: `Maintenance: ${metadata.maintenanceStatus}`,
        });
    }

    const base = {
        rescueId,
        requiresApproval: true,
        confidence: "high" as const,
        evidence,
        reasons: [] as string[],
        unresolvedQuestions: [] as string[],
    };

    switch (session.status) {
        case "REQUESTED":
            return {
                ...base,
                recommendedAction: "Complete safety triage and verify the location before provider matching",
                proposedStatus: "TRIAGED",
                reasons: ["Dispatch has been received but has not completed operational triage"],
                unresolvedQuestions: [
                    ...(!session.userLocation?.lat || !session.userLocation?.lng ? ["Verified coordinates"] : []),
                    ...(!session.severity ? ["Operational severity"] : []),
                ],
            };
        case "TRIAGED":
            return {
                ...base,
                recommendedAction: "Rank qualified providers by skills, capacity, ETA, and SLA probability",
                proposedStatus: "OFFERED",
                reasons: ["Triage is complete and no provider offer is active"],
                unresolvedQuestions: ["Provider qualifications and reserved capacity"],
            };
        case "OFFERED":
            return {
                ...base,
                recommendedAction: "Monitor the provider acceptance deadline; escalate if it expires",
                reasons: [`Offer is awaiting an explicit response from ${session.providerName || "the provider"}`],
                unresolvedQuestions: ["Provider acceptance", "Crew and equipment reservation"],
            };
        case "ACCEPTED":
            return {
                ...base,
                recommendedAction: "Confirm crew readiness and dispatch the accepted provider",
                proposedStatus: "ENROUTE",
                reasons: [`${session.providerName || "Provider"} accepted the mission`],
                unresolvedQuestions: ["Final ETA", "Required equipment onboard"],
            };
        case "ENROUTE":
            return {
                ...base,
                recommendedAction: "Monitor ETA and alert operations if SLA risk increases",
                proposedStatus: "ARRIVED",
                reasons: ["Provider is travelling to the verified incident location"],
                unresolvedQuestions: ["Live ETA and traffic confidence"],
            };
        case "ARRIVED":
            return {
                ...base,
                recommendedAction: "Verify the arrival handshake before work begins",
                proposedStatus: "ASSISTING",
                reasons: ["Provider reports arrival but identity confirmation is pending"],
                unresolvedQuestions: session.arrivalProtocolVerified ? [] : ["Requester arrival verification"],
            };
        case "ASSISTING":
        case "RELAY_ENROUTE":
            return {
                ...base,
                recommendedAction: "Collect diagnostic evidence and requester confirmation before closure",
                proposedStatus: "COMPLETED",
                reasons: ["Work is active; closure remains evidence-gated"],
                unresolvedQuestions: ["Provider evidence", "Requester confirmation or operator override"],
            };
        default:
            return {
                ...base,
                recommendedAction: "No automated action recommended for a terminal rescue",
                requiresApproval: false,
                confidence: "high",
                reasons: [`Rescue is ${session.status}`],
                unresolvedQuestions: [],
            };
    }
}

