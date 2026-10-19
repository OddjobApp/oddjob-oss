/**
 * Re-export of the canonical primitive at client/src/components/ui/sidebar.
 *
 * This root kept a second copy that had drifted from client/src. Before
 * collapsing it, this copy's SidebarMenuSkeleton body was promoted into client/src, whose version rendered an empty self-closing div.
 *
 * The `@/` alias resolves to client/src for this root too, so existing
 * importers of @domain-ui/core/ui/components/ui/sidebar are unaffected.
 */
export * from "@/components/ui/sidebar";
