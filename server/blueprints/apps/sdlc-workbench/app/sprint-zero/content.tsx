"use client";
import { useState, useCallback } from "react";
import { records, missions, knowledge, telemetry } from "../../lib/platform-client";
import type { KnowledgeResult, MissionTriggerResult } from "../../lib/platform-client";
import { MermaidRenderer } from "../components/MermaidRenderer";

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | 5;

interface BacklogItem {
  id: string;
  title: string;
  priority: "High" | "Medium" | "Low";
}

type ComplianceFramework = "SOC2" | "GDPR" | "OWASP" | "HIPAA" | "PCI-DSS";

const COMPLIANCE_FRAMEWORKS: ComplianceFramework[] = ["SOC2", "GDPR", "OWASP", "HIPAA", "PCI-DSS"];

type LaunchState = "idle" | "saving" | "done" | "error";

// ── Step progress indicator ───────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8 select-none">
      {([1, 2, 3, 4, 5] as Step[]).map((step, idx) => {
        const isCompleted = step < current;
        const isCurrent   = step === current;
        const isFuture    = step > current;
        return (
          <div key={step} className="flex items-center">
            {/* connector line before (skip for step 1) */}
            {idx > 0 && (
              <div
                className={`w-10 h-px transition-colors duration-300 ${
                  step <= current ? "bg-blue-500" : "bg-white/10"
                }`}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all duration-300 ${
                  isCompleted
                    ? "bg-emerald-500/20 border-emerald-500 text-emerald-400"
                    : isCurrent
                    ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/30"
                    : "bg-white/5 border-white/15 text-slate-500"
                }`}
              >
                {isCompleted ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  step
                )}
              </div>
              <span
                className={`text-[10px] font-medium whitespace-nowrap transition-colors duration-300 ${
                  isCurrent ? "text-blue-400" : isCompleted ? "text-emerald-500" : "text-slate-600"
                }`}
              >
                {
                  ["Codebase", "Architecture", "Threat Model", "Backlog", "Launch"][step - 1]
                }
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Field components ──────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  error?: boolean;
  children: React.ReactNode;
  hint?: string;
}

function Field({ label, error, children, hint }: FieldProps) {
  return (
    <div>
      <label className={`text-xs font-medium uppercase tracking-wide ${error ? "text-rose-400" : "text-slate-400"}`}>
        {label}
        {error && <span className="ml-1 normal-case font-normal text-rose-400">— required</span>}
      </label>
      {hint && <p className="text-[11px] text-slate-500 mt-0.5 mb-1">{hint}</p>}
      <div className="mt-1">{children}</div>
    </div>
  );
}

const inputCls = (error?: boolean) =>
  `w-full bg-white/5 border ${
    error ? "border-rose-500/70" : "border-white/10"
  } rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition-colors`;

const textareaCls = (error?: boolean) =>
  `w-full bg-white/5 border ${
    error ? "border-rose-500/70" : "border-white/10"
  } rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition-colors resize-none`;

// ── Navigation buttons ────────────────────────────────────────────────────────

function NavButtons({
  onBack,
  onNext,
  nextLabel = "Next →",
  nextDisabled,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between pt-4 mt-4 border-t border-white/5">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
        >
          ← Back
        </button>
      ) : (
        <div />
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="px-6 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed border border-blue-500/50 shadow-sm shadow-blue-500/20 transition-colors"
      >
        {nextLabel}
      </button>
    </div>
  );
}

// ── Read-only summary helpers ─────────────────────────────────────────────────

function SummarySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/3 border border-white/8 rounded-lg p-4 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-400">{title}</h3>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-slate-500 flex-shrink-0 w-36">{label}</span>
      <span className="text-slate-200 flex-1">{value || <span className="text-slate-600 italic">—</span>}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SprintZeroContent() {
  const [currentStep, setCurrentStep] = useState<Step>(1);

  // Step 1 state
  const [repoUrl, setRepoUrl]     = useState("");
  const [techStack, setTechStack] = useState("");
  const [teamSize, setTeamSize]   = useState("");

  // Step 2 state
  const [architectureSummary, setArchitectureSummary] = useState("");
  const [keyRisks, setKeyRisks]                       = useState("");
  const [kgLoading, setKgLoading]                     = useState(false);
  const [kgStatus, setKgStatus]                       = useState<"idle" | "empty" | "done">("idle");

  // Step 3 state
  const [threatSurface, setThreatSurface]           = useState("");
  const [mitigations, setMitigations]               = useState("");
  const [complianceFrameworks, setComplianceFrameworks] = useState<ComplianceFramework[]>([]);

  // Step 4 state
  const [backlogItems, setBacklogItems]   = useState<BacklogItem[]>([]);
  const [newItemTitle, setNewItemTitle]   = useState("");
  const [newItemPriority, setNewItemPriority] = useState<"High" | "Medium" | "Low">("Medium");
  const [addItemError, setAddItemError]   = useState(false);

  // Step 5 state
  const [launchState, setLaunchState]     = useState<LaunchState>("idle");
  const [launchError, setLaunchError]     = useState<string | null>(null);
  const [launchResult, setLaunchResult]   = useState<MissionTriggerResult | null>(null);

  // Validation errors (per step)
  const [step1Errors, setStep1Errors] = useState<Record<string, boolean>>({});
  const [step2Errors, setStep2Errors] = useState<Record<string, boolean>>({});
  const [step3Errors, setStep3Errors] = useState<Record<string, boolean>>({});

  // ── Validation ──────────────────────────────────────────────────────────────

  function validateStep1(): boolean {
    const errs: Record<string, boolean> = {};
    if (!repoUrl.trim()) errs.repoUrl = true;
    if (!techStack.trim()) errs.techStack = true;
    if (!teamSize || Number(teamSize) < 1) errs.teamSize = true;
    setStep1Errors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateStep2(): boolean {
    const errs: Record<string, boolean> = {};
    if (!architectureSummary.trim()) errs.architectureSummary = true;
    if (!keyRisks.trim()) errs.keyRisks = true;
    setStep2Errors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateStep3(): boolean {
    const errs: Record<string, boolean> = {};
    if (!threatSurface.trim()) errs.threatSurface = true;
    if (!mitigations.trim()) errs.mitigations = true;
    setStep3Errors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  function advanceStep() {
    if (currentStep === 1 && !validateStep1()) return;
    if (currentStep === 2 && !validateStep2()) return;
    if (currentStep === 3 && !validateStep3()) return;
    if (currentStep === 4 && backlogItems.length === 0) { setAddItemError(true); return; }
    setCurrentStep((s) => Math.min(s + 1, 5) as Step);
  }

  function goBack() {
    setCurrentStep((s) => Math.max(s - 1, 1) as Step);
  }

  // ── Knowledge graph populate ────────────────────────────────────────────────

  const handleKgQuery = useCallback(async () => {
    setKgLoading(true);
    setKgStatus("idle");
    try {
      const result = await knowledge.query("architecture overview system design components", 5);
      const top = result.results[0];
      if (top?.content) {
        setArchitectureSummary(top.content);
        setKgStatus("done");
      } else {
        setKgStatus("empty");
      }
    } catch {
      setKgStatus("empty");
    } finally {
      setKgLoading(false);
    }
  }, []);

  // ── Backlog management ──────────────────────────────────────────────────────

  function addBacklogItem() {
    if (!newItemTitle.trim()) { setAddItemError(true); return; }
    setAddItemError(false);
    setBacklogItems((prev) => [
      ...prev,
      { id: `item-${Date.now()}`, title: newItemTitle.trim(), priority: newItemPriority },
    ]);
    setNewItemTitle("");
    setNewItemPriority("Medium");
  }

  function removeBacklogItem(id: string) {
    setBacklogItems((prev) => prev.filter((i) => i.id !== id));
  }

  // ── Mission launch ──────────────────────────────────────────────────────────

  async function handleLaunch() {
    setLaunchState("saving");
    setLaunchError(null);
    try {
      // 1. Persist config
      await records.create("sprint_zero_configs", {
        repoUrl,
        techStack,
        teamSize: Number(teamSize),
        architectureSummary,
        keyRisks,
        threatSurface,
        mitigations,
        complianceFrameworks,
        backlogItems,
        timestamp: new Date().toISOString(),
      });

      // 2. Grounding query (non-blocking — best-effort)
      let knowledgeContext: Array<{ content: string; source: string }> = [];
      try {
        const kgResult = await knowledge.query(
          "project initialization sprint zero architecture best practices",
          3
        );
        knowledgeContext = kgResult.results
          .slice(0, 3)
          .map((r: KnowledgeResult) => ({ content: r.content, source: r.source }));
      } catch {
        // non-blocking — proceed without context
      }

      // 3. Trigger mission
      const result = await missions.trigger("Project Initialization & Sprint Zero", {
        repoUrl,
        techStack,
        teamSize: Number(teamSize),
        architectureSummary,
        keyRisks,
        threatSurface,
        mitigations,
        complianceFrameworks,
        backlogItems,
        knowledgeContext,
        triggeredBy: "sprint-zero-wizard",
      });

      // 4. Telemetry
      telemetry.emit("sprint_zero_launched", "info", {
        repoUrl,
        backlogCount: backlogItems.length,
      });

      setLaunchResult(result);
      setLaunchState("done");
    } catch (err: unknown) {
      setLaunchError(err instanceof Error ? err.message : "Unknown error");
      setLaunchState("error");
    }
  }

  // ── Compliance toggle ────────────────────────────────────────────────────────

  function toggleFramework(fw: ComplianceFramework) {
    setComplianceFrameworks((prev) =>
      prev.includes(fw) ? prev.filter((f) => f !== fw) : [...prev, fw]
    );
  }

  // ── Priority pill colours ────────────────────────────────────────────────────

  function priorityColor(p: "High" | "Medium" | "Low") {
    return p === "High"
      ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
      : p === "Medium"
      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
      : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#090d16] text-white p-6">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            SDLC
          </span>
          <div>
            <h1 className="text-2xl font-bold leading-none">Sprint Zero Setup</h1>
            <p className="text-xs text-slate-500 mt-1">Mission-0: Project Initialization &amp; Sprint Zero</p>
          </div>
        </div>

        {/* Progress indicator */}
        <StepIndicator current={currentStep} />

        {/* ── Step 1: Codebase Context ─────────────────────────────────────── */}
        {currentStep === 1 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-white">Codebase Context</h2>
              <p className="text-xs text-slate-500 mt-0.5">Tell the mission about your repository and team.</p>
            </div>

            <Field label="Repository URL" error={step1Errors.repoUrl}>
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => { setRepoUrl(e.target.value); setStep1Errors((p) => ({ ...p, repoUrl: false })); }}
                placeholder="https://github.com/org/repo"
                className={inputCls(step1Errors.repoUrl)}
              />
            </Field>

            <Field label="Tech Stack" error={step1Errors.techStack}
              hint="Describe your tech stack: languages, frameworks, databases">
              <textarea
                rows={4}
                value={techStack}
                onChange={(e) => { setTechStack(e.target.value); setStep1Errors((p) => ({ ...p, techStack: false })); }}
                placeholder="e.g. TypeScript / Next.js frontend, Node.js API, PostgreSQL, Redis, deployed on AWS ECS"
                className={textareaCls(step1Errors.techStack)}
              />
            </Field>

            <Field label="Team Size" error={step1Errors.teamSize}>
              <input
                type="number"
                min={1}
                value={teamSize}
                onChange={(e) => { setTeamSize(e.target.value); setStep1Errors((p) => ({ ...p, teamSize: false })); }}
                placeholder="e.g. 6"
                className={`${inputCls(step1Errors.teamSize)} w-32`}
              />
            </Field>

            <NavButtons onNext={advanceStep} />
          </div>
        )}

        {/* ── Step 2: Architecture Brief ───────────────────────────────────── */}
        {currentStep === 2 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-white">Architecture Brief</h2>
              <p className="text-xs text-slate-500 mt-0.5">Describe the system structure and known technical risks.</p>
            </div>

            <Field label="Architecture Summary" error={step2Errors.architectureSummary}
              hint="Describe system architecture: key components, data flow, external dependencies">
              <textarea
                rows={5}
                value={architectureSummary}
                onChange={(e) => { setArchitectureSummary(e.target.value); setStep2Errors((p) => ({ ...p, architectureSummary: false })); }}
                placeholder="e.g. Monorepo with separate frontend and API packages. API follows RESTful conventions with a message-queue layer for async jobs…"
                className={textareaCls(step2Errors.architectureSummary)}
              />
            </Field>

            {/* Knowledge Graph button */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleKgQuery}
                disabled={kgLoading}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 transition-colors disabled:opacity-50"
              >
                {kgLoading ? "Querying knowledge graph…" : "Generate from Knowledge Graph"}
              </button>
              {kgStatus === "empty" && !kgLoading && (
                <span className="text-xs text-slate-500">No relevant context found</span>
              )}
              {kgStatus === "done" && !kgLoading && (
                <span className="text-xs text-emerald-500">Populated from knowledge graph</span>
              )}
            </div>

            {/* Architecture Flowchart Preview */}
            <MermaidRenderer
              chart={`graph TD
  Client[Web Client & Workbench App] --> Gateway[API Gateway / Next.js Proxy]
  Gateway --> Service[Domain Application Services]
  Service --> DB[(PostgreSQL Database)]
  Service --> Queue[BullMQ Message Queue]
  Queue --> Agents[Autonomous Agent Fleet]`}
              scope="sprint-zero-architecture"
            />

            <Field label="Key Technical Risks" error={step2Errors.keyRisks}
              hint="Known technical risks or constraints">
              <textarea
                rows={3}
                value={keyRisks}
                onChange={(e) => { setKeyRisks(e.target.value); setStep2Errors((p) => ({ ...p, keyRisks: false })); }}
                placeholder="e.g. Legacy authentication module, no unit-test coverage on payments service, unclear third-party API SLAs"
                className={textareaCls(step2Errors.keyRisks)}
              />
            </Field>

            <NavButtons onBack={goBack} onNext={advanceStep} />
          </div>
        )}

        {/* ── Step 3: Threat Model ─────────────────────────────────────────── */}
        {currentStep === 3 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-white">Threat Model</h2>
              <p className="text-xs text-slate-500 mt-0.5">Identify your attack surface, controls, and compliance scope.</p>
            </div>

            <Field label="Threat Surface" error={step3Errors.threatSurface}
              hint="What assets / endpoints / data are most sensitive?">
              <textarea
                rows={4}
                value={threatSurface}
                onChange={(e) => { setThreatSurface(e.target.value); setStep3Errors((p) => ({ ...p, threatSurface: false })); }}
                placeholder="e.g. /api/payments, user PII in PostgreSQL users table, admin dashboard, OAuth tokens stored in localStorage"
                className={textareaCls(step3Errors.threatSurface)}
              />
            </Field>

            <Field label="Mitigations" error={step3Errors.mitigations}
              hint="Existing security controls and mitigations">
              <textarea
                rows={3}
                value={mitigations}
                onChange={(e) => { setMitigations(e.target.value); setStep3Errors((p) => ({ ...p, mitigations: false })); }}
                placeholder="e.g. TLS 1.2+ enforced, JWT with 15-min expiry, rate limiting via Nginx, secrets managed via AWS Secrets Manager"
                className={textareaCls(step3Errors.mitigations)}
              />
            </Field>

            <Field label="Compliance Frameworks">
              <div className="flex flex-wrap gap-2 mt-1">
                {COMPLIANCE_FRAMEWORKS.map((fw) => {
                  const selected = complianceFrameworks.includes(fw);
                  return (
                    <button
                      key={fw}
                      type="button"
                      onClick={() => toggleFramework(fw)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                        selected
                          ? "bg-blue-600/30 border-blue-500/60 text-blue-300"
                          : "bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-300"
                      }`}
                    >
                      {fw}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-600 mt-2">Select all that apply — none required</p>
            </Field>

            <NavButtons onBack={goBack} onNext={advanceStep} />
          </div>
        )}

        {/* ── Step 4: Initial Backlog ──────────────────────────────────────── */}
        {currentStep === 4 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-white">Initial Backlog</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Add at least one backlog item to seed the sprint. You can add more after launch.
              </p>
            </div>

            {/* Add item form */}
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <input
                  type="text"
                  value={newItemTitle}
                  onChange={(e) => { setNewItemTitle(e.target.value); setAddItemError(false); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBacklogItem(); } }}
                  placeholder="Backlog item title…"
                  className={inputCls(addItemError && !newItemTitle.trim())}
                />
              </div>
              <select
                value={newItemPriority}
                onChange={(e) => setNewItemPriority(e.target.value as "High" | "Medium" | "Low")}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-blue-500/60"
              >
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
              <button
                type="button"
                onClick={addBacklogItem}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white border border-blue-500/50 transition-colors"
              >
                Add
              </button>
            </div>
            {addItemError && backlogItems.length === 0 && (
              <p className="text-xs text-rose-400 -mt-2">At least one backlog item is required to continue.</p>
            )}
            {addItemError && !newItemTitle.trim() && backlogItems.length > 0 && (
              <p className="text-xs text-rose-400 -mt-2">Enter an item title before adding.</p>
            )}

            {/* Item list */}
            {backlogItems.length > 0 && (
              <div className="space-y-2">
                {backlogItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/3 border border-white/8"
                  >
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border flex-shrink-0 ${priorityColor(item.priority)}`}
                    >
                      {item.priority}
                    </span>
                    <span className="text-sm text-white flex-1">{item.title}</span>
                    <button
                      type="button"
                      onClick={() => removeBacklogItem(item.id)}
                      className="text-slate-600 hover:text-rose-400 transition-colors text-base leading-none w-5 h-5 flex items-center justify-center rounded"
                      aria-label="Remove item"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {backlogItems.length === 0 && (
              <div className="text-center py-6 text-slate-600 text-sm border border-dashed border-white/8 rounded-lg">
                No items yet — add at least one to continue.
              </div>
            )}

            <NavButtons onBack={goBack} onNext={advanceStep} />
          </div>
        )}

        {/* ── Step 5: Review & Launch ──────────────────────────────────────── */}
        {currentStep === 5 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-white">Review &amp; Launch</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Confirm all details before triggering the Sprint Zero mission.
              </p>
            </div>

            {/* Summary */}
            <div className="space-y-3">
              <SummarySection title="Codebase Context">
                <SummaryRow label="Repository URL" value={repoUrl} />
                <SummaryRow label="Tech Stack"
                  value={<span className="whitespace-pre-wrap">{techStack}</span>} />
                <SummaryRow label="Team Size" value={teamSize ? `${teamSize} engineers` : ""} />
              </SummarySection>

              <SummarySection title="Architecture Brief">
                <SummaryRow
                  label="Architecture"
                  value={<span className="whitespace-pre-wrap line-clamp-4">{architectureSummary}</span>}
                />
                <SummaryRow
                  label="Key Risks"
                  value={<span className="whitespace-pre-wrap line-clamp-3">{keyRisks}</span>}
                />
              </SummarySection>

              <SummarySection title="Threat Model">
                <SummaryRow
                  label="Threat Surface"
                  value={<span className="whitespace-pre-wrap line-clamp-3">{threatSurface}</span>}
                />
                <SummaryRow
                  label="Mitigations"
                  value={<span className="whitespace-pre-wrap line-clamp-3">{mitigations}</span>}
                />
                <SummaryRow
                  label="Compliance"
                  value={
                    complianceFrameworks.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {complianceFrameworks.map((fw) => (
                          <span
                            key={fw}
                            className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30"
                          >
                            {fw}
                          </span>
                        ))}
                      </div>
                    ) : (
                      "None selected"
                    )
                  }
                />
              </SummarySection>

              <SummarySection title={`Initial Backlog (${backlogItems.length} items)`}>
                <div className="space-y-1.5">
                  {backlogItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 text-sm">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border flex-shrink-0 ${priorityColor(item.priority)}`}
                      >
                        {item.priority}
                      </span>
                      <span className="text-slate-200">{item.title}</span>
                    </div>
                  ))}
                </div>
              </SummarySection>
            </div>

            {/* Launch section */}
            <div className="pt-2 border-t border-white/5">
              {launchState === "done" && launchResult ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-semibold text-sm">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Sprint Zero Mission triggered
                  </div>
                  <div className="text-xs text-slate-500">
                    Run ID:{" "}
                    <span className="font-mono text-slate-300">{launchResult.runId}</span>
                    {" · "}
                    Status:{" "}
                    <span className="text-blue-400">{launchResult.status}</span>
                  </div>
                </div>
              ) : (
                <>
                  {launchError && (
                    <div className="mb-3 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400">
                      {launchError}
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={goBack}
                      disabled={launchState === "saving"}
                      className="px-5 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors disabled:opacity-40"
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      onClick={handleLaunch}
                      disabled={launchState === "saving"}
                      className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed border border-blue-500/50 shadow-sm shadow-blue-500/20 transition-colors"
                    >
                      {launchState === "saving" ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          Saving &amp; triggering mission…
                        </span>
                      ) : (
                        "Trigger Sprint Zero Mission"
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
