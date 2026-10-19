/**
 * Turns raw capability-gap events into typed signatures and per-signature counts.
 *
 * Two rules from §6 shape everything here:
 *
 * 1. **A permission denial is never proof of a missing capability.** Events are
 *    grouped by `failureClass`, and only `missing` produces capability-gap
 *    candidates. `unavailable` is an allotment problem and is aggregated
 *    separately so it can be routed to access review instead of to a build.
 *
 * 2. **Two identical failures in one run count as one affected run.** Frequency
 *    counts DISTINCT `runRef`. Events with no run identity are excluded from
 *    that count and reported separately — never given a synthetic id, and never
 *    quietly folded in as if each were its own run.
 *
 * Identity is computed here, deterministically, and never asked of a model.
 * The verb/object parse is an admitted heuristic over a naming convention; when
 * it cannot parse a name it says so rather than inventing a decomposition.
 */

import { createHash } from "node:crypto";

import type {
    CapabilityGapEvent,
    CapabilityGapFailureClass,
} from "@shared/schema/capabilities/index.js";

/** §6.2's normalized gap signature. */
export interface CapabilityGapSignature {
    /** What the agent was trying to achieve, as the tool name expresses it. */
    intendedOutcome: string;
    targetSystem?: string;
    requiredVerb: string;
    requiredObject: string;
    permissionScope?: string;
    failureClass: CapabilityGapFailureClass;
}

/**
 * Verbs recognised in the platform's `verb_object` tool-naming convention.
 *
 * An allow-list rather than "first token wins": `jira_create_issue` leads with
 * a system, not a verb, and guessing would produce `verb: "jira"` and quietly
 * merge every Jira gap into one signature.
 */
const KNOWN_VERBS = new Set([
    "create", "update", "delete", "remove", "get", "fetch", "read", "list",
    "search", "query", "write", "send", "post", "publish", "run", "execute",
    "sync", "import", "export", "generate", "synthesize", "analyze", "validate",
    "approve", "propose", "launch", "browse", "extract", "ingest", "index",
]);

/** Known system prefixes, so `jira_create_issue` resolves its target. */
const KNOWN_SYSTEMS = new Set([
    "jira", "slack", "github", "gitlab", "gmail", "email", "notion", "linear",
    "salesforce", "hubspot", "stripe", "s3", "gdrive", "sheets", "confluence",
    "zendesk", "asana", "trello", "figma", "shopify",
]);

export interface ParsedToolName {
    system?: string;
    verb: string;
    object: string;
    /** False when the name did not fit the convention and was used whole. */
    parsed: boolean;
}

/**
 * Decompose a tool name into system / verb / object.
 *
 * Deterministic and reversible-by-inspection. When no known verb appears, the
 * whole name becomes the object and `parsed` is false — an unparsed name is a
 * data-quality fact the caller can surface, not something to paper over.
 */
export function parseToolName(toolName: string): ParsedToolName {
    const parts = toolName.trim().toLowerCase().split(/[_\-.:]+/).filter(Boolean);
    if (parts.length === 0) return { verb: "unknown", object: toolName, parsed: false };

    let system: string | undefined;
    let rest = parts;
    if (KNOWN_SYSTEMS.has(parts[0])) {
        system = parts[0];
        rest = parts.slice(1);
    }

    const verbIndex = rest.findIndex(p => KNOWN_VERBS.has(p));
    if (verbIndex === -1) {
        return { system, verb: "unknown", object: rest.join("_") || toolName, parsed: false };
    }

    const verb = rest[verbIndex];
    const object = [...rest.slice(0, verbIndex), ...rest.slice(verbIndex + 1)].join("_");
    return { system, verb, object: object || verb, parsed: true };
}

export function buildGapSignature(event: CapabilityGapEvent): CapabilityGapSignature {
    const parsed = parseToolName(event.requestedToolName);
    return {
        intendedOutcome: event.canonicalToolName ?? event.requestedToolName,
        targetSystem: parsed.system,
        requiredVerb: parsed.verb,
        requiredObject: parsed.object,
        failureClass: event.failureClass,
    };
}

/**
 * Stable key for a signature.
 *
 * Field-wise and sorted, so identity does not depend on serialization order —
 * and computed from typed fields rather than from a model's free-text summary,
 * which is what made the existing `failure_patterns` clustering non-repeatable.
 */
