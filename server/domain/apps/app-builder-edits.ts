/**
 * Normalization of the AI's edit payload into `{ filePath: fileContent }`.
 *
 * Kept out of app-builder.service.ts so it can be tested without dragging in
 * the database, the AI clients, and the forge validator.
 */

/**
 * Pull the file body out of one entry of an LLM edit list.
 *
 * Checks each key for a string rather than `a || b || c`: truncating a file to
 * "" is a legitimate edit, and `||` fell through to the next key and dropped
 * the entry entirely.
 */
function entryContent(item: any): string | undefined {
    for (const key of ["content", "code", "body"]) {
        const v = item?.[key];
        if (typeof v === "string") return v;
    }
    return undefined;
}

/** `[{ path, content }, ...]` -> `{ path: content }`. */
function fromEntryList(list: any[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const item of list) {
        const filePath = item?.path ?? item?.file ?? item?.filename;
        const content = entryContent(item);
        if (typeof filePath === "string" && filePath && content !== undefined) {
            out[filePath] = content;
        }
    }
    return out;
}

/** `{ path: content | { content } }` -> `{ path: content }`. */
function fromPathMap(map: Record<string, any>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, val] of Object.entries(map)) {
        if (typeof val === "string") {
            out[key] = val;
        } else if (val && typeof val === "object") {
            const nested = entryContent(val);
            if (nested !== undefined) out[key] = nested;
        }
    }
    return out;
}

/**
 * Normalize an AI edit payload into `{ filePath: fileContent }`.
 *
 * Models return this shape several ways: a bare path map, a list of
 * `{ path, content }` entries, or either of those nested under `files` or
 * `edits`. Both wrapper keys go through the same two branches — an earlier
 * version array-handled `files` but not `edits`, so an `edits` array fell into
 * the path-map branch and produced files literally named "0" and "1".
 */
export function normalizeEdits(raw: any): Record<string, string> {
    if (Array.isArray(raw)) return fromEntryList(raw);
    if (!raw || typeof raw !== "object") return {};

    // Single edit object, e.g. { path: "pages/index.tsx", content: "..." }
    if ((raw.path || raw.file || raw.filename) && entryContent(raw) !== undefined) {
        return fromEntryList([raw]);
    }

    let body: any = raw;
    for (const wrapper of ["files", "edits"] as const) {
        if (raw[wrapper] && typeof raw[wrapper] === "object") {
            body = raw[wrapper];
            break;
        }
    }

    return Array.isArray(body) ? fromEntryList(body) : fromPathMap(body);
}
