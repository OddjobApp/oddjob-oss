import { createHash, randomUUID } from "node:crypto";
import {
    evaluateAutonomyPolicy,
    type AutonomyRiskFlag,
} from "@shared/governance/autonomy-policy.js";
import { BadRequestError } from "../../../utils/errors.js";
import {
    trycuaService,
    type TrycuaAction,
    type TrycuaActionInput,
    type TrycuaAccessibilityNode,
    type TrycuaAccessibilitySnapshot,
} from "./trycua-service.js";
import { resolveOrgGeminiKey } from "@domain/ai/core/org-gemini-key.js";

type GuidedDecision = "execute" | "needs_review" | "blocked" | "observe_only";
type SurfaceType = "browser" | "terminal" | "desktop" | "application" | "unknown";
type UiRegionKind = "viewport" | "toolbar" | "content" | "text_input" | "button" | "danger_zone" | "unknown";

type TrycuaRiskFlag = AutonomyRiskFlag;

interface UiRegion {
    id: string;
    kind: UiRegionKind;
    label?: string;
    bounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    confidence: number;
    evidence: string[];
}

interface AppIdentity {
    name: string;
    category: SurfaceType;
    confidence: number;
    evidence: string[];
}

interface ScreenshotSummary {
    mediaType: string;
    bytesApprox: number;
    fingerprint: string;
    dataUrl?: string;
}

export interface TrycuaUiUnderstanding {
    source: "screenshot_metadata" | "session_metadata" | "accessibility_tree" | "hybrid";
    surfaceType: SurfaceType;
    activeApp: AppIdentity;
    visibleText: string[];
    controls: UiRegion[];
    textInputs: UiRegion[];
    clickableRegions: UiRegion[];
    warnings: string[];
    confidence: number;
}

export interface TrycuaObservation {
    id: string;
    sessionId: string;
    organizationId: number;
    userId: string;
    provider: string;
    os: string;
    status: string;
    observedAt: string;
    screenshot: ScreenshotSummary;
    accessibility: TrycuaAccessibilitySnapshot;
    ui: TrycuaUiUnderstanding;
    riskFlags: TrycuaRiskFlag[];
    limitations: string[];
    diff?: ScreenshotDiff;
}

export interface GuidedActionTarget {
    x?: number;
    y?: number;
    label?: string;
    role?: string;
}

export interface GuidedActionScroll {
    x?: number;
    y?: number;
    clicks?: number;
}

export interface GuidedActionDrag {
    startX?: number;
    startY?: number;
    endX?: number;
    endY?: number;
    durationMs?: number;
}

export interface TrycuaGuidedActionInput {
    sessionId: string;
    organizationId: number;
    userId: string;
    goal?: string;
    instruction?: string;
    action?: TrycuaAction;
    text?: string;
    target?: GuidedActionTarget;
    key?: string;
    hotkey?: string[];
    scroll?: GuidedActionScroll;
    drag?: GuidedActionDrag;
    clipboardText?: string;
    waitMs?: number;
    allowSensitive?: boolean;
    execute?: boolean;
    includeVerificationObservation?: boolean;
}

export interface TrycuaProposedAction {
    action: TrycuaAction;
    params: Record<string, unknown>;
    redacted: boolean;
}

export interface TrycuaTargetGrounding {
    resolved: boolean;
    method: "explicit_coordinates" | "accessibility_tree" | "vision" | "heuristic" | "none";
    query?: string;
    target?: GuidedActionTarget & { x: number; y: number };
    matchedRegion?: UiRegion;
    confidence: number;
    rationale: string;
}

export interface TrycuaGuidedActionPlan {
    id: string;
    sessionId: string;
    goal?: string;
    instruction?: string;
    decision: GuidedDecision;
    confidence: number;
    rationale: string;
    proposedAction?: TrycuaProposedAction;
    grounding?: TrycuaTargetGrounding;
    riskFlags: TrycuaRiskFlag[];
    requiredReview: string[];
    suggestedFollowUps: string[];
    observationId: string;
    createdAt: string;
}

export interface TrycuaGuidedActionResult {
    observation: TrycuaObservation;
    plan: TrycuaGuidedActionPlan;
    result?: Record<string, unknown>;
    verification?: TrycuaObservation;
}

interface InternalPlan {
    plan: TrycuaGuidedActionPlan;
    action?: TrycuaActionInput;
}

export interface ScreenshotDiff {
    changed: boolean;
    summary: string;
    changedRegions: string[];
    beforeFingerprint: string;
    afterFingerprint: string;
}

/**
 * The organization's own Gemini key — the platform key only outside production.
 * This used to prefer the platform key over the org's and read a second,
 * unencrypted `google_ai` credential; both are gone under strict BYOK.
 */
export async function resolveGeminiApiKey(organizationId: number): Promise<string | null> {
    return resolveOrgGeminiKey(organizationId);
}

function screenshotFingerprint(dataUrl: string): string {
    return createHash("sha256").update(dataUrl.slice(0, 4096)).digest("hex").slice(0, 16);
}

const SAFE_KEY_ALIASES: Record<string, string> = {
    enter: "Enter",
    return: "Enter",
    tab: "Tab",
    escape: "Escape",
    esc: "Escape",
    backspace: "Backspace",
    delete: "Delete",
    space: "Space",
};

