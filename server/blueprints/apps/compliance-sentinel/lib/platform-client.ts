const BASE = typeof window !== "undefined" ? "/api/oddjob" : "";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new Error(`Compliance platform request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export interface GuardrailEvidence {
  id: string;
  source: string;
  framework: string;
  status: "verified" | "drift_detected";
  timestamp: string;
  confidence: number;
  hash: string;
  violations: string[];
}

export interface AuditReceipt {
  type: "ForensicAuditReceipt";
  receiptId: string;
  generatedAt: string;
  verdict: "safe_to_commit" | "requires_hil_review";
  hilRequestId?: string;
  sha256Proof: string;
  guardrail: { allowed: boolean; overallRiskScore: number; layerResults: Array<{ layerName: string; passed: boolean; violations: string[] }> };
  subject: Record<string, unknown>;
  "@context": string[];
}

export const compliance = {
  evidence: () => request<{ generatedAt: string; overallRiskScore: number; evidence: GuardrailEvidence[] }>("/compliance/evidence"),
  simulate: (scenario: Record<string, unknown>) => request<AuditReceipt>("/compliance/simulate", { method: "POST", body: JSON.stringify(scenario) }),
};
