/**
 * Re-export of the canonical primitive at client/src/components/ui/aspect-ratio.
 *
 * This was a byte-identical second copy. Two copies of one primitive meant
 * either root could be edited alone and silently diverge — which is what
 * happened to button, dialog, sheet and others. The `@/` alias resolves to
 * client/src for this root as well (these files already imported @/lib/utils),
 * so existing importers of @domain-ui/core/ui/components/ui/aspect-ratio are unaffected.
 */
export * from "@/components/ui/aspect-ratio";
