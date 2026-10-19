/**
 * SignoffPanel — prd_ux_design_signoff HIL form + poll + Approval_Gate evaluation.
 */
import React, { useState } from "react";
import { CheckSquare, Loader2, AlertCircle, CheckCircle2, AlertTriangle } from "lucide-react";
import type { HilPollState } from "../lib/hooks";

interface Props {
  onSubmit: (data: SignoffData) => Promise<void>;
  hilPollState: HilPollState;
  signoffStatus: "idle" | "pending" | "approved" | "changes_requested" | null;
  scopingComments: string | null;
  disabled: boolean;
}

export interface SignoffData {
  prdStatus: string;
  uxMockupStatus: string;
  designSystemCompliance: string;
  scopingComments: string;
  reviewedStoryPoints: number;
}

interface FieldError {
  prdStatus?: string;
  uxMockupStatus?: string;
  designSystemCompliance?: string;
  reviewedStoryPoints?: string;
}

export function SignoffPanel({ onSubmit, hilPollState, signoffStatus, scopingComments, disabled }: Props) {
  const [prdStatus, setPrdStatus] = useState("Approved");
  const [uxMockupStatus, setUxMockupStatus] = useState("Approved");
  const [designSystemCompliance, setDesignSystemCompliance] = useState("Yes");
  const [comments, setComments] = useState("");
  const [storyPoints, setStoryPoints] = useState<number | "">("");
  const [errors, setErrors] = useState<FieldError>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function validate(): boolean {
    const e: FieldError = {};
    if (!prdStatus) e.prdStatus = "Required";
    if (!uxMockupStatus) e.uxMockupStatus = "Required";
    if (!designSystemCompliance) e.designSystemCompliance = "Required";
    if (!storyPoints || Number(storyPoints) <= 0) e.reviewedStoryPoints = "Must be greater than 0";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({
        prdStatus,
        uxMockupStatus,
        designSystemCompliance,
        scopingComments: comments,
        reviewedStoryPoints: Number(storyPoints),
      });
    } catch (err: any) {
      setSubmitError(err.message ?? "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  // Already approved
  if (signoffStatus === "approved") {
    return (
      <div className="bg-[#111827]/40 border border-emerald-500/20 rounded-xl p-6">
        <div className="flex items-center gap-3 text-emerald-400 mb-2">
          <CheckCircle2 className="w-5 h-5" />
          <h3 className="font-semibold">Approved for Engineering</h3>
        </div>
        <p className="text-xs text-emerald-400/70">PRD and UX mockups have been approved. Core Development can be triggered.</p>
      </div>
    );
  }

  // Changes requested
  if (signoffStatus === "changes_requested") {
    return (
      <div className="bg-[#111827]/40 border border-amber-500/20 rounded-xl p-6">
        <div className="flex items-center gap-3 text-amber-400 mb-2">
          <AlertTriangle className="w-5 h-5" />
          <h3 className="font-semibold">Changes Requested</h3>
        </div>
        {scopingComments && (
          <div className="mt-3 p-3 bg-amber-500/5 border border-amber-500/10 rounded-lg text-sm text-slate-300">
            {scopingComments}
          </div>
        )}
        <p className="text-xs text-amber-400/70 mt-3">Revise the PRD and resubmit for approval.</p>
      </div>
    );
  }

  // Polling state
  if (hilPollState.status === "polling" || signoffStatus === "pending") {
    return (
      <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-6 flex items-center gap-3">
        <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
        <div>
          <p className="text-sm font-semibold text-slate-200">Awaiting platform processing…</p>
          <p className="text-xs text-slate-500">Sign-off submitted. Polling for completion.</p>
        </div>
      </div>
    );
  }

  // Timeout
  if (hilPollState.status === "timeout") {
    return (
      <div className="bg-[#111827]/40 border border-amber-500/20 rounded-xl p-6">
        <div className="flex items-center gap-2 text-amber-400 mb-2">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm font-semibold">Poll timeout — you may resubmit.</span>
        </div>
      </div>
    );
  }

  // Form
  return (
    <div className="bg-[#111827]/40 border border-white/5 rounded-xl p-6">
      <div className="flex items-center gap-2 text-blue-400 mb-5">
        <CheckSquare className="w-5 h-5" />
        <h3 className="font-semibold text-lg">PRD & UX Design Sign-off</h3>
      </div>

      {submitError && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="prd-status" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              PRD Status <span className="text-rose-400">*</span>
            </label>
            <select
              id="prd-status"
              value={prdStatus}
              onChange={(e) => setPrdStatus(e.target.value)}
              disabled={disabled}
              aria-describedby={errors.prdStatus ? "prd-status-error" : undefined}
              aria-invalid={!!errors.prdStatus}
              className={`w-full bg-slate-900 border rounded-lg p-2.5 text-sm focus:outline-none focus:border-blue-500 text-white ${errors.prdStatus ? "border-rose-500" : "border-white/10"}`}
            >
              <option value="Approved">Approved</option>
              <option value="Changes Requested">Changes Requested</option>
            </select>
            {errors.prdStatus && <p id="prd-status-error" role="alert" className="mt-1 text-xs text-rose-400">{errors.prdStatus}</p>}
          </div>

          <div>
            <label htmlFor="ux-status" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              UX Mockups Status <span className="text-rose-400">*</span>
            </label>
            <select
              id="ux-status"
              value={uxMockupStatus}
              onChange={(e) => setUxMockupStatus(e.target.value)}
              disabled={disabled}
              aria-describedby={errors.uxMockupStatus ? "ux-status-error" : undefined}
              aria-invalid={!!errors.uxMockupStatus}
              className={`w-full bg-slate-900 border rounded-lg p-2.5 text-sm focus:outline-none focus:border-blue-500 text-white ${errors.uxMockupStatus ? "border-rose-500" : "border-white/10"}`}
            >
              <option value="Approved">Approved</option>
              <option value="Changes Requested">Changes Requested</option>
            </select>
            {errors.uxMockupStatus && <p id="ux-status-error" role="alert" className="mt-1 text-xs text-rose-400">{errors.uxMockupStatus}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="design-compliance" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Design System Compliance <span className="text-rose-400">*</span>
            </label>
            <select
              id="design-compliance"
              value={designSystemCompliance}
              onChange={(e) => setDesignSystemCompliance(e.target.value)}
              disabled={disabled}
              aria-describedby={errors.designSystemCompliance ? "design-compliance-error" : undefined}
              aria-invalid={!!errors.designSystemCompliance}
              className={`w-full bg-slate-900 border rounded-lg p-2.5 text-sm focus:outline-none focus:border-blue-500 text-white ${errors.designSystemCompliance ? "border-rose-500" : "border-white/10"}`}
            >
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
            {errors.designSystemCompliance && <p id="design-compliance-error" role="alert" className="mt-1 text-xs text-rose-400">{errors.designSystemCompliance}</p>}
          </div>

          <div>
            <label htmlFor="story-points" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Reviewed Story Points <span className="text-rose-400">*</span>
            </label>
            <input
              id="story-points"
              type="number"
              min={1}
              value={storyPoints}
              onChange={(e) => setStoryPoints(e.target.value ? Number(e.target.value) : "")}
              disabled={disabled}
              aria-describedby={errors.reviewedStoryPoints ? "story-points-error" : undefined}
              aria-invalid={!!errors.reviewedStoryPoints}
              className={`w-full bg-slate-900 border rounded-lg p-2.5 text-sm focus:outline-none focus:border-blue-500 text-white ${errors.reviewedStoryPoints ? "border-rose-500" : "border-white/10"}`}
            />
            {errors.reviewedStoryPoints && <p id="story-points-error" role="alert" className="mt-1 text-xs text-rose-400">{errors.reviewedStoryPoints}</p>}
          </div>
        </div>

        <div>
          <label htmlFor="scoping-comments" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
            Scoping Comments
          </label>
          <textarea
            id="scoping-comments"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            disabled={disabled}
            placeholder="Optional feedback or scoping notes..."
            className="w-full h-20 bg-slate-900 border border-white/10 rounded-lg p-2.5 text-sm focus:outline-none focus:border-blue-500 text-white resize-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || disabled}
          className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-sm font-semibold transition-colors"
        >
          {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : "Submit Sign-off"}
        </button>
      </form>
    </div>
  );
}
