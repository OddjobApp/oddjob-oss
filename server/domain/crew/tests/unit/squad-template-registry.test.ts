import { describe, it, expect } from "vitest";
import { squadTemplateRegistry } from "../../core/squad-template-registry.service.js";

describe("SquadTemplateRegistryService", () => {
    it("lists default hybrid squad templates across core enterprise categories", () => {
        const templates = squadTemplateRegistry.listTemplates();

        expect(templates.length).toBeGreaterThanOrEqual(4);
        const slugs = templates.map(t => t.slug);
        expect(slugs).toContain("rapid-prototyping");
        expect(slugs).toContain("forensic-redteam");
        expect(slugs).toContain("compliance-quorum");
        expect(slugs).toContain("deep-research");
    });

    it("retrieves a squad template by slug with complete member and quorum definitions", () => {
        const template = squadTemplateRegistry.getTemplate("forensic-redteam");

        expect(template).toBeDefined();
        expect(template?.name).toBe("Forensic Red-Team Squad");
        expect(template?.quorumPolicy).toBe("unanimous");
        expect(template?.members.length).toBe(3);
        expect(template?.members.find(m => m.isLead)?.displayName).toBe("Aegis");
    });
});
