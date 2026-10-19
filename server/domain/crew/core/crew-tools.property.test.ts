/**
 * Property-Based Tests: Crew tool admission and schema sanitising.
 *
 * `classifyReadOnly` is a security boundary — it decides which tools an agent
 * may invoke mid-discussion. Its contract is DEFAULT-DENY, which example-based
 * tests are poor at proving: they show that the cases someone thought of are
 * refused, not that nothing else slips through. These properties assert the
 * invariant over generated input instead.
 *
 * `sanitizeSchema` guards a different failure: Gemini rejects the whole request
 * on any key outside its OpenAPI subset, so one unsanitised property silences an
 * entire round.
 *
 * Uses fast-check with a minimum of 100 iterations per property.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { z } from "zod";
import {
    classifyReadOnly,
    sanitizeSchema,
    extractBalancedJson,
    detectArtifact,
    detectOntologyArtifact,
    RICH_PAYLOAD_TYPES,
    ARTIFACT_TOOLS,
    UNIVERSAL_PRESENTATION_TOOLS,
} from "./crew-tools.service.js";
import type { ToolDefinition } from "@domain/tools/v1/capabilities/types.js";
import { COPILOT_TOOLS } from "@shared/constants/agent-personas.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tool(overrides: Partial<ToolDefinition> & { name: string }): ToolDefinition {
    return {
        description: "test tool",
        parameters: z.object({}),
        execute: async () => null,
        ...overrides,
    } as ToolDefinition;
}

/** Verbs that mark a tool as acting on the world. */
const WRITE_VERBS = [
    "create", "update", "delete", "write", "post", "send", "publish", "trigger",
    "run", "execute", "provision", "install", "deploy", "modify", "set", "add",
    "remove", "move", "upsert", "launch", "approve", "assign", "close", "merge",
    "start", "stop", "cancel", "kill", "reset", "sync", "import", "export",
    "generate", "build", "apply", "invite", "grant", "revoke",
];

const READ_VERBS = ["get", "list", "search", "read", "query", "find", "describe", "fetch"];

const NOUNS = ["file", "pipeline", "issue", "document", "user", "repo", "dataset", "job"];

// ─── classifyReadOnly ─────────────────────────────────────────────────────────

describe("classifyReadOnly — default-deny admission", () => {
    it("never admits a tool whose name contains a write verb", () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...WRITE_VERBS),
                fc.constantFrom(...NOUNS),
                fc.option(fc.constantFrom(...READ_VERBS), { nil: undefined }),
                (write, noun, read) => {
                    // Even with a read verb also present, a write verb disqualifies.
                    const name = read ? `${read}_${write}_${noun}` : `${write}_${noun}`;
                    return classifyReadOnly(tool({ name })) === null;
                },
            ),
            { numRuns: 200 },
        );
    });

    it("never admits an admin-gated tool, whatever its name suggests", () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...READ_VERBS),
                fc.constantFrom(...NOUNS),
                fc.constantFrom("adminOnly", "superAdminOnly"),
                (read, noun, gate) =>
                    classifyReadOnly(tool({ name: `${read}_${noun}`, [gate]: true })) === null,
            ),
            { numRuns: 100 },
        );
    });

    it("never admits a high-risk tool", () => {
        fc.assert(
            fc.property(fc.constantFrom(...READ_VERBS), fc.constantFrom(...NOUNS), (read, noun) =>
                classifyReadOnly(tool({ name: `${read}_${noun}`, riskLevel: "high" })) === null,
            ),
            { numRuns: 100 },
        );
    });

    it("never admits a tool with a disqualifying side effect", () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...READ_VERBS),
                fc.constantFrom(...NOUNS),
                fc.constantFrom("file-system", "email", "webhook", "container", "queue-message"),
                (read, noun, effect) =>
                    classifyReadOnly(
                        tool({ name: `${read}_${noun}`, sideEffects: [effect as never] }),
                    ) === null,
            ),
            { numRuns: 100 },
        );
    });

    it("never admits a tool explicitly declared non-idempotent", () => {
        fc.assert(
            fc.property(fc.constantFrom(...READ_VERBS), fc.constantFrom(...NOUNS), (read, noun) =>
                classifyReadOnly(tool({ name: `${read}_${noun}`, idempotency: "none" })) === null,
            ),
            { numRuns: 100 },
        );
    });

    it("refuses names carrying no read signal at all (default-deny)", () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 3, maxLength: 12 }).filter((s) => /^[a-z]+$/.test(s)),
                (blob) => {
                    const hasRead = READ_VERBS.some((v) => blob.includes(v));
                    const hasWrite = WRITE_VERBS.some((v) => blob.includes(v));
                    // Only assert the case with no signal either way.
                    if (hasRead || hasWrite) return true;
                    return classifyReadOnly(tool({ name: blob })) === null;
                },
            ),
            { numRuns: 200 },
        );
    });

    it("admits a plain read verb, and honours an explicit read-safe declaration", () => {
        expect(classifyReadOnly(tool({ name: "list_pipelines" }))).toBe("read-verb");
        expect(
            classifyReadOnly(tool({ name: "workspace_thing", idempotency: "read-safe" })),
        ).toBe("declared-read-safe");
    });

    it("admits artifact tools, which are not reads but render a surface", () => {
        expect(classifyReadOnly(tool({ name: "render_intake_form" }))).toBe("artifact");
        // ...while the write that would run one is still refused.
        expect(classifyReadOnly(tool({ name: "trigger_pipeline" }))).toBeNull();
    });

    it("refuses the known-dangerous tools by name", () => {
        for (const name of [
            "slack_post_message",
            "github_create_pr",
            "jira_create_bug",
            "file_write",
            "file_delete",
            "run_pipeline",
        ]) {
            expect(classifyReadOnly(tool({ name }))).toBeNull();
        }
    });
});