export class TrycuaComputerIntelligenceService {
    async observeSession(input: {
        sessionId: string;
        organizationId: number;
        userId: string;
        includeScreenshot?: boolean;
        previousScreenshot?: string;
    }): Promise<TrycuaObservation> {
        const session = await trycuaService.getSession(input.sessionId, input.organizationId);
        const screenshot = await trycuaService.getScreenshot(input.sessionId, input.organizationId, input.userId);

        const [visionUi, diff, accessibility] = await Promise.all([
            this.analyzeScreenshotWithVision(screenshot, session.os, input.organizationId),
            input.previousScreenshot
                ? this.computeVisualDiff(input.previousScreenshot, screenshot, input.organizationId)
                : Promise.resolve(null),
            trycuaService.getAccessibilityTree(input.sessionId, input.organizationId, input.userId)
                .catch((error: any): TrycuaAccessibilitySnapshot => ({
                    available: false,
                    source: "unavailable",
                    capturedAt: new Date().toISOString(),
                    nodes: [],
                    error: error?.message ?? "Accessibility tree capture failed",
                })),
        ]);

        const baseUi = this.understandUi({
            provider: session.provider,
            os: session.os,
            sandboxName: session.sandboxName,
            providerSessionId: session.providerSessionId,
            metadata: session.metadata,
            screenshot,
        });

        const accessibilityUi = accessibilityToUiUnderstanding(accessibility, session.provider);
        const ui = mergeUiUnderstanding(baseUi, accessibilityUi, visionUi);

        const limitations: string[] = [];
        if (!accessibility.available) {
            limitations.push(accessibility.error
                ? `Accessibility tree unavailable: ${accessibility.error}`
                : "Accessibility tree unavailable from current provider.");
        }
        if (!visionUi) {
            limitations.push("Vision analysis unavailable. Check the Gemini API key (GEMINI_API_KEY or GOOGLE_API_KEY) and provider availability; do not infer targets from screenshot metadata.");
        }

        return {
            id: `obs_${randomUUID()}`,
            sessionId: session.id,
            organizationId: session.organizationId,
            userId: input.userId,
            provider: session.provider,
            os: session.os,
            status: session.status,
            observedAt: new Date().toISOString(),
            screenshot: summarizeScreenshot(screenshot, input.includeScreenshot ?? true),
            accessibility,
            ui,
            riskFlags: ui.warnings.map((warning) => ({
                code: "observation_limitation",
                level: "low" as const,
                message: warning,
                requiresReview: false,
                domains: ["computer_use" as const],
            })),
            limitations,
            diff: diff ?? undefined,
        };
    }

    async compareScreenshots(
        before: string,
        after: string,
        organizationId: number,
    ): Promise<ScreenshotDiff> {
        return this.computeVisualDiff(before, after, organizationId);
    }