export function signatureKey(signature: CapabilityGapSignature): string {
    const canonical = JSON.stringify({
        failureClass: signature.failureClass,
        intendedOutcome: signature.intendedOutcome,
        permissionScope: signature.permissionScope ?? null,
        requiredObject: signature.requiredObject,
        requiredVerb: signature.requiredVerb,
        targetSystem: signature.targetSystem ?? null,
    });
    return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/** One signature with everything §6.3 needs to score it. */
export interface AggregatedGap {
    key: string;
    signature: CapabilityGapSignature;
    organizationId: number;

    eventCount: number;
    /** DISTINCT runs. Ten failures in one run count once. */
    uniqueAffectedRuns: number;
    /** DISTINCT users. Excludes events with no actor. */
    uniqueAffectedUsers: number;

    /** Events with no run identity — excluded from `uniqueAffectedRuns`. */
    eventsWithoutRunIdentity: number;
    /** Events with no actor — excluded from `uniqueAffectedUsers`. */
    eventsWithoutActor: number;
    /** Tool names that did not fit the naming convention. */
    unparsedToolNames: string[];

    firstSeenAt: Date;
    lastSeenAt: Date;
    exampleToolNames: string[];
}

export interface NormalizationReport {
    /** Candidates for capability invention: `missing` only. */
    capabilityGaps: AggregatedGap[];
    /**
     * `unavailable` gaps — a real tool outside the run's allotment. An access
     * and recruitment question, never evidence that something must be built.
     */
    allotmentGaps: AggregatedGap[];
    /** Anything else (`unauthorized`, `incompatible`). */
    otherGaps: AggregatedGap[];
    totalEvents: number;
}

function aggregate(events: CapabilityGapEvent[]): AggregatedGap[] {
    const groups = new Map<string, CapabilityGapEvent[]>();

    for (const event of events) {
        const signature = buildGapSignature(event);
        // Organization is part of the grouping key: one tenant's execution gap
        // must never merge into another's evidence, whatever the tool name.
        const key = `${event.organizationId}:${signatureKey(signature)}`;
        groups.set(key, [...(groups.get(key) ?? []), event]);
    }

    return [...groups.entries()]
        .map(([key, group]) => {
            const signature = buildGapSignature(group[0]);
            const runs = new Set(group.map(e => e.runRef).filter((r): r is string => !!r));
            const users = new Set(group.map(e => e.actorUserHash).filter((h): h is string => !!h));
            const times = group.map(e => new Date(e.occurredAt).getTime());
            const unparsed = [
                ...new Set(
                    group
                        .filter(e => !parseToolName(e.requestedToolName).parsed)
                        .map(e => e.requestedToolName),
                ),
            ];

            return {
                key,
                signature,
                organizationId: group[0].organizationId,
                eventCount: group.length,
                uniqueAffectedRuns: runs.size,
                uniqueAffectedUsers: users.size,
                eventsWithoutRunIdentity: group.filter(e => !e.runRef).length,
                eventsWithoutActor: group.filter(e => !e.actorUserHash).length,
                unparsedToolNames: unparsed,
                firstSeenAt: new Date(Math.min(...times)),
                lastSeenAt: new Date(Math.max(...times)),
                exampleToolNames: [...new Set(group.map(e => e.requestedToolName))].slice(0, 5),
            };
        })
        .sort((a, b) => b.uniqueAffectedRuns - a.uniqueAffectedRuns || b.eventCount - a.eventCount);
}

/**
 * Group raw events into scored-ready aggregates, split by failure class.
 *
 * The split is the point. Feeding `unavailable` gaps into capability invention
 * would generate proposals to build tools that already exist — the exact defect
 * §6.5 forbids, and the one the old single-string guard guaranteed.
 */
export function normalizeCapabilityGaps(events: CapabilityGapEvent[]): NormalizationReport {
    const byClass = (c: CapabilityGapFailureClass) => events.filter(e => e.failureClass === c);

    return {
        capabilityGaps: aggregate(byClass("missing")),
        allotmentGaps: aggregate(byClass("unavailable")),
        otherGaps: aggregate(events.filter(e => e.failureClass === "unauthorized" || e.failureClass === "incompatible")),
        totalEvents: events.length,
    };
}
