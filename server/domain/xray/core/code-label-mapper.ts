/**
 * Code Label Mapper
 *
 * Bridges the two label vocabularies that grew up around the System Graph:
 *
 *  - `systemKnowledgeService` (regex scanners) emits domain labels the admin UI
 *    knows how to filter on: Service, API_Route, Component, Page, Schema_Model…
 *  - `codeParserService` (AST) emits structural kinds: code_file, code_function,
 *    code_class, code_interface, code_method.
 *
 * The AST parser is the better source of truth, but swapping its raw kinds in
 * would replace the categories operators actually filter by. So file-level nodes
 * are mapped onto the existing domain vocabulary, while symbol-level nodes keep
 * their structural kind — the depth the regex scanners never had.
 */

import type { CodeNodeKind } from "./code-parser.service.js";

/**
 * Labels the admin System Graph page lists in its filter panel. Anything
 * emitted outside this set still renders (the panel derives its options from
 * live node labels) but lands outside the curated categories.
 */
export type DomainLabel =
    | "Service"
    | "API_Route"
    | "Schema_Model"
    | "Component"
    | "Page"
    | "Module"
    | "Infrastructure";

export type MappedLabel = DomainLabel | CodeNodeKind;

/**
 * Ordered path rules. First match wins, so the more specific patterns
 * (schema, routes) must precede the general ones (any .tsx is a Component).
 */
const FILE_RULES: Array<{ test: RegExp; label: DomainLabel }> = [
    // Database schema definitions.
    { test: /^shared\/schema\//, label: "Schema_Model" },
    // HTTP surfaces — both the co-located *.route.ts convention and server/routes/.
    { test: /\.route\.ts$/, label: "API_Route" },
    { test: /^server\/routes\//, label: "API_Route" },
    { test: /\.controller\.ts$/, label: "API_Route" },
    // Business logic.
    { test: /\.service\.ts$/, label: "Service" },
    // UI: pages before components, since a page is also under a ui/ tree.
    { test: /\/pages\/[^/]+\.tsx$/, label: "Page" },
    { test: /\/components\/.*\.tsx$/, label: "Component" },
    { test: /\/modules\/.*\.tsx$/, label: "Module" },
    // Wiring and process boundaries.
    { test: /^server\/(infrastructure|workers)\//, label: "Infrastructure" },
    { test: /\/infrastructure\/[^/]+\.ts$/, label: "Infrastructure" },
];

/**
 * Map a parsed node to the label it should be stored under.
 *
 * @param kind     Structural kind from the AST parser.
 * @param filePath Repo-relative, posix-separated path.
 * @param data     Parser payload; `type: "api_route"` marks an extracted route.
 */
export function mapCodeNodeLabel(
    kind: CodeNodeKind,
    filePath: string,
    data?: Record<string, any>,
): MappedLabel {
    // An extracted route is an API_Route regardless of which file it lives in —
    // the parser repurposes code_function for these.
    if (data?.type === "api_route") return "API_Route";

    // Symbol-level nodes keep their structural kind. Labelling every function in
    // a service file as "Service" would produce dozens of nodes claiming to be
    // the service itself; the old scanner created exactly one per file.
    if (kind !== "code_file") return kind;

    const normalized = filePath.replace(/\\/g, "/");
    for (const rule of FILE_RULES) {
        if (rule.test.test(normalized)) return rule.label;
    }
    return "code_file";
}

/**
 * True when a label belongs to the curated domain vocabulary rather than the
 * structural one. Useful for callers that want only file-level architecture.
 */
export function isDomainLabel(label: string): label is DomainLabel {
    return (
        label === "Service" ||
        label === "API_Route" ||
        label === "Schema_Model" ||
        label === "Component" ||
        label === "Page" ||
        label === "Module" ||
        label === "Infrastructure"
    );
}
