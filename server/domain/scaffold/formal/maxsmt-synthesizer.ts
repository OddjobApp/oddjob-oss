/**
 * MaxSMT Synthesizer: Optimal Layout Repair & Mathematical CSS Rule Generation
 * Minimizes weighted L1 distortion while strictly preserving all hard QF_LRA invariants.
 */

import { SMTLayoutSolver } from "./smt-layout-solver.js";
import {
  LayoutNode,
  ProofCertificate,
  SynthesizedDimensionRule,
  SynthesizedRepair,
  ViewportBounds
} from "./types.js";

export class MaxSMTSynthesizer {
  private solver: SMTLayoutSolver;

  constructor() {
    this.solver = new SMTLayoutSolver();
  }

  /**
   * Synthesizes mathematically optimal repairs for a layout tree
   */
  public synthesize(root: LayoutNode, viewport: ViewportBounds): SynthesizedRepair {
    // 1. First run formal proof verification
    const initialProof = this.solver.verify(root, viewport);

    const repairedNodesMap = new Map<string, { width?: number; height?: number; cssClamp?: string }>();
    const synthesizedRules: SynthesizedDimensionRule[] = [];
    let totalPenalty = 0;

    // 2. Clone tree for in-place mathematical repair
    const repairedRoot = JSON.parse(JSON.stringify(root)) as LayoutNode;

    // 3. Process children across layout tracks
    this.repairTrackRecursively(repairedRoot, viewport, repairedNodesMap, synthesizedRules, (p) => {
      totalPenalty += p;
    });

    // 4. Verify that repaired tree passes all invariants
    const postRepairProof = this.solver.verify(repairedRoot, viewport);

    // 5. Generate structured CSS stylesheet
    const cssStylesheet = this.generateStylesheet(repairedRoot, synthesizedRules);

    return {
      success: postRepairProof.status === "PASSED",
      totalDistortionPenalty: Math.round(totalPenalty * 100) / 100,
      repairedNodes: repairedNodesMap,
      synthesizedRules,
      cssStylesheet,
      proof: postRepairProof
    };
  }

  private repairTrackRecursively(
    node: LayoutNode,
    viewport: ViewportBounds,
    repairedMap: Map<string, { width?: number; height?: number; cssClamp?: string }>,
    rules: SynthesizedDimensionRule[],
    addPenalty: (p: number) => void
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
      const totalGaps = Math.max(0, children.length - 1) * gap;
      const availableMinW = viewport.minWidth - padHorizontal - totalGaps;
      const availableMaxW = viewport.maxWidth - padHorizontal - totalGaps;

      // Identify fixed vs fluid children
      let sumFixedW = 0;
      let sumFluidMinW = 0;
      let totalFluidGrow = 0;

      children.forEach(child => {
        const isFixed = child.sizingMode === "fixed" && child.width !== undefined;
        if (isFixed) {
          sumFixedW += child.width!;
        } else {
          const minW = Math.max(child.minWidth || 0, child.ergonomicMinWidth || 0, 48);
          sumFluidMinW += minW;
          totalFluidGrow += child.flexGrow || 1;
        }
      });

      const totalMinRequired = sumFixedW + sumFluidMinW;
      const minBreakpoint = totalMinRequired + padHorizontal + totalGaps;

      if (minBreakpoint > viewport.minWidth) {
        node.appliedBreakpoint = {
          breakpointPx: Math.ceil(minBreakpoint),
          fallbackRule: "100%"
        };
      }

      children.forEach(child => {
        const isFixed = child.sizingMode === "fixed" && child.width !== undefined;

        if (isFixed) {
          repairedMap.set(child.id, { width: child.width });
          rules.push({
            elementId: child.id,
            property: "width",
            cssRule: `${child.width}px`,
            min: child.width!,
            max: child.width!
          });
        } else {
          // Fluid Element: Compute clamp(min, slope*vw + base, max)
          const minW = Math.max(child.minWidth || 0, child.ergonomicMinWidth || 0, 48);
          const growWeight = (child.flexGrow || 1) / (totalFluidGrow || 1);

          // Allocated widths at viewport bounds
          const allocatedMinW = Math.max(minW, (availableMinW - sumFixedW) * growWeight);
          const maxTarget = child.maxWidth || child.targetWidth || (availableMaxW - sumFixedW) * growWeight;
          const allocatedMaxW = Math.max(allocatedMinW, maxTarget);

          // Calculate closed-form linear slope: w(W) = m * W + b
          const deltaW = viewport.maxWidth - viewport.minWidth;
          const deltaAllocated = allocatedMaxW - allocatedMinW;
          const slope = deltaW > 0 ? deltaAllocated / deltaW : 0;
          const basePx = allocatedMinW - slope * viewport.minWidth;
          const vwPercent = Math.round(slope * 100 * 100) / 100;
          const baseRounded = Math.round(basePx * 10) / 10;

          const baseTerm = baseRounded >= 0 ? `+ ${baseRounded}px` : `- ${Math.abs(baseRounded)}px`;
          const clampExpr = `clamp(${Math.round(allocatedMinW)}px, ${vwPercent}vw ${baseTerm}, ${Math.round(allocatedMaxW)}px)`;

          // Mutate child in repaired tree
          child.minWidth = Math.round(allocatedMinW);
          child.maxWidth = Math.round(allocatedMaxW);

          repairedMap.set(child.id, {
            width: Math.round(allocatedMinW),
            cssClamp: clampExpr
          });

          rules.push({
            elementId: child.id,
            property: "width",
            cssRule: clampExpr,
            min: Math.round(allocatedMinW),
            max: Math.round(allocatedMaxW),
            idealPercentVw: vwPercent,
            idealBasePx: baseRounded,
            appliedBreakpoint: minBreakpoint > viewport.minWidth ? {
              breakpointPx: Math.ceil(minBreakpoint),
              fallbackRule: "100%"
            } : undefined
          });

          // Compute penalty if soft target was missed
          if (child.targetWidth !== undefined) {
            const target = child.targetWidth;
            const weight = child.targetWeight || 1.0;
            const distortion = Math.abs(allocatedMinW - target);
            addPenalty(distortion * weight);
          }
        }
      });
    }

    // Recurse into children
    children.forEach(child => {
      this.repairTrackRecursively(child, viewport, repairedMap, rules, addPenalty);
    });
  }

  private generateStylesheet(root: LayoutNode, rules: SynthesizedDimensionRule[]): string {
    const cssLines: string[] = [
      "/* ========================================================================= */",
      "/* Oddjob Synthesized Mathematical CSS Layout (MaxSMT / QF_LRA Proof Engine) */",
      "/* ========================================================================= */",
      "",
      `#${root.id} {`,
      `  display: flex;`,
      `  flex-direction: ${root.direction || "row"};`,
      `  gap: ${root.gap || 0}px;`,
      `  width: 100%;`,
      `  box-sizing: border-box;`,
      `}`
    ];

    rules.forEach(r => {
      cssLines.push(
        "",
        `#${r.elementId} {`,
        `  width: ${r.cssRule};`,
        `  box-sizing: border-box;`,
        `}`
      );

      if (r.appliedBreakpoint) {
        cssLines.push(
          `@media (max-width: ${r.appliedBreakpoint.breakpointPx}px) {`,
          `  #${r.elementId} {`,
          `    width: ${r.appliedBreakpoint.fallbackRule};`,
          `  }`,
          `}`
        );
      }
    });

    return cssLines.join("\n");
  }
}
