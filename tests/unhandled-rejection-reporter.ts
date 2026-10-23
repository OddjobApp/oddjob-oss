import { expect } from "vitest";

/**
 * Name the test file behind each unhandled rejection.
 *
 * The integration run reports 9 rejections as `{ message: undefined, stacks: [] }`:
 * the reason is not an Error (a plain object, a value, or nothing), so Vitest can
 * say neither what nor where. Log the file, the running test, and the reason's
 * shape alongside its own report, so the next run points at the source.
 */
process.on("unhandledRejection", (reason: unknown) => {
    let where = "outside a test";
    try {
        const state = expect.getState();
        where = `${state.testPath ?? "unknown file"} :: ${state.currentTestName ?? "between tests"}`;
    } catch {
        // No test context: the rejection fired during collection or teardown.
    }
    const shape = reason === undefined ? "undefined"
        : reason === null ? "null"
        : typeof reason === "object" ? (reason as object).constructor?.name ?? "Object"
        : typeof reason;
    let detail: string;
    try {
        detail = reason instanceof Error
            ? `${reason.message}\n${reason.stack?.split("\n").slice(1, 6).join("\n") ?? ""}`
            : (JSON.stringify(reason) ?? String(reason)).slice(0, 500);
    } catch {
        detail = String(reason);
    }
    console.error(`[unhandled-rejection] ${where} (${shape}): ${detail}`);
});
