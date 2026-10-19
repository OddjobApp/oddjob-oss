import { describe, expect, it } from "vitest";
import { scribeIntentResolverService } from "../scribe-intent-resolver.service.js";
import { IntentRouterService } from "../intent-router.service.js";

describe("ScribeIntentResolverService", () => {
    it("resolves SOW statement of work with extracted entities and title", () => {
        const prompt = "Write an SOW for Acme Corp's cloud migration project, fixed-fee, 3 milestones";
        const res = scribeIntentResolverService.resolve(prompt);

        expect(res.archetypeMode).toBe("sow_statement_of_work");
        expect(res.confidence).toBeGreaterThanOrEqual(0.7);
        expect(res.extractedEntities.client_name).toBe("Acme Corp");
        expect(res.extractedEntities.pricing_model).toBe("Fixed Fee");
        expect(res.extractedEntities.milestone_count).toBe("3");
        expect(res.inferredTitle).toContain("Acme Corp");
        expect(res.inferredTitle).toContain("Statement of Work");
        expect(res.framework?.stationCount).toBe(8);
        expect(res.framework?.criticRoles).toContain("Commercial Counsel");
    });

    it("resolves enterprise SOP runbook request", () => {
        const prompt = "Draft an enterprise SOP runbook for database failover and recovery procedures";
        const res = scribeIntentResolverService.resolve(prompt);

        expect(res.archetypeMode).toBe("enterprise_sop");
        expect(res.confidence).toBeGreaterThanOrEqual(0.7);
        expect(res.inferredTitle).toContain("Standard Operating Procedure");
        expect(res.framework?.stationCount).toBe(6);
    });

    it("resolves business case & justification request", () => {
        const prompt = "Prepare a business case and ROI justification document for AI automation platform";
        const res = scribeIntentResolverService.resolve(prompt);

        expect(res.archetypeMode).toBe("business_doc_best_practices");
        expect(res.confidence).toBeGreaterThanOrEqual(0.7);
        expect(res.framework?.stationCount).toBe(7);
    });

    it("resolves SaaS MSA contract request", () => {
        const prompt = "Draft a SaaS MSA and service level agreement for Enterprise customer Beta Corp";
        const res = scribeIntentResolverService.resolve(prompt);

        expect(res.archetypeMode).toBe("saas_msa");
        expect(res.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("falls back to freeform when generic authoring term is used without specific archetype", () => {
        const prompt = "Help me compose a new document about future roadmap";
        const res = scribeIntentResolverService.resolve(prompt);

        expect(res.archetypeMode).toBe("freeform");
        expect(res.confidence).toBeLessThan(0.7);
    });

    it("resolves product requirement request with clean title and PRD archetype", () => {
        const prompt = "I want to write a product requirement for an app called Shelfie. Shelfie is an app that keeps track of refrigerator inventory and use by dates so that the user can prioritize consumption. There are two types of tracking required use by date and purchase date.";
        const res = scribeIntentResolverService.resolve(prompt);

        expect(res.archetypeMode).toBe("business_doc_best_practices");
        expect(res.confidence).toBeGreaterThanOrEqual(0.7);
        expect(res.inferredTitle).toBe("Shelfie — Product Requirements Document (PRD)");
        expect(res.inferredTitle).not.toContain("keeps track of refrigerator inventory");
        expect(res.framework?.stationCount).toBe(7);
    });
});
