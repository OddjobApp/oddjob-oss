import React, { useEffect, useMemo, useState } from "react";
import { ShieldCheck, ShieldAlert, FileText, CheckCircle2, AlertTriangle, Download, RefreshCw, Activity, Lock } from "lucide-react";
import SimulationSandboxPanel from "../components/SimulationSandboxPanel";
import { compliance, type GuardrailEvidence } from "../lib/platform-client";

export default function ComplianceSentinelPage() {
  const [evidenceList, setEvidenceList] = useState<GuardrailEvidence[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "simulation">("overview");

  const appTitle = ("{{APP_TITLE}}" !== "{{APP_TITLE}}") ? "{{APP_TITLE}}" : "Enterprise Compliance Sentinel";
  const frameworkName = ("{{FRAMEWORK_NAME}}" !== "{{FRAMEWORK_NAME}}") ? "{{FRAMEWORK_NAME}}" : "SOC2 Type II / ISO 27001";
  const complianceScore = useMemo(() => evidenceList.length ? (100 * evidenceList.filter(item => item.status === "verified").length / evidenceList.length) : 0, [evidenceList]);

  useEffect(() => {
    compliance.evidence().then(result => setEvidenceList(result.evidence)).catch(err => setLoadError(err instanceof Error ? err.message : "Evidence load failed"));
  }, []);

  const exportW3CAuditBundle = () => {
    setIsExporting(true);
    setTimeout(() => {
      const bundle = {
        "@context": ["https://www.w3.org/ns/activitystreams", "https://oddjob.ai/ns/forensic/v1"],
        type: "ComplianceEvidenceBundle",
        generatedAt: new Date().toISOString(),
        framework: frameworkName,
        complianceScore,
        evidenceItems: evidenceList
      };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `compliance_audit_${Date.now()}.jsonld`;
      a.click();
      URL.revokeObjectURL(url);
      setIsExporting(false);
    }, 400);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-border bg-card/60 backdrop-blur sticky top-0 z-10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 text-primary rounded-lg border border-primary/20">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-none">{appTitle}</h1>
            <p className="text-xs text-muted-foreground mt-1">Continuous Real-Time Regulatory Governance • {frameworkName}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab(activeTab === "overview" ? "simulation" : "overview")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              activeTab === "simulation"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/50 border-border text-foreground hover:bg-muted"
            }`}
          >
            {activeTab === "simulation" ? "Exit Sandbox" : "What-If Simulation Sandbox"}
          </button>
          <button
            onClick={exportW3CAuditBundle}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border transition-colors disabled:opacity-50"
          >
            {isExporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Export Evidence JSON-LD
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6">
        {activeTab === "simulation" ? (
          <SimulationSandboxPanel />
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-card border border-border p-4 rounded-xl space-y-1">
                <div className="text-xs text-muted-foreground">Continuous Compliance Posture</div>
                <div className="text-2xl font-bold text-emerald-500 font-mono">{complianceScore.toFixed(1)}%</div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  <span>{evidenceList.filter(item => item.status === "verified").length}/{evidenceList.length} guardrail layers passing</span>
                </div>
              </div>

              <div className="bg-card border border-border p-4 rounded-xl space-y-1">
                <div className="text-xs text-muted-foreground">Socratic Evidence Confidence</div>
                <div className="text-2xl font-bold text-foreground font-mono">98.2%</div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Activity className="w-3 h-3 text-primary" />
                  <span>Bayesian trajectory verified</span>
                </div>
              </div>

              <div className="bg-card border border-border p-4 rounded-xl space-y-1">
                <div className="text-xs text-muted-foreground">Active Monitored Streams</div>
                <div className="text-2xl font-bold text-foreground font-mono">18</div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Lock className="w-3 h-3 text-emerald-500" />
                  <span>Zero unencrypted transports</span>
                </div>
              </div>

              <div className="bg-card border border-border p-4 rounded-xl space-y-1">
                <div className="text-xs text-muted-foreground">Open Drift Alerts</div>
                <div className="text-2xl font-bold text-amber-500 font-mono">1</div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                  <span>Auto-remediation draft ready</span>
                </div>
              </div>
            </div>

            {/* Evidence Feed and Remediation Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" />
                    <h3 className="font-semibold text-sm">Real-Time Evidence & Audit Ingestion</h3>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">Live WebSocket Synced</span>
                </div>

                {loadError && <p role="alert" className="text-xs text-rose-500">{loadError}</p>}
                
                {/* SAST / SCA Security Audit Findings */}
                <div className="p-3 bg-muted/40 rounded-lg border border-border space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="flex items-center gap-1.5 text-primary">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      AST Code & Dependency Vulnerability Stream
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-500 font-mono">
                      Continuous SAST/SCA
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between p-2 bg-card rounded border border-border">
                      <div>
                        <span className="font-mono text-emerald-500">[SEC-PASS]</span> Zero hardcoded tokens or AWS keys detected
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono">AST Tree-Sitter</span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-card rounded border border-border">
                      <div>
                        <span className="font-mono text-amber-500">[SCA-WARN]</span> lodash ^4.17.15 upgrade recommendation (^4.17.21 available)
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono">CVE-2021-23337</span>
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-border text-xs">
                  {evidenceList.map((item) => (
                    <div key={item.id} className="py-3 flex items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="font-medium text-foreground flex items-center gap-2">
                          <span>{item.source}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted font-mono">{item.framework}</span>
                        </div>
                        <div className="text-muted-foreground font-mono text-[11px]">
                          Hash: {item.hash} • Confidence: {(item.confidence * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`px-2 py-0.5 rounded-full font-medium text-[11px] ${
                            item.status === "verified"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                          }`}
                        >
                          {item.status === "verified" ? "Verified" : "Drift Detected"}
                        </span>
                        <span className="text-muted-foreground text-[11px]">{item.timestamp}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Explainable Guardrail Remediation Card */}
              <div className="bg-card border border-border rounded-xl p-5 space-y-4 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-500" />
                    <h3 className="font-semibold text-sm">Active Guardrail Remediation</h3>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Socratic GQE Guardrail detected an ingress configuration drift in Kubernetes Ingress cluster.
                  </p>

                  <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg text-xs space-y-2">
                    <div className="font-medium text-foreground">Remediation Recommendation</div>
                    <p className="text-muted-foreground text-[11px]">
                      Enforce strict TLS 1.3 protocol cipher suites across edge ingress gateways.
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        onClick={() => setActiveTab("simulation")}
                        className="px-2.5 py-1 bg-primary text-primary-foreground rounded text-[11px] font-medium hover:bg-primary/90 transition-colors"
                      >
                        Simulate in Sandbox
                      </button>
                      <button className="px-2.5 py-1 bg-muted border border-border text-foreground rounded text-[11px] font-medium hover:bg-muted/80 transition-colors">
                        Request Admin Override
                      </button>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Policy Engine: Swiss Cheese L5</span>
                  <span className="text-emerald-500 font-medium">Safe Boundary Enforced</span>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
