/**
 * QF_LRA Compiler: Translates UI Component Hierarchies into Linear Real Arithmetic Systems
 */

import {
  LayoutNode,
  LinearConstraint,
  LinearExpression,
  LinearTerm,
  ViewportBounds
} from "./types.js";

export interface CompiledConstraintSystem {
  variables: Set<string>;
  viewportBounds: ViewportBounds;
  hardConstraints: LinearConstraint[];
  softConstraints: LinearConstraint[];
  nodeVariableMap: Map<string, { x: string; y: string; w: string; h: string }>;
}

export class QFLRACompiler {
  /**
   * Helper to create a single-variable expression
   */
  public static varExpr(varName: string, coeff: number = 1.0): LinearExpression {
    return {
      terms: [{ variable: varName, coefficient: coeff }],
      constant: 0
    };
  }

  /**
   * Helper to create a constant expression
   */
  public static constExpr(val: number): LinearExpression {
    return {
      terms: [],
      constant: val
    };
  }

  /**
   * Add two linear expressions
   */
  public static addExpr(a: LinearExpression, b: LinearExpression): LinearExpression {
    const termsMap = new Map<string, number>();
    for (const t of a.terms) {
      termsMap.set(t.variable, (termsMap.get(t.variable) || 0) + t.coefficient);
    }
    for (const t of b.terms) {
      termsMap.set(t.variable, (termsMap.get(t.variable) || 0) + t.coefficient);
    }

    const terms: LinearTerm[] = [];
    termsMap.forEach((coeff, v) => {
      if (Math.abs(coeff) > 1e-9) {
        terms.push({ variable: v, coefficient: coeff });
      }
    });

    return {
      terms,
      constant: a.constant + b.constant
    };
  }

  /**
   * Subtract linear expression b from a (a - b)
   */
  public static subExpr(a: LinearExpression, b: LinearExpression): LinearExpression {
    const scaledB: LinearExpression = {
      terms: b.terms.map(t => ({ variable: t.variable, coefficient: -t.coefficient })),
      constant: -b.constant
    };
    return QFLRACompiler.addExpr(a, scaledB);
  }

  /**
   * Compiles a LayoutNode tree into a Quantifier-Free Linear Real Arithmetic system
   */
  public compile(root: LayoutNode, viewport: ViewportBounds): CompiledConstraintSystem {
    const variables = new Set<string>(["W_viewport", "H_viewport"]);
    const hardConstraints: LinearConstraint[] = [];
    const softConstraints: LinearConstraint[] = [];
    const nodeVariableMap = new Map<string, { x: string; y: string; w: string; h: string }>();

    // 1. Viewport range bounds
    hardConstraints.push({
      id: "bound_viewport_min_w",
      description: "Viewport width lower bound",
      left: QFLRACompiler.varExpr("W_viewport"),
      op: ">=",
      right: QFLRACompiler.constExpr(viewport.minWidth),
      isHard: true
    });
    hardConstraints.push({
      id: "bound_viewport_max_w",
      description: "Viewport width upper bound",
      left: QFLRACompiler.varExpr("W_viewport"),
      op: "<=",
      right: QFLRACompiler.constExpr(viewport.maxWidth),
      isHard: true
    });

    // 2. Set root node variables
    const rootVars = {
      x: `x_${root.id}`,
      y: `y_${root.id}`,
      w: `w_${root.id}`,
      h: `h_${root.id}`
    };
    nodeVariableMap.set(root.id, rootVars);
    [rootVars.x, rootVars.y, rootVars.w, rootVars.h].forEach(v => variables.add(v));

    // Root origin and dimensions match viewport
    hardConstraints.push({
      id: `root_origin_x_${root.id}`,
      description: "Root X anchored at 0",
      left: QFLRACompiler.varExpr(rootVars.x),
      op: "==",
      right: QFLRACompiler.constExpr(0),
      isHard: true
    });
    hardConstraints.push({
      id: `root_origin_y_${root.id}`,
      description: "Root Y anchored at 0",
      left: QFLRACompiler.varExpr(rootVars.y),
      op: "==",
      right: QFLRACompiler.constExpr(0),
      isHard: true
    });
    hardConstraints.push({
      id: `root_width_${root.id}`,
      description: "Root width matches viewport",
      left: QFLRACompiler.varExpr(rootVars.w),
      op: "==",
      right: QFLRACompiler.varExpr("W_viewport"),
      isHard: true
    });

    // 3. Recursively compile node tree
    this.compileNodeRecursive(root, variables, hardConstraints, softConstraints, nodeVariableMap);

    return {
      variables,
      viewportBounds: viewport,
      hardConstraints,
      softConstraints,
      nodeVariableMap
    };
  }