    private async analyzeScreenshotWithVision(
        screenshot: string,
        os: string,
        organizationId: number,
    ): Promise<TrycuaUiUnderstanding | null> {
        if (isLikelyBlankMockScreenshot(screenshot)) return null;
        const apiKey = await resolveGeminiApiKey(organizationId);
        if (!apiKey) return null;

        try {
            const prompt = `You are analyzing a screenshot of a ${os} desktop environment for a computer-use agent.
Return ONLY valid JSON with this exact structure (no markdown):
{
  "surfaceType": "browser|terminal|desktop|application|unknown",
  "activeApp": { "name": "string", "category": "browser|terminal|desktop|application|unknown", "confidence": 0.0-1.0 },
  "visibleText": ["string"],
  "clickableRegions": [{ "id": "string", "kind": "button|link|menu|input|other", "label": "string", "x": number, "y": number, "width": number, "height": number, "confidence": 0.0-1.0 }],
  "textInputs": [{ "id": "string", "label": "string", "x": number, "y": number, "width": number, "height": number, "placeholder": "string" }],
  "warnings": ["string"]
}
Focus on: visible text, interactive elements, buttons, input fields, menus, and the active application.`;

            const [header, data] = screenshot.split(",");
            const mimeType = header.replace("data:", "").replace(";base64", "") || "image/png";

            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
                    signal: AbortSignal.timeout(30_000),
                    body: JSON.stringify({
                        contents: [{ parts: [{ inlineData: { mimeType, data } }, { text: prompt }] }],
                        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 2048 },
                    }),
                }
            );

            if (!res.ok) return null;
            const json = await res.json() as any;
            const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!raw) return null;

            const parsed = JSON.parse(raw);
            const clickableRegions = (parsed.clickableRegions ?? []).map((r: any) => ({
                id: r.id ?? randomUUID(),
                kind: r.kind ?? "button",
                label: r.label,
                bounds: r.x !== undefined ? { x: r.x, y: r.y, width: r.width, height: r.height } : undefined,
                confidence: r.confidence ?? 0.7,
                evidence: ["Gemini Vision"],
            }));
            const textInputs = (parsed.textInputs ?? []).map((i: any) => ({
                id: i.id ?? randomUUID(),
                kind: "text_input" as const,
                label: i.label,
                bounds: i.x !== undefined ? { x: i.x, y: i.y, width: i.width, height: i.height } : undefined,
                confidence: 0.8,
                evidence: ["Gemini Vision"],
            }));

            return {
                source: "screenshot_metadata" as const,
                surfaceType: parsed.surfaceType ?? "unknown",
                activeApp: {
                    name: parsed.activeApp?.name ?? "Unknown",
                    category: parsed.activeApp?.category ?? "unknown",
                    confidence: parsed.activeApp?.confidence ?? 0.5,
                    evidence: ["Gemini Vision analysis"],
                },
                visibleText: Array.isArray(parsed.visibleText) ? parsed.visibleText : [],
                clickableRegions,
                textInputs,
                controls: [...clickableRegions, ...textInputs],
                warnings: parsed.warnings ?? [],
                confidence: parsed.activeApp?.confidence ?? 0.8,
            };
        } catch {
            return null;
        }
    }

    private async computeVisualDiff(
        before: string,
        after: string,
        organizationId: number,
    ): Promise<ScreenshotDiff> {
        const beforeFp = screenshotFingerprint(before);
        const afterFp = screenshotFingerprint(after);
        const unchanged = beforeFp === afterFp;

        if (unchanged) {
            return { changed: false, summary: "Screen unchanged.", changedRegions: [], beforeFingerprint: beforeFp, afterFingerprint: afterFp };
        }

        const apiKey = await resolveGeminiApiKey(organizationId);
        let summary = "Screen changed (visual diff analysis unavailable without Gemini API key).";
        const changedRegions: string[] = [];

        if (apiKey && !isLikelyBlankMockScreenshot(before) && !isLikelyBlankMockScreenshot(after)) {
            try {
                const prompt = `I have two screenshots of a ${organizationId > 0 ? "desktop" : "screen"} taken before and after a computer action. Describe ONLY what changed between them in 1-2 sentences. Focus on: what appeared, disappeared, moved, or was modified.`;
                const [hB, dB] = before.split(",");
                const [hA, dA] = after.split(",");
                const res = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
                    signal: AbortSignal.timeout(30_000),
                        body: JSON.stringify({
                            contents: [{
                                parts: [
                                    { inlineData: { mimeType: hB.replace("data:", "").replace(";base64", "") || "image/png", data: dB } },
                                    { inlineData: { mimeType: hA.replace("data:", "").replace(";base64", "") || "image/png", data: dA } },
                                    { text: prompt },
                                ]
                            }],
                        }),
                    }
                );
                if (res.ok) {
                    const json = await res.json() as any;
                    summary = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? summary;
                }
            } catch { /* use default summary */ }
        }

        return { changed: true, summary, changedRegions, beforeFingerprint: beforeFp, afterFingerprint: afterFp };
    }

    async planNextAction(input: TrycuaGuidedActionInput): Promise<TrycuaGuidedActionResult> {
        const observation = await this.observeSession({
            sessionId: input.sessionId,
            organizationId: input.organizationId,
            userId: input.userId,
            includeScreenshot: true,
        });

        const { plan } = this.buildPlan(input, observation);
        return { observation, plan };
    }

    async executeGuidedAction(input: TrycuaGuidedActionInput): Promise<TrycuaGuidedActionResult> {
        const observation = await this.observeSession({
            sessionId: input.sessionId,
            organizationId: input.organizationId,
            userId: input.userId,
            includeScreenshot: true,
        });
        const { plan, action } = this.buildPlan(input, observation);

        if (input.execute === false || plan.decision !== "execute" || !action) {
            return { observation, plan };
        }

        const result = await trycuaService.executeAction(
            input.sessionId,
            input.organizationId,
            input.userId,
            action,
        );

        const verification = input.includeVerificationObservation === false
            ? undefined
            : await this.observeSession({
                sessionId: input.sessionId,
                organizationId: input.organizationId,
                userId: input.userId,
                includeScreenshot: true,
                previousScreenshot: observation.screenshot.dataUrl,
            });

        return { observation, plan, result, verification };
    }

    private buildPlan(input: TrycuaGuidedActionInput, observation: TrycuaObservation): InternalPlan {
        const requestedTargetLabel = input.target?.label ?? inferTargetLabelFromInstruction(input);
        const grounding = resolveGroundedTarget(input, observation, requestedTargetLabel);
        const groundedInput: TrycuaGuidedActionInput = grounding.target
            ? { ...input, target: { ...input.target, ...grounding.target } }
            : (requestedTargetLabel && !input.target ? { ...input, target: { label: requestedTargetLabel } } : input);
        const policy = evaluateAutonomyPolicy({
            domain: "computer_use",
            goal: groundedInput.goal,
            instruction: groundedInput.instruction,
            text: groundedInput.text,
            action: groundedInput.action,
            targetLabel: requestedTargetLabel,
            allowSensitive: groundedInput.allowSensitive ?? false,
            metadata: { clipboardText: groundedInput.clipboardText },
        });
        const riskFlags = policy.flags;
        const requiredReview = [...policy.requiredReview];
        const action = this.inferAction(groundedInput);
        let decision: GuidedDecision = "execute";
        let confidence = action ? 0.74 : 0.28;
        let rationale = action
            ? "The request maps to a supported low-level computer action with explicit enough inputs."
            : "The request does not include enough grounded information to choose a computer action.";

        if (action && grounding.resolved && grounding.method !== "explicit_coordinates") {
            confidence = Math.max(confidence, Math.min(0.95, grounding.confidence));
            rationale = `${rationale} Target grounded by ${grounding.method.replace("_", " ")}: ${grounding.rationale}`;
        }

        if (!hasInstruction(groundedInput)) {
            decision = "observe_only";
            confidence = 0.9;
            rationale = "No goal or instruction was supplied, so the safest useful step is observation only.";
        } else if (policy.decision === "block") {
            decision = "blocked";
            confidence = 0.92;
            rationale = policy.rationale;
        } else if (!action) {
            decision = "needs_review";
            confidence = 0.46;
            rationale = requestedTargetLabel && !grounding.resolved
                ? `The requested target "${requestedTargetLabel}" could not be grounded to a reliable screen region.`
                : "The request needs a concrete target, key, text, scroll amount, or wait duration before it can execute.";
        } else if (policy.decision === "review") {
            decision = "needs_review";
            confidence = 0.62;
            rationale = policy.rationale;
        } else if (action.action === "click" && !hasConcreteTarget(groundedInput.target)) {
            decision = "needs_review";
            confidence = 0.5;
            rationale = requestedTargetLabel
                ? `Click target "${requestedTargetLabel}" needs visual or accessibility grounding before execution.`
                : "Click actions require explicit x and y coordinates from the UI layer.";
        }

        if (requestedTargetLabel && !grounding.resolved && decision === "needs_review") {
            requiredReview.push(`Resolve target "${requestedTargetLabel}" using accessibility tree, vision, or explicit coordinates.`);
        }

        return {
            action: decision === "execute" ? action : undefined,
            plan: {
                id: `gap_${randomUUID()}`,
                sessionId: input.sessionId,
                goal: input.goal,
                instruction: input.instruction,
                decision,
                confidence,
                rationale,
                proposedAction: action ? redactAction(action) : undefined,
                grounding,
                riskFlags,
                requiredReview,
                suggestedFollowUps: this.suggestFollowUps(groundedInput, action, observation),
                observationId: observation.id,
                createdAt: new Date().toISOString(),
            },
        };
    }

    private inferAction(input: TrycuaGuidedActionInput): TrycuaActionInput | undefined {
        const phrase = normalizePhrase(`${input.goal ?? ""} ${input.instruction ?? ""}`);

        if (input.action) {
            return explicitAction(input);
        }

        if (input.waitMs !== undefined || /\b(wait|pause|sleep)\b/.test(phrase)) {
            return {
                action: "wait",
                params: { ms: clampMilliseconds(input.waitMs ?? inferWaitMs(phrase)) },
            };
        }

        if (input.clipboardText !== undefined || /\b(clipboard|copy buffer)\b/.test(phrase)) {
            if (input.clipboardText === undefined) return undefined;
            return { action: "clipboard", params: { text: input.clipboardText } };
        }

        if (input.drag) {
            return {
                action: "drag",
                params: {
                    startX: input.drag.startX,
                    startY: input.drag.startY,
                    endX: input.drag.endX,
                    endY: input.drag.endY,
                    durationMs: input.drag.durationMs ?? 300,
                },
            };
        }

        if (input.scroll) {
            return {
                action: "scroll",
                params: {
                    x: finiteOrDefault(input.scroll.x, 0),
                    y: finiteOrDefault(input.scroll.y, 0),
                    clicks: finiteOrDefault(input.scroll.clicks, phrase.includes("up") ? -3 : 3),
                },
            };
        }

        if (input.hotkey) {
            return { action: "hotkey", params: { keys: input.hotkey } };
        }

        if (input.key || /\b(press|hit)\s+(enter|return|tab|escape|esc|backspace|delete|space)\b/.test(phrase)) {
            const key = input.key ?? inferKey(phrase);
            if (!key) return undefined;
            return { action: "key_press", params: { key } };
        }

        if (input.target && hasConcreteTarget(input.target) && /\b(click|select|open|choose|press)\b/.test(phrase)) {
            if (/\bright[-\s]?click\b/.test(phrase)) {
                return {
                    action: "right_click",
                    params: targetParams(input.target),
                };
            }
            if (/\bdouble[-\s]?click\b/.test(phrase)) {
                return {
                    action: "double_click",
                    params: targetParams(input.target),
                };
            }
            return {
                action: "click",
                params: targetParams(input.target),
            };
        }

        if (input.target && hasConcreteTarget(input.target) && /\b(move|hover)\b/.test(phrase)) {
            return {
                action: "mouse_move",
                params: targetParams(input.target),
            };
        }

        if (input.text !== undefined) {
            if (typeof input.text !== "string" || input.text.length > 5000) {
                throw new BadRequestError("Guided text input must be a string under 5000 characters");
            }
            return { action: "type_text", params: { text: input.text } };
        }

        return undefined;
    }

    private understandUi(input: {
        provider: string;
        os: string;
        sandboxName?: string | null;
        providerSessionId?: string | null;
        metadata: Record<string, unknown>;
        screenshot: string;
    }): TrycuaUiUnderstanding {
        const metadataText = [
            input.provider,
            input.os,
            input.sandboxName,
            input.providerSessionId,
            safeString(input.metadata.sdk),
            safeString(input.metadata.image),
            safeString(input.metadata.providerType),
        ].filter(Boolean).join(" ").toLowerCase();
        const activeApp = inferAppIdentity(metadataText, input.provider);
        const viewport: UiRegion = {
            id: "viewport",
            kind: "viewport",
            label: `${activeApp.name} viewport`,
            confidence: 0.65,
            evidence: ["Provider screenshot captured successfully"],
        };
        const warnings = [
            "Screen observation is screenshot-only; semantic labels require OCR, accessibility data, or caller-provided targets.",
        ];

        if (isLikelyBlankMockScreenshot(input.screenshot)) {
            warnings.push("Current screenshot matches the mock provider placeholder.");
        }

        return {
            source: "screenshot_metadata",
            surfaceType: activeApp.category,
            activeApp,
            visibleText: [],
            controls: [viewport],
            textInputs: [],
            clickableRegions: [],
            warnings,
            confidence: activeApp.confidence,
        };
    }

    private suggestFollowUps(
        input: TrycuaGuidedActionInput,
        action: TrycuaActionInput | undefined,
        observation: TrycuaObservation,
    ): string[] {
        const suggestions: string[] = [];
        if (!action) {
            suggestions.push("Provide an explicit target coordinate, key, text value, scroll amount, or wait duration.");
        }
        if (input.target?.label && !hasConcreteTarget(input.target)) {
            suggestions.push(`Resolve the target label "${input.target.label}" to x/y coordinates before clicking.`);
        }
        if (input.text && !input.target && action?.action === "type_text") {
            suggestions.push("Confirm the intended field is focused before typing.");
        }
        if (input.clipboardText && action?.action === "clipboard") {
            suggestions.push("Confirm the destination app is ready before pasting clipboard contents.");
        }
        if (observation.ui.visibleText.length === 0) {
            suggestions.push("Attach OCR or accessibility-tree capture to improve application and control identification.");
        }
        return suggestions;
    }
}

