import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { evalScenarioSchema } from "@shared/contracts/index.js";

const dir = path.join(process.cwd(), "tests/evals/scenarios");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

describe("scenario files validate against the schema", () => {
    it("finds scenario files", () => {
        expect(files.length).toBeGreaterThan(0);
    });

    it.each(files)("%s parses and resolves a subject", (file) => {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
        const parsed = evalScenarioSchema.safeParse(raw);
        expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues)).toBe(true);
        if (parsed.success) {
            expect(parsed.data.subject.ref.length).toBeGreaterThan(0);
            expect(parsed.data.criteria.length).toBeGreaterThan(0);
        }
    });
});
