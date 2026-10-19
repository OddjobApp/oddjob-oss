/**
 * @oddjob/design-system
 *
 * Unified design system for Oddjob UI components.
 * Exports tokens, icons, and design utilities.
 */

// Tokens
export * from "./tokens";

// Icons
export * from "./icons";

// Hooks
export * from "./hooks/index";

// Components
export * from "./components/MetricSummaryCard";
export * from "./components/FormalLayout";
export * from "./components/ActionCardShell";
export * from "./components/PlaceholderPreview";

// Type exports
export type { LucideIcon } from "lucide-react";

// Re-export lucide-react for convenience
export * from "lucide-react";
