/**
 * Adaptive Conversation State Machine Service
 *
 * Coordinates dynamic shifts across conversation phases:
 * DISCOVERY -> DEBATE -> CONSENSUS_BUILDING -> DECISION_MAKING -> FINALIZED
 */

export type ConversationState = "DISCOVERY" | "DEBATE" | "CONSENSUS_BUILDING" | "DECISION_MAKING" | "FINALIZED";

export interface StateTransitionEvent {
    fromState: ConversationState;
    toState: ConversationState;
    reason: string;
    unresolvedContradictions: number;
    agreementRatio: number; // 0.0 - 1.0
    timestamp: Date;
}

export interface ConversationStateConfig {
    currentState: ConversationState;
    turnDurationCapSeconds: number;
    allowInterruptions: boolean;
    requiredConsensusThreshold: number; // 0.0 - 1.0
    allowedSpeakerIntents: string[];
}

export class ConversationStateMachineService {
    private currentState: ConversationState = "DISCOVERY";

    public getState(): ConversationState {
        return this.currentState;
    }

    public getConfig(): ConversationStateConfig {
        switch (this.currentState) {
            case "DISCOVERY":
                return {
                    currentState: "DISCOVERY",
                    turnDurationCapSeconds: 120,
                    allowInterruptions: false,
                    requiredConsensusThreshold: 0.5,
                    allowedSpeakerIntents: ["clarification", "build_upon"],
                };
            case "DEBATE":
                return {
                    currentState: "DEBATE",
                    turnDurationCapSeconds: 60,
                    allowInterruptions: true,
                    requiredConsensusThreshold: 0.6,
                    allowedSpeakerIntents: ["challenge", "clarification", "arbitration"],
                };
            case "CONSENSUS_BUILDING":
                return {
                    currentState: "CONSENSUS_BUILDING",
                    turnDurationCapSeconds: 45,
                    allowInterruptions: false,
                    requiredConsensusThreshold: 0.8,
                    allowedSpeakerIntents: ["arbitration", "build_upon", "conclusion"],
                };
            case "DECISION_MAKING":
            case "FINALIZED":
                return {
                    currentState: this.currentState,
                    turnDurationCapSeconds: 30,
                    allowInterruptions: false,
                    requiredConsensusThreshold: 0.95,
                    allowedSpeakerIntents: ["conclusion"],
                };
        }
    }

    /**
     * Evaluates room telemetry to transition to the next conversation state.
     */
    public evaluateTransition(
        turnsCompleted: number,
        unresolvedContradictions: number,
        agreementRatio: number
    ): StateTransitionEvent | null {
        const fromState = this.currentState;
        let toState = fromState;
        let reason = "";

        if (fromState === "DISCOVERY" && turnsCompleted >= 2) {
            toState = unresolvedContradictions > 0 ? "DEBATE" : "CONSENSUS_BUILDING";
            reason = unresolvedContradictions > 0
                ? "Contradictions detected during discovery. Entering DEBATE phase."
                : "Initial discovery completed without contradictions. Entering CONSENSUS_BUILDING.";
        } else if (fromState === "DEBATE" && (unresolvedContradictions === 0 || agreementRatio >= 0.75)) {
            toState = "CONSENSUS_BUILDING";
            reason = `Contradictions reconciled (Agreement ratio: ${(agreementRatio * 100).toFixed(0)}%).`;
        } else if (fromState === "CONSENSUS_BUILDING" && agreementRatio >= 0.85) {
            toState = "DECISION_MAKING";
            reason = `High quorum consensus reached (${(agreementRatio * 100).toFixed(0)}%). Proceeding to formal decision lock.`;
        } else if (fromState === "DECISION_MAKING") {
            toState = "FINALIZED";
            reason = "Formal decision committed to project ledger.";
        }

        if (toState !== fromState) {
            this.currentState = toState;
            return {
                fromState,
                toState,
                reason,
                unresolvedContradictions,
                agreementRatio,
                timestamp: new Date(),
            };
        }

        return null;
    }

    public reset(): void {
        this.currentState = "DISCOVERY";
    }
}

export const conversationStateMachine = new ConversationStateMachineService();
