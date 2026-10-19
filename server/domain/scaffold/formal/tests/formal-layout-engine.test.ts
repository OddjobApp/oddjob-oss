import { describe, it, expect } from "vitest";
import { QFLRACompiler } from "../qf-lra-compiler.js";
import { SMTLayoutSolver } from "../smt-layout-solver.js";
import { MaxSMTSynthesizer } from "../maxsmt-synthesizer.js";
import { layoutFormalService } from "../layout-formal.service.js";
import { layoutVerificationEvaluator } from "../../../knowledge/core/calculations/evaluators/layout-verification.evaluator.js";
import { QAService } from "../../../qa/services/qa.service.js";
import { LayoutNode, ViewportBounds } from "../types.js";

describe("Formal Layout Verification & Synthesis Engine (QF_LRA / MaxSMT)", () => {
  const desktopViewport: ViewportBounds = {
    minWidth: 1024,
    maxWidth: 1920
  };

  const responsiveViewport: ViewportBounds = {
    minWidth: 320,
    maxWidth: 1920
  };

  describe("QFLRACompiler & SMT-LIB2 Generation", () => {
    it("should compile a node tree into linear constraints and valid SMT-LIB2 format", () => {
      const compiler = new QFLRACompiler();
      const tree: LayoutNode = {
        id: "app_root",
        direction: "row",
        gap: 16,
        padding: 24,
        children: [
          {
            id: "sidebar",
            sizingMode: "fixed",
            width: 260,
            ergonomicMinWidth: 48
          },
          {
            id: "main_content",
            sizingMode: "fluid",
            minWidth: 400,
            targetWidth: 600,
            targetWeight: 10
          }
        ]
      };

      const system = compiler.compile(tree, desktopViewport);
      expect(system.variables.has("W_viewport")).toBe(true);
      expect(system.variables.has("w_sidebar")).toBe(true);
      expect(system.variables.has("w_main_content")).toBe(true);
      expect(system.hardConstraints.length).toBeGreaterThan(5);

      const smtLib = compiler.toSMTLIB2(system);
      expect(smtLib).toContain("(set-logic QF_LRA)");
      expect(smtLib).toContain("(declare-fun W_viewport () Real)");
      expect(smtLib).toContain("(check-sat)");
    });
  });

  describe("SMT Invariant Verification & Counterexample Discovery", () => {
    const solver = new SMTLayoutSolver();

    it("should PASS verification when layout satisfies all invariants across desktop viewport", () => {
      const validTree: LayoutNode = {
        id: "desktop_shell",
        direction: "row",
        gap: 16,
        padding: 16,
        children: [
          {
            id: "nav",
            sizingMode: "fixed",
            width: 240,
            minWidth: 240
          },
          {
            id: "editor",
            sizingMode: "fluid",
            minWidth: 400
          }
        ]
      };

      // 240 (nav) + 400 (editor) + 16 (gap) + 32 (padding) = 688px <= 1024px min desktop
      const proof = solver.verify(validTree, desktopViewport);
      expect(proof.status).toBe("PASSED");
      expect(proof.violations.length).toBe(0);
      expect(proof.checkedInvariantsCount).toBeGreaterThan(0);
    });

    it("should FAIL and find exact counterexample when 3-column layout overflows mobile viewport", () => {
      const overflowingTree: LayoutNode = {
        id: "three_column_dashboard",
        name: "3-Column Workspace",
        direction: "row",
        gap: 16,
        padding: 16,
        children: [
          {
            id: "left_sidebar",
            name: "Left Sidebar",
            sizingMode: "fixed",
            width: 260
          },
          {
            id: "main_canvas",
            name: "Main Canvas",
            sizingMode: "fluid",
            minWidth: 400
          },
          {
            id: "right_inspector",
            name: "Right Inspector",
            sizingMode: "fixed",
            width: 300
          }
        ]
      };

      // Minimum required = 260 + 400 + 300 + (2 * 16) + (2 * 16) = 1024px
      // On responsive spectrum W ∈ [320, 1920], it fails at W < 1024px
      const proof = solver.verify(overflowingTree, responsiveViewport);
      expect(proof.status).toBe("FAILED");
      expect(proof.violations.length).toBeGreaterThan(0);

      const containmentViolation = proof.violations.find(v => v.invariantType === "containment");
      expect(containmentViolation).toBeDefined();
      expect(containmentViolation?.counterexampleViewport).toBe(320);
      expect(containmentViolation?.overlapMagnitude).toBe(1024 - 320); // 704px overflow
    });

    it("should detect ergonomic hitbox violations for undersized interactive elements", () => {
      const undersizedTree: LayoutNode = {
        id: "touch_toolbar",
        direction: "row",
        children: [
          {
            id: "icon_button",
            name: "Delete Button",
            sizingMode: "fixed",
            width: 24, // Violates 48px ergonomic minimum touch target
            ergonomicMinWidth: 48
          }
        ]
      };

      const proof = solver.verify(undersizedTree, desktopViewport);
      expect(proof.status).toBe("FAILED");
      const ergoViolation = proof.violations.find(v => v.invariantType === "ergonomic_minimum");
      expect(ergoViolation).toBeDefined();
      expect(ergoViolation?.elementId).toBe("icon_button");
    });
  });

  describe("MaxSMT Synthesizer & Closed-Form CSS Generation", () => {
    const synthesizer = new MaxSMTSynthesizer();

    it("should synthesize mathematical clamp() CSS rules and repair layout", () => {
      const treeToRepair: LayoutNode = {
        id: "fluid_app_view",
        direction: "row",
        gap: 16,
        padding: 16,
        children: [
          {
            id: "side_panel",
            sizingMode: "fixed",
            width: 250
          },
          {
            id: "content_panel",
            sizingMode: "fluid",
            minWidth: 400,
            targetWidth: 800,
            targetWeight: 5
          }
        ]
      };

      const repair = synthesizer.synthesize(treeToRepair, desktopViewport);
      expect(repair.success).toBe(true);
      expect(repair.proof.status).toBe("PASSED");
      expect(repair.synthesizedRules.length).toBe(2);

      const fluidRule = repair.synthesizedRules.find(r => r.elementId === "content_panel");
      expect(fluidRule).toBeDefined();
      expect(fluidRule?.cssRule).toContain("clamp(");
      expect(fluidRule?.cssRule).toContain("vw");

      // Verify generated stylesheet contains proper CSS
      expect(repair.cssStylesheet).toContain("#fluid_app_view {");
      expect(repair.cssStylesheet).toContain("#content_panel {");
      expect(repair.cssStylesheet).toContain("clamp(");
    });
  });

  describe("Unified Service & Knowledge Graph Evaluator Integration", () => {
    it("should execute via layoutFormalService facade", () => {
      const tree: LayoutNode = {
        id: "forge_component",
        direction: "row",
        children: [
          { id: "left", sizingMode: "fixed", width: 200 },
          { id: "right", sizingMode: "fluid", minWidth: 300 }
        ]
      };

      const result = layoutFormalService.verifyAndSynthesize(tree, desktopViewport);
      expect(result.certificate.status).toBe("PASSED");
    });

    it("should evaluate layout within Knowledge Graph calculation engine", () => {
      const tree: LayoutNode = {
        id: "kg_node_layout",
        direction: "row",
        children: [
          { id: "box1", sizingMode: "fixed", width: 100 },
          { id: "box2", sizingMode: "fixed", width: 150 }
        ]
      };

      const evalResult = layoutVerificationEvaluator.evaluateLayout(tree, desktopViewport);
      expect(evalResult.passed).toBe(true);
      expect(evalResult.complianceScore).toBe(100);

      // Fast containment check helper
      // 200 + 300 + 150 + 32 (gap) + 40 (padding) = 722 <= 800 -> true
      const fits = layoutVerificationEvaluator.validateContainment(800, [200, 300, 150], 16, 20);
      expect(fits).toBe(true);

      // 300 + 500 + 20 (gap) + 40 (padding) = 860 > 800 -> false
      const doesNotFit = layoutVerificationEvaluator.validateContainment(800, [300, 500], 20, 20);
      expect(doesNotFit).toBe(false);
    });

    it("should run pre-flight QA check via QAService", () => {
      const tree: LayoutNode = {
        id: "qa_target_view",
        direction: "row",
        gap: 12,
        children: [
          { id: "col1", sizingMode: "fixed", width: 300 },
          { id: "col2", sizingMode: "fluid", minWidth: 400 }
        ]
      };

      const qaResult = QAService.verifyLayoutFormally(tree, desktopViewport);
      expect(qaResult.passed).toBe(true);
      expect(qaResult.summary).toContain("Formal QA Passed");
    });
  });
});