  private compileNodeRecursive(
    node: LayoutNode,
    variables: Set<string>,
    hardConstraints: LinearConstraint[],
    softConstraints: LinearConstraint[],
    nodeVariableMap: Map<string, { x: string; y: string; w: string; h: string }>
  ) {
    const parentVars = nodeVariableMap.get(node.id)!;
    const children = node.children || [];
    const direction = node.direction || "row";
    const gap = node.gap || 0;

    let padLeft = 0, padRight = 0, padTop = 0, padBottom = 0;
    if (typeof node.padding === "number") {
      padLeft = padRight = padTop = padBottom = node.padding;
    } else if (node.padding) {
      padLeft = node.padding.left || 0;
      padRight = node.padding.right || 0;
      padTop = node.padding.top || 0;
      padBottom = node.padding.bottom || 0;
    }

    // Register child variables
    children.forEach(child => {
      const childVars = {
        x: `x_${child.id}`,
        y: `y_${child.id}`,
        w: `w_${child.id}`,
        h: `h_${child.id}`
      };
      nodeVariableMap.set(child.id, childVars);
      [childVars.x, childVars.y, childVars.w, childVars.h].forEach(v => variables.add(v));

      // Ergonomic & Minimum Dimensions Invariants
      const minW = Math.max(child.minWidth || 0, child.ergonomicMinWidth || 0);
      if (minW > 0) {
        hardConstraints.push({
          id: `ergonomic_min_w_${child.id}`,
          description: `Ergonomic minimum width for ${child.id}`,
          left: QFLRACompiler.varExpr(childVars.w),
          op: ">=",
          right: QFLRACompiler.constExpr(minW),
          isHard: true
        });
      }

      if (child.maxWidth !== undefined) {
        hardConstraints.push({
          id: `max_w_${child.id}`,
          description: `Maximum width for ${child.id}`,
          left: QFLRACompiler.varExpr(childVars.w),
          op: "<=",
          right: QFLRACompiler.constExpr(child.maxWidth),
          isHard: true
        });
      }

      // Soft design token targets
      if (child.targetWidth !== undefined) {
        softConstraints.push({
          id: `soft_target_w_${child.id}`,
          description: `Desired design token width for ${child.id}`,
          left: QFLRACompiler.varExpr(childVars.w),
          op: "==",
          right: QFLRACompiler.constExpr(child.targetWidth),
          isHard: false,
          weight: child.targetWeight || 1.0
        });
      }
    });

    // Parent Containment Invariants
    children.forEach(child => {
      const childVars = nodeVariableMap.get(child.id)!;
      // Child left >= Parent left + padLeft
      hardConstraints.push({
        id: `containment_left_${child.id}`,
        description: `Left boundary containment for ${child.id}`,
        left: QFLRACompiler.varExpr(childVars.x),
        op: ">=",
        right: QFLRACompiler.addExpr(QFLRACompiler.varExpr(parentVars.x), QFLRACompiler.constExpr(padLeft)),
        isHard: true
      });

      // Child right <= Parent right - padRight
      const childRight = QFLRACompiler.addExpr(QFLRACompiler.varExpr(childVars.x), QFLRACompiler.varExpr(childVars.w));
      const parentRight = QFLRACompiler.subExpr(
        QFLRACompiler.addExpr(QFLRACompiler.varExpr(parentVars.x), QFLRACompiler.varExpr(parentVars.w)),
        QFLRACompiler.constExpr(padRight)
      );
      hardConstraints.push({
        id: `containment_right_${child.id}`,
        description: `Right boundary containment for ${child.id}`,
        left: childRight,
        op: "<=",
        right: parentRight,
        isHard: true
      });
    });

    // Sibling Flow & Non-Overlap Invariants
    if (direction === "row") {
      for (let i = 0; i < children.length; i++) {
        const curr = children[i];
        const currVars = nodeVariableMap.get(curr.id)!;

        if (i === 0) {
          // First child starts at parent left + padding
          hardConstraints.push({
            id: `row_flow_start_${curr.id}`,
            description: `Row flow start for ${curr.id}`,
            left: QFLRACompiler.varExpr(currVars.x),
            op: "==",
            right: QFLRACompiler.addExpr(QFLRACompiler.varExpr(parentVars.x), QFLRACompiler.constExpr(padLeft)),
            isHard: true
          });
        } else {
          const prev = children[i - 1];
          const prevVars = nodeVariableMap.get(prev.id)!;
          const prevRight = QFLRACompiler.addExpr(
            QFLRACompiler.addExpr(QFLRACompiler.varExpr(prevVars.x), QFLRACompiler.varExpr(prevVars.w)),
            QFLRACompiler.constExpr(gap)
          );

          hardConstraints.push({
            id: `row_sibling_flow_${prev.id}_to_${curr.id}`,
            description: `Sequential horizontal flow between ${prev.id} and ${curr.id}`,
            left: QFLRACompiler.varExpr(currVars.x),
            op: ">=",
            right: prevRight,
            isHard: true
          });
        }

        // Fixed sizing mode constraint
        if (curr.sizingMode === "fixed" && curr.width) {
          hardConstraints.push({
            id: `fixed_w_${curr.id}`,
            description: `Fixed token width for ${curr.id}`,
            left: QFLRACompiler.varExpr(currVars.w),
            op: "==",
            right: QFLRACompiler.constExpr(curr.width),
            isHard: true
          });
        }
      }
    } else if (direction === "column") {
      for (let i = 0; i < children.length; i++) {
        const curr = children[i];
        const currVars = nodeVariableMap.get(curr.id)!;

        if (i > 0) {
          const prev = children[i - 1];
          const prevVars = nodeVariableMap.get(prev.id)!;
          const prevBottom = QFLRACompiler.addExpr(
            QFLRACompiler.addExpr(QFLRACompiler.varExpr(prevVars.y), QFLRACompiler.varExpr(prevVars.h)),
            QFLRACompiler.constExpr(gap)
          );

          hardConstraints.push({
            id: `col_sibling_flow_${prev.id}_to_${curr.id}`,
            description: `Sequential vertical flow between ${prev.id} and ${curr.id}`,
            left: QFLRACompiler.varExpr(currVars.y),
            op: ">=",
            right: prevBottom,
            isHard: true
          });
        }
      }
    }

    // Recurse on children
    children.forEach(child => {
      this.compileNodeRecursive(child, variables, hardConstraints, softConstraints, nodeVariableMap);
    });
  }

