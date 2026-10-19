/**
 * CapacityPanel — Sprint capacity HIL form + AI plan output + Mission-1 trigger.
 */
import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Calendar, RefreshCw, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { hil, missions, telemetry } from "../lib/platform-client";
import type { CapacityPlanRecord } from "../lib/collections";

interface Props {
  sprintNumber: number;
  existingPlan: CapacityPlanRecord | null;
  onPlanSaved: (plan: CapacityPlanRecord) => void;
  onMission1Started: (runId: number) => void;
}

interface FieldError { sprintNumber?: string; availableEngineerDays?: string; targetVelocity?: string }

const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS  = 5 * 60 * 1000;

export function CapacityPanel({ sprintNumber: defaultSprint, existingPlan, onPlanSaved, onMission1Started }: Props) {
  const [sprintNum, setSprintNum]     = useState(existingPlan?.sprintNumber ?? defaultSprint);
  const [engDays, setEngDays]         = useState(existingPlan?.availableEngineerDays ?? 0);
  const [velocity, setVelocity]       = useState(existingPlan?.targetVelocity ?? 0);
  const [errors, setErrors]           = useState<FieldError>({});
  const [submitting, setSubmitting]   = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [polling, setPolling]         = useState(false);
  const [pollTimeout, setPollTimeout] = useState(false);
  const [planData, setPlanData]       = useState<Record<string, unknown> | null>(
    existingPlan?.planData ?? null
  );

  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hilFormId  = useRef<number | null>(existingPlan?.hilFormId ?? null);

  // Sync from restored plan
  useEffect(() => {
    if (existingPlan) {
      setSprintNum(existingPlan.sprintNumber);
      setEngDays(existingPlan.availableEngineerDays);
      setVelocity(existingPlan.targetVelocity);
      if (existingPlan.planData) setPlanData(existingPlan.planData);
    }
  }, [existingPlan]);

  function validate(): boolean {
    const e: FieldError = {};
    if (!sprintNum || sprintNum <= 0) e.sprintNumber = "Sprint number must be greater than 0";
    if (!engDays   || engDays   <= 0) e.availableEngineerDays = "Engineer-days must be greater than 0";
    if (!velocity  || velocity  <= 0) e.targetVelocity = "Target velocity must be greater than 0";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function stopPolling() {
    if (pollRef.current)    clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollRef.current    = null;
    timeoutRef.current = null;
  }

  async function pollHil(formId: number, plan: CapacityPlanRecord, onUpdate: (p: CapacityPlanRecord) => void) {
    try {
      const result = await hil.poll(formId);
      if (result.status === "completed") {
        stopPolling();
        setPolling(false);
        const updated: CapacityPlanRecord = {
          ...plan,
          hilCompletedAt: new Date().toISOString(),
          planData: result.result ?? {},
        };
        setPlanData(result.result ?? {});
        onUpdate(updated);
      }
    } catch {
      // continue polling — errors are tolerated until timeout
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      // 1. Create HIL form
      const hilResult = await hil.create(
        `Sprint ${sprintNum} capacity planning: ${engDays} engineer-days, target velocity ${velocity} SP.`,
        { sprintNumber: sprintNum, availableEngineerDays: engDays, targetVelocity: velocity }
      );
      hilFormId.current = hilResult.id;

      const plan: CapacityPlanRecord = {
        sprintNumber: sprintNum,
        availableEngineerDays: engDays,
        targetVelocity: velocity,
        hilFormId: hilResult.id,
        submittedAt: new Date().toISOString(),
      };
      onPlanSaved(plan);

      telemetry.emit("capacity_form_submitted", "info", {
        sprintNumber: sprintNum, availableEngineerDays: engDays, targetVelocity: velocity,
      });

      // 2. Trigger Mission-1
      const missionResult = await missions.trigger("Sprint Kickoff & Planning", {
        sprintNumber: sprintNum, availableEngineerDays: engDays, targetVelocity: velocity,
      });
      onMission1Started(missionResult.runId);
      onPlanSaved({ ...plan, mission1RunId: missionResult.runId, mission1TriggeredAt: new Date().toISOString() });

      // 3. Start HIL polling
      setPolling(true);
      setPollTimeout(false);
      pollRef.current = setInterval(() => pollHil(hilResult.id, plan, onPlanSaved), POLL_INTERVAL_MS);
      timeoutRef.current = setTimeout(() => {
        stopPolling();
        setPolling(false);
        setPollTimeout(true);
      }, POLL_TIMEOUT_MS);

    } catch (err: any) {
      setSubmitError(err.message ?? "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleRetry() {
    setPollTimeout(false);
    setSubmitError(null);
  }

  const alreadyCompleted = !!existingPlan?.hilCompletedAt;

  return (
    <div className="space-y-6">
      <div className="bg-[#15121e]/40 border border-white/5 rounded-xl p-6">
        <div className="flex items-center gap-2 text-amber-400 mb-5">
          <Calendar className="w-5 h-5" />
          <h3 className="font-semibold text-lg">Sprint Capacity & Planning</h3>
        </div>

        {/* Submit error */}
        {submitError && (
          <div className="mb-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">{submitError}</div>
            <button onClick={handleRetry} className="underline shrink-0">Retry</button>
          </div>
        )}

        {/* Poll timeout warning */}
        {pollTimeout && (
          <div className="mb-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">AI capacity plan is taking longer than expected. You can resubmit or check back later.</div>
            <button onClick={handleRetry} className="underline shrink-0">Dismiss</button>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Sprint Number */}
            <div>
              <label htmlFor="sprint-number" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Sprint Number <span className="text-rose-400">*</span>
              </label>
              <input
                id="sprint-number"
                type="number"
                min={1}
                value={sprintNum || ""}
                onChange={(e) => setSprintNum(Number(e.target.value))}
                aria-describedby={errors.sprintNumber ? "sprint-number-error" : undefined}
                aria-invalid={errors.sprintNumber ? "true" : "false"}
                className={`w-full bg-[#100d17] border rounded-lg p-2.5 text-sm focus:outline-none focus:border-amber-500 text-white transition-colors ${
                  errors.sprintNumber ? "border-rose-500" : "border-white/10"
                }`}
              />
              {errors.sprintNumber && (
                <p id="sprint-number-error" role="alert" className="mt-1 text-xs text-rose-400">{errors.sprintNumber}</p>
              )}
            </div>

            {/* Engineer Days */}
            <div>
              <label htmlFor="eng-days" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Engineer-Days <span className="text-rose-400">*</span>
              </label>
              <input
                id="eng-days"
                type="number"
                min={1}
                value={engDays || ""}
                onChange={(e) => setEngDays(Number(e.target.value))}
                aria-describedby={errors.availableEngineerDays ? "eng-days-error" : undefined}
                aria-invalid={errors.availableEngineerDays ? "true" : "false"}
                className={`w-full bg-[#100d17] border rounded-lg p-2.5 text-sm focus:outline-none focus:border-amber-500 text-white transition-colors ${
                  errors.availableEngineerDays ? "border-rose-500" : "border-white/10"
                }`}
              />
              {errors.availableEngineerDays && (
                <p id="eng-days-error" role="alert" className="mt-1 text-xs text-rose-400">{errors.availableEngineerDays}</p>
              )}
            </div>

            {/* Target Velocity */}
            <div>
              <label htmlFor="target-velocity" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Target Velocity (SP) <span className="text-rose-400">*</span>
              </label>
              <input
                id="target-velocity"
                type="number"
                min={1}
                value={velocity || ""}
                onChange={(e) => setVelocity(Number(e.target.value))}
                aria-describedby={errors.targetVelocity ? "target-velocity-error" : undefined}
                aria-invalid={errors.targetVelocity ? "true" : "false"}
                className={`w-full bg-[#100d17] border rounded-lg p-2.5 text-sm focus:outline-none focus:border-amber-500 text-white transition-colors ${
                  errors.targetVelocity ? "border-rose-500" : "border-white/10"
                }`}
              />
              {errors.targetVelocity && (
                <p id="target-velocity-error" role="alert" className="mt-1 text-xs text-rose-400">{errors.targetVelocity}</p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || polling}
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            {submitting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
            ) : polling ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Awaiting AI capacity plan…</>
            ) : alreadyCompleted ? (
              "Resubmit Capacity Plan"
            ) : (
              "Save & Trigger Sprint Kickoff"
            )}
          </button>
        </form>
      </div>

      {/* AI Plan Output */}
      {/* renderScalar: safely converts any AI-returned value to a display string.
          Missions can return numbers, strings, or nested objects for the same field. */}
      {planData && (() => {
        const renderScalar = (v: unknown): string => {
          if (v === null || v === undefined) return "";
          if (typeof v === "object") return JSON.stringify(v);
          return String(v);
        };
        return (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[#15121e]/40 border border-amber-500/20 rounded-xl p-6"
        >
          <div className="flex items-center gap-2 text-amber-400 mb-4">
            <CheckCircle2 className="w-5 h-5" />
            <h3 className="font-semibold">AI Capacity Plan</h3>
          </div>
          <div className="space-y-3 text-sm text-slate-300">
            {planData.recommendedAllocation !== undefined && (
              <div className="flex justify-between">
                <span className="text-slate-400">Recommended SP Allocation</span>
                <span className="font-bold text-white">{renderScalar(planData.recommendedAllocation)} SP</span>
              </div>
            )}
            {planData.capacityUtilization !== undefined && (
              <div className="flex justify-between">
                <span className="text-slate-400">Capacity Utilization</span>
                <span className="font-bold text-white">{renderScalar(planData.capacityUtilization)}%</span>
              </div>
            )}
            {!!planData.notes && (
              <div className="mt-3 p-3 bg-white/5 rounded-lg text-xs text-slate-300 leading-relaxed">
                {renderScalar(planData.notes)}
              </div>
            )}
            {planData.recommendedAllocation === undefined && planData.notes === undefined && (
              <pre className="text-xs text-slate-400 whitespace-pre-wrap break-all">
                {JSON.stringify(planData, null, 2)}
              </pre>
            )}
          </div>
        </motion.div>
        );
      })()}
    </div>
  );
}
