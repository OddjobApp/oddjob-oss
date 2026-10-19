/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import {
    evaluateAndAttemptReflexion,
    observeTargetAttributes,
    computeDomFailureSignature,
    synthesizeReflexionRepair,
    recordReflexionBufferEntry,
    getReflexionCritiques,
    markReflexionResolved,
} from "./reflexion.js";
import type { TargetDescriptor } from "./skill-recorder.js";
import type { Page, Locator } from "playwright";

describe("Reflexion Engine", () => {
    describe("computeDomFailureSignature", () => {
        it("extracts CSS when present", () => {
            const sig = computeDomFailureSignature({ tag: "button", css: "#checkout-btn.primary" });
            expect(sig).toBe("#checkout-btn.primary");
        });

        it("extracts ID or testId when css is absent", () => {
            expect(computeDomFailureSignature({ tag: "button", id: "save-btn" })).toBe("#save-btn");
            expect(computeDomFailureSignature({ tag: "button", testId: "submit-form" })).toBe('[data-testid="submit-form"]');
        });

        it("extracts name or text as fallback", () => {
            expect(computeDomFailureSignature({ tag: "input", name: "email" })).toBe('input[name="email"]');
            expect(computeDomFailureSignature({ tag: "button", text: "Submit Order" })).toBe('button:has-text("Submit Order")');
        });
    });

    describe("synthesizeReflexionRepair", () => {
        it("detects cookie overlay and recommends prestep dismissal", () => {
            const result = synthesizeReflexionRepair({
                stepIndex: 2,
                target: { tag: "button", css: ".submit-order" },
                error: "Timeout 10000ms waiting for locator('.submit-order')",
                currentDomSnippet: "<div class='banner-overlay'><button id='cookie-accept'>Accept</button></div>",
            });

            expect(result.action).toBe("execute_remediation_prestep");
            expect(result.category).toBe("modal_blocked");
            expect(result.critique).toContain("modal dialog or cookie consent banner");
            expect(result.remediation?.selector).toBe("#cookie-accept");
        });

        it("detects authentication wall", () => {
            const result = synthesizeReflexionRepair({
                stepIndex: 1,
                target: { tag: "a", css: ".profile-link" },
                url: "https://example.com/login?redirect=%2Fprofile",
            });

            expect(result.action).toBe("handoff_visual_loop");
            expect(result.category).toBe("auth_gate");
            expect(result.critique).toContain("authentication gate");
        });

        it("detects 404 not-found", () => {
            const result = synthesizeReflexionRepair({
                stepIndex: 0,
                target: { tag: "h1", css: ".title" },
                error: "Page returned 404 Not Found",
            });

            expect(result.action).toBe("handoff_visual_loop");
            expect(result.category).toBe("not_found");
        });

        it("relaxes locator when timeout occurs", () => {
            const result = synthesizeReflexionRepair({
                stepIndex: 4,
                target: { tag: "button", text: "Save Changes", css: "#btn-save" },
                error: "waiting for locator('#btn-save') failed",
            });

            expect(result.action).toBe("update_target");
            expect(result.category).toBe("locator_timeout");
            expect(result.updatedTarget?.name).toBe("Save Changes");
        });
    });

    describe("observeTargetAttributes", () => {
        it("reads testId, id, nameAttr, and placeholder from locator", async () => {
            const mockLocator = {
                getAttribute: vi.fn().mockImplementation(async (attr: string) => {
                    switch (attr) {
                        case "data-testid": return "login-btn";
                        case "id": return "auth-submit";
                        case "name": return "submitBtn";
                        case "placeholder": return undefined;
                        default: return null;
                    }
                }),
            } as unknown as Locator;

            const observed = await observeTargetAttributes(mockLocator);
            expect(observed.testId).toBe("login-btn");
            expect(observed.id).toBe("auth-submit");
            expect(observed.nameAttr).toBe("submitBtn");
            expect(observed.placeholder).toBeUndefined();
        });
    });

    describe("evaluateAndAttemptReflexion", () => {
        it("identifies authentication wall when page URL contains login", async () => {
            const mockPage = {
                url: () => "https://app.oddjob.ai/login?redirect=%2Fdashboard",
                locator: vi.fn().mockReturnValue({
                    first: () => ({
                        isVisible: vi.fn().mockResolvedValue(false),
                    }),
                }),
                getByRole: vi.fn().mockReturnValue({
                    count: vi.fn().mockResolvedValue(0),
                }),
            } as unknown as Page;

            const target: TargetDescriptor = { tag: "button", text: "Submit Order", css: "#submit-btn" };
            const retryFn = vi.fn().mockResolvedValue(undefined);

            const result = await evaluateAndAttemptReflexion(mockPage, 2, target, retryFn);

            expect(result.resolved).toBe(false);
            expect(result.entry.step).toBe(2);
            expect(result.entry.failedHypothesis).toContain("Submit Order");
            expect(result.entry.critique).toContain("authentication gate");
            expect(result.entry.correctiveAction).toContain("Human-In-The-Loop");
            expect(result.entry.failureCategory).toBe("auth_gate");
        });

        it("identifies 404/not-found errors", async () => {
            const mockPage = {
                url: () => "https://app.oddjob.ai/404-not-found",
                locator: vi.fn().mockReturnValue({
                    first: () => ({
                        isVisible: vi.fn().mockResolvedValue(false),
                    }),
                }),
                getByRole: vi.fn().mockReturnValue({
                    count: vi.fn().mockResolvedValue(0),
                }),
            } as unknown as Page;

            const target: TargetDescriptor = { tag: "button", text: "Download Report", css: ".report-dl" };
            const retryFn = vi.fn().mockResolvedValue(undefined);

            const result = await evaluateAndAttemptReflexion(mockPage, 1, target, retryFn);

            expect(result.resolved).toBe(false);
            expect(result.entry.critique).toContain("404");
            expect(result.entry.correctiveAction).toContain("Verify target URL");
            expect(result.entry.failureCategory).toBe("not_found");
        });

        it("detects and dismisses blocking cookie dialogs / overlays", async () => {
            const dismissClick = vi.fn().mockResolvedValue(undefined);
            const overlayLocator = {
                isVisible: vi.fn().mockResolvedValue(true),
                locator: vi.fn().mockImplementation((sel: string) => ({
                    first: () => ({
                        isVisible: vi.fn().mockResolvedValue(sel.includes("Accept")),
                        click: dismissClick,
                    }),
                })),
            };

            const mockPage = {
                url: () => "https://app.oddjob.ai/dashboard",
                locator: vi.fn().mockImplementation((sel: string) => ({
                    first: () => {
                        if (sel.includes("dialog")) return overlayLocator;
                        return { isVisible: vi.fn().mockResolvedValue(false) };
                    },
                })),
                getByRole: vi.fn().mockReturnValue({
                    count: vi.fn().mockResolvedValue(0),
                }),
                waitForTimeout: vi.fn().mockResolvedValue(undefined),
            } as unknown as Page;

            const target: TargetDescriptor = { tag: "button", text: "Proceed", css: ".proceed-btn" };
            const recoveredLocator = { id: "recovered" } as unknown as Locator;
            const retryFn = vi.fn().mockResolvedValue({ locator: recoveredLocator, via: "role" });

            const result = await evaluateAndAttemptReflexion(mockPage, 0, target, retryFn);

            expect(dismissClick).toHaveBeenCalled();
            expect(result.resolved).toBe(true);
            expect(result.via).toBe("reflexion_overlay_cleared");
            expect(result.entry.critique).toContain("Target was occluded by a blocking overlay");
            expect(result.entry.failureCategory).toBe("modal_blocked");
            expect(result.locator).toBe(recoveredLocator);
        });

        it("heals target when text has casing or whitespace drift via relaxed matching", async () => {
            const mockRoleLocator = {
                count: vi.fn().mockResolvedValue(1),
                getAttribute: vi.fn().mockImplementation(async (attr: string) => {
                    if (attr === "id") return "search-btn-v2";
                    return null;
                }),
            };

            const mockPage = {
                url: () => "https://app.oddjob.ai/search",
                locator: vi.fn().mockReturnValue({
                    first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
                }),
                getByRole: vi.fn().mockReturnValue(mockRoleLocator),
            } as unknown as Page;

            const target: TargetDescriptor = {
                tag: "button",
                role: "button",
                name: "search documents",
                css: "button.search",
            };
            const retryFn = vi.fn().mockResolvedValue(undefined);

            const result = await evaluateAndAttemptReflexion(mockPage, 3, target, retryFn);

            expect(result.resolved).toBe(true);
            expect(result.via).toBe("reflexion_fuzzy");
            expect(result.entry.critique).toContain("whitespace or casing drift");
            expect(result.entry.failureCategory).toBe("locator_timeout");
            expect(result.healedTarget?.id).toBe("search-btn-v2");
            expect(result.healedTarget?.name).toBe("search documents");
        });
    });

    describe("buffer operations", () => {
        it("handles recording and query gracefully even if db encounters no-op/mock state", async () => {
            const entry = await recordReflexionBufferEntry({
                organizationId: 999999,
                stepIndex: 0,
                site: "test.local",
                failureCategory: "modal_blocked",
                domFailureSignature: "#btn",
                verbalCritique: "Blocked by dialog",
            });
            // Should either return inserted row or undefined without throwing uncaught errors
            expect(entry === undefined || typeof entry.id === "number").toBe(true);

            const list = await getReflexionCritiques({
                organizationId: 999999,
                site: "test.local",
            });
            expect(Array.isArray(list)).toBe(true);

            await expect(markReflexionResolved({
                organizationId: 999999,
                stepIndex: 0,
            })).resolves.not.toThrow();
        });
    });
});
