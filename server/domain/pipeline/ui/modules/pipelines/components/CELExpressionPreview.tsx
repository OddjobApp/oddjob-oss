/**
 * CEL Expression Preview
 * 
 * Component for displaying live preview of compiled CEL expressions.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Eye } from "lucide-react";

interface Condition {
  source: string;
  operator: string;
  target: any;
}

interface CELExpressionPreviewProps {
  conditions: Condition[];
  evaluationMode: "AND" | "OR";
}

/**
 * Generate CEL expression preview from conditions
 */
function generateCELPreview(conditions: Condition[], mode: "AND" | "OR"): string {
  if (!conditions || conditions.length === 0) {
    return "No conditions defined";
  }

  const operatorMap: Record<string, string> = {
    "GT": ">",
    "LT": "<",
    "GTE": ">=",
    "LTE": "<=",
    "EQ": "==",
    "NE": "!=",
    "CONTAINS": ".contains(",
    "STARTS_WITH": ".startsWith(",
    "ENDS_WITH": ".endsWith(",
    "HAS": ".has(",
    "NOT_HAS": ".notHas(",
    "WITHIN_WINDOW": "> timestamp(",
    "BEFORE": "< timestamp(",
    "AFTER": "> timestamp(",
    "MATCHES": ".matches(",
  };

  const expressions = conditions
    .filter((c) => c.source && c.operator && c.target !== undefined && c.target !== null && c.target !== "")
    .map((condition) => {
      const { source, operator, target } = condition;
      const celOp = operatorMap[operator] || operator;

      // Handle method-style operators
      if (celOp.startsWith(".")) {
        const targetStr = typeof target === "string" ? `"${target}"` : String(target);
        return `${source}${celOp}${targetStr})`;
      }

      // Handle temporal operators
      if (operator === "WITHIN_WINDOW") {
        // Convert time window to timestamp (simplified)
        const now = new Date();
        const windowMatch = String(target).match(/^(\d+)([dhms])$/);
        if (windowMatch) {
          const value = parseInt(windowMatch[1], 10);
          const unit = windowMatch[2];
          let ms = 0;
          if (unit === "d") ms = value * 24 * 60 * 60 * 1000;
          else if (unit === "h") ms = value * 60 * 60 * 1000;
          else if (unit === "m") ms = value * 60 * 1000;
          else if (unit === "s") ms = value * 1000;
          const timestamp = new Date(now.getTime() - ms);
          return `${source} > timestamp("${timestamp.toISOString()}")`;
        }
        return `${source} > timestamp("${target}")`;
      }

      // Handle comparison operators
      const targetStr = typeof target === "string" ? `"${target}"` : String(target);
      return `${source} ${celOp} ${targetStr}`;
    });

  if (expressions.length === 0) {
    return "No valid conditions";
  }

  const logicalOp = mode === "AND" ? " AND " : " OR ";
  return expressions.join(logicalOp);
}

export function CELExpressionPreview({ conditions, evaluationMode }: CELExpressionPreviewProps) {
  const preview = generateCELPreview(conditions, evaluationMode);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-4 w-4" />
          Expression Preview
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md bg-muted p-4 font-mono text-sm whitespace-pre-wrap break-words">
          {preview}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          This is the compiled CEL expression that will be evaluated at runtime.
        </p>
      </CardContent>
    </Card>
  );
}

