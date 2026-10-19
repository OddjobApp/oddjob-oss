import { describe, it, expect } from "vitest";
import { BlueprintSchemaValidator } from "@server/domain/org/core/blueprint-schema.validator.js";
import fs from "fs/promises";
import path from "path";

describe("Blueprint Schema Validation", () => {
    const validator = BlueprintSchemaValidator;

    const baseYaml = `
name: "test"
version: "1.0.0"
description: "test"
agents:
  - id: "test-agent"
    name: "Test Agent"
    system_prompt: "You are a test agent."
missions:
  - id: "test-mission"
    name: "Test Mission"
    primary_agent: "test-agent"
    trigger: "manual"
`;

    it("should validate valid blueprint", async () => {
        const result = validator.validate(baseYaml);

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
        const baseYaml = `
name: "test"
version: "1.0.0"
description: "test"
agents:
  - id: "test-agent"
    name: "Test Agent"
    system_prompt: "You are a test agent."
missions:
  - id: "test-mission"
    name: "Test Mission"
    primary_agent: "test-agent"
    trigger: "manual"
`;
        const yamlWithHumanRoles = baseYaml + `
human_roles:
  team: "Test Team"
  members:
    - user_id: "user1"
      role: "Test Role"
      permissions: ["read", "write"]
`;

        const result = validator.validate(yamlWithHumanRoles);

        expect(result.valid).toBe(true);
    });

    it("should validate apps section", () => {
        const yamlWithApps = baseYaml + `
apps:
  - id: "test_app"
    path: "file://test.json"
    enabled: true
`;

        const result = validator.validate(yamlWithApps);

        expect(result.valid).toBe(true);
    });

    it("should validate org_customizations section", () => {
        const yamlWithCustomizations = baseYaml + `
org_customizations:
  ui:
    theme: "professional"
  workflow:
    default_approval_timeout_hours: 24
`;

        const result = validator.validate(yamlWithCustomizations);

        expect(result.valid).toBe(true);
    });

    it("should detect invalid app configuration", () => {
        const invalidYaml = `
name: "test"
version: "1.0.0"
description: "test"
apps:
  - id: "test_app"
    # missing path or schema
`;

        const result = validator.validate(invalidYaml);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.path.includes("apps"))).toBe(true);
    });

    it("should validate cycle chaining configuration", () => {
        const validYamlWithChaining = baseYaml + `
follow_up_cycle_template_id: 123
follow_up_cycle:
  name: "mitigation"
  objective: "mitigate service anomaly"
  blueprints:
    - name: "hotfix"
      objective: "write hotfix code"
`;

        const result = validator.validate(validYamlWithChaining);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("should fail validation if follow_up_cycle is missing required fields", () => {
        const invalidYamlWithChaining = `
name: "triage"
version: "1.0.0"
description: "triage phase"
follow_up_cycle:
  name: "mitigation"
  # missing objective and blueprints
`;

        const result = validator.validate(invalidYamlWithChaining);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.path.includes("follow_up_cycle"))).toBe(true);
    });
});