function accessibilityToUiUnderstanding(
    snapshot: TrycuaAccessibilitySnapshot,
    provider: string,
): TrycuaUiUnderstanding | null {
    if (!snapshot.available || snapshot.nodes.length === 0) return null;

    const regions = snapshot.nodes
        .map((node, index) => uiRegionFromAccessibilityNode(node, index))
        .filter((region): region is UiRegion => Boolean(region));
    const clickableRegions = regions.filter((region) => isClickableKind(region.kind));
    const textInputs = regions.filter((region) => region.kind === "text_input");
    const visibleText = uniqueStrings(snapshot.nodes.flatMap((node) => [
        node.title,
        node.value,
        node.description,
    ]).filter((value): value is string => typeof value === "string" && value.trim().length > 0));

    const rootLabel = snapshot.root?.title || snapshot.root?.description || `${provider} desktop`;
    return {
        source: "accessibility_tree",
        surfaceType: "application",
        activeApp: {
            name: rootLabel,
            category: "application",
            confidence: snapshot.source === "mock" ? 0.45 : 0.82,
            evidence: [`${snapshot.source} accessibility tree`, `${snapshot.nodes.length} nodes captured`],
        },
        visibleText,
        controls: regions,
        textInputs,
        clickableRegions,
        warnings: snapshot.source === "mock" ? ["Using synthetic mock accessibility tree."] : [],
        confidence: snapshot.source === "mock" ? 0.45 : 0.82,
    };
}

