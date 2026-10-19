/**
 * The execution context every crew tool call in a round shares.
 *
 * Lives outside the orchestrator because both the speaker turn and the app
 * studio paths build it, and the two must agree: this was written out at four
 * call sites inside a single speaker's turn -- first pass, bounded follow-up,
 * markdown recovery, and the email fallback -- and they had already drifted.
 * The email path carried no sessionId, so a session-scoped tool reached that
 * way could not tell which room had called it. projectId/projectKey are a read
 * boundary rather than decoration, so they must not vary between passes either.
 */

import type { ToolContext } from "@domain/tools/v1/capabilities/types.js";

export function buildCrewToolContext(scope: {
    orgId: number;
    userId?: string;
    projectId: number | null;
    projectKey: string | null;
    sessionKey: string;
    sessionId: number;
    message: string;
    /** Which agent is speaking, so a write it makes is attributable. */
    agentName?: string;
    /** The speaking card's id — the send gate reads its approval boundary. */
    agentCardId?: number;
}): ToolContext {
    return {
        organizationId: scope.orgId,
        userId: scope.userId ?? "crew",
        // Carries the room's Project Space so a tool cannot read across the
        // boundary.
        projectId: scope.projectId,
        projectKey: scope.projectKey,
        // Which room the call came from. Proposal tools record this so an
        // approval decided later can be reported back into the discussion
        // that raised it.
        sessionKey: scope.sessionKey,
        sessionId: scope.sessionId,
        // Who is writing. Without it every authoring operation a crew agent
        // performs is recorded against the generic "author", which makes the
        // record unable to answer the first question anyone asks of it.
        agentName: scope.agentName,
        agentCardId: scope.agentCardId,
        named: { message: scope.message },
        positional: {},
    };
}
