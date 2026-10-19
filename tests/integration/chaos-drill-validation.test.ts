import { describe, it, expect } from "vitest";
import { BlueprintSchemaValidator } from "@server/domain/org/core/blueprint-schema.validator.js";
import fs from "fs/promises";
import path from "path";

describe("Chaos Drill Blueprint Schema Validation", () => {
    const validator = BlueprintSchemaValidator;

    it("should validate full Chaos Engineering & Auto-Recovery Drill blueprint", async () => {
        const yamlPath = path.join(process.cwd(), "server/cycles/chaos-drill.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");

        const result = validator.validate(yamlContent);
        if (!result.valid) {
            console.error("Chaos Drill blueprint validation errors:", result.errors);
        }
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });
});
