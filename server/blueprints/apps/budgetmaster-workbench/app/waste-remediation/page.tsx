'use client'

import { useState } from "react";
import { Server, Zap, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

const mockResources = [
  { id: "i-0982734abc", type: "EC2 (t3.xlarge)", environment: "Dev", idleDays: 14, costPerMonth: 120, status: "Idle", recommendedAction: "Terminate" },
  { id: "rds-staging-db", type: "RDS (db.m5.large)", environment: "Staging", idleDays: 8, costPerMonth: 340, status: "Idle", recommendedAction: "Snapshot & Terminate" },
  { id: "eks-node-group-1", type: "EKS Nodes", environment: "Test", idleDays: 2, costPerMonth: 450, status: "Underutilized", recommendedAction: "Downsize to t3.medium" },
];

export default function WasteRemediation() {
  const [resources, setResources] = useState(mockResources);
  const [prStatus, setPrStatus] = useState<string | null>(null);

  const totalWaste = resources.reduce((sum, r) => sum + r.costPerMonth, 0);

  const generateTeardownPR = () => {
    setPrStatus("Generating Terraform Teardown PR...");
    setTimeout(() => {
      setPrStatus("PR #402 Created: Agentic Infrastructure Cleanup");
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">♻️</span>
              <h1 className="text-3xl font-bold tracking-tight">Cloud Waste Remediation</h1>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 font-bold">
              <AlertTriangle className="w-4 h-4" />
              Est. Monthly Waste: ${totalWaste}
            </div>
          </div>
          <p className="text-sm text-slate-400 max-w-2xl mt-3">
            The AI Agent actively monitors your cloud environments (AWS, GCP, Azure) to identify idle resources, 
            orphaned volumes, and underutilized clusters. It proposes Terraform/CloudFormation PRs to tear them down safely.
          </p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/5 border-b border-white/10 text-slate-400 text-left">
                <th className="px-4 py-3 font-semibold">Resource ID</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Environment</th>
                <th className="px-4 py-3 font-semibold text-right">Idle Days</th>
                <th className="px-4 py-3 font-semibold text-right">Monthly Cost</th>
                <th className="px-4 py-3 font-semibold">AI Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {resources.map(r => (
                <tr key={r.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-3 font-mono text-slate-300 flex items-center gap-2">
                    <Server className="w-4 h-4 text-slate-500" /> {r.id}
                  </td>
                  <td className="px-4 py-3">{r.type}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full bg-white/10 text-[10px] uppercase font-bold tracking-wider">{r.environment}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-rose-400">{r.idleDays}</td>
                  <td className="px-4 py-3 text-right font-mono text-rose-400">${r.costPerMonth}</td>
                  <td className="px-4 py-3">
                    <span className="text-emerald-400 font-semibold">{r.recommendedAction}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-[#0b1212]/40 border border-teal-500/20 rounded-xl p-6 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
              <Zap className="w-5 h-5 text-teal-400" /> Agentic Remediation
            </h3>
            <p className="text-sm text-slate-400 mt-1 max-w-xl">
              The agent will analyze dependencies, check for state locks, and generate a pull request removing these resources from your Infrastructure-as-Code repository.
            </p>
          </div>
          
          <div className="text-right">
            {prStatus ? (
              <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                <CheckCircle2 className="w-5 h-5" /> {prStatus}
              </div>
            ) : (
              <button onClick={generateTeardownPR} className="px-6 py-3 bg-teal-600 hover:bg-teal-500 text-white rounded-lg font-bold transition-colors shadow-lg shadow-teal-900/20">
                Generate Teardown PR
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
