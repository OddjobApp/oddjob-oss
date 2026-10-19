/**
 * Re-export of the canonical primitive at client/src/components/ui/alert-dialog.
 *
 * This root kept a second copy that had drifted from client/src. Before
 * collapsing it, this copy's light-mode design tokens were promoted into client/src, which still hardcoded bg-black/border-white.
 *
 * The `@/` alias resolves to client/src for this root too, so existing
 * importers of @domain-ui/core/ui/components/ui/alert-dialog are unaffected.
 */
export * from "@/components/ui/alert-dialog";
