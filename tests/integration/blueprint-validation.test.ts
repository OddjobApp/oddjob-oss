import { describe, it, expect } from "vitest";
import { BlueprintSchemaValidator } from "@server/domain/org/core/blueprint-schema.validator.js";
import fs from "fs/promises";
import path from "path";

describe("Blueprint Schema Validation", () => {
    const validator = BlueprintSchemaValidator;

    it("should validate valid blueprint", async () => {
        const yamlPath = path.join(process.cwd(), "server/cycles/hybrid-sdlc.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");

        const result = validator.validate(yamlContent);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("should detect missing required fields", () => {
        const invalidYaml = `
name: "test"
# missing version and description
`;

        const result = validator.validate(invalidYaml);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should validate human_roles section", () => {
        const yamlWithHumanRoles = `
name: "test"
version: "1.0.0"
description: "test"
agents: []
missions: []
human_roles:
  team: "Test Team"
  members:
    - user_id: "user1"
      role: "Test Role"
      permissions: ["read", "write"]
`;

        const result = validator.validate(yamlWithHumanRoles);
        if (!result.valid) {
            console.error("human_roles validation errors:", result.errors);
        }
        expect(result.valid).toBe(true);
    });

    it("should validate apps section", () => {
        const yamlWithApps = `
name: "test"
version: "1.0.0"
description: "test"
agents: []
missions: []
apps:
  - id: "test_app"
    path: "file://test.json"
    enabled: true
`;

        const result = validator.validate(yamlWithApps);
        if (!result.valid) {
            console.error("apps validation errors:", result.errors);
        }
        expect(result.valid).toBe(true);
    });

    it("should validate org_customizations section", () => {
        const yamlWithCustomizations = `
name: "test"
version: "1.0.0"
description: "test"
agents: []
missions: []
org_customizations:
  ui:
    theme: "professional"
  workflow:
    default_approval_timeout_hours: 24
`;

        const result = validator.validate(yamlWithCustomizations);
        if (!result.valid) {
            console.error("org_customizations validation errors:", result.errors);
        }
        expect(result.valid).toBe(true);
    });

    it("should detect invalid app configuration", () => {
        const invalidYaml = `
name: "test"
version: "1.0.0"
description: "test"
agents: []
missions: []
apps:
  - id: "test_app"
    # missing path or schema
`;

        const result = validator.validate(invalidYaml);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.path.includes("apps"))).toBe(true);
    });

    it("should validate cycle chaining configuration", () => {
        const validYamlWithChaining = `
name: "triage"
version: "1.0.0"
description: "triage phase"
agents: []
missions: []
follow_up_cycle_template_id: 123
follow_up_cycle:
  name: "mitigation"
  objective: "mitigate service anomaly"
  blueprints:
    - name: "hotfix"
      objective: "write hotfix code"
`;

        const result = validator.validate(validYamlWithChaining);
        if (!result.valid) {
            console.error("chaining validation errors:", result.errors);
        }
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("should fail validation if follow_up_cycle is missing required fields", () => {
        const invalidYamlWithChaining = `
name: "triage"
version: "1.0.0"
description: "triage phase"
agents: []
missions: []
follow_up_cycle:
  name: "mitigation"
  # missing objective and blueprints
`;

        const result = validator.validate(invalidYamlWithChaining);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.path.includes("follow_up_cycle"))).toBe(true);
    });

    it("should validate full Incident Response Chain blueprint", async () => {
        const yamlPath = path.join(process.cwd(), "server/cycles/incident-response-chain.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");

        const result = validator.validate(yamlContent);
        if (!result.valid) {
            console.error("Incident response blueprint validation errors:", result.errors);
        }
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });
});
