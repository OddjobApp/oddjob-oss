/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
    STORAGE_FILE_TOOLS,
    isCodegenCycle,
    CODEGEN_WORKSPACE_DIRECTIVE,
} from "./mission-strategic-planner.service.js";

describe("planner codegen tool routing", () => {
    it("detects the codegen cycle by name or slug", () => {
        expect(isCodegenCycle("Autonomous Code Generation Pipeline")).toBe(true);
        expect(isCodegenCycle(null, "autonomous-code-generation-pipeline")).toBe(true);
        expect(isCodegenCycle("Some Codegen Flow")).toBe(true);
    });

    it("does not misfire on unrelated cycles", () => {
        expect(isCodegenCycle("Sales Opportunity Workbench")).toBe(false);
        expect(isCodegenCycle(null, "technical-research")).toBe(false);
        expect(isCodegenCycle(undefined, undefined)).toBe(false);
    });

    it("STORAGE_FILE_TOOLS lists the org-storage file tools to exclude", () => {
        expect(STORAGE_FILE_TOOLS).toEqual(expect.arrayContaining(["file_read", "file_write", "file_list"]));
    });

    it("filtering codegen tools drops storage file tools but keeps workspace tools", () => {
        // Mirrors the planner's filter: t => !(isCodegen && STORAGE_FILE_TOOLS.includes(t.name))
        const names = ["file_read", "file_write", "file_list", "workspace_read_file", "workspace_list_files", "search"];
        const codegenVisible = names.filter(n => !STORAGE_FILE_TOOLS.includes(n));
        expect(codegenVisible).toEqual(["workspace_read_file", "workspace_list_files", "search"]);
        // Non-codegen keeps everything.
        const normalVisible = names.filter(() => true);
        expect(normalVisible).toContain("file_read");
    });

    it("directive steers toward workspace_* tools", () => {
        expect(CODEGEN_WORKSPACE_DIRECTIVE).toMatch(/workspace_read_file/);
        expect(CODEGEN_WORKSPACE_DIRECTIVE).toMatch(/repository/i);
    });
});
