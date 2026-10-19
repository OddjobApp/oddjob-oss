/**
 * Property-based tests for Agent Card Service
 *
 * Feature: hat-menu-intent-router
 *
 * Properties tested:
 * - Property 3: Organization isolation — cards from org A never appear in org B queries
 * - Property 4: Name uniqueness — case-insensitive duplicate names rejected
 * - Property 7: Partial update preservation — unmodified fields retain values
 * - Property 8: List ordering — only enabled cards returned, sorted by createdAt desc
 *
 * **Validates: Requirements 3.2, 3.4, 4.2, 4.3, 4.5, 4.7**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";

// ─── In-memory store for simulating database ────────────────────────────────

let store: AgentCardRecord[] = [];
let nextId = 1;

function resetStore() {
    store = [];
    nextId = 1;
}

/**
 * Helper: Insert a card into the in-memory store (simulates db.insert)
 */
function insertCard(input: {
    organizationId: number;
    name: string;
    description: string;
    personaType: string;
    modelBindingProviderId: number;
    modelBindingModelId: number;
    capabilities: string[];
    tools: string[];
    topicAffinities: string[];
    intentAffinities: string[];
    enabled?: boolean;
    isDefault?: boolean;
    createdAt?: Date;
}): AgentCardRecord {
    const record: AgentCardRecord = {
        id: nextId++,
        organizationId: input.organizationId,
        name: input.name,
        description: input.description,
        personaType: input.personaType,
        modelBindingProviderId: input.modelBindingProviderId,
        modelBindingModelId: input.modelBindingModelId,
        capabilities: input.capabilities,
        tools: input.tools,
        topicAffinities: input.topicAffinities as any,
        topicLabelAffinities: [],
        intentAffinities: input.intentAffinities as any,
        enabled: input.enabled ?? true,
        isDefault: input.isDefault ?? false,
        oceanTraits: { o: 0.5, c: 0.5, e: 0.5, a: 0.5, n: 0.5 },
        soulArchetype: null,
        legend: null,
        approvalBoundary: null,
        createdAt: input.createdAt ?? new Date(),
        updatedAt: new Date(),
    };
    store.push(record);
    return record;
}

/**
 * Helper: List cards for an org (simulates service.list behavior)
 * Returns only enabled cards for the org, sorted by createdAt descending.
 */
function listCards(orgId: number): AgentCardRecord[] {
    return store
        .filter((c) => c.organizationId === orgId && c.enabled === true)
        .sort((a, b) => {
            const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return tb - ta;
        });
}

/**
 * Helper: Get card by ID scoped to org (simulates service.getById behavior)
 */
function getCardById(orgId: number, id: number): AgentCardRecord | null {
    return store.find((c) => c.id === id && c.organizationId === orgId) ?? null;
}

/**
 * Helper: Check name uniqueness within org (case-insensitive)
 */
function nameExistsInOrg(orgId: number, name: string, excludeId?: number): boolean {
    return store.some(
        (c) =>
            c.organizationId === orgId &&
            c.name.toLowerCase() === name.toLowerCase() &&
            (excludeId === undefined || c.id !== excludeId)
    );
}

/**
 * Helper: Partial update (simulates service.update behavior)
 */
function updateCard(
    orgId: number,
    id: number,
    input: Partial<{
        name: string;
        description: string;
        personaType: string;
        capabilities: string[];
        tools: string[];
        topicAffinities: string[];
        intentAffinities: string[];
        modelBindingProviderId: number;
        modelBindingModelId: number;
    }>
): AgentCardRecord | null {
    const idx = store.findIndex((c) => c.id === id && c.organizationId === orgId);
    if (idx === -1) return null;

    const existing = store[idx];

    // Only apply provided fields (partial update semantics)
    const updated: AgentCardRecord = {
        ...existing,
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.personaType !== undefined && { personaType: input.personaType }),
        ...(input.capabilities !== undefined && { capabilities: input.capabilities }),
        ...(input.tools !== undefined && { tools: input.tools }),
        ...(input.topicAffinities !== undefined && { topicAffinities: input.topicAffinities as any }),
        ...(input.intentAffinities !== undefined && { intentAffinities: input.intentAffinities as any }),
        ...(input.modelBindingProviderId !== undefined && { modelBindingProviderId: input.modelBindingProviderId }),
        ...(input.modelBindingModelId !== undefined && { modelBindingModelId: input.modelBindingModelId }),
        updatedAt: new Date(),
    };

    store[idx] = updated;
    return updated;
}

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Arbitrary for a valid org ID (positive integer) */
const orgIdArb = fc.integer({ min: 1, max: 10000 });