function mergeUiUnderstanding(
    baseUi: TrycuaUiUnderstanding,
    accessibilityUi: TrycuaUiUnderstanding | null,
    visionUi: TrycuaUiUnderstanding | null,
): TrycuaUiUnderstanding {
    const sources = [baseUi, accessibilityUi, visionUi].filter((ui): ui is TrycuaUiUnderstanding => Boolean(ui));
    if (sources.length === 1) return baseUi;

    const bestUi = accessibilityUi ?? visionUi ?? baseUi;
    return {
        source: sources.length > 1 ? "hybrid" : bestUi.source,
        surfaceType: bestUi.surfaceType || baseUi.surfaceType,
        activeApp: bestUi.activeApp.confidence >= baseUi.activeApp.confidence ? bestUi.activeApp : baseUi.activeApp,
        visibleText: uniqueStrings(sources.flatMap((ui) => ui.visibleText)),
        controls: dedupeRegions(sources.flatMap((ui) => ui.controls)),
        textInputs: dedupeRegions(sources.flatMap((ui) => ui.textInputs)),
        clickableRegions: dedupeRegions(sources.flatMap((ui) => ui.clickableRegions)),
        warnings: uniqueStrings(sources.flatMap((ui) => ui.warnings)),
        confidence: Math.max(...sources.map((ui) => ui.confidence)),
    };
}

function uiRegionFromAccessibilityNode(node: TrycuaAccessibilityNode, index: number): UiRegion | undefined {
    const label = firstNonEmpty(node.title, node.value, node.description);
    const role = normalizePhrase(node.role);
    const kind = kindFromAccessibilityRole(role);
    if (!label && kind === "unknown" && !node.bounds) return undefined;

    return {
        id: `ax_${index}_${hashSmall(`${node.role}:${label ?? ""}`)}`,
        kind,
        label,
        bounds: node.bounds,
        confidence: node.bounds ? 0.86 : 0.64,
        evidence: ["Accessibility tree", node.role].filter(Boolean),
    };
}

function kindFromAccessibilityRole(role: string): UiRegionKind {
    if (/(button|link|menuitem|menu item|checkbox|radio|tab|option|switch|cell)/.test(role)) return "button";
    if (/(textfield|text field|textbox|searchfield|search field|search|combobox|combo box|input|edit)/.test(role)) return "text_input";
    if (/(toolbar|menubar|menu bar)/.test(role)) return "toolbar";
    if (/(window|application|desktop|document|webarea|web area|group|region)/.test(role)) return "content";
    return "unknown";
}

function isClickableKind(kind: UiRegionKind): boolean {
    return kind === "button" || kind === "text_input";
}

