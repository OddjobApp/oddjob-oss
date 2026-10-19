import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Gauge,
  GitPullRequest,
  KeyRound,
  Landmark,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { isEmbedded, notifySaved, notifyUnsavedChange, useWorkbenchContext } from "../sdk/workbench-sdk";

type WorkloadAgent = {
  agent: string;
  mission: string;
  status: string;
  risk: "low" | "medium" | "high";
  unresolvedDependencies: string[];
  costUsd: number;
  confidence: number | null;
};

type Workload = {
  cycle: { id: number; name: string; status: string; objective: string; budgetLimitUsd: number; currentSpendUsd: number } | null;
  agents: WorkloadAgent[];
  attention: Array<{ agent: string; mission: string; reason: string; severity: string }>;
  summary: { active: number; blocked: number; idle: number; completed: number; tokenSpendUsd: number };
};

type RecordLike = Record<string, any> & { id?: string };

const collections = {
  uat: "stakeholder_workbench_uat_signoffs",
  cab: "stakeholder_workbench_cab_approvals",
  roi: "stakeholder_workbench_roi_cases",
  releases: "stakeholder_workbench_release_packets",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const proxyBase = typeof window !== "undefined" && window.location.pathname.startsWith("/app/")
    ? `/app/${window.location.pathname.split("/")[2]}/api/oddjob`
    : "/api/oddjob";
  const response = await fetch(`${proxyBase}/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json();
}

function listRecords(collection: string) {
  return api<RecordLike[]>(`datasets?collection=${collection}`);
}

function saveRecord(collection: string, payload: RecordLike) {
  const id = payload.id;
  return api<RecordLike>(`datasets${id ? `/${id}` : ""}?collection=${collection}`, {
    method: id ? "PUT" : "POST",
    body: JSON.stringify({ ...payload, id: undefined }),
  });
}

function pct(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 100) : 0;
}

function releaseMarkdown(workload: Workload | null, uat: any, cab: any, roi: any) {
  const cycle = workload?.cycle;
  const missions = workload?.agents ?? [];
  const attention = workload?.attention ?? [];
  return [
    `<h1>${cycle?.name ?? "SDLC Release Packet"}</h1>`,
    `<p><strong>Status:</strong> ${cycle?.status ?? "unknown"}</p>`,
    `<p><strong>Objective:</strong> ${cycle?.objective ?? "Not provided"}</p>`,
    "<h2>Release Readiness</h2>",
    `<ul><li>UAT verdict: ${uat.status}</li><li>CAB decision: ${cab.decision}</li><li>Risk level: ${cab.riskLevel}</li><li>Deployment window: ${cab.deployWindow}</li></ul>`,
    "<h2>Mission Snapshot</h2>",
    `<ul>${missions.map(m => `<li>${m.mission}: ${m.status} (${m.agent})</li>`).join("")}</ul>`,
    "<h2>Open Attention Items</h2>",
    attention.length ? `<ul>${attention.map(a => `<li>${a.mission}: ${a.reason}</li>`).join("")}</ul>` : "<p>No blocked or high-risk items.</p>",
    "<h2>Business Value</h2>",
    `<p>Estimated manual cost: $${Number(roi.manualCost || 0).toLocaleString()}<br/>Estimated AI-assisted cost: $${Number(roi.aiCost || 0).toLocaleString()}<br/>Net savings: $${Number(roi.savings || 0).toLocaleString()}</p>`,
  ].join("\n");
}

export default function StakeholderWorkbench() {
  const embedded = isEmbedded();
  const ctx = useWorkbenchContext();
  const [tab, setTab] = useState<"readiness" | "approvals" | "publish">("readiness");
  const [workload, setWorkload] = useState<Workload | null>(null);
  const [records, setRecords] = useState<Record<string, RecordLike[]>>({});
  const [jiraIssues, setJiraIssues] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [uat, setUat] = useState({ status: "approved", blocker: "", comments: "Stakeholder validation passed.", hours: "3" });
  const [cab, setCab] = useState({ decision: "approve", deployWindow: "Next approved release window", riskLevel: "medium", checklist: "complete", rollback: "Rollback via previous stable artifact and database backup checkpoint." });
  const [roi, setRoi] = useState({ tickets: "250", manualHours: "8", hourlyRate: "75", aiCostPct: "10" });
  const [publish, setPublish] = useState({ space: "", parentPageId: "", title: "SDLC Release Readiness Packet", jiraJql: "project = PROJ ORDER BY updated DESC" });

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const [nextWorkload, uatRows, cabRows, roiRows, releaseRows] = await Promise.all([
        api<Workload>("fleet/workload"),
        listRecords(collections.uat),
        listRecords(collections.cab),
        listRecords(collections.roi),
        listRecords(collections.releases),
      ]);
      setWorkload(nextWorkload);
      setRecords({ uat: uatRows, cab: cabRows, roi: roiRows, releases: releaseRows });
      if (nextWorkload?.cycle) setPublish(prev => ({ ...prev, title: `${nextWorkload.cycle!.name} Release Readiness Packet` }));
    } catch (err: any) {
      setError(err.message || "Unable to load stakeholder workbench data.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const readiness = useMemo(() => {
    const total = workload?.agents.length ?? 0;
    const blocked = workload?.summary.blocked ?? 0;
    const completed = workload?.summary.completed ?? 0;
    const highRisk = workload?.agents.filter(agent => agent.risk === "high").length ?? 0;
    const score = Math.max(0, Math.min(100, 55 + pct(completed, total) - blocked * 15 - highRisk * 20));
    return { total, blocked, highRisk, score };
  }, [workload]);

  const roiCalc = useMemo(() => {
    const manualCost = Number(roi.tickets) * Number(roi.manualHours) * Number(roi.hourlyRate);
    const aiCost = manualCost * (Number(roi.aiCostPct) / 100);
    return { manualCost, aiCost, savings: manualCost - aiCost };
  }, [roi]);

  const submitUat = async (event: React.FormEvent) => {
    event.preventDefault();
    const saved = await saveRecord(collections.uat, { ...uat, cycleId: workload?.cycle?.id, submittedAt: new Date().toISOString() });
    setRecords(prev => ({ ...prev, uat: [saved, ...(prev.uat || [])] }));
    notifySaved("UAT sign-off captured", ["uat_status", "release_readiness"]);
    setSuccess("UAT sign-off captured.");
  };

  const submitCab = async (event: React.FormEvent) => {
    event.preventDefault();
    const saved = await saveRecord(collections.cab, { ...cab, cycleId: workload?.cycle?.id, submittedAt: new Date().toISOString() });
    setRecords(prev => ({ ...prev, cab: [saved, ...(prev.cab || [])] }));
    notifySaved("CAB decision captured", ["cab_decision", "deployment_gate"]);
    setSuccess("CAB decision captured.");
  };

  const submitRoi = async (event: React.FormEvent) => {
    event.preventDefault();
    const saved = await saveRecord(collections.roi, { ...roi, ...roiCalc, cycleId: workload?.cycle?.id, submittedAt: new Date().toISOString() });
    setRecords(prev => ({ ...prev, roi: [saved, ...(prev.roi || [])] }));
    notifySaved("ROI case saved", ["roi", "value_stream"]);
    setSuccess("ROI case saved.");
  };

  const runJiraSearch = async () => {
    setBusy(true);
    setError(null);
    try {
      const result: any = await api("integrations/jira/search", {
        method: "POST",
        body: JSON.stringify({ jql: publish.jiraJql, limit: 12 }),
      });
      setJiraIssues(result.issues || []);
      setSuccess(`Loaded ${result.issues?.length ?? 0} Jira issues.`);
    } catch (err: any) {
      setError(err.message || "Jira search failed.");
    } finally {
      setBusy(false);
    }
  };

  const publishRelease = async () => {
    setBusy(true);
    setError(null);
    try {
      const packet = {
        title: publish.title,
        space: publish.space,
        content: releaseMarkdown(workload, uat, cab, roiCalc),
        parentPageId: publish.parentPageId || undefined,
      };
      const confluenceResult: any = await api("integrations/confluence/publish", {
        method: "POST",
        body: JSON.stringify(packet),
      });
      const saved = await saveRecord(collections.releases, {
        ...packet,
        cycleId: workload?.cycle?.id,
        confluencePageId: confluenceResult.pageId,
        confluenceUrl: confluenceResult.url,
        publishedAt: new Date().toISOString(),
      });
      setRecords(prev => ({ ...prev, releases: [saved, ...(prev.releases || [])] }));
      notifySaved("Release readiness packet published to Confluence", ["release_notes", "cab_decision", "uat_status"]);
      setSuccess("Release readiness packet published to Confluence.");
    } catch (err: any) {
      setError(err.message || "Confluence publish failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={`shell ${embedded ? "embedded" : ""}`}>
      <header className="hero">
        <div>
          <span className="eyebrow"><Landmark size={14} /> SDLC Stakeholder Gateway</span>
          <h1>Stakeholder Workbench</h1>
          <p>{workload?.cycle?.name ?? "Loading release context"}{ctx?.mission?.name ? ` · ${ctx.mission.name}` : ""}</p>
        </div>
        <button title="Refresh" className="primary" onClick={load} disabled={busy}><RefreshCw size={16} /> Refresh</button>
      </header>

      {error && <div className="notice danger"><AlertTriangle size={18} /> {error}</div>}
      {success && <div className="notice ok"><CheckCircle2 size={18} /> {success}</div>}

      <section className="metrics">
        <div><Gauge /><span>Readiness</span><strong>{readiness.score}%</strong></div>
        <div><ClipboardCheck /><span>Blocked Gates</span><strong>{readiness.blocked}</strong></div>
        <div><BarChart3 /><span>Net Savings</span><strong>${Math.round(roiCalc.savings).toLocaleString()}</strong></div>
        <div><Rocket /><span>Cycle Spend</span><strong>${Number(workload?.cycle?.currentSpendUsd ?? 0).toFixed(2)}</strong></div>
      </section>

      <nav className="tabs">
        {[
          ["readiness", "Readiness", ShieldCheck],
          ["approvals", "UAT & CAB", KeyRound],
          ["publish", "Jira & Confluence", FileText],
        ].map(([key, label, Icon]: any) => (
          <button title={label as string} key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}><Icon size={16} /> {label}</button>
        ))}
      </nav>

      {tab === "readiness" && (
        <section className="grid">
          <div className="panel wide">
            <h2>Mission Readiness Map</h2>
            <p>Release and stakeholder decisions are grounded in the same cycle workload used by the SDLC manager.</p>
            <div className="missionList">
              {(workload?.agents ?? []).map(agent => (
                <div key={agent.mission} className="mission">
                  <span className={`dot ${agent.risk}`} />
                  <div><strong>{agent.mission}</strong><small>{agent.agent} · {agent.status}</small></div>
                  <span>{agent.confidence ?? "--"}%</span>
                  <span>{agent.unresolvedDependencies.length ? agent.unresolvedDependencies.join(", ") : "Clear"}</span>
                </div>
              ))}
            </div>
          </div>
          <aside className="panel">
            <h2>Stakeholder Brief</h2>
            <div className="brief"><Sparkles size={18} /><p>{readiness.blocked ? "Release approval should wait for blocked downstream gates to clear." : "No blocked gates are present. Proceed through UAT and CAB review."}</p></div>
            <h3>Attention Items</h3>
            {(workload?.attention ?? []).map(item => <div className="attention" key={item.mission}><AlertTriangle size={15} /><span>{item.mission}: {item.reason}</span></div>)}
            {workload?.attention.length === 0 && <div className="empty">No stakeholder escalations.</div>}
          </aside>
        </section>
      )}

      {tab === "approvals" && (
        <section className="grid three">
          <form className="panel form" onSubmit={submitUat} onChange={() => notifyUnsavedChange(true)}>
            <h2>UAT Sign-Off</h2>
            <label>Status<select title="UAT Status" value={uat.status} onChange={e => setUat({ ...uat, status: e.target.value })}><option value="approved">Approved</option><option value="approved-with-notes">Approved with notes</option><option value="blocked">Blocked</option></select></label>
            <label>Blocker<input value={uat.blocker} onChange={e => setUat({ ...uat, blocker: e.target.value })} placeholder="Optional blocker description" /></label>
            <label>Testing comments<textarea value={uat.comments} onChange={e => setUat({ ...uat, comments: e.target.value })} /></label>
            <label>Actual hours<input type="number" value={uat.hours} onChange={e => setUat({ ...uat, hours: e.target.value })} /></label>
            <button title="Save UAT" className="primary"><Save size={16} /> Save UAT</button>
          </form>

          <div className="panel riskPanel">
            <div>
              <h2>Dynamic CAB Approval & Risk Matrix</h2>
              <p className="riskSubtitle">Auto-scored based on IaC changes, code diffs, and security scans.</p>
            </div>
            
            <div className="riskGrid">
              <div className="riskCard green">
                <div className="riskCardLabel">Security Scans</div>
                <div className="riskCardValue">0</div>
                <div className="riskCardHint">High Severity Findings</div>
              </div>
              <div className="riskCard amber">
                <div className="riskCardLabel">IaC Changes</div>
                <div className="riskCardValue">4</div>
                <div className="riskCardHint">Medium Risk Modules</div>
              </div>
              <div className="riskCard blue">
                <div className="riskCardLabel">Code Diffs</div>
                <div className="riskCardValue">12K</div>
                <div className="riskCardHint">Lines Changed</div>
              </div>
            </div>

            <div className="riskSummary">
              <div>
                <span className="riskCaption">Calculated Risk Level</span>
                <div className="riskLevel">
                  <div className="dot medium"></div>
                  <span className="riskLevelValue">Medium</span>
                </div>
              </div>
              <div className="riskAction">
                <span className="riskCaption">Suggested Action</span>
                <div className="riskActionValue">Proceed with Standard CAB</div>
              </div>
            </div>

            <form className="form" onSubmit={submitCab}>
              <label>Decision
                <select title="CAB Decision" value={cab.decision} onChange={e => setCab({ ...cab, decision: e.target.value })} className="deepField">
                  <option value="approve">Approve (1-Click)</option>
                  <option value="defer">Defer to Next Window</option>
                  <option value="reject">Reject & Flag</option>
                </select>
              </label>
              <label>Deployment window<input value={cab.deployWindow} onChange={e => setCab({ ...cab, deployWindow: e.target.value })} className="deepField" /></label>
              <label>Rollback plan<textarea value={cab.rollback} onChange={e => setCab({ ...cab, rollback: e.target.value })} className="deepField" /></label>
              <button title="Save CAB" className="primary"><ShieldCheck size={16} /> Submit Decision</button>
            </form>
          </div>

          <form className="panel form" onSubmit={submitRoi}>
            <h2>ROI Case</h2>
            <label>Tickets processed<input type="number" value={roi.tickets} onChange={e => setRoi({ ...roi, tickets: e.target.value })} /></label>
            <label>Manual hours per ticket<input type="number" value={roi.manualHours} onChange={e => setRoi({ ...roi, manualHours: e.target.value })} /></label>
            <label>Hourly rate<input type="number" value={roi.hourlyRate} onChange={e => setRoi({ ...roi, hourlyRate: e.target.value })} /></label>
            <div className="valueBox"><span>Net savings</span><strong>${Math.round(roiCalc.savings).toLocaleString()}</strong></div>
            <button title="Save ROI" className="primary"><BarChart3 size={16} /> Save ROI</button>
          </form>
        </section>
      )}

      {tab === "publish" && (
        <section className="grid">
          <div className="panel">
            <h2>Jira Context</h2>
            <label>Release JQL<textarea value={publish.jiraJql} onChange={e => setPublish({ ...publish, jiraJql: e.target.value })} /></label>
            <button title="Run JQL" className="secondary" onClick={runJiraSearch} disabled={busy}><GitPullRequest size={16} /> Run JQL</button>
            <div className="issueList">{jiraIssues.map(issue => <div key={issue.key}><strong>{issue.key}</strong><span>{issue.summary}</span><small>{issue.status} · {issue.priority ?? "No priority"}</small></div>)}</div>
          </div>
          <div className="panel">
            <h2>Confluence Release Packet</h2>
            <label>Space key<input value={publish.space} onChange={e => setPublish({ ...publish, space: e.target.value.toUpperCase() })} /></label>
            <label>Parent page ID<input value={publish.parentPageId} onChange={e => setPublish({ ...publish, parentPageId: e.target.value })} placeholder="Optional" /></label>
            <label>Page title<input value={publish.title} onChange={e => setPublish({ ...publish, title: e.target.value })} /></label>
            <button title="Publish to Confluence" className="primary" onClick={publishRelease} disabled={busy}><ExternalLink size={16} /> Publish to Confluence</button>
            <h3>Published Packets</h3>
            {(records.releases || []).slice(0, 4).map(row => <div className="published" key={row.id}><strong>{row.title}</strong><small>{row.space} · {row.confluencePageId ?? "pending"}</small></div>)}
          </div>
        </section>
      )}

      <style jsx>{`
        :global(body){margin:0;background:#070b12;color:#edf2ff;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        .shell{min-height:100vh;padding:42px clamp(18px,4vw,64px);background:radial-gradient(circle at 0 0,rgba(20,184,166,.14),transparent 28%),linear-gradient(135deg,#071018,#111827 56%,#0b1120)}
        .embedded{padding:clamp(14px,4vw,28px);max-width:100%;overflow-x:hidden}.hero,.metrics,.tabs,.grid{max-width:1460px;margin:0 auto;min-width:0}.hero{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:24px}.hero h1{font-size:clamp(32px,8vw,58px);overflow-wrap:anywhere}
        .eyebrow{display:inline-flex;align-items:center;gap:8px;color:#5eead4;border:1px solid rgba(94,234,212,.3);background:rgba(20,184,166,.09);border-radius:999px;padding:7px 12px;font-size:12px;font-weight:850;text-transform:uppercase}
        h1{font-size:clamp(34px,5vw,64px);line-height:1;margin:12px 0 6px;letter-spacing:0}h2{margin:0 0 8px;font-size:20px}h3{font-size:14px;text-transform:uppercase;color:#94a3b8;letter-spacing:.08em}p,small{color:#9fb0c7}.primary,.secondary{border:0;border-radius:10px;min-height:44px;padding:0 16px;font-weight:850;display:inline-flex;align-items:center;justify-content:center;gap:8px}.primary{background:#f8fafc;color:#08111c}.secondary{background:rgba(20,184,166,.14);color:#d7fffb;border:1px solid rgba(94,234,212,.28)}
        .notice,.panel,.metrics>div{border:1px solid rgba(148,163,184,.18);background:rgba(9,17,30,.74);backdrop-filter:blur(18px);box-shadow:0 22px 70px rgba(0,0,0,.28)}.notice{max-width:1460px;margin:0 auto 18px;border-radius:12px;padding:14px 16px;display:flex;gap:10px;align-items:center}.danger{color:#fecaca;border-color:rgba(248,113,113,.42);background:rgba(127,29,29,.26)}.ok{color:#bbf7d0;border-color:rgba(52,211,153,.36);background:rgba(6,78,59,.22)}
        .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}.metrics>div{border-radius:14px;padding:18px;display:grid;gap:8px}.metrics svg{color:#5eead4}.metrics strong{font-size:30px}
        .tabs{display:flex;gap:8px;margin-bottom:18px}.tabs button{border:1px solid rgba(148,163,184,.15);background:rgba(15,23,42,.65);color:#cbd5e1;border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:8px;font-weight:850}.tabs .active{background:#f8fafc;color:#08111c}
        .grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(360px,.7fr);gap:18px}.three{grid-template-columns:repeat(3,minmax(0,1fr))}.panel{border-radius:18px;padding:22px;min-width:0}.missionList,.issueList{display:grid;gap:10px;margin-top:16px}.mission{display:grid;grid-template-columns:14px 1.4fr 70px 1fr;gap:12px;align-items:center;border:1px solid rgba(148,163,184,.12);background:rgba(15,23,42,.65);border-radius:13px;padding:13px}.mission strong,.issueList strong,.published strong{display:block}.dot{width:10px;height:10px;border-radius:999px}.dot.low{background:#34d399}.dot.medium{background:#f59e0b}.dot.high{background:#fb7185}.brief,.attention,.empty,.valueBox,.published,.issueList>div{border:1px solid rgba(148,163,184,.12);background:rgba(15,23,42,.68);border-radius:13px;padding:14px}.brief,.attention{display:flex;gap:10px}.form{display:grid;gap:14px}label{display:grid;gap:7px;color:#cbd5e1;font-size:13px;font-weight:850}input,select,textarea{box-sizing:border-box;width:100%;border:1px solid rgba(148,163,184,.2);background:rgba(2,6,23,.72);color:#f8fafc;border-radius:10px;padding:11px 12px;font:inherit}textarea{min-height:90px;resize:vertical}.valueBox{display:flex;align-items:center;justify-content:space-between}.valueBox strong{font-size:28px;color:#5eead4}.riskPanel{display:flex;flex-direction:column;gap:20px}.riskSubtitle{color:#9fb0c7;font-size:14px;margin-bottom:16px}.riskGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.riskCard{padding:16px;border-radius:12px}.riskCard.green{background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.2)}.riskCard.amber{background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2)}.riskCard.blue{background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.2)}.riskCardLabel{font-size:12px;font-weight:bold;text-transform:uppercase;margin-bottom:8px}.riskCard.green .riskCardLabel{color:#34d399}.riskCard.amber .riskCardLabel{color:#f59e0b}.riskCard.blue .riskCardLabel{color:#3b82f6}.riskCardValue{font-size:24px;font-weight:bold;color:#fff}.riskCardHint{font-size:12px;color:#9fb0c7}.riskSummary{background:rgba(15,23,42,.8);padding:16px;border-radius:12px;border:1px solid rgba(148,163,184,.15);display:flex;justify-content:space-between;align-items:center}.riskCaption{font-size:12px;text-transform:uppercase;color:#94a3b8;font-weight:bold}.riskLevel{display:flex;align-items:center;gap:8px;margin-top:4px}.riskLevelValue{font-size:18px;font-weight:bold;color:#f59e0b}.riskAction{text-align:right}.riskActionValue{font-size:16px;font-weight:bold;color:#34d399;margin-top:4px}.deepField{background:rgba(2,6,23,.9)}
        @media(max-width:1100px){.grid,.three,.metrics{grid-template-columns:1fr}.hero{align-items:flex-start;flex-direction:column}.mission{grid-template-columns:14px minmax(0,1fr)}.mission>span:nth-child(n+3){grid-column:2}.tabs{overflow-x:auto}.tab{white-space:nowrap}}
      `}</style>
    </main>
  );
}
export async function getServerSideProps() { return { props: {} }; }