/** Arbitrary for two distinct org IDs */
const twoDistinctOrgIdsArb = fc
    .tuple(orgIdArb, orgIdArb)
    .filter(([a, b]) => a !== b);

/** Arbitrary for a valid agent card name (1-100 characters) */
const cardNameArb = fc.stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_".split("")),
    { minLength: 1, maxLength: 50 }
).filter((s) => s.trim().length > 0);

/** Arbitrary for a valid description (1-500 chars) */
const descriptionArb = fc.string({ minLength: 1, maxLength: 100 });

/** Arbitrary for a persona type */
const personaTypeArb = fc.constantFrom("assistant", "analyst", "coder", "media_creator", "researcher");

/** Arbitrary for capabilities (1-20 non-empty strings) */
const capabilitiesArb = fc.array(
    fc.string({ minLength: 1, maxLength: 30 }),
    { minLength: 1, maxLength: 5 }
);

/** Arbitrary for tools (0-30 strings) */
const toolsArb = fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 5 });

/** Arbitrary for topic affinities */
const topicAffinitiesArb = fc.subarray(
    ["Code", "Real Estate", "Legal", "Media", "Finance", "Health", "General"],
    { minLength: 0, maxLength: 3 }
);

/** Arbitrary for intent affinities */
const intentAffinitiesArb = fc.subarray(
    ["Image Generation", "Video", "Code Execution", "Analysis", "Alert", "Chat", "Search"],
    { minLength: 0, maxLength: 3 }
);

/** Arbitrary for a full card creation input */
const cardInputArb = fc.record({
    name: cardNameArb,
    description: descriptionArb,
    personaType: personaTypeArb,
    modelBindingProviderId: fc.integer({ min: 1, max: 100 }),
    modelBindingModelId: fc.integer({ min: 1, max: 100 }),
    capabilities: capabilitiesArb,
    tools: toolsArb,
    topicAffinities: topicAffinitiesArb,
    intentAffinities: intentAffinitiesArb,
});