export function resolveGroundedTarget(
    input: TrycuaGuidedActionInput,
    observation: TrycuaObservation,
    requestedLabel?: string,
): TrycuaTargetGrounding {
    if (hasConcreteTarget(input.target)) {
        return {
            resolved: true,
            method: "explicit_coordinates",
            query: input.target.label,
            target: { ...input.target, x: input.target.x, y: input.target.y },
            confidence: 1,
            rationale: "Caller supplied explicit x/y coordinates.",
        };
    }

    const query = requestedLabel?.trim();
    if (!query) {
        return {
            resolved: false,
            method: "none",
            confidence: 0,
            rationale: "No target label or coordinates were provided.",
        };
    }

    const candidates = [
        ...observation.ui.clickableRegions,
        ...observation.ui.textInputs,
        ...observation.ui.controls,
    ].filter((region) => region.bounds && region.label);

    // 1. Check for relative directional modifier parsing
    let queryText = query;
    let modifier: "below" | "above" | "left" | "right" | "next_to" | undefined;
    let anchorText = "";

    const belowRegex = /(?:below|under)\s+(.+)/i;
    const aboveRegex = /(?:above|over)\s+(.+)/i;
    const leftRegex = /(?:to the left of|left of)\s+(.+)/i;
    const rightRegex = /(?:to the right of|right of)\s+(.+)/i;
    const nextToRegex = /(?:next to|beside|adjacent to)\s+(.+)/i;

    let match = queryText.match(belowRegex);
    if (match) { modifier = "below"; anchorText = match[1].trim(); }
    else if ((match = queryText.match(aboveRegex))) { modifier = "above"; anchorText = match[1].trim(); }
    else if ((match = queryText.match(leftRegex))) { modifier = "left"; anchorText = match[1].trim(); }
    else if ((match = queryText.match(rightRegex))) { modifier = "right"; anchorText = match[1].trim(); }
    else if ((match = queryText.match(nextToRegex))) { modifier = "next_to"; anchorText = match[1].trim(); }

    if (modifier && anchorText) {
        const anchorCandidates = candidates.map((region) => ({ region, score: scoreRegionMatch(anchorText, region) }))
            .filter((c) => c.score >= 0.58)
            .sort((a, b) => b.score - a.score);
        const anchor = anchorCandidates[0]?.region;
        if (anchor && anchor.bounds) {
            const relativeCandidates = candidates.filter((c) => c.id !== anchor.id && c.bounds);
            const scoredRelative = relativeCandidates.map((c) => {
                const cb = c.bounds!;
                const ab = anchor.bounds!;
                const cx = cb.x + cb.width / 2;
                const cy = cb.y + cb.height / 2;
                const ax = ab.x + ab.width / 2;
                const ay = ab.y + ab.height / 2;

                let spatialScore = 0;
                let distance = Math.sqrt((cx - ax) ** 2 + (cy - ay) ** 2);

                if (modifier === "below" && cy > ay + ab.height / 2) {
                    spatialScore = 1 / (1 + distance / 100);
                } else if (modifier === "above" && cy < ay - ab.height / 2) {
                    spatialScore = 1 / (1 + distance / 100);
                } else if (modifier === "left" && cx < ax - ab.width / 2) {
                    spatialScore = 1 / (1 + distance / 100);
                } else if (modifier === "right" && cx > ax + ab.width / 2) {
                    spatialScore = 1 / (1 + distance / 100);
                } else if (modifier === "next_to") {
                    spatialScore = 1 / (1 + distance / 100);
                }

                let tokenMatch = 0.5;
                if (c.kind === "button" || c.kind === "text_input") {
                    tokenMatch = 0.9;
                }

                return { region: c, score: spatialScore * tokenMatch };
            }).filter((c) => c.score > 0).sort((a, b) => b.score - a.score);

            const bestRelative = scoredRelative[0];
            if (bestRelative && bestRelative.region.bounds && bestRelative.score > 0.15) {
                const bounds = bestRelative.region.bounds;
                const method = bestRelative.region.evidence.some((entry) => /accessibility/i.test(entry))
                    ? "accessibility_tree"
                    : (bestRelative.region.evidence.some((entry) => /vision/i.test(entry)) ? "vision" : "heuristic");
                return {
                    resolved: true,
                    method,
                    query,
                    target: {
                        x: Math.round(bounds.x + bounds.width / 2),
                        y: Math.round(bounds.y + bounds.height / 2),
                        label: bestRelative.region.label,
                        role: bestRelative.region.kind,
                    },
                    matchedRegion: bestRelative.region,
                    confidence: 0.9,
                    rationale: `Matched "${query}" relative to "${anchor.label}" using spatial directional grounding.`,
                };
            }
        }
    }

    const ranked = candidates
        .map((region) => ({ region, score: scoreRegionMatch(query, region) }))
        .sort((a, b) => b.score - a.score);
    const best = ranked[0];

    if (!best || best.score < 0.58 || !best.region.bounds) {
        return {
            resolved: false,
            method: "none",
            query,
            confidence: best?.score ?? 0,
            rationale: best
                ? `Best candidate "${best.region.label}" scored below the grounding threshold.`
                : "No labelled clickable or input regions had coordinates.",
        };
    }

    // 2. Check for label-to-input sibling mapping
    if (best && (best.region.kind === "content" || best.region.kind === "unknown" || !isClickableKind(best.region.kind))) {
        const labelBounds = best.region.bounds!;
        const lx = labelBounds.x + labelBounds.width / 2;
        const ly = labelBounds.y + labelBounds.height / 2;

        const interactiveCandidates = candidates.filter(
            (c) => c.id !== best.region.id && (c.kind === "text_input" || c.kind === "button")
        );

        const withDistance = interactiveCandidates.map((c) => {
            const cb = c.bounds!;
            const cx = cb.x + cb.width / 2;
            const cy = cb.y + cb.height / 2;
            
            const dx = cx - lx;
            const dy = cy - ly;
            const distance = Math.sqrt(dx * dx + dy * dy);

            let alignmentScore = 0;
            if (dx > 0 && Math.abs(dy) < 30) {
                alignmentScore = 1.0;
            } else if (dy > 0 && Math.abs(dx) < 80) {
                alignmentScore = 0.8;
            } else {
                alignmentScore = 0.2;
            }

            return { region: c, score: alignmentScore / (1 + distance / 150) };
        }).sort((a, b) => b.score - a.score);

        const sibling = withDistance[0]?.region;
        if (sibling && sibling.bounds && withDistance[0].score > 0.15) {
            const bounds = sibling.bounds;
            const method = sibling.evidence.some((entry) => /accessibility/i.test(entry))
                ? "accessibility_tree"
                : (sibling.evidence.some((entry) => /vision/i.test(entry)) ? "vision" : "heuristic");
            return {
                resolved: true,
                method,
                query,
                target: {
                    x: Math.round(bounds.x + bounds.width / 2),
                    y: Math.round(bounds.y + bounds.height / 2),
                    label: sibling.label,
                    role: sibling.kind,
                },
                matchedRegion: sibling,
                confidence: 0.88,
                rationale: `Mapped label match "${best.region.label}" to adjacent interactive element "${sibling.label}".`,
            };
        }
    }

    const method = best.region.evidence.some((entry) => /accessibility/i.test(entry))
        ? "accessibility_tree"
        : (best.region.evidence.some((entry) => /vision/i.test(entry)) ? "vision" : "heuristic");
    const bounds = best.region.bounds;
    return {
        resolved: true,
        method,
        query,
        target: {
            x: Math.round(bounds.x + bounds.width / 2),
            y: Math.round(bounds.y + bounds.height / 2),
            label: best.region.label,
            role: best.region.kind,
        },
        matchedRegion: best.region,
        confidence: Math.min(0.96, Math.max(best.region.confidence, best.score)),
        rationale: `Matched "${query}" to "${best.region.label}" (${Math.round(best.score * 100)}%).`,
    };
}

