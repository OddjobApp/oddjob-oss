import { describe, expect, it } from "vitest";
import { jobConfigSchema } from "./table.js";
import { getDefaultJobConfig } from "../../../server/domain/jobs/ui/modules/jobs/job-constants.js";
import { isAiCredential } from "../../../server/domain/jobs/ui/modules/jobs/components/AIAgentJobConfig.js";

describe("agent creation readiness contracts", () => {
    it("shows every supported AI credential type", () => {
        expect(["api_key", "ai_provider", "openai", "anthropic", "gemini"].every(type => isAiCredential({ type }))).toBe(true);
        expect(isAiCredential({ type: "jira" })).toBe(false);
    });

    it("materializes autonomous-agent defaults while leaving required user inputs empty", () => {
        const defaults = getDefaultJobConfig("ai_agent");

        expect(defaults).toMatchObject({
            model: "gemini-2.0-flash",
            goal: "",
            maxIterations: 10,
            temperature: 0.7,
            supervision: "full",
        });
        expect(jobConfigSchema.safeParse({ type: "ai_agent", config: defaults }).success).toBe(false);
    });

    it("accepts a complete autonomous agent", () => {
        const config = {
            ...getDefaultJobConfig("ai_agent"),
            credentialId: 7,
            goal: "Research the account and return a sourced opportunity brief.",
        };

        expect(jobConfigSchema.safeParse({ type: "ai_agent", config }).success).toBe(true);
    });

    it("supports computer-use jobs in the canonical config union", () => {
        const config = {
            ...getDefaultJobConfig("computer_use"),
            goal: "Open the dashboard and capture its current status.",
        };

        expect(jobConfigSchema.safeParse({ type: "computer_use", config }).success).toBe(true);
        expect(jobConfigSchema.safeParse({ type: "computer_use", config: { ...config, goal: "" } }).success).toBe(false);
    });

    it("requires the canonical form-agent schema shape", () => {
        const canonical = {
            documentTemplateId: 3,
            formSchema: {
                fields: [{ key: "summary", type: "textarea", label: "Summary", required: true }],
            },
            variableMappings: {},
            timeoutMinutes: 15,
            retryOnFailure: false,
        };

        expect(jobConfigSchema.safeParse({ type: "form_agent", config: canonical }).success).toBe(true);
        expect(jobConfigSchema.safeParse({ type: "form_agent", config: { ...canonical, formSchema: canonical.formSchema.fields } }).success).toBe(false);
    });

    it("keeps dispatcher location values aligned with its executor contract", () => {
        const config = {
            serviceType: "medical",
            missionTemplateId: 4,
            userLocationSource: "variable",
            userLocationVar: "{{input.location}}",
            isDemoMode: false,
        };

        expect(jobConfigSchema.safeParse({ type: "dispatcher", config }).success).toBe(true);
        expect(jobConfigSchema.safeParse({ type: "dispatcher", config: { ...config, userLocationSource: "input" } }).success).toBe(false);
    });
});