// ─── sanitizeSchema ───────────────────────────────────────────────────────────

const FORBIDDEN_KEYS = [
    "additionalProperties", "exclusiveMinimum", "exclusiveMaximum", "$schema",
    "definitions", "$ref", "default", "patternProperties", "allOf", "oneOf",
    "not", "const", "minLength", "maxLength", "pattern", "format",
];

/** Every key appearing anywhere in a nested object. */
function allKeys(value: unknown, acc: string[] = []): string[] {
    if (!value || typeof value !== "object") return acc;
    if (Array.isArray(value)) {
        for (const v of value) allKeys(v, acc);
        return acc;
    }
    for (const [k, v] of Object.entries(value)) {
        acc.push(k);
        allKeys(v, acc);
    }
    return acc;
}

describe("the Copilot's declared tools survive the crew gate", () => {
    // A rejected tool is not an error — it is simply absent from the turn. So a
    // Copilot that cannot open an app looks exactly like one that chose not to,
    // which is how the original "I cannot open the SDLC Workbench" reply
    // happened. This makes that failure loud at build time instead.
    it.each([...COPILOT_TOOLS])("admits %s", (name) => {
        expect(classifyReadOnly(tool({ name }))).not.toBeNull();
    });

    it("admits render_app_surface as an artifact, not by its name", () => {
        // "render" is neither a read nor a write token: the tool is admitted by
        // the explicit tier-2 allowlist. Renaming it would silently mute the
        // Copilot's whole reason for existing.
        expect(classifyReadOnly(tool({ name: "render_app_surface" }))).toBe("artifact");
    });

    it("still refuses a launch tool that actually acts on the world", () => {
        // The boundary the Copilot must not cross: presenting an app is fine,
        // starting one is a write.
        expect(classifyReadOnly(tool({ name: "launch_app" }))).toBeNull();
        expect(classifyReadOnly(tool({ name: "deploy_blueprint" }))).toBeNull();
    });
});

