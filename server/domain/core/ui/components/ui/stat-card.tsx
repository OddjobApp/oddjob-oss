/**
 * Re-export of the canonical primitive at client/src/components/ui/stat-card.
 *
 * This root kept a second copy that had drifted from client/src. Before
 * collapsing it, client/src already had the superset props (optional description, string|number value), so it is the canonical one here.
 *
 * The `@/` alias resolves to client/src for this root too, so existing
 * importers of @domain-ui/core/ui/components/ui/stat-card are unaffected.
 */
export * from "@/components/ui/stat-card";
