/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { parseAgentResponse } from "./AgentInputForm";

const token = "0123456789abcdef".repeat(3);

describe("parseAgentResponse — shared forms", () => {
    it("recognises a shared published form, alone or inside a reply", () => {
        const share = { type: "form_studio_form", token, formName: "Beta validation", releaseNumber: 2 };
        expect(parseAgentResponse(JSON.stringify(share))).toEqual({ type: "form_studio_form", data: share });
        expect(parseAgentResponse("Here you go:\n```json\n" + JSON.stringify(share) + "\n```")).toEqual({ type: "form_studio_form", data: share });
    });

    it("treats anything without a real link token as text", () => {
        for (const bad of [{ type: "form_studio_form" }, { type: "form_studio_form", token: "../../api/admin" }, { type: "form_studio_form", token: token.toUpperCase() }]) {
            expect(parseAgentResponse(JSON.stringify(bad)).type).toBe("text");
        }
    });
});
