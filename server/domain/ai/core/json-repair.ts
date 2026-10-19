/**
 * Robust JSON extraction + repair for LLM output.
 *
 * LLMs frequently wrap JSON in ```json fences, append prose, emit trailing
 * commas, or get truncated mid-object (token limit). This mirrors the
 * "produce/repair valid JSON" behavior of function-calling-tuned models
 * (e.g. Hermes 4.3) so the rest of the platform can rely on structured output.
 *
 * Strategy: strip fences → locate the first JSON value → try parse → apply a
 * series of repairs (balance brackets for truncation, drop trailing commas,
 * cut trailing prose) → try again. Returns null only if unrecoverable.
 */

/** Walk `s` from the first `open` bracket and return the substring through its
 *  matching close. If the input was truncated (never closes), append the missing
 *  closing brackets so the value can still parse. String/escape aware. */
function balanceFromFirst(s: string): string | null {
    const firstObj = s.indexOf("{");
    const firstArr = s.indexOf("[");
    if (firstObj === -1 && firstArr === -1) return null;
    const start =
        firstArr !== -1 && (firstObj === -1 || firstArr < firstObj) ? firstArr : firstObj;

    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "{" || ch === "[") stack.push(ch);
        else if (ch === "}" || ch === "]") {
            stack.pop();
            if (stack.length === 0) {
                end = i;
                break;
            }
        }
    }

    if (end !== -1) return s.slice(start, end + 1);

    // Truncated: close any still-open brackets (in reverse) after trimming a
    // dangling partial token / trailing comma.
    let partial = s.slice(start).replace(/,\s*$/, "");
    if (inString) partial += '"';
    const closers = stack.reverse().map((b) => (b === "{" ? "}" : "]"));
    return partial + closers.join("");
}

function dropTrailingCommas(s: string): string {
    return s.replace(/,\s*([}\]])/g, "$1");
}

export function extractJson<T = any>(raw: string | null | undefined): T | null {
    if (!raw) return null;
    let s = String(raw).trim();
    // Strip markdown code fences, including unterminated ones.
    s = s.replace(/```json/gi, "").replace(/```/g, "").trim();

    const attempts: string[] = [];
    attempts.push(s);
    const balanced = balanceFromFirst(s);
    if (balanced) {
        attempts.push(balanced);
        attempts.push(dropTrailingCommas(balanced));
    }

    for (const a of attempts) {
        try {
            return JSON.parse(a) as T;
        } catch {
            /* try next repair */
        }
    }
    return null;
}