function scoreRegionMatch(query: string, region: UiRegion): number {
    const queryNorm = normalizeTargetText(query);
    const labelNorm = normalizeTargetText(region.label ?? "");
    if (!queryNorm || !labelNorm) return 0;
    if (queryNorm === labelNorm) return 0.98;
    if (labelNorm.includes(queryNorm) || queryNorm.includes(labelNorm)) return 0.86;

    const queryTokens = new Set(queryNorm.split(" ").filter(Boolean));
    const labelTokens = new Set(labelNorm.split(" ").filter(Boolean));
    const overlap = [...queryTokens].filter((token) => labelTokens.has(token)).length;
    const union = new Set([...queryTokens, ...labelTokens]).size || 1;
    const tokenScore = overlap / union;
    const roleBoost = queryNorm.includes(region.kind.replace("_", " ")) ? 0.08 : 0;
    return Math.min(0.94, tokenScore + roleBoost);
}

function inferTargetLabelFromInstruction(input: TrycuaGuidedActionInput): string | undefined {
    const phrase = `${input.instruction ?? ""} ${input.goal ?? ""}`.trim();
    const quoted = /["']([^"']{2,80})["']/.exec(phrase);
    if (quoted?.[1]) return cleanupTargetLabel(quoted[1]);

    const match = /\b(?:click|tap|press|select|choose|open)\s+(?:the\s+)?(.{2,80}?)(?:\s+(?:button|link|field|input|menu|tab))?(?:[.!?]|$)/i.exec(phrase);
    if (!match?.[1]) return undefined;
    return cleanupTargetLabel(match[1]);
}

