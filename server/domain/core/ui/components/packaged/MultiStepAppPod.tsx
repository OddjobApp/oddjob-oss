import React from "react";
import { MultiStepAppProvider } from "@/modules/apps/context/MultiStepAppContext";
import { MultiStepScreenContainer } from "@/modules/apps/components/MultiStepScreenContainer";

/**
 * Multi-step assembly run, mounted inline in chat.
 *
 * Renders a run that already exists SERVER-SIDE: the pod receives only a
 * sessionId, and the provider reads stage state from /api/blueprint-sessions.
 * Stage prerequisites are enforced by the server on submit, so nothing here can
 * advance a run that isn't allowed to advance.
 *
 * `blueprint.layout.type` defaults to "chat_inline", which is what this serves.
 */
export interface MultiStepAppPodProps {
    /** Server-side blueprint session id, from start_multistep_run. */
    sessionId?: string;
    /** Supplied by the chat artifact host when the run completes. */
    onComplete?: (finalResults: Record<string, Record<string, unknown>>) => void;
}

export default function MultiStepAppPod({ sessionId, onComplete }: MultiStepAppPodProps) {
    // Without a session there is nothing to render. Say so plainly rather than
    // mounting an empty wizard that reads as a run with no steps.
    if (!sessionId) {
        return (
            <div className="p-6 text-center text-xs font-mono text-amber-500" data-testid="multistep-no-session">
                No run session was provided. Start one with <code>start_multistep_run</code>.
            </div>
        );
    }

    return (
        <div data-testid="multistep-app-pod" className="w-full">
            <MultiStepAppProvider sessionId={sessionId} onComplete={onComplete}>
                <MultiStepScreenContainer />
            </MultiStepAppProvider>
        </div>
    );
}