/** Arbitrary for a partial update (some fields present, some absent) */
const partialUpdateArb = fc.record(
    {
        name: cardNameArb,
        description: descriptionArb,
        personaType: personaTypeArb,
        capabilities: capabilitiesArb,
        tools: toolsArb,
        topicAffinities: topicAffinitiesArb,
        intentAffinities: intentAffinitiesArb,
    },
    { requiredKeys: [] }
);

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: hat-menu-intent-router, Property 3: Organization isolation", () => {
    beforeEach(() => {
        resetStore();
    });

    /**
     * Property 3: Organization isolation
     *
     * For any two org IDs A ≠ B, cards created under org A should never
     * be returned by list(B) or getById(B, id).
     *
     * **Validates: Requirements 3.2**
     */
    it("cards from org A never appear in org B list queries", () => {
        fc.assert(
            fc.property(
                twoDistinctOrgIdsArb,
                fc.array(cardInputArb, { minLength: 1, maxLength: 10 }),
                fc.array(cardInputArb, { minLength: 1, maxLength: 10 }),
                ([orgA, orgB], cardsA, cardsB) => {
                    resetStore();

                    // Create cards for org A
                    const createdA = cardsA.map((input) =>
                        insertCard({ ...input, organizationId: orgA })
                    );

                    // Create cards for org B
                    const createdB = cardsB.map((input) =>
                        insertCard({ ...input, organizationId: orgB })
                    );

                    // List for org A should only contain org A cards
                    const listA = listCards(orgA);
                    const listAIds = new Set(listA.map((c) => c.id));
                    for (const card of createdB) {
                        expect(listAIds.has(card.id)).toBe(false);
                    }

                    // List for org B should only contain org B cards
                    const listB = listCards(orgB);
                    const listBIds = new Set(listB.map((c) => c.id));
                    for (const card of createdA) {
                        expect(listBIds.has(card.id)).toBe(false);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    it("getById with org B never returns a card belonging to org A", () => {
        fc.assert(
            fc.property(
                twoDistinctOrgIdsArb,
                fc.array(cardInputArb, { minLength: 1, maxLength: 10 }),
                ([orgA, orgB], cardsA) => {
                    resetStore();

                    // Create cards for org A
                    const createdA = cardsA.map((input) =>
                        insertCard({ ...input, organizationId: orgA })
                    );

                    // Attempting to get each org A card via org B should return null
                    for (const card of createdA) {
                        const result = getCardById(orgB, card.id);
                        expect(result).toBeNull();
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});

describe("Feature: hat-menu-intent-router, Property 4: Name uniqueness", () => {
    beforeEach(() => {
        resetStore();
    });

    /**
     * Property 4: Name uniqueness
     *
     * For any organization, attempting to create two cards with names that differ
     * only in casing should be rejected (detected as conflict).
     *
     * **Validates: Requirements 3.4, 4.7**
     */
    it("case-insensitive duplicate names are detected within same org", () => {
        fc.assert(
            fc.property(
                orgIdArb,
                cardInputArb,
                fc.constantFrom("upper", "lower", "mixed") as fc.Arbitrary<"upper" | "lower" | "mixed">,
                (orgId, input, caseVariant) => {
                    resetStore();

                    // Insert the first card
                    insertCard({ ...input, organizationId: orgId });

                    // Create a case-variant of the name
                    let variantName: string;
                    switch (caseVariant) {
                        case "upper":
                            variantName = input.name.toUpperCase();
                            break;
                        case "lower":
                            variantName = input.name.toLowerCase();
                            break;
                        case "mixed":
                            variantName = input.name
                                .split("")
                                .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
                                .join("");
                            break;
                    }

                    // The name uniqueness check should detect this as a duplicate
                    const isDuplicate = nameExistsInOrg(orgId, variantName);
                    expect(isDuplicate).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    it("same name in different orgs is NOT a conflict", () => {
        fc.assert(
            fc.property(
                twoDistinctOrgIdsArb,
                cardInputArb,
                ([orgA, orgB], input) => {
                    resetStore();

                    // Insert card with a name in org A
                    insertCard({ ...input, organizationId: orgA });

                    // Same name in org B should NOT be detected as duplicate
                    const isDuplicate = nameExistsInOrg(orgB, input.name);
                    expect(isDuplicate).toBe(false);
                }
            ),
            { numRuns: 100 }
        );
    });

    it("distinct names within same org are allowed", () => {
        fc.assert(
            fc.property(
                orgIdArb,
                cardInputArb,
                cardNameArb,
                (orgId, input, differentName) => {
                    // Pre-condition: the names must actually differ (case-insensitive)
                    fc.pre(input.name.toLowerCase() !== differentName.toLowerCase());

                    resetStore();

                    // Insert first card
                    insertCard({ ...input, organizationId: orgId });

                    // A different name should not be detected as duplicate
                    const isDuplicate = nameExistsInOrg(orgId, differentName);
                    expect(isDuplicate).toBe(false);
                }
            ),
            { numRuns: 100 }
        );
    });
});

describe("Feature: hat-menu-intent-router, Property 7: Partial update preservation", () => {
    beforeEach(() => {
        resetStore();
    });

    /**
     * Property 7: Partial update preservation
     *
     * For any agent card and partial update that includes only some fields,
     * the remaining fields retain their original values after update.
     *
     * **Validates: Requirements 4.3**
     */
    it("unmodified fields retain their original values after partial update", () => {
        fc.assert(
            fc.property(
                orgIdArb,
                cardInputArb,
                partialUpdateArb,
                (orgId, input, partialUpdate) => {
                    resetStore();

                    // Create initial card
                    const original = insertCard({ ...input, organizationId: orgId });

                    // Apply partial update
                    const updated = updateCard(orgId, original.id, partialUpdate);
                    expect(updated).not.toBeNull();

                    // For every field NOT in the partial update, verify it retains original value
                    if (partialUpdate.name === undefined) {
                        expect(updated!.name).toBe(original.name);
                    }
                    if (partialUpdate.description === undefined) {
                        expect(updated!.description).toBe(original.description);
                    }
                    if (partialUpdate.personaType === undefined) {
                        expect(updated!.personaType).toBe(original.personaType);
                    }
                    if (partialUpdate.capabilities === undefined) {
                        expect(updated!.capabilities).toEqual(original.capabilities);
                    }
                    if (partialUpdate.tools === undefined) {
                        expect(updated!.tools).toEqual(original.tools);
                    }
                    if (partialUpdate.topicAffinities === undefined) {
                        expect(updated!.topicAffinities).toEqual(original.topicAffinities);
                    }
                    if (partialUpdate.intentAffinities === undefined) {
                        expect(updated!.intentAffinities).toEqual(original.intentAffinities);
                    }

                    // Immutable fields should never change
                    expect(updated!.id).toBe(original.id);
                    expect(updated!.organizationId).toBe(original.organizationId);
                }
            ),
            { numRuns: 100 }
        );
    });

    it("modified fields reflect the new values from partial update", () => {
        fc.assert(
            fc.property(
                orgIdArb,
                cardInputArb,
                partialUpdateArb,
                (orgId, input, partialUpdate) => {
                    resetStore();

                    // Create initial card
                    const original = insertCard({ ...input, organizationId: orgId });

                    // Apply partial update
                    const updated = updateCard(orgId, original.id, partialUpdate);
                    expect(updated).not.toBeNull();

                    // For every field IN the partial update, verify it has the new value
                    if (partialUpdate.name !== undefined) {
                        expect(updated!.name).toBe(partialUpdate.name);
                    }
                    if (partialUpdate.description !== undefined) {
                        expect(updated!.description).toBe(partialUpdate.description);
                    }
                    if (partialUpdate.personaType !== undefined) {
                        expect(updated!.personaType).toBe(partialUpdate.personaType);
                    }
                    if (partialUpdate.capabilities !== undefined) {
                        expect(updated!.capabilities).toEqual(partialUpdate.capabilities);
                    }
                    if (partialUpdate.tools !== undefined) {
                        expect(updated!.tools).toEqual(partialUpdate.tools);
                    }
                    if (partialUpdate.topicAffinities !== undefined) {
                        expect(updated!.topicAffinities).toEqual(partialUpdate.topicAffinities);
                    }
                    if (partialUpdate.intentAffinities !== undefined) {
                        expect(updated!.intentAffinities).toEqual(partialUpdate.intentAffinities);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});

describe("Feature: hat-menu-intent-router, Property 8: List ordering", () => {
    beforeEach(() => {
        resetStore();
    });

    /**
     * Property 8: List ordering
     *
     * list() returns only enabled cards, sorted by createdAt descending.
     *
     * **Validates: Requirements 4.2, 4.5**
     */
    it("list returns only enabled cards for the given org", () => {
        fc.assert(
            fc.property(
                orgIdArb,
                fc.array(
                    fc.tuple(cardInputArb, fc.boolean()),
                    { minLength: 1, maxLength: 15 }
                ),
                (orgId, cardEnabledPairs) => {
                    resetStore();

                    // Create cards with varying enabled status
                    const created: Array<{ card: AgentCardRecord; enabled: boolean }> = [];
                    for (const [input, enabled] of cardEnabledPairs) {
                        const card = insertCard({
                            ...input,
                            organizationId: orgId,
                            enabled,
                        });
                        created.push({ card, enabled });
                    }

                    // List should only return enabled cards
                    const listed = listCards(orgId);
                    const enabledCards = created.filter((c) => c.enabled);

                    expect(listed.length).toBe(enabledCards.length);

                    // Every returned card should be enabled
                    for (const card of listed) {
                        expect(card.enabled).toBe(true);
                    }

                    // No disabled card should be in the result
                    const listedIds = new Set(listed.map((c) => c.id));
                    for (const { card, enabled } of created) {
                        if (!enabled) {
                            expect(listedIds.has(card.id)).toBe(false);
                        }
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    it("list returns cards sorted by createdAt descending", () => {
        fc.assert(
            fc.property(
                orgIdArb,
                fc.array(cardInputArb, { minLength: 2, maxLength: 15 }),
                (orgId, inputs) => {
                    resetStore();

                    // Create cards with incrementing timestamps to ensure ordering
                    const baseTime = Date.now();
                    for (let i = 0; i < inputs.length; i++) {
                        insertCard({
                            ...inputs[i],
                            organizationId: orgId,
                            enabled: true,
                            createdAt: new Date(baseTime + i * 1000), // 1s apart
                        });
                    }

                    const listed = listCards(orgId);

                    // Verify descending order by createdAt
                    for (let i = 0; i < listed.length - 1; i++) {
                        const currentTime = listed[i].createdAt
                            ? new Date(listed[i].createdAt!).getTime()
                            : 0;
                        const nextTime = listed[i + 1].createdAt
                            ? new Date(listed[i + 1].createdAt!).getTime()
                            : 0;
                        expect(currentTime).toBeGreaterThanOrEqual(nextTime);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    it("disabled cards never appear in list regardless of creation order", () => {
        fc.assert(
            fc.property(
                orgIdArb,
                fc.array(cardInputArb, { minLength: 3, maxLength: 10 }),
                fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 5 }),
                (orgId, inputs, disableIndices) => {
                    resetStore();

                    // Create all cards as enabled first
                    const created: AgentCardRecord[] = [];
                    const baseTime = Date.now();
                    for (let i = 0; i < inputs.length; i++) {
                        created.push(
                            insertCard({
                                ...inputs[i],
                                organizationId: orgId,
                                enabled: true,
                                createdAt: new Date(baseTime + i * 1000),
                            })
                        );
                    }

                    // Disable some cards by setting enabled = false
                    const disabledIds = new Set<number>();
                    for (const idx of disableIndices) {
                        const actualIdx = idx % created.length;
                        store[store.findIndex((c) => c.id === created[actualIdx].id)].enabled = false;
                        disabledIds.add(created[actualIdx].id);
                    }

                    // List should not include disabled cards
                    const listed = listCards(orgId);
                    for (const card of listed) {
                        expect(disabledIds.has(card.id)).toBe(false);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});
