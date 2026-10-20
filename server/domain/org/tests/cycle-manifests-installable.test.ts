/**
 * Every cycle in server/cycles must be installable by Org Forge.
 *
 * installCycleApp validates each manifest with BlueprintSchemaValidator and throws
 * on any error, so a file that fails it can never be installed. Eight did: four
 * written as phases[] instead of missions[], two whose missions had no name, agent
 * or trigger, and two missing an integration key. Nothing ran the validator over
 * the directory, so it went unnoticed.
 *
 * Two shapes pass the validator yet install wrong, so they are checked here too:
 * the installer reads a mission's steps from `sequence` (a `steps` list installs a
 * mission with none), and a form field's key from `name` (a field with only `id`
 * is provisioned with an undefined key).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { BlueprintSchemaValidator } from "../core/blueprint-schema.validator.js";

const CYCLES_DIR = path.resolve("server/cycles");
const files = fs.readdirSync(CYCLES_DIR).filter((f) => f.endsWith(".cycle.yaml")).sort();

describe("cycle manifests are installable by Org Forge", () => {
    it("finds the cycle files", () => {
        // A path change that matched nothing would make every check below vacuous.
        expect(files.length).toBeGreaterThan(40);
    });

    for (const file of files) {
        it(file, () => {
            const source = fs.readFileSync(path.join(CYCLES_DIR, file), "utf8");

            const result = BlueprintSchemaValidator.validate(source);
            expect(result.errors.map((e: any) => `${e.path}: ${e.message}`)).toEqual([]);

            const manifest: any = yaml.load(source);
            const missionsWithSteps = (manifest.missions ?? [])
                .filter((m: any) => m.steps && !m.sequence)
                .map((m: any) => m.id);
            expect(missionsWithSteps, "missions list steps under `steps`; the installer reads `sequence`").toEqual([]);

            const unnamedFields = (manifest.forms ?? []).flatMap((form: any) =>
                (form.fields ?? []).filter((f: any) => !f.name).map((f: any) => `${form.id}.${f.id ?? "?"}`),
            );
            expect(unnamedFields, "form fields need `name`; it becomes the field key").toEqual([]);
        });
    }
});
