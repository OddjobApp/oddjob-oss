import { describe, it, expect } from "vitest";
import {
    ONTOLOGY_ADAPTERS,
    UnfilterablePropertyError,
} from "../../core/ontology-adapters.js";
import { OntologyService, type OntologyCtx } from "../../core/ontology.service.js";

/**
 * The listBy contract, checked across every registered adapter.
 *
 * These assertions are deliberately DB-free: every implementation validates the
 * property BEFORE it builds a query, which is the property being pinned here — a
 * filter that reached the database with an unrecognised column would either error
 * at the driver or, worse, be dropped and return the org's entire table.
 */

const CTX: OntologyCtx = { organizationId: 1, userId: "test:adapters" };
const ADAPTERS = Object.entries(ONTOLOGY_ADAPTERS);

describe("OntologyAdapter.listBy", () => {
    it("registers at least the adapters the ontology ships with", () => {
        expect(ADAPTERS.length).toBeGreaterThanOrEqual(23);
    });

    it.each(ADAPTERS)("%s implements listBy", (_key, adapter) => {
        // Without it, inbound link traversal falls back to a bounded scan and can
        // only ever return a capped, explicitly-partial answer.
        expect(typeof adapter.listBy).toBe("function");
    });

    it.each(ADAPTERS)("%s refuses a property it cannot filter", async (_key, adapter) => {
        // Refusing is the whole contract. Ignoring an unknown property would leave
        // the query unfiltered, and traversal would then report every object of this
        // type as related to whatever was being traversed from.
        await expect(
            adapter.listBy!(CTX, "definitely_not_a_column", "x"),
        ).rejects.toThrow(UnfilterablePropertyError);
    });

    it.each(ADAPTERS)("%s only offers filters for properties it actually surfaces", async (_key, adapter) => {
        // A filterable key that is not a declared property is unreachable: defineLinkType
        // validates sourceProperty against `properties`, so such a key could never be
        // named by a link. The mismatch to catch is the reverse of the alias trap —
        // `signalId` must appear here as the exposed name, not as event_primitive_id.
        const error = await adapter
            .listBy!(CTX, "definitely_not_a_column", "x")
            .then(() => null, (e) => e as Error);

        const listed = /Filterable: (.*)\.$/.exec(error!.message)?.[1] ?? "";
        const filterable = listed === "(none)" ? [] : listed.split(", ");

        expect(filterable.length, "an adapter that can filter nothing should not declare listBy").toBeGreaterThan(0);
        for (const property of filterable) {
            expect(
                adapter.properties,
                `'${property}' is filterable but is not a declared property, so no link can name it`,
            ).toHaveProperty(property);
        }
    });
});

/**
 * The default Link Types, checked without a database.
 *
 * seedDefaultLinkTypes SKIPS a link whose ends or join property do not resolve, and
 * only logs — the right behaviour at runtime (one bad default must not cost an org
 * the others) and exactly the wrong behaviour to leave unwatched, because a typo
 * would ship as a link that silently never exists. These assertions are the watch.
 */
