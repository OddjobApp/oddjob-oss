import { TokenizedUISchema, ComponentNode } from "./types.js";

export interface VerificationResult {
  isValid: boolean;
  violations: Array<{
    nodeId: string;
    ruleId: string;
    message: string;
    severity: "critical" | "warning";
  }>;
}

export function verifyUICompliance(schema: TokenizedUISchema): VerificationResult {
  const result: VerificationResult = { isValid: true, violations: [] };

  // Helper to extract flat list of component nodes
  const allNodes: ComponentNode[] = [];
  function traverse(node: ComponentNode) {
    allNodes.push(node);
    node.children?.forEach(traverse);
  }
  
  if (schema.layout && Array.isArray(schema.layout.children)) {
    schema.layout.children.forEach(traverse);
  }

  // Rule 1: ActionButton POST requires justification input in form
  const hasJustificationInput = allNodes.some(
    n => (n.type === "FormTextArea" || n.type === "FormInput") && 
         (n.props?.bindToState === "remediationNote" || n.props?.bindToState === "reason")
  );

  allNodes.forEach(node => {
    if (node.type === "ActionButton") {
      const clickAction = node.props?.onClick;
      if (clickAction && clickAction.action === "dispatchApi" && clickAction.method === "POST") {
        if (!hasJustificationInput) {
          result.violations.push({
            nodeId: node.id,
            ruleId: "RULE_WRITE_JUSTIFICATION_REQUIRED",
            message: "Action button triggers a state change (POST) but layout lacks a justification input (remediationNote/reason).",
            severity: "critical"
          });
        }
      }
    }
    
    // Rule 2: Theme Brand Color Compliance
    const brandColor = schema.theme?.colors?.brand;
    if (brandColor && (brandColor.toLowerCase() === "#ff0000" || brandColor.toLowerCase() === "red")) {
      result.violations.push({
        nodeId: "theme",
        ruleId: "RULE_NON_COMPLIANT_COLOR",
        message: "Brand accent color cannot be pure red (#FF0000) to avoid visual noise conflicts with critical alerts.",
        severity: "warning"
      });
    }
  });

  result.isValid = result.violations.filter(v => v.severity === "critical").length === 0;
  return result;
}
