import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, XCircle, Clock, ShieldCheck } from "lucide-react";
import type { DecisionGateEntry, DecisionGateStatus } from "../types/index.js";

const STATUS_META: Record<DecisionGateStatus, { variant: "success" | "destructive" | "secondary" | "warning" | "info"; Icon: typeof CheckCircle2 }> = {
  passed: { variant: "success", Icon: CheckCircle2 },
  failed: { variant: "destructive", Icon: XCircle },
  overridden: { variant: "warning", Icon: ShieldCheck },
  skipped: { variant: "secondary", Icon: XCircle },
  pending: { variant: "info", Icon: Clock },
};

export interface DecisionGatesPanelProps {
  gates: DecisionGateEntry[];
  onApprove?: (gateId: string) => void;
  onReject?: (gateId: string) => void;
  onCancel?: (gateId: string) => void;
}

export function DecisionGatesPanel({ gates, onApprove, onReject, onCancel }: DecisionGatesPanelProps) {
  const ordered = [...gates].sort((a, b) => {
    const ta = a.evaluatedAt ? new Date(a.evaluatedAt).getTime() : Infinity; // pending (null) last
    const tb = b.evaluatedAt ? new Date(b.evaluatedAt).getTime() : Infinity;
    return ta - tb;
  });

  if (ordered.length === 0) {
    return <p className="text-sm text-muted-foreground">No decision gates recorded.</p>;
  }

  return (
    <div className="space-y-2" data-testid="decision-gates-panel">
      {ordered.map((gate) => {
        const meta = STATUS_META[gate.status] ?? STATUS_META.pending;
        const { Icon } = meta;
        return (
          <Card key={gate.id} className={cn(gate.requiresAttention && "border-amber-400 ring-1 ring-amber-400/40")}>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                {gate.requiresAttention && <AlertCircle className="h-4 w-4 text-amber-500" />}
                {gate.label}
              </CardTitle>
              <Badge variant={meta.variant} className="inline-flex items-center gap-1">
                <Icon className="h-3 w-3" /> {gate.status}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2 py-0 pb-3 text-xs text-muted-foreground">
              {gate.evaluatedAt && <p>Evaluated {new Date(gate.evaluatedAt).toLocaleString()}</p>}
              {gate.details && Object.keys(gate.details).length > 0 && (
                <ul className="list-inside list-disc">
                  {Object.entries(gate.details).map(([k, v]) => (
                    <li key={k}><span className="font-medium">{k}:</span> {String(v)}</li>
                  ))}
                </ul>
              )}
              {gate.blockingFailures && gate.blockingFailures.length > 0 && (
                <ul className="list-inside list-disc text-red-600">
                  {gate.blockingFailures.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              )}
              {gate.override && (
                <p className="text-amber-600">Overridden by {gate.override.userId} on {new Date(gate.override.timestamp).toLocaleString()}</p>
              )}
              {gate.requiresAttention && (
                <div className="flex gap-2 pt-1">
                  {onApprove && <Button size="sm" variant="default" className="h-7" onClick={() => onApprove(gate.id)}>Approve</Button>}
                  {onReject && <Button size="sm" variant="destructive" className="h-7" onClick={() => onReject(gate.id)}>Reject</Button>}
                  {onCancel && <Button size="sm" variant="outline" className="h-7" onClick={() => onCancel(gate.id)}>Cancel</Button>}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
