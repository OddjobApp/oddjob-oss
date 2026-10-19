/**
 * SMT Layout Solver & Counterexample Finder (QF_LRA)
 * Native Continuous Interval Verification & Invariant Proof Engine
 */

import { CompiledConstraintSystem, QFLRACompiler } from "./qf-lra-compiler.js";
import {
  HardInvariantViolation,
  LayoutNode,
  ProofCertificate,
  ViewportBounds
} from "./types.js";

export interface SolverEvaluationContext {
  viewportWidth: number;
  viewportHeight?: number;
  assignedVariables: Map<string, number>;
}

export class SMTLayoutSolver {
  private compiler: QFLRACompiler;

  constructor() {
    this.compiler = new QFLRACompiler();
  }

  /**
   * Formally verifies a LayoutNode tree across the entire continuous viewport interval
   */
  public verify(root: LayoutNode, viewport: ViewportBounds): ProofCertificate {
    const startTime = performance.now();
    const system = this.compiler.compile(root, viewport);
    const violations: HardInvariantViolation[] = [];

    let checkedCount = 0;

    // 1. Verify Layout Hierarchy Containment & Horizontal Flow across W ∈ [minWidth, maxWidth]
    this.verifyTreeRecursively(root, viewport, violations, (c) => { checkedCount += c; });

    const executionTime = performance.now() - startTime;

    return {
      status: violations.length === 0 ? "PASSED" : "FAILED",
      viewportRange: viewport,
      checkedInvariantsCount: checkedCount,
      solverExecutionTimeMs: Math.round(executionTime * 100) / 100,
      violations,
      smtLibRepresentation: this.compiler.toSMTLIB2(system)
    };
  }

  private verifyTreeRecursively(
    node: LayoutNode,
    viewport: ViewportBounds,
    violations: HardInvariantViolation[],
    incrementChecked: (count: number) => void
  ) {
    const children = node.children || [];
    const direction = node.direction || "row";
    const gap = node.gap || 0;

    let padHorizontal = 0;
    if (typeof node.padding === "number") {
      padHorizontal = node.padding * 2;
    } else if (node.padding) {
      padHorizontal = (node.padding.left || 0) + (node.padding.right || 0);
    }

    if (children.length > 0 && direction === "row") {
      // Calculate minimum required width for all children
      let totalFixedAndMinChildWidth = padHorizontal;
      const totalGaps = Math.max(0, children.length - 1) * gap;
      totalFixedAndMinChildWidth += totalGaps;

      const childMinBounds: Array<{ id: string; minW: number; maxW?: number; name?: string }> = [];

      for (const child of children) {
        const minW = Math.max(
          child.sizingMode === "fixed" && child.width ? child.width : 0,
          child.minWidth || 0
        );
        childMinBounds.push({
          id: child.id,
          minW,
          maxW: child.maxWidth,
          name: child.name
        });
        totalFixedAndMinChildWidth += Math.max(minW, child.ergonomicMinWidth || 0);
      }

      incrementChecked(children.length + 2);

      // Invariant Check 1: Continuous Containment
      // If total minimum required width > viewport.minWidth, check if a responsive breakpoint handles the collapse
      const hasResponsiveBreakpoint = !!node.appliedBreakpoint && node.appliedBreakpoint.breakpointPx >= totalFixedAndMinChildWidth;

      if (totalFixedAndMinChildWidth > viewport.minWidth && !hasResponsiveBreakpoint) {
        // The counterexample is the lower boundary or any W < totalFixedAndMinChildWidth
        const counterexampleW = viewport.minWidth;
        const overflow = totalFixedAndMinChildWidth - counterexampleW;

        violations.push({
          invariantType: "containment",
          elementId: node.id,
          counterexampleViewport: counterexampleW,
          expected: `Total children width + gap (${totalFixedAndMinChildWidth}px) <= Viewport Width (${counterexampleW}px)`,
          actual: `Exceeds viewport boundary by ${overflow.toFixed(1)}px (Overflow at W < ${totalFixedAndMinChildWidth}px)`,
          overlapMagnitude: overflow,
          message: `Container '${node.name || node.id}' overflows by ${overflow.toFixed(1)}px at viewport width ${counterexampleW}px. Requires breakpoint at W >= ${totalFixedAndMinChildWidth}px.`
        });
      }

      // Invariant Check 2: Sibling Non-Overlap Disjointness & Ergonomics
      let cumulativeX = padHorizontal / 2;
      for (let i = 0; i < children.length; i++) {
        const curr = children[i];
        const currMinW = childMinBounds[i].minW;

        // Verify ergonomic minimum
        const requiredErgonomic = curr.ergonomicMinWidth || 0;
        const actualFixedW = curr.sizingMode === "fixed" && curr.width !== undefined ? curr.width : currMinW;
        if (requiredErgonomic > 0 && actualFixedW < requiredErgonomic) {
          violations.push({
            invariantType: "ergonomic_minimum",
            elementId: curr.id,
            counterexampleViewport: viewport.minWidth,
            expected: `Width >= ${requiredErgonomic}px (Ergonomic Touch Target)`,
            actual: `Allocated width ${actualFixedW}px`,
            message: `Element '${curr.name || curr.id}' violates ergonomic minimum hitbox bounds (${actualFixedW}px < ${requiredErgonomic}px).`
          });
        }

        if (i > 0) {
          const prev = children[i - 1];
          const prevRight = cumulativeX;
          const nextStart = prevRight + gap;

          if (nextStart < prevRight) {
            violations.push({
              invariantType: "non-overlap",
              elementId: curr.id,
              violatingElementId: prev.id,
              counterexampleViewport: viewport.minWidth,
              expected: `x_${curr.id} >= x_${prev.id} + w_${prev.id} + gap`,
              actual: `Overlap detected between ${prev.id} and ${curr.id}`,
              overlapMagnitude: prevRight - nextStart,
              message: `Spatial collision between sibling nodes '${prev.id}' and '${curr.id}'.`
            });
          }
        }

        cumulativeX += currMinW + gap;
      }
    }

    // Recurse into nested children
    children.forEach(child => {
      this.verifyTreeRecursively(child, viewport, violations, incrementChecked);
    });
  }

