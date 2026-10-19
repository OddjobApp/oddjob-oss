/**
 * Reflexion Self-Healing Engine (Noah Shinn Paradigm)
 *
 * Implements verbal critique, episodic reflection, and autonomous repair
 * when Playwright/CDP browser execution or target element resolution fails.
 */
import type { Page, Locator } from "playwright";
import { eq, and, desc } from "drizzle-orm";
import { createLogger } from "../../../utils/logger.js";
import type { TargetDescriptor } from "./skill-recorder.js";
import { db } from "../../../db/index.js";
import {
    computerUseReflexionBuffer,
    type ComputerUseReflexionBufferRow,
} from "@shared/schema";

const logger = createLogger("ReflexionEngine");

export type ReflexionLocatorStrategy =
    | "testId"
    | "role"
    | "label"
    | "placeholder"
    | "id"
    | "nameAttr"
    | "text"
    | "css"
    | "reflexion_fuzzy"
    | "reflexion_overlay_cleared";

export type ReflexionFailureCategory =
    | "locator_timeout"
    | "modal_blocked"
    | "element_detached"
    | "auth_gate"
    | "not_found"
    | "validation_error"
    | "unknown";

export interface ReflexionEntry {
    step: number;
    failedHypothesis: string;
    critique: string;
    correctiveAction: string;
    resolved: boolean;
    timestamp: string;
    failureCategory?: ReflexionFailureCategory;
    proposedRemediation?: Record<string, unknown>;
    domFailureSignature?: string;
}

export interface ReflexionEvaluationResult {
    resolved: boolean;
    entry: ReflexionEntry;
    healedTarget?: TargetDescriptor;
    locator?: Locator;
    via?: ReflexionLocatorStrategy;
}

export interface ReflexionRepairResult {
    action: "execute_remediation_prestep" | "update_target" | "retry" | "handoff_visual_loop";
    critique: string;
    category: ReflexionFailureCategory;
    remediation?: {
        kind: string;
        target?: Partial<TargetDescriptor>;
        selector?: string;
    };
    updatedTarget?: Partial<TargetDescriptor>;
}

