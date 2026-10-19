import { describe, it, expect } from "vitest";
import { extractReferences } from "../reference-extractor.js";

describe("extractReferences", () => {
    describe("string plan parsing", () => {
        it("extracts file paths from markdown text", () => {
            const plan = `
## Implementation Plan

Modify \`server/routes/users.ts\` to add pagination.
Also update \`client/src/components/UserList.tsx\` and \`shared/schema/users.ts\`.
            `;

            const refs = extractReferences(plan);
            expect(refs.filePaths).toContain("server/routes/users.ts");
            expect(refs.filePaths).toContain("client/src/components/UserList.tsx");
            expect(refs.filePaths).toContain("shared/schema/users.ts");
        });

        it("extracts function declarations", () => {
            const plan = `
We need to modify function createUser and add export async function validateInput.
Also update function handleRequest.
            `;

            const refs = extractReferences(plan);
            expect(refs.functionNames).toContain("createUser");
            expect(refs.functionNames).toContain("validateInput");
            expect(refs.functionNames).toContain("handleRequest");
        });

        it("extracts const/arrow function patterns", () => {
            const plan = `
Update const processPayment = to handle new payment types.
Also fix export const formatCurrency = function.
            `;

            const refs = extractReferences(plan);
            expect(refs.functionNames).toContain("processPayment");
            expect(refs.functionNames).toContain("formatCurrency");
        });

        it("extracts class names", () => {
            const plan = `
Extend class UserService to implement caching.
Also create export class PaymentProcessor and abstract class BaseHandler.
            `;

            const refs = extractReferences(plan);
            expect(refs.classNames).toContain("UserService");
            expect(refs.classNames).toContain("PaymentProcessor");
            expect(refs.classNames).toContain("BaseHandler");
        });

        it("extracts interface and type names", () => {
            const plan = `
Define interface InsertUser and export type UserConfig.
Update export interface ValidationResult.
            `;

            const refs = extractReferences(plan);
            expect(refs.typeNames).toContain("InsertUser");
            expect(refs.typeNames).toContain("UserConfig");
            expect(refs.typeNames).toContain("ValidationResult");
        });

        it("extracts scoped module names", () => {
            const plan = `
Import types from @shared/schema and use @oddjob/shared-utils for formatting.
            `;

            const refs = extractReferences(plan);
            expect(refs.moduleNames).toContain("@shared/schema");
            expect(refs.moduleNames).toContain("@oddjob/shared-utils");
        });

        it("extracts import-from module paths", () => {
            const plan = `
import { createUser } from "./services/user.js"
import type { Config } from "@server/config.js"
            `;

            const refs = extractReferences(plan);
            expect(refs.moduleNames).toContain("./services/user.js");
            expect(refs.moduleNames).toContain("@server/config.js");
        });

        it("deduplicates results", () => {
            const plan = `
Modify server/routes/users.ts and then later update server/routes/users.ts again.
Call function createUser and also function createUser in a different context.
            `;

            const refs = extractReferences(plan);
            const fileCount = refs.filePaths.filter((f) => f === "server/routes/users.ts").length;
            const funcCount = refs.functionNames.filter((f) => f === "createUser").length;
            expect(fileCount).toBe(1);
            expect(funcCount).toBe(1);
        });

        it("does not classify types as functions when using const pattern", () => {
            const plan = `
export type UserConfig = ...
export const processData = () => {}
            `;

            const refs = extractReferences(plan);
            expect(refs.typeNames).toContain("UserConfig");
            expect(refs.functionNames).not.toContain("UserConfig");
            expect(refs.functionNames).toContain("processData");
        });

        it("extracts method references from obj.method() patterns", () => {
            const plan = `
Call userService.create() to persist the record.
Then call validator.check() and formatter.apply() on the result.
            `;

            const refs = extractReferences(plan);
            expect(refs.functionNames).toContain("create");
            expect(refs.functionNames).toContain("check");
            expect(refs.functionNames).toContain("apply");
        });

        it("extracts PascalCase identifiers with Service/Controller suffix as classNames", () => {
            const plan = `
The AuthService handles login and UserController manages routes.
Also inject the PaymentHandler into the pipeline.
            `;

            const refs = extractReferences(plan);
            expect(refs.classNames).toContain("AuthService");
            expect(refs.classNames).toContain("UserController");
            expect(refs.classNames).toContain("PaymentHandler");
        });

        it("extracts PascalCase identifiers with Props/Config suffix as typeNames", () => {
            const plan = `
Define ButtonProps for the component and AppConfig for settings.
Also export UserOptions and QueryResult types.
            `;

            const refs = extractReferences(plan);
            expect(refs.typeNames).toContain("ButtonProps");
            expect(refs.typeNames).toContain("AppConfig");
            expect(refs.typeNames).toContain("UserOptions");
            expect(refs.typeNames).toContain("QueryResult");
        });

        it("filters noise from method references (console.log, Object.keys)", () => {
            const plan = `
Use console.log() for debugging.
Call Object.keys() and Array.from() to transform data.
Then call userService.save() to persist.
            `;

            const refs = extractReferences(plan);
            expect(refs.functionNames).not.toContain("log");
            expect(refs.functionNames).not.toContain("keys");
            expect(refs.functionNames).not.toContain("from");
            expect(refs.functionNames).toContain("save");
        });
    });

    describe("structured plan parsing", () => {
        it("extracts from file_targets array", () => {
            const plan = {
                file_targets: ["server/routes/users.ts", "client/src/App.tsx"],
                tasks: [],
                acceptance_criteria: [],
            };

            const refs = extractReferences(plan);
            expect(refs.filePaths).toContain("server/routes/users.ts");
            expect(refs.filePaths).toContain("client/src/App.tsx");
        });

        it("extracts references from tasks strings", () => {
            const plan = {
                tasks: [
                    "Modify function createUser in server/routes/users.ts",
                    "Add interface NewUserInput type",
                ],
                file_targets: [],
                acceptance_criteria: [],
            };

            const refs = extractReferences(plan);
            expect(refs.filePaths).toContain("server/routes/users.ts");
            expect(refs.functionNames).toContain("createUser");
            expect(refs.typeNames).toContain("NewUserInput");
        });

        it("extracts from acceptance_criteria", () => {
            const plan = {
                tasks: [],
                file_targets: [],
                acceptance_criteria: [
                    "class UserService must implement caching",
                    "export type CacheConfig must be defined",
                ],
            };

            const refs = extractReferences(plan);
            expect(refs.classNames).toContain("UserService");
            expect(refs.typeNames).toContain("CacheConfig");
        });

        it("extracts from task objects with description/title fields", () => {
            const plan = {
                tasks: [
                    { title: "Update UserService", description: "Modify class UserService in server/services/user.ts" },
                ],
                file_targets: [],
                acceptance_criteria: [],
            };

            const refs = extractReferences(plan);
            expect(refs.classNames).toContain("UserService");
            expect(refs.filePaths).toContain("server/services/user.ts");
        });

        it("extracts from other top-level string fields", () => {
            const plan = {
                tasks: [],
                file_targets: [],
                acceptance_criteria: [],
                description: "Implement function fetchData in server/api/data.ts",
            };

            const refs = extractReferences(plan);
            expect(refs.functionNames).toContain("fetchData");
            expect(refs.filePaths).toContain("server/api/data.ts");
        });

        it("merges file_targets with parsed file paths", () => {
            const plan = {
                file_targets: ["server/routes/users.ts"],
                tasks: ["Also update server/routes/auth.ts"],
                acceptance_criteria: [],
            };

            const refs = extractReferences(plan);
            expect(refs.filePaths).toContain("server/routes/users.ts");
            expect(refs.filePaths).toContain("server/routes/auth.ts");
        });
    });

    describe("empty/null plans", () => {
        it("returns empty references for null", () => {
            const refs = extractReferences(null as any);
            expect(refs.filePaths).toEqual([]);
            expect(refs.functionNames).toEqual([]);
            expect(refs.classNames).toEqual([]);
            expect(refs.moduleNames).toEqual([]);
            expect(refs.typeNames).toEqual([]);
        });

        it("returns empty references for undefined", () => {
            const refs = extractReferences(undefined as any);
            expect(refs.filePaths).toEqual([]);
            expect(refs.functionNames).toEqual([]);
            expect(refs.classNames).toEqual([]);
            expect(refs.moduleNames).toEqual([]);
            expect(refs.typeNames).toEqual([]);
        });

        it("returns empty references for empty string", () => {
            const refs = extractReferences("");
            expect(refs.filePaths).toEqual([]);
            expect(refs.functionNames).toEqual([]);
            expect(refs.classNames).toEqual([]);
            expect(refs.moduleNames).toEqual([]);
            expect(refs.typeNames).toEqual([]);
        });

        it("returns empty references for empty object", () => {
            const refs = extractReferences({});
            expect(refs.filePaths).toEqual([]);
            expect(refs.functionNames).toEqual([]);
            expect(refs.classNames).toEqual([]);
            expect(refs.moduleNames).toEqual([]);
            expect(refs.typeNames).toEqual([]);
        });
    });
});
