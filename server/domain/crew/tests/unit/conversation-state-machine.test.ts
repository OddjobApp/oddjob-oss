import { describe, it, expect, beforeEach } from "vitest";
import { conversationStateMachine } from "../../core/conversation-state-machine.service.js";

describe("ConversationStateMachineService", () => {
    beforeEach(() => {
        conversationStateMachine.reset();
    });

    it("starts in DISCOVERY state and transitions to DEBATE on unresolved contradictions", () => {
        expect(conversationStateMachine.getState()).toBe("DISCOVERY");

        const transition = conversationStateMachine.evaluateTransition(2, 1, 0.5);

        expect(transition).not.toBeNull();
        expect(transition?.toState).toBe("DEBATE");
        expect(conversationStateMachine.getState()).toBe("DEBATE");
        expect(conversationStateMachine.getConfig().allowInterruptions).toBe(true);
    });

    it("transitions through CONSENSUS_BUILDING to DECISION_MAKING upon high agreement", () => {
        // Move to DEBATE
        conversationStateMachine.evaluateTransition(2, 1, 0.5);

        // Reconcile contradictions in DEBATE -> move to CONSENSUS_BUILDING
        const toConsensus = conversationStateMachine.evaluateTransition(4, 0, 0.8);
        expect(toConsensus?.toState).toBe("CONSENSUS_BUILDING");

        // High agreement in CONSENSUS_BUILDING -> move to DECISION_MAKING
        const toDecision = conversationStateMachine.evaluateTransition(6, 0, 0.9);
        expect(toDecision?.toState).toBe("DECISION_MAKING");
    });
});
