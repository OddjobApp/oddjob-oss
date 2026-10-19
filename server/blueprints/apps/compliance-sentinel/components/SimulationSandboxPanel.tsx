import React, { useState } from "react";
import { AlertTriangle, Play, RefreshCw, Layers, CheckCircle2 } from "lucide-react";
import { compliance, type AuditReceipt } from "../lib/platform-client";

export interface SimulationScenario {
  id: string;
  name: string;
  targetFramework: string;
  proposedAction: string;
  riskScore: number;
  projectedPassRate: number;
  impactedResources: string[];
}

const DEFAULT_SCENARIOS: SimulationScenario[] = [
  {
    id: "scen-1",
    name: "Enforce TLS 1.3 Strict Cipher Suites",
    targetFramework: "SOC2 CC6.1",
    proposedAction: "Update ingress ingress-gateway nginx.conf SSL protocols",
    riskScore: 12,
    projectedPassRate: 99.8,
    impactedResources: ["ingress-gateway", "edge-router-01", "api-cluster-prod"]
  },
  {
    id: "scen-2",
    name: "Automate Database Secret Rotation (30-day)",
    targetFramework: "ISO 27001 A.9.4.3",
    proposedAction: "Rotate AWS KMS master keys and Drizzle connection pools",
    riskScore: 28,
    projectedPassRate: 97.5,
    impactedResources: ["db-primary-pool", "vault-transit-key", "worker-node-alpha"]
  },
  {
    id: "scen-3",
    name: "Quarantine Unencrypted S3 Logs Bucket",
    targetFramework: "HIPAA 164.312(a)(2)(iv)",
    proposedAction: "Apply SSE-KMS bucket policy and revoke public read ACLs",
    riskScore: 5,
    projectedPassRate: 100.0,
    impactedResources: ["s3://oddjob-forensic-archive-prod"]
  }
];

export function SimulationSandboxPanel() {
  const [selectedScenario, setSelectedScenario] = useState<SimulationScenario>(DEFAULT_SCENARIOS[0]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<AuditReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSimulation = async () => {
    setIsSimulating(true);
    setSimulationResult(null);
    setError(null);
    try {
      setSimulationResult(await compliance.simulate(selectedScenario as unknown as Record<string, unknown>));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-primary/10 rounded-lg text-primary">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">What-If Policy Simulation Sandbox</h3>
            <p className="text-xs text-muted-foreground">Test compliance remediations in a shadow environment before live execution</p>
          </div>
        </div>
        <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          Sandbox Isolated
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {DEFAULT_SCENARIOS.map((scen) => (
          <button
            key={scen.id}
            onClick={() => {
              setSelectedScenario(scen);
              setSimulationResult(null);
            }}
            className={`p-3 text-left rounded-lg border transition-all text-xs space-y-1.5 ${
              selectedScenario.id === scen.id
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border bg-muted/40 hover:bg-muted"
            }`}
          >
            <div className="font-medium text-foreground truncate">{scen.name}</div>
            <div className="text-muted-foreground flex justify-between">
              <span>{scen.targetFramework}</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400">{scen.projectedPassRate}% Pass</span>
            </div>
          </button>
        ))}
      </div>

      <div className="bg-muted/30 border border-border rounded-lg p-4 space-y-3 text-xs">
        <div className="flex items-center justify-between font-mono text-muted-foreground">
          <span>Target Action: {selectedScenario.proposedAction}</span>
          <span>Risk: {selectedScenario.riskScore}/100</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={runSimulation}
            disabled={isSimulating}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSimulating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {isSimulating ? "Simulating Shadow Run..." : "Run Shadow Simulation"}
          </button>
        </div>

        {error && <p role="alert" className="text-rose-500">{error}</p>}
        {simulationResult && (
          <div className="mt-4 pt-4 border-t border-border space-y-2">
            <div className="flex items-center gap-2">
              {simulationResult.verdict === "safe_to_commit" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              )}
              <span className="font-semibold text-foreground">
                {simulationResult.verdict === "safe_to_commit" ? "Safe to Auto-Commit" : "Requires Human Supervisor Authorization"}
              </span>
            </div>
            <p className="text-muted-foreground">
              Risk {simulationResult.guardrail.overallRiskScore}/100 across {simulationResult.guardrail.layerResults.length} evaluated guardrail layers.
              {simulationResult.hilRequestId ? ` Sent to HIL queue as #${simulationResult.hilRequestId}.` : " No human escalation required."}
            </p>
            <div className="bg-background/80 rounded border border-border p-2.5 font-mono text-[11px] space-y-1">
              {simulationResult.guardrail.layerResults.map((layer, i) => (
                <div key={i} className={layer.passed ? "text-emerald-500" : "text-rose-500"}>
                  {layer.passed ? "✓" : "✕"} {layer.layerName}{layer.violations.length ? ` — ${layer.violations.join("; ")}` : ""}
                </div>
              ))}
              <div className="text-foreground">Receipt {simulationResult.receiptId} · SHA-256 {simulationResult.sha256Proof}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SimulationSandboxPanel;