describe("sanitizeSchema — provider-safe function declarations", () => {
    it("never emits a key outside the accepted subset, at any depth", () => {
        const messy = fc.letrec((rec) => ({
            node: fc.oneof(
                { depthSize: "small" },
                fc.record({
                    type: fc.constantFrom("object", "string", "number", "array"),
                    additionalProperties: fc.boolean(),
                    $schema: fc.constant("http://json-schema.org/draft-07/schema#"),
                    exclusiveMinimum: fc.integer(),
                    description: fc.string(),
                }),
                fc.record({
                    type: fc.constant("object"),
                    additionalProperties: fc.boolean(),
                    properties: fc.dictionary(
                        fc.string({ minLength: 1, maxLength: 6 }),
                        rec("node") as fc.Arbitrary<unknown>,
                        { maxKeys: 3 },
                    ),
                }),
            ),
        })).node;

        fc.assert(
            fc.property(messy, (schema) => {
                const keys = allKeys(sanitizeSchema(schema));
                return !keys.some((k) => FORBIDDEN_KEYS.includes(k));
            }),
            { numRuns: 200 },
        );
    });

    it("collapses union types, which providers reject", () => {
        const out = sanitizeSchema({ type: ["number", "string"] });
        expect(Array.isArray(out.type)).toBe(false);
        expect(out.type).toBe("number");
    });

    it("marks nullable rather than emitting a null union member", () => {
        const out = sanitizeSchema({ type: ["string", "null"] });
        expect(out.type).toBe("string");
        expect(out.nullable).toBe(true);
    });

    it("always produces a declared type", () => {
        fc.assert(
            fc.property(fc.anything(), (v) => typeof sanitizeSchema(v).type === "string"),
            { numRuns: 200 },
        );
    });

    it("drops required entries whose property did not survive", () => {
        const out = sanitizeSchema({
            type: "object",
            properties: { kept: { type: "string" } },
            required: ["kept", "gone"],
        });
        expect(out.required).toEqual(["kept"]);
    });

    it("always emits items on arrays — Gemini 400s on a bare array schema", () => {
        // The live failure: external_sql_query.params and
        // aggregate_findings.sastFindings arrived as { type: "array" } with no
        // items, and Gemini rejected the entire 300-tool request.
        const out = sanitizeSchema({
            type: "object",
            properties: { params: { type: "array", description: "query params" } },
        });
        expect((out.properties as any).params.items).toBeDefined();
        expect((out.properties as any).params.type).toBe("array");
    });

    it("preserves a realistic zod-derived schema's shape", () => {
        const out = sanitizeSchema({
            type: "object",
            additionalProperties: false,
            $schema: "http://json-schema.org/draft-07/schema#",
            properties: {
                owner: { type: "string", description: "Repository owner" },
                limit: { type: "number", exclusiveMinimum: 0 },
            },
            required: ["owner"],
        });
        expect(out.type).toBe("object");
        expect(out.required).toEqual(["owner"]);
        expect((out.properties as any).owner.description).toBe("Repository owner");
        expect((out.properties as any).limit.type).toBe("number");
        expect(allKeys(out)).not.toContain("exclusiveMinimum");
    });
});

// ─── extractBalancedJson ──────────────────────────────────────────────────────

describe("extractBalancedJson — balanced scan, not a regex", () => {
    it("returns the WHOLE object when braces nest", () => {
        // The bug this replaces: a lazy /\{[\s\S]*?\}/ stops at the first inner
        // brace and leaves the payload's tail on screen as prose.
        const payload = '{"type":"instant_app","props":{"a":{"b":1}},"title":"x"}';
        const found = extractBalancedJson(`prose before ${payload} prose after`);
        expect(found).toBe(payload);
        expect(() => JSON.parse(found!)).not.toThrow();
    });

    it("round-trips arbitrary nested objects embedded in prose", () => {
        fc.assert(
            fc.property(
                fc.dictionary(
                    fc.string({ minLength: 1, maxLength: 5 }).filter((s) => /^[a-z]+$/.test(s)),
                    fc.oneof(fc.integer(), fc.boolean(), fc.constant<Record<string, number>>({ n: 1 })),
                    { minKeys: 1, maxKeys: 4 },
                ),
                (obj) => {
                    const json = JSON.stringify(obj);
                    const found = extractBalancedJson(`lead ${json} trail`);
                    return found !== null && JSON.stringify(JSON.parse(found)) === json;
                },
            ),
            { numRuns: 200 },
        );
    });

    it("is not fooled by braces inside strings", () => {
        const payload = '{"note":"a } brace in text","ok":true}';
        expect(extractBalancedJson(payload)).toBe(payload);
    });

    it("handles escaped quotes without terminating early", () => {
        const payload = '{"note":"he said \\"hi\\" }","ok":true}';
        expect(extractBalancedJson(payload)).toBe(payload);
    });

    it("returns null when there is no object or it never closes", () => {
        expect(extractBalancedJson("no json here")).toBeNull();
        expect(extractBalancedJson('{"unclosed": true')).toBeNull();
    });
});