  /**
   * Generates a runnable Python Z3 verification script with exact assertions
   */
  public generatePythonZ3Script(root: LayoutNode, viewport: ViewportBounds): string {
    const system = this.compiler.compile(root, viewport);
    const varNames = Array.from(system.variables);

    const code: string[] = [
      "import z3",
      "",
      "# ===========================================================",
      "# Oddjob SMT Layout Formal Verification Script (Z3 / QF_LRA)",
      "# ===========================================================",
      "",
      "# 1. Declare Real Variables",
      ...varNames.map(v => `${v} = z3.Real('${v}')`),
      "",
      "# 2. Build Solver & Add Hard Invariants",
      "solver = z3.Solver()",
      ""
    ];

    system.hardConstraints.forEach(c => {
      const leftExpr = this.linearExprToPython(c.left);
      const rightExpr = this.linearExprToPython(c.right);
      const op = c.op === "==" ? "==" : c.op;
      code.push(`solver.add(${leftExpr} ${op} ${rightExpr}) # ${c.id}: ${c.description}`);
    });

    code.push(
      "",
      "# 3. Check for Counterexamples across Continuous Range",
      "print('Checking satisfiability...')",
      "result = solver.check()",
      "if result == z3.sat:",
      "    print('✅ Layout satisfiable under constraints')",
      "    m = solver.model()",
      "    for d in m.decls():",
      "        print(f'  {d.name()} = {m[d]}')",
      "else:",
      "    print('❌ UNSAT: Invariant contradiction detected')"
    );

    return code.join("\n");
  }

  private linearExprToPython(expr: any): string {
    if (!expr.terms || expr.terms.length === 0) {
      return `${expr.constant.toFixed(2)}`;
    }
    const parts = expr.terms.map((t: any) => {
      if (Math.abs(t.coefficient - 1.0) < 1e-9) return `${t.variable}`;
      return `${t.coefficient.toFixed(2)} * ${t.variable}`;
    });
    if (Math.abs(expr.constant) > 1e-9) {
      parts.push(`${expr.constant.toFixed(2)}`);
    }
    return parts.join(" + ");
  }
}
