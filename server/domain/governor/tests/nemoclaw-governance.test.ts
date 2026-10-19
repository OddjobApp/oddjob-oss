import { describe, it, expect } from "vitest";
import { governorService } from "../core/governor-service.js";
import { type GovernorPolicyRule } from "@shared/schema/governor.js";
import { ForbiddenError } from "@server/utils/errors.js";

describe("NemoClaw Governance Extensions", () => {
    describe("validateModel (Model Cap)", () => {
        it("should allow any model if no rule exists", () => {
            expect(() => governorService.validateModel("gpt-4", [])).not.toThrow();
        });

        it("should restrict models by whitelist", () => {
            const rules = [
                {
                    id: 1,
                    type: "model_cap",
                    isEnabled: true,
                    configuration: { allowedModels: ["gemini-2.0-flash", "claude-3-5-sonnet"] }
                }
            ] as GovernorPolicyRule[];

            expect(() => governorService.validateModel("gemini-2.0-flash", rules)).not.toThrow();
            expect(() => governorService.validateModel("gpt-4", rules)).toThrow(ForbiddenError);
        });

        it("should enforce local-only cap", () => {
            const rules = [
                {
                    id: 2,
                    type: "model_cap",
                    isEnabled: true,
                    configuration: { maxModelTier: "local" }
                }
            ] as GovernorPolicyRule[];

            expect(() => governorService.validateModel("llama3.1:latest", rules)).not.toThrow();
            expect(() => governorService.validateModel("local:deepseek", rules)).not.toThrow();
            expect(() => governorService.validateModel("gemini-2.0-flash", rules)).toThrow(ForbiddenError);
        });

        it("should enforce economy cap", () => {
            const rules = [
                {
                    id: 3,
                    type: "model_cap",
                    isEnabled: true,
                    configuration: { maxModelTier: "economy" }
                }
            ] as GovernorPolicyRule[];

            expect(() => governorService.validateModel("claude-3-5-haiku", rules)).not.toThrow();
            expect(() => governorService.validateModel("llama3.2", rules)).not.toThrow();
            expect(() => governorService.validateModel("gpt-4o", rules)).toThrow(ForbiddenError);
        });
    });

    describe("validateFilePath (File Path Restriction)", () => {
        it("should allow any path if no rules exist", () => {
            expect(() => governorService.validateFilePath("/etc/passwd", [])).not.toThrow();
        });

        it("should enforce blocked paths", () => {
            const rules = [
                {
                    id: 1,
                    type: "file_path_restriction",
                    isEnabled: true,
                    configuration: { blockedPaths: ["/etc/**", "c:/windows/**", "**/secret.txt"] }
                }
            ] as GovernorPolicyRule[];

            expect(() => governorService.validateFilePath("/etc/passwd", rules)).toThrow(ForbiddenError);
            expect(() => governorService.validateFilePath("c:/windows/system32/cmd.exe", rules)).toThrow(ForbiddenError);
            expect(() => governorService.validateFilePath("/data/public/info.txt", rules)).not.toThrow();
        });

        it("should enforce allowed paths whitelist", () => {
            const rules = [
                {
                    id: 2,
                    type: "file_path_restriction",
                    isEnabled: true,
                    configuration: { allowedPaths: ["/data/public/**", "**/workspace/*"] }
                }
            ] as GovernorPolicyRule[];

            expect(() => governorService.validateFilePath("/data/public/reports/december.pdf", rules)).not.toThrow();
            expect(() => governorService.validateFilePath("/etc/passwd", rules)).toThrow(ForbiddenError);
        });

        it("should prevent directory traversal bypass", () => {
            const rules = [
                {
                    id: 3,
                    type: "file_path_restriction",
                    isEnabled: true,
                    configuration: { allowedPaths: ["/data/public/**"] }
                }
            ] as GovernorPolicyRule[];

            // Trying to use relative paths to read outside public folder
            expect(() => governorService.validateFilePath("/data/public/../private/passwords.txt", rules)).toThrow(ForbiddenError);
        });
    });

    describe("validateNetworkDestination (Network Restriction)", () => {
        it("should allow any destination if no rules exist", () => {
            expect(() => governorService.validateNetworkDestination("https://google.com", [])).not.toThrow();
        });

        it("should block specified domains", () => {
            const rules = [
                {
                    id: 1,
                    type: "network_destination_restriction",
                    isEnabled: true,
                    configuration: { blockedDomains: ["facebook.com", "malicious.org"] }
                }
            ] as GovernorPolicyRule[];

            expect(() => governorService.validateNetworkDestination("https://facebook.com/login", rules)).toThrow(ForbiddenError);
            expect(() => governorService.validateNetworkDestination("https://sub.malicious.org/download", rules)).toThrow(ForbiddenError);
            expect(() => governorService.validateNetworkDestination("https://google.com", rules)).not.toThrow();
        });

        it("should restrict to whitelist domains", () => {
            const rules = [
                {
                    id: 2,
                    type: "network_destination_restriction",
                    isEnabled: true,
                    configuration: { allowedDomains: ["api.public.com", "google.com"] }
                }
            ] as GovernorPolicyRule[];

            expect(() => governorService.validateNetworkDestination("https://api.public.com/data", rules)).not.toThrow();
            expect(() => governorService.validateNetworkDestination("https://google.com/search", rules)).not.toThrow();
            expect(() => governorService.validateNetworkDestination("https://attacker.com", rules)).toThrow(ForbiddenError);
        });
    });
});
