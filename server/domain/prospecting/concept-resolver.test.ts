import { describe, it, expect, beforeEach } from "vitest";
import {
    normalizeUrl,
    cacheKey,
    resolveConcepts,
    clearConceptCache,
    conceptCacheSize,
    type VocabularyLookup,
} from "./concept-resolver.js";

beforeEach(() => clearConceptCache());

describe("normalizeUrl", () => {
    it("strips tracking parameters so one page is one key", () => {
        // This is the whole basis of the cache-hit rate: the same page arriving
        // with a hundred campaign tags must not become a hundred keys.
        const a = normalizeUrl("https://acme.com/pricing?utm_source=x&utm_campaign=y");
        const b = normalizeUrl("https://acme.com/pricing?gclid=abc");
        const c = normalizeUrl("https://acme.com/pricing");
        expect(a).toBe(c);
        expect(b).toBe(c);
    });

    it("strips identity params the embed appends", () => {
        expect(normalizeUrl("https://acme.com/docs?oj_uid=123&oj_email=a@b.c"))
            .toBe(normalizeUrl("https://acme.com/docs"));
    });

    it("keeps meaningful query parameters", () => {
        const out = normalizeUrl("https://acme.com/search?q=widgets&utm_source=x");
        expect(out).toContain("q=widgets");
        expect(out).not.toContain("utm_source");
    });

    it("orders surviving parameters so order cannot fragment the key", () => {
        expect(normalizeUrl("https://acme.com/s?b=2&a=1")).toBe(normalizeUrl("https://acme.com/s?a=1&b=2"));
    });

    it("drops the fragment", () => {
        expect(normalizeUrl("https://acme.com/docs#install")).toBe(normalizeUrl("https://acme.com/docs"));
    });

    it("lowercases the host but preserves path case", () => {
        const out = normalizeUrl("https://ACME.com/Docs/Install");
        expect(out).toContain("acme.com");
        expect(out).toContain("/Docs/Install");
    });

    it("removes a trailing slash from a non-root path", () => {
        expect(normalizeUrl("https://acme.com/pricing/")).toBe(normalizeUrl("https://acme.com/pricing"));
    });

    it("leaves the root path alone", () => {
        expect(normalizeUrl("https://acme.com/")).toContain("acme.com/");
    });

    it("drops default ports", () => {
        expect(normalizeUrl("https://acme.com:443/pricing")).toBe(normalizeUrl("https://acme.com/pricing"));
        expect(normalizeUrl("http://acme.com:80/pricing")).toBe(normalizeUrl("http://acme.com/pricing"));
    });

    it("returns unparseable input unchanged rather than throwing", () => {
        expect(normalizeUrl("not a url")).toBe("not a url");
        expect(normalizeUrl("")).toBe("");
    });
});

describe("cacheKey", () => {
    it("namespaces by organization", () => {
        expect(cacheKey(1, null, "https://acme.com/p")).not.toBe(cacheKey(2, null, "https://acme.com/p"));
    });

    it("namespaces by project so vocabularies cannot bleed", () => {
        expect(cacheKey(1, 10, "https://acme.com/p")).not.toBe(cacheKey(1, 20, "https://acme.com/p"));
    });

    it("distinguishes org-wide from project-scoped", () => {
        expect(cacheKey(1, null, "https://acme.com/p")).not.toBe(cacheKey(1, 10, "https://acme.com/p"));
    });
});

describe("resolveConcepts", () => {
    const lookup: VocabularyLookup = async () => ({ concepts: ["Pricing"], topics: ["Commercial"] });

    it("returns vocabulary results and reports the source", async () => {
        const r = await resolveConcepts({ organizationId: 1, url: "https://acme.com/pricing" }, lookup);
        expect(r.concepts).toEqual(["Pricing"]);
        expect(r.topics).toEqual(["Commercial"]);
        expect(r.source).toBe("vocabulary");
    });

    it("serves a repeat request from cache without calling the vocabulary again", async () => {
        let calls = 0;
        const counting: VocabularyLookup = async () => { calls++; return { concepts: ["Pricing"], topics: [] }; };

        await resolveConcepts({ organizationId: 1, url: "https://acme.com/pricing?utm_source=a" }, counting);
        const second = await resolveConcepts({ organizationId: 1, url: "https://acme.com/pricing?utm_source=b" }, counting);

        // Different campaign tags, same page — the point of the whole design.
        expect(calls).toBe(1);
        expect(second.source).toBe("cache");
    });

    it("falls back to embed themes for a URL not in the vocabulary", async () => {
        const empty: VocabularyLookup = async () => null;
        const r = await resolveConcepts(
            { organizationId: 1, url: "https://acme.com/new", fallbackThemes: ["Pricing & Tiers"] },
            empty,
        );
        expect(r.source).toBe("fallback");
        expect(r.concepts).toEqual(["Pricing & Tiers"]);
    });

    it("does NOT cache a fallback", async () => {
        const empty: VocabularyLookup = async () => null;
        await resolveConcepts({ organizationId: 1, url: "https://acme.com/new", fallbackThemes: ["X"] }, empty);

        // Caching a fallback would stop the real vocabulary ever taking effect
        // for that URL once it is populated.
        expect(conceptCacheSize()).toBe(0);
    });

    it("degrades to fallback when the vocabulary lookup throws", async () => {
        const broken: VocabularyLookup = async () => { throw new Error("db down"); };
        const r = await resolveConcepts(
            { organizationId: 1, url: "https://acme.com/pricing", fallbackThemes: ["Pricing & Tiers"] },
            broken,
        );
        // An outage must never drop the event.
        expect(r.source).toBe("fallback");
        expect(r.concepts).toEqual(["Pricing & Tiers"]);
    });

    it("does not leak one project's vocabulary into another", async () => {
        const byProject: VocabularyLookup = async (_org, projectId) => ({
            concepts: [projectId === 10 ? "AlphaConcept" : "BetaConcept"],
            topics: [],
        });

        const alpha = await resolveConcepts({ organizationId: 1, projectId: 10, url: "https://acme.com/p" }, byProject);
        const beta = await resolveConcepts({ organizationId: 1, projectId: 20, url: "https://acme.com/p" }, byProject);

        expect(alpha.concepts).toEqual(["AlphaConcept"]);
        expect(beta.concepts).toEqual(["BetaConcept"]);
    });

    it("dedupes and trims resolved values", async () => {
        const messy: VocabularyLookup = async () => ({ concepts: ["Pricing", " Pricing ", ""], topics: [] });
        const r = await resolveConcepts({ organizationId: 1, url: "https://acme.com/p" }, messy);
        expect(r.concepts).toEqual(["Pricing"]);
    });

    it("works with no lookup supplied", async () => {
        const r = await resolveConcepts({ organizationId: 1, url: "https://acme.com/p", fallbackThemes: ["T"] });
        expect(r.source).toBe("fallback");
        expect(r.concepts).toEqual(["T"]);
    });
});