// ─── detectArtifact ───────────────────────────────────────────────────────────

describe("detectArtifact — only known renderable payloads", () => {
    it("recognises a rich payload", () => {
        const out = detectArtifact(
            "render_intake_form",
            JSON.stringify({ type: "assistant_form", title: "Incident", schema: { fields: [] } }),
        );
        expect(out?.payload.type).toBe("assistant_form");
        expect(out?.tool).toBe("render_intake_form");
    });

    it("ignores JSON whose type is not a renderable surface", () => {
        fc.assert(
            fc.property(
                // Derived from the real set, never a hardcoded copy of it. A frozen
                // list here is what hid the Rich-UI drift: eight types that tools
                // actually emitted were absent from RICH_PAYLOAD_TYPES, and this
                // property asserted their absence was correct.
                fc.string({ minLength: 1, maxLength: 10 }).filter((s) => !RICH_PAYLOAD_TYPES.has(s)),
                (type) => detectArtifact("t", JSON.stringify({ type, data: 1 })) === null,
            ),
            { numRuns: 200 },
        );
    });

    // Every payload type a crew-reachable tool can emit must be detectable, or
    // the envelope reaches the user as prose. The first eight were the ones
    // that leaked; assistant_carousel joins the set the same way.
    it.each([
        "assistant_table",
        "assistant_chart",
        "assistant_list",
        "assistant_timeline",
        "assistant_progress",
        "assistant_tree",
        "assistant_comparison",
        "assistant_app_catalog",
        "assistant_carousel",
    ])("detects the Rich-UI payload %s", (type) => {
        expect(detectArtifact("render_x", JSON.stringify({ type, title: "t" }))?.payload.type).toBe(type);
    });

    it("admits every Rich-UI render tool as an artifact, so its payload is detected", () => {
        // Guards the other half of the pairing: a type in RICH_PAYLOAD_TYPES is
        // only reachable if the tool emitting it is also offered to the room.
        for (const name of ["render_table", "render_list", "render_tree", "render_comparison", "render_carousel", "render_timeline", "render_progress", "render_app_catalog"]) {
            expect(ARTIFACT_TOOLS.has(name), `${name} must be an artifact tool`).toBe(true);
            expect(UNIVERSAL_PRESENTATION_TOOLS, `${name} must be granted universally`).toContain(name);
        }
    });

    it("ignores plain text and malformed JSON", () => {
        expect(detectArtifact("t", "just a normal tool result")).toBeNull();
        expect(detectArtifact("t", '{"type":"instant_app"')).toBeNull();
    });
});

describe("detectOntologyArtifact", () => {
    it("turns traversal JSON into a structured room surface without changing the tool contract", () => {
        const artifact = detectOntologyArtifact("ontology_traverse_link", JSON.stringify({
            link: { sourceType: "Mission", name: "project_links", targetType: "Project Resource" },
            objects: [{ id: 7, name: "Project membership" }],
            complete: false,
        }));
        expect(artifact?.payload.type).toBe("ontology_traversal");
        expect(artifact?.payload.count).toBe(1);
        expect((artifact?.payload.data as any).complete).toBe(false);
    });

    it("does not reinterpret error text as a surface", () => {
        expect(detectOntologyArtifact("ontology_get_object", "Ontology Get Error: missing")).toBeNull();
    });
});
