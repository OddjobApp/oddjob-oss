/**
 * Re-export of the canonical primitive at client/src/components/ui/gauge.
 *
 * This root kept a second copy that had drifted from client/src. Before
 * collapsing it, the copies differed only in import style.
 *
 * The `@/` alias resolves to client/src for this root too, so existing
 * importers of @domain-ui/core/ui/components/ui/gauge are unaffected.
 */
export * from "@/components/ui/gauge";