function cleanupTargetLabel(value: string): string | undefined {
    const cleaned = value
        .replace(/\b(button|link|field|input|menu|tab)\b/gi, "")
        .replace(/\b(on|in|at)\s+.*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned.length >= 2 ? cleaned : undefined;
}

function normalizeTargetText(value: string): string {
    return normalizePhrase(value)
        .replace(/\b(the|a|an|button|link|field|input|menu|tab|please)\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function dedupeRegions(regions: UiRegion[]): UiRegion[] {
    const seen = new Set<string>();
    const result: UiRegion[] = [];
    for (const region of regions) {
        const bounds = region.bounds;
        const key = [
            normalizePhrase(region.label ?? ""),
            region.kind,
            bounds ? `${Math.round(bounds.x)}:${Math.round(bounds.y)}:${Math.round(bounds.width)}:${Math.round(bounds.height)}` : "none",
        ].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(region);
    }
    return result;
}

function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const trimmed = value.trim();
        const key = trimmed.toLowerCase();
        if (!trimmed || seen.has(key)) continue;
        seen.add(key);
        result.push(trimmed);
    }
    return result.slice(0, 200);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
    return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function hashSmall(value: string): string {
    return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function summarizeScreenshot(dataUrl: string, includeScreenshot: boolean): ScreenshotSummary {
    const parsed = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
    const mediaType = parsed?.[1] ?? "application/octet-stream";
    const base64 = parsed?.[2] ?? dataUrl;
    return {
        mediaType,
        bytesApprox: Math.floor(base64.length * 0.75),
        fingerprint: createHash("sha256").update(dataUrl).digest("hex").slice(0, 24),
        dataUrl: includeScreenshot ? dataUrl : undefined,
    };
}

function inferAppIdentity(metadataText: string, provider: string): AppIdentity {
    if (/\b(chrome|chromium|browser|firefox|edge|safari)\b/.test(metadataText)) {
        return {
            name: "browser",
            category: "browser",
            confidence: 0.68,
            evidence: ["Session metadata references a browser runtime."],
        };
    }

    if (/\b(terminal|shell|bash|powershell|cmd)\b/.test(metadataText)) {
        return {
            name: "terminal",
            category: "terminal",
            confidence: 0.62,
            evidence: ["Session metadata references a shell or terminal."],
        };
    }

    if (/\b(xfce|desktop|linux|windows|macos)\b/.test(metadataText)) {
        return {
            name: `${provider} remote desktop`,
            category: "desktop",
            confidence: 0.52,
            evidence: ["Session metadata identifies a remote desktop environment."],
        };
    }

    return {
        name: `${provider} application`,
        category: "unknown",
        confidence: 0.32,
        evidence: ["Only provider metadata is available."],
    };
}

function redactAction(action: TrycuaActionInput): TrycuaProposedAction {
    const params = action.params ?? {};
    if (action.action === "type_text" || action.action === "clipboard") {
        const text = String(params.text ?? "");
        return {
            action: action.action,
            params: { text: `[REDACTED_TEXT:${text.length}]` },
            redacted: true,
        };
    }
    return {
        action: action.action,
        params,
        redacted: false,
    };
}

function normalizePhrase(value: string): string {
    return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasInstruction(input: TrycuaGuidedActionInput): boolean {
    return Boolean(
        input.goal ||
        input.instruction ||
        input.action ||
        input.text ||
        input.key ||
        input.hotkey ||
        input.scroll ||
        input.drag ||
        input.clipboardText ||
        input.waitMs,
    );
}

function hasConcreteTarget(target?: GuidedActionTarget): target is GuidedActionTarget & { x: number; y: number } {
    return typeof target?.x === "number"
        && Number.isFinite(target.x)
        && typeof target.y === "number"
        && Number.isFinite(target.y);
}

function inferKey(phrase: string): string | undefined {
    for (const [alias, key] of Object.entries(SAFE_KEY_ALIASES)) {
        if (new RegExp(`\\b${alias}\\b`, "i").test(phrase)) {
            return key;
        }
    }
    return undefined;
}

function inferWaitMs(phrase: string): number {
    const seconds = /(\d+(?:\.\d+)?)\s*(seconds?|secs?|s)\b/.exec(phrase);
    if (seconds) return Number(seconds[1]) * 1000;
    const milliseconds = /(\d+)\s*(milliseconds?|ms)\b/.exec(phrase);
    if (milliseconds) return Number(milliseconds[1]);
    return 1000;
}

function clampMilliseconds(value: number): number {
    if (!Number.isFinite(value)) return 1000;
    return Math.max(0, Math.min(Math.round(value), 10_000));
}

function finiteOrDefault(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function safeString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function isLikelyBlankMockScreenshot(dataUrl: string): boolean {
    return dataUrl.includes("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ");
}

function explicitAction(input: TrycuaGuidedActionInput): TrycuaActionInput | undefined {
    switch (input.action) {
        case "click":
        case "double_click":
        case "right_click":
        case "mouse_move":
            return hasConcreteTarget(input.target)
                ? { action: input.action, params: targetParams(input.target) }
                : undefined;
        case "drag":
            return input.drag
                ? {
                    action: "drag",
                    params: {
                        startX: input.drag.startX,
                        startY: input.drag.startY,
                        endX: input.drag.endX,
                        endY: input.drag.endY,
                        durationMs: input.drag.durationMs ?? 300,
                    },
                }
                : undefined;
        case "type_text":
            return input.text === undefined ? undefined : { action: "type_text", params: { text: input.text } };
        case "key_press":
            return input.key === undefined ? undefined : { action: "key_press", params: { key: input.key } };
        case "hotkey":
            return input.hotkey === undefined ? undefined : { action: "hotkey", params: { keys: input.hotkey } };
        case "clipboard":
            return input.clipboardText === undefined ? undefined : { action: "clipboard", params: { text: input.clipboardText } };
        case "scroll":
            return {
                action: "scroll",
                params: {
                    x: finiteOrDefault(input.scroll?.x, 0),
                    y: finiteOrDefault(input.scroll?.y, 0),
                    clicks: finiteOrDefault(input.scroll?.clicks, 3),
                },
            };
        case "wait":
            return { action: "wait", params: { ms: clampMilliseconds(input.waitMs ?? 1000) } };
        default:
            return undefined;
    }
}

function targetParams(target: GuidedActionTarget & { x: number; y: number }): Record<string, unknown> {
    return {
        x: target.x,
        y: target.y,
        label: target.label,
        role: target.role,
    };
}

export const trycuaComputerIntelligenceService = new TrycuaComputerIntelligenceService();