describe("OntologyService.DEFAULT_LINK_TYPES", () => {
    const TYPES = OntologyService.DEFAULT_VIRTUAL_TYPES;
    const LINKS = OntologyService.DEFAULT_LINK_TYPES;
    const typeByName = new Map(TYPES.map((t) => [t.name, t]));

    const propertiesOf = (typeName: string) =>
        ONTOLOGY_ADAPTERS[typeByName.get(typeName)!.adapter].properties;

    it.each(TYPES.map((t) => [t.name, t.adapter] as const))(
        "default Object Type '%s' names a registered adapter (%s)",
        (_name, adapter) => {
            expect(ONTOLOGY_ADAPTERS).toHaveProperty(adapter);
        },
    );

    it("names every registered adapter", () => {
        // The reverse direction, and the one that actually rotted: five adapters were
        // fully written, registered, and reachable by nothing, because no default type
        // named them. An adapter with no Object Type is dead code that reads as a
        // feature.
        const claimed = new Set(TYPES.map((t) => t.adapter));
        expect(Object.keys(ONTOLOGY_ADAPTERS).filter((k) => !claimed.has(k))).toEqual([]);
    });

    it.each(LINKS.map((l) => [`${l.sourceType} --${l.name}--> ${l.targetType ?? "(polymorphic)"}`, l] as const))(
        "%s connects two default Object Types",
        (_label, link) => {
            expect(typeByName.has(link.sourceType), `unknown source type '${link.sourceType}'`).toBe(true);
            if (link.targetType === null) {
                // A polymorphic link names its targets in the discriminator map, and
                // the seeder DROPS any entry pointing at a type that does not exist.
                // A typo here would not fail — it would quietly shrink what the link
                // can reach.
                const mapped = Object.values(link.targetTypeMap ?? {});
                expect(mapped.length, `'${link.name}' maps no target types`).toBeGreaterThan(0);
                for (const typeName of mapped) {
                    expect(typeByName.has(typeName), `unknown mapped target type '${typeName}'`).toBe(true);
                }
                expect(
                    link.targetTypeProperty && link.targetTypeProperty in propertiesOf(link.sourceType),
                    `discriminator '${link.targetTypeProperty}' is not a property of '${link.sourceType}'`,
                ).toBe(true);
            } else {
                expect(typeByName.has(link.targetType), `unknown target type '${link.targetType}'`).toBe(true);
            }
        },
    );

    it.each(LINKS.filter((l) => (l.backing ?? "derived") === "derived").map((l) => [`${l.sourceType}.${l.sourceProperty}`, l] as const))(
        "%s is a property the source adapter actually surfaces",
        (_label, link) => {
            // A join key the adapter does not project resolves to undefined on every
            // row, and the traversal returns nothing forever without erroring.
            // Composed links are excluded: their hops carry the join keys, and their
            // own sourceProperty is never read.
            expect(propertiesOf(link.sourceType)).toHaveProperty(link.sourceProperty);
        },
    );

    it("gives every composed link hops that other default links declare", () => {
        // A path names its hops as strings, so a typo is invisible until traversal
        // returns nothing. Each hop must be some default link's forward or inverse
        // name — the same check defineLinkType makes against the org's live links.
        const names = new Set(LINKS.flatMap((l) => [l.name, l.inverseName]));
        for (const link of LINKS.filter((l) => l.backing === "path")) {
            expect(link.path?.length, `'${link.name}' declares no hops`).toBeGreaterThan(0);
            for (const hop of link.path ?? []) {
                expect(names.has(hop), `'${link.name}' hop '${hop}' is not a declared link`).toBe(true);
            }
            // The declared target is the promise the traversal filters down to; a
            // composed link without one could land on anything.
            expect(link.targetType, `'${link.name}' must name where it lands`).toBeTruthy();
        }
    });

    it("declares no two links the same name from the same source type", () => {
        // The table's unique index is (org, sourceType, name); a duplicate here would
        // make the second insert a silent no-op under onConflictDoNothing.
        const seen = LINKS.map((l) => `${l.sourceType}::${l.name}`);
        expect(new Set(seen).size).toBe(seen.length);
    });

    it("declares no two links the same inverse name arriving at the same type", () => {
        // Inverse traversal matches on (inverseName, targetType) and takes the FIRST
        // hit, so a collision would resolve to whichever link happened to be read
        // first — a relationship silently answering for a different one.
        //
        // A polymorphic link arrives at EVERY type in its map, so it has to be
        // expanded: the collision it can cause is with a concrete link into one of
        // those types, which comparing against a null target would miss entirely.
        const seen = LINKS.flatMap((l) =>
            l.targetType === null
                ? Object.values(l.targetTypeMap ?? {}).map((t) => `${t}::${l.inverseName}`)
                : [`${l.targetType}::${l.inverseName}`],
        );
        expect(new Set(seen).size).toBe(seen.length);
    });

    it("names both directions of every link", () => {
        for (const link of LINKS) {
            expect(link.name.length, "forward name").toBeGreaterThan(0);
            expect(link.inverseName.length, "inverse name").toBeGreaterThan(0);
            expect(link.inverseName).not.toBe(link.name);
        }
    });
});
