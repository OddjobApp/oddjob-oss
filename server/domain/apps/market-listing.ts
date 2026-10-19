/**
 * Whether a public app belongs on the marketplace shelf. The shelf holds
 * platform built-ins and listings only: a "custom" app is one org's own install
 * copy (Org Forge marks those public too), so listing it shows every tenant a
 * duplicate of the standard app it came from, under another org's name.
 * Scaffold rows opt out with `AppConfig.hiddenFromMarket`.
 */
export function listedInMarket(app: { distribution?: string | null; config?: unknown }): boolean {
    if (app.distribution === "custom") return false;
    return (app.config as { hiddenFromMarket?: unknown } | null | undefined)?.hiddenFromMarket !== true;
}
