import { describe, expect, it } from "vitest";
import { mapAgentError } from "./agent-error-map.js";
import { ORG_AI_KEY_MISSING } from "@domain/ai/core/organization-ai-client.js";
import { ORG_GEMINI_KEY_MISSING } from "@domain/ai/core/org-gemini-key.js";

describe("mapAgentError", () => {
    it("tells an organization without an AI key where to connect one", () => {
        const { userMessage, errorCode } = mapAgentError(ORG_AI_KEY_MISSING);
        expect(errorCode).toBe("ORG_AI_KEY_MISSING");
        expect(userMessage).toContain("/platform/ai-models");
    });

    it("says when a feature needs Gemini specifically", () => {
        expect(mapAgentError(`${ORG_GEMINI_KEY_MISSING} to use Hermes reasoning.`).errorCode).toBe("ORG_GEMINI_KEY_MISSING");
    });

    it("keeps the generic message for unknown errors", () => {
        expect(mapAgentError("something odd").errorCode).toBe("AGENT_ERROR");
    });
});
