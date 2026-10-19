/**
 * Formal Layout Verification & Synthesis Engine Types
 * Quantifier-Free Linear Real Arithmetic (QF_LRA) & MaxSMT Formulations
 */

export interface ViewportBounds {
  minWidth: number;
  maxWidth: number;
  minHeight?: number;
  maxHeight?: number;
}

export type LayoutFlowDirection = "row" | "column" | "grid";
export type SizingMode = "fixed" | "fluid" | "fit-content";

export interface LayoutNode {
  id: string;
  name?: string;
  direction?: LayoutFlowDirection;
  sizingMode?: SizingMode;
  
  // Dimensions and Coordinates (Base Tokens)
  x?: number;
  y?: number;
  width?: number;
  height?: number;

  // Hard Invariant Bounds
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;

  // Ergonomic Minimums (e.g. 48px touch targets)
  ergonomicMinWidth?: number;
  ergonomicMinHeight?: number;

  // Flexbox / Grid Parameters
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number;
  gridSpan?: number;

  // Spacing
  padding?: number | { top?: number; right?: number; bottom?: number; left?: number };
  gap?: number;

  // Soft Design Target & Optimization Weight
  targetWidth?: number;
  targetHeight?: number;
  targetWeight?: number; // Priority penalty weight ω_i in MaxSMT

  // Synthesized Breakpoints
  appliedBreakpoint?: { breakpointPx: number; fallbackRule: string };

  // Tree Hierarchy
  children?: LayoutNode[];
}

export interface LinearTerm {
  coefficient: number; // multiplier for variable
  variable: string;    // variable name, e.g., 'W', 'w_sidebar', 'x_main'
}

export interface LinearExpression {
  terms: LinearTerm[];
  constant: number;
}

export type RelationalOperator = "<=" | ">=" | "==" | "<" | ">";

export interface LinearConstraint {
  id: string;
  description: string;
  left: LinearExpression;
  op: RelationalOperator;
  right: LinearExpression;
  isHard: boolean;
  weight?: number; // For soft constraints in MaxSMT
}

export interface HardInvariantViolation {
  invariantType: "containment" | "non-overlap" | "ergonomic_minimum" | "custom";
  elementId: string;
  violatingElementId?: string;
  counterexampleViewport: number;
  expected: string;
  actual: string;
  overlapMagnitude?: number;
  message: string;
}

export interface ProofCertificate {
  status: "PASSED" | "FAILED";
  viewportRange: ViewportBounds;
  checkedInvariantsCount: number;
  solverExecutionTimeMs: number;
  violations: HardInvariantViolation[];
  smtLibRepresentation?: string;
}

export interface SynthesizedDimensionRule {
  elementId: string;
  property: "width" | "height" | "grid-template-columns";
  cssRule: string; // e.g. "clamp(240px, 25vw, 320px)"
  min: number;
  idealPercentVw?: number;
  idealBasePx?: number;
  max: number;
  appliedBreakpoint?: {
    breakpointPx: number;
    fallbackRule: string;
  };
}

export interface SynthesizedRepair {
  success: boolean;
  totalDistortionPenalty: number;
  repairedNodes: Map<string, { width?: number; height?: number; cssClamp?: string }>;
  synthesizedRules: SynthesizedDimensionRule[];
  cssStylesheet: string;
  proof: ProofCertificate;
}