export interface ReflexionOptions {
    organizationId?: number;
    skillId?: string;
    site?: string;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function computeDomFailureSignature(target: Partial<TargetDescriptor>): string {
    if (target.css) return target.css.slice(0, 200);
    if (target.id) return `#${target.id}`;
    if (target.testId) return `[data-testid="${target.testId}"]`;
    if (target.name) return `${target.tag || "element"}[name="${target.name}"]`;
    if (target.text) return `${target.tag || "element"}:has-text("${target.text.slice(0, 50)}")`;
    return `${target.tag || "unknown_target"}`;
}

/**
 * Common selectors for cookie consent banners, modal dialogs, and overlays
 * that often intercept user clicks or occlude target elements.
 */
const OVERLAY_SELECTORS = [
    '[role="dialog"]',
    'dialog[open]',
    '.modal.show',
    '.modal.is-active',
    'div[aria-modal="true"]',
    '#cookie-banner',
    '.cookie-banner',
    '.cookie-consent',
    '#onetrust-banner-sdk',
    '.onetrust-pc-dark-filter',
    '.consent-banner',
    '.cc-window',
];

/**
 * Common dismissal buttons inside banners and modal dialogs.
 */
const DISMISS_SELECTORS = [
    'button:has-text("Accept")',
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    'button:has-text("Got it")',
    'button:has-text("Dismiss")',
    'button:has-text("Close")',
    'button[aria-label="Close"]',
    'button[aria-label="close"]',
    '.modal-close',
    '#onetrust-accept-btn-handler',
    '#cookie-accept',
];

/**
 * Extracts observed element attributes to assist with target repair.
 */
export async function observeTargetAttributes(locator: Locator): Promise<Partial<TargetDescriptor>> {
    const attr = async (name: string) => (await locator.getAttribute(name).catch(() => null)) ?? undefined;
    return {
        testId: (await attr("data-testid")) ?? (await attr("data-test")) ?? (await attr("data-qa")),
        id: await attr("id"),
        nameAttr: await attr("name"),
        placeholder: await attr("placeholder"),
    };
}

/**
 * Records an episodic critique into the persistent computer_use_reflexion_buffer table.
 */
export async function recordReflexionBufferEntry(params: {
    organizationId: number;
    skillId?: string;
    stepIndex: number;
    site: string;
    failureCategory: ReflexionFailureCategory;
    domFailureSignature: string;
    verbalCritique: string;
    proposedRemediation?: Record<string, unknown>;
    trialCount?: number;
    succeededOnNextTrial?: boolean;
}): Promise<ComputerUseReflexionBufferRow | undefined> {
    try {
        if (!db) return undefined;
        const [inserted] = await db.insert(computerUseReflexionBuffer).values({
            organizationId: params.organizationId,
            skillId: params.skillId ? (params.skillId as any) : null,
            stepIndex: params.stepIndex,
            site: params.site || "unknown",
            failureCategory: params.failureCategory,
            domFailureSignature: params.domFailureSignature.slice(0, 255),
            verbalCritique: params.verbalCritique,
            proposedRemediation: params.proposedRemediation ?? {},
            trialCount: params.trialCount ?? 1,
            succeededOnNextTrial: params.succeededOnNextTrial ?? null,
        }).returning();
        return inserted;
    } catch (err: any) {
        logger.warn("Reflexion: Failed to persist episodic buffer entry", { error: err?.message });
        return undefined;
    }
}

/**
 * Retrieves past episodic critiques from the buffer to guide self-healing attempts.
 */
export async function getReflexionCritiques(params: {
    organizationId: number;
    skillId?: string;
    site?: string;
    domFailureSignature?: string;
    limit?: number;
}): Promise<ComputerUseReflexionBufferRow[]> {
    try {
        if (!db) return [];
        const conditions = [eq(computerUseReflexionBuffer.organizationId, params.organizationId)];
        if (params.skillId) {
            conditions.push(eq(computerUseReflexionBuffer.skillId, params.skillId as any));
        }
        if (params.site) {
            conditions.push(eq(computerUseReflexionBuffer.site, params.site));
        }
        if (params.domFailureSignature) {
            conditions.push(eq(computerUseReflexionBuffer.domFailureSignature, params.domFailureSignature));
        }
        return await db.select()
            .from(computerUseReflexionBuffer)
            .where(and(...conditions))
            .orderBy(desc(computerUseReflexionBuffer.createdAt))
            .limit(params.limit ?? 20);
    } catch (err: any) {
        logger.warn("Reflexion: Failed to query episodic buffer entries", { error: err?.message });
        return [];
    }
}

/**
 * Marks recent buffer entries as resolved once a retry or alternative candidate succeeds.
 */
export async function markReflexionResolved(params: {
    organizationId: number;
    skillId?: string;
    stepIndex?: number;
    domFailureSignature?: string;
}): Promise<void> {
    try {
        if (!db) return;
        const conditions = [eq(computerUseReflexionBuffer.organizationId, params.organizationId)];
        if (params.skillId) {
            conditions.push(eq(computerUseReflexionBuffer.skillId, params.skillId as any));
        }
        if (params.stepIndex !== undefined) {
            conditions.push(eq(computerUseReflexionBuffer.stepIndex, params.stepIndex));
        }
        if (params.domFailureSignature) {
            conditions.push(eq(computerUseReflexionBuffer.domFailureSignature, params.domFailureSignature));
        }
        await db.update(computerUseReflexionBuffer)
            .set({ succeededOnNextTrial: true, updatedAt: new Date() })
            .where(and(...conditions));
    } catch (err: any) {
        logger.warn("Reflexion: Failed to mark buffer entry resolved", { error: err?.message });
    }
}

/**
 * Evaluates DOM diagnostics, failure errors, and target descriptors to synthesize a verbal critique
 * and generate structured repair remediation. (Noah Shinn Evaluator module).
 */
export function synthesizeReflexionRepair(params: {
    stepIndex: number;
    target: Partial<TargetDescriptor>;
    error?: string;
    currentDomSnippet?: string;
    url?: string;
}): ReflexionRepairResult {
    const { stepIndex, target, error = "", currentDomSnippet = "", url = "" } = params;
    const combined = `${error} ${currentDomSnippet} ${url}`.toLowerCase();

    // 1. Overlay / Cookie Banner blocked
    if (/banner|dialog|modal|cookie|onetrust|consent|overlay/.test(combined)) {
        let dismissSelector = "#cookie-banner-accept, [aria-label='Close'], button:has-text('Accept'), button:has-text('Close')";
        if (/id=['"]cookie-accept['"]/i.test(currentDomSnippet) || /cookie-accept/i.test(currentDomSnippet)) {
            dismissSelector = "#cookie-accept";
        } else if (/onetrust-accept/i.test(currentDomSnippet)) {
            dismissSelector = "#onetrust-accept-btn-handler";
        } else if (/modal-close/i.test(currentDomSnippet)) {
            dismissSelector = ".modal-close";
        } else if (/id=['"]close['"]/i.test(currentDomSnippet)) {
            dismissSelector = "#close";
        }

        return {
            action: "execute_remediation_prestep",
            category: "modal_blocked",
            critique: `Target in step ${stepIndex} is occluded by a high z-index modal dialog or cookie consent banner. The page requires overlay clearance before interaction.`,
            remediation: {
                kind: "click",
                selector: dismissSelector,
                target: { tag: "button", css: dismissSelector },
            },
            updatedTarget: target,
        };
    }

    // 2. Auth / Login gate
    if (/login|signin|auth|session|forbidden|unauthorized/i.test(combined)) {
        return {
            action: "handoff_visual_loop",
            category: "auth_gate",
            critique: `Target step encountered an authentication gate, session expiry, or login wall at '${url || "target page"}'.`,
            updatedTarget: target,
        };
    }

    // 3. 404 / Route error
    if (/404|not-found|error/i.test(combined)) {
        return {
            action: "handoff_visual_loop",
            category: "not_found",
            critique: `Navigation or interaction led to an error or 404 not-found page state.`,
            updatedTarget: target,
        };
    }

    // 4. Locator timeout with potential attribute drift
    if (/timeout/i.test(combined) || error.includes("waiting for locator")) {
        const relaxedTarget = { ...target };
        if (target.text) relaxedTarget.name = target.text.trim();
        return {
            action: "update_target",
            category: "locator_timeout",
            critique: `Locator timed out waiting for element matching selector '${target.css || target.text || "target"}'. Applying relaxed role and semantic attribute matching.`,
            updatedTarget: relaxedTarget,
        };
    }

    return {
        action: "handoff_visual_loop",
        category: "unknown",
        critique: `Element resolution failed for step ${stepIndex} (<${target.tag || "element"}>). Visual verification required.`,
        updatedTarget: target,
    };
}

/**
 * Synthesizes a verbal critique comparing expected target state vs. current observed page state,
 * and actively attempts self-healing strategies:
 * 1. Historical Episodic Memory retrieval (learned dismissal/healing from buffer).
 * 2. Blocking Overlay / Modal / Cookie Banner detection and dismissal.
 * 3. Relaxed semantic & fuzzy text/label matching.
 * 4. Page drift / Authentication wall detection.
 */
export async function evaluateAndAttemptReflexion(
    page: Page,
    stepIndex: number,
    target: TargetDescriptor,
    retryCandidatesFn: (p: Page, t: TargetDescriptor) => Promise<{ locator: Locator; via: any } | undefined>,
    options?: ReflexionOptions,
): Promise<ReflexionEvaluationResult> {
    const targetDesc = target.text || target.name || target.placeholder || target.id || target.css;
    const failedHypothesis = `Hypothesis: Expected <${target.tag || "element"}> matching "${targetDesc}" to be present, unoccluded, and interactable in the viewport.`;
    const domSignature = computeDomFailureSignature(target);

    const now = new Date().toISOString();
    let site = options?.site || "";
    try {
        if (!site && page.url()) {
            site = new URL(page.url()).hostname;
        }
    } catch {
        site = site || "unknown";
    }

    // -------------------------------------------------------------------------
    // Strategy 0: Historical Episodic Memory Check
    // -------------------------------------------------------------------------
    if (options?.organizationId) {
        try {
            const pastCritiques = await getReflexionCritiques({
                organizationId: options.organizationId,
                skillId: options.skillId,
                site,
                domFailureSignature: domSignature,
                limit: 3,
            });
            for (const record of pastCritiques) {
                if (record.succeededOnNextTrial && record.proposedRemediation) {
                    const remediation = record.proposedRemediation as Record<string, unknown>;
                    if (remediation.selector && typeof remediation.selector === "string") {
                        const preDismiss = page.locator(remediation.selector).first();
                        if (await preDismiss.isVisible().catch(() => false)) {
                            logger.info("Reflexion: Applying historical episodic remediation", {
                                selector: remediation.selector,
                                stepIndex,
                            });
                            await preDismiss.click({ timeout: 2000 }).catch(() => undefined);
                            await page.waitForTimeout(400);
                            const recovered = await retryCandidatesFn(page, target);
                            if (recovered) {
                                return {
                                    resolved: true,
                                    locator: recovered.locator,
                                    via: "reflexion_overlay_cleared",
                                    entry: {
                                        step: stepIndex,
                                        failedHypothesis,
                                        critique: `Recovered via historical episodic remediation (${record.failureCategory}): Dismissed '${remediation.selector}'.`,
                                        correctiveAction: "Applied previously validated episodic remediation from reflexion buffer.",
                                        resolved: true,
                                        timestamp: now,
                                        failureCategory: record.failureCategory as ReflexionFailureCategory,
                                        domFailureSignature: domSignature,
                                        proposedRemediation: remediation,
                                    },
                                };
                            }
                        }
                    }
                }
            }
        } catch {
            // Buffer retrieval fallback; proceed to dynamic strategies
        }
    }

    // -------------------------------------------------------------------------
    // Strategy 1: Detect and Dismiss Blocking Dialogs / Overlays / Cookie Banners
    // -------------------------------------------------------------------------
    for (const overlaySel of OVERLAY_SELECTORS) {
        try {
            const overlay = page.locator(overlaySel).first();
            const isVisible = await overlay.isVisible().catch(() => false);
            if (isVisible) {
                logger.info("Reflexion: Detected active blocking overlay", { overlaySel, stepIndex });

                // Find a dismissal button inside or adjacent to the overlay
                for (const dismissSel of DISMISS_SELECTORS) {
                    const btn = overlay.locator(dismissSel).first();
                    const btnVisible = await btn.isVisible().catch(() => false);
                    if (btnVisible) {
                        logger.info("Reflexion: Clicking dismissal button on overlay", { dismissSel, stepIndex });
                        await btn.click({ timeout: 2000 }).catch(() => undefined);
                        await page.waitForTimeout(400);

                        // Retry original target candidates
                        const recovered = await retryCandidatesFn(page, target);
                        if (recovered) {
                            const entry: ReflexionEntry = {
                                step: stepIndex,
                                failedHypothesis,
                                critique: `Target was occluded by a blocking overlay (${overlaySel}). The overlay was dismissed via '${dismissSel}'.`,
                                correctiveAction: "Dismissed occluding dialog; target is now interactable.",
                                resolved: true,
                                timestamp: now,
                                failureCategory: "modal_blocked",
                                domFailureSignature: domSignature,
                                proposedRemediation: { action: "dismiss_modal", selector: dismissSel, overlay: overlaySel },
                            };

                            if (options?.organizationId) {
                                await recordReflexionBufferEntry({
                                    organizationId: options.organizationId,
                                    skillId: options.skillId,
                                    stepIndex,
                                    site,
                                    failureCategory: "modal_blocked",
                                    domFailureSignature: domSignature,
                                    verbalCritique: entry.critique,
                                    proposedRemediation: entry.proposedRemediation,
                                    succeededOnNextTrial: true,
                                });
                                await markReflexionResolved({
                                    organizationId: options.organizationId,
                                    skillId: options.skillId,
                                    stepIndex,
                                    domFailureSignature: domSignature,
                                });
                            }

                            return {
                                resolved: true,
                                locator: recovered.locator,
                                via: "reflexion_overlay_cleared",
                                entry,
                            };
                        }
                    }
                }
            }
        } catch {
            // Ignore overlay check errors and proceed to next strategy
        }
    }

    // -------------------------------------------------------------------------
    // Strategy 2: Relaxed Semantic / Fuzzy Text & Attribute Matching
    // -------------------------------------------------------------------------
    const textQuery = target.text || target.name;
    if (textQuery && textQuery.trim().length > 1) {
        try {
            const regex = new RegExp(escapeRegex(textQuery.trim()), "i");
            const roleLocator = target.role
                ? page.getByRole(target.role as any, { name: regex })
                : null;

            if (roleLocator && (await roleLocator.count().catch(() => 0)) === 1) {
                const observed = await observeTargetAttributes(roleLocator);
                const healedTarget: TargetDescriptor = {
                    ...target,
                    ...observed,
                    name: textQuery.trim(),
                };

                const entry: ReflexionEntry = {
                    step: stepIndex,
                    failedHypothesis,
                    critique: `Exact match for "${textQuery}" failed due to whitespace or casing drift. Located uniquely using case-insensitive role match.`,
                    correctiveAction: "Healed target descriptor with relaxed case-insensitive role binding.",
                    resolved: true,
                    timestamp: now,
                    failureCategory: "locator_timeout",
                    domFailureSignature: domSignature,
                    proposedRemediation: { action: "healed_target", target: healedTarget },
                };

                if (options?.organizationId) {
                    await recordReflexionBufferEntry({
                        organizationId: options.organizationId,
                        skillId: options.skillId,
                        stepIndex,
                        site,
                        failureCategory: "locator_timeout",
                        domFailureSignature: domSignature,
                        verbalCritique: entry.critique,
                        proposedRemediation: entry.proposedRemediation,
                        succeededOnNextTrial: true,
                    });
                    await markReflexionResolved({
                        organizationId: options.organizationId,
                        skillId: options.skillId,
                        stepIndex,
                        domFailureSignature: domSignature,
                    });
                }

                return {
                    resolved: true,
                    locator: roleLocator,
                    via: "reflexion_fuzzy",
                    healedTarget,
                    entry,
                };
            }

            const textLocator = page.locator(target.tag || "*").filter({ hasText: regex });
            if ((await textLocator.count().catch(() => 0)) === 1) {
                const observed = await observeTargetAttributes(textLocator);
                const healedTarget: TargetDescriptor = {
                    ...target,
                    ...observed,
                    text: textQuery.trim(),
                };

                const entry: ReflexionEntry = {
                    step: stepIndex,
                    failedHypothesis,
                    critique: `Exact match for "${textQuery}" failed. Located uniquely using relaxed case-insensitive text search.`,
                    correctiveAction: "Healed target descriptor using relaxed substring matching.",
                    resolved: true,
                    timestamp: now,
                    failureCategory: "locator_timeout",
                    domFailureSignature: domSignature,
                    proposedRemediation: { action: "healed_target", target: healedTarget },
                };

                if (options?.organizationId) {
                    await recordReflexionBufferEntry({
                        organizationId: options.organizationId,
                        skillId: options.skillId,
                        stepIndex,
                        site,
                        failureCategory: "locator_timeout",
                        domFailureSignature: domSignature,
                        verbalCritique: entry.critique,
                        proposedRemediation: entry.proposedRemediation,
                        succeededOnNextTrial: true,
                    });
                    await markReflexionResolved({
                        organizationId: options.organizationId,
                        skillId: options.skillId,
                        stepIndex,
                        domFailureSignature: domSignature,
                    });
                }

                return {
                    resolved: true,
                    locator: textLocator,
                    via: "reflexion_fuzzy",
                    healedTarget,
                    entry,
                };
            }
        } catch {
            // Continue if fuzzy matching errors out
        }
    }

    // -------------------------------------------------------------------------
    // Strategy 3: Unresolved Diagnostics (Auth wall, 404, or deep layout change)
    // -------------------------------------------------------------------------
    let url = "";
    try {
        url = page.url();
    } catch {
        url = "unknown";
    }

    let critique = `Target element <${target.tag || "element"}> "${targetDesc}" could not be resolved in the DOM.`;
    let correctiveAction = "Handoff to Gemini multimodal visual reasoning loop with current page snapshot.";
    let failureCategory: ReflexionFailureCategory = "locator_timeout";

    if (/login|signin|auth|session/i.test(url)) {
        critique = `Replay stopped at URL '${url}' which indicates an authentication gate or session expiry.`;
        correctiveAction = "Prompt human operator or invoke Human-In-The-Loop (HIL) credential verification.";
        failureCategory = "auth_gate";
    } else if (/404|not-found|error/i.test(url)) {
        critique = `Target page navigation resulted in an error or 404 state at URL '${url}'.`;
        correctiveAction = "Verify target URL parameters and destination route validity.";
        failureCategory = "not_found";
    }

    const entry: ReflexionEntry = {
        step: stepIndex,
        failedHypothesis,
        critique,
        correctiveAction,
        resolved: false,
        timestamp: now,
        failureCategory,
        domFailureSignature: domSignature,
    };

    if (options?.organizationId) {
        await recordReflexionBufferEntry({
            organizationId: options.organizationId,
            skillId: options.skillId,
            stepIndex,
            site,
            failureCategory,
            domFailureSignature: domSignature,
            verbalCritique: critique,
            proposedRemediation: { correctiveAction },
            succeededOnNextTrial: false,
        });
    }

    return {
        resolved: false,
        entry,
    };
}