  /**
   * Generates standard SMT-LIB2 format representation for deep external Z3 verification
   */
  public toSMTLIB2(system: CompiledConstraintSystem): string {
    const lines: string[] = [
      ";; Oddjob Formal Layout Verification (QF_LRA)",
      "(set-logic QF_LRA)",
      "(set-option :produce-models true)"
    ];

    // Declare variables
    system.variables.forEach(v => {
      lines.push(`(declare-fun ${v} () Real)`);
      lines.push(`(assert (>= ${v} 0.0))`);
    });

    // Assert hard constraints
    system.hardConstraints.forEach(c => {
      const leftStr = this.linearExprToSMTLIB(c.left);
      const rightStr = this.linearExprToSMTLIB(c.right);
      const opStr = c.op === "==" ? "=" : c.op;
      lines.push(`(assert (! (${opStr} ${leftStr} ${rightStr}) :named ${c.id}))`);
    });

    lines.push("(check-sat)");
    lines.push("(get-model)");

    return lines.join("\n");
  }

  private linearExprToSMTLIB(expr: LinearExpression): string {
    if (expr.terms.length === 0) {
      return expr.constant.toFixed(2);
    }

    const termStrings = expr.terms.map(t => {
      if (Math.abs(t.coefficient - 1.0) < 1e-9) return t.variable;
      if (Math.abs(t.coefficient - (-1.0)) < 1e-9) return `(- ${t.variable})`;
      return `(* ${t.coefficient.toFixed(2)} ${t.variable})`;
    });

    if (Math.abs(expr.constant) > 1e-9) {
      termStrings.push(expr.constant.toFixed(2));
    }

    if (termStrings.length === 1) return termStrings[0];
    return `(+ ${termStrings.join(" ")})`;
  }
}
