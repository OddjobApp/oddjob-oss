import { describe, it, expect } from "vitest";
import { BlueprintSchemaValidator } from "@server/domain/org/core/blueprint-schema.validator.js";
import fs from "fs/promises";
import path from "path";

describe("Technical Research Blueprint Schema Validation", () => {
    const validator = BlueprintSchemaValidator;

    it("should validate full Technical Research & RFC Synthesis blueprint", async () => {
        const yamlPath = path.join(process.cwd(), "server/cycles/technical-research.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");

        const result = validator.validate(yamlContent);
        if (!result.valid) {
            console.error("Technical Research blueprint validation errors:", result.errors);
        }
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });
});
