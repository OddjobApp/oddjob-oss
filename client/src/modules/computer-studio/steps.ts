/**
 * Turns recorded task steps into what a person reads in the studio's timeline.
 * Pure, so the wording is tested without rendering.
 */
import type { StudioStep } from "./types";

export type StepTone = "neutral" | "success" | "attention" | "danger" | "skill" | "human";

export interface DescribedStep {
  title: string;
  detail?: string;
  tone: StepTone;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function describeStep(step: StudioStep): DescribedStep {
  const plan = step.plan ?? {};
  const result = step.result ?? {};
  const failed = step.status === "failed" || !!step.error;

  switch (step.phase) {
    case "action":
    case "confirmation_execution":
      return {
        title: `${step.phase === "confirmation_execution" ? "Approved action ran" : "Action"}: ${step.action ?? "unknown"}`,
        detail: text(step.error) ?? text(plan.intent),
        tone: failed ? "danger" : "neutral",
      };
    case "skill_replay": {
      const skill = text(plan.skill) ?? text(step.action) ?? "learned skill";
      if (step.status === "guided") {
        return { title: `Following learned skill "${skill}"`, detail: "Supervised mode: the agent follows its saved procedure one approved action at a time.", tone: "skill" };
      }
      if (typeof plan.step === "number") {
        return { title: `Replayed "${skill}", step ${plan.step}: ${step.action ?? ""}`.trim(), tone: "skill" };
      }
      if (step.status === "skipped") {
        return { title: step.action ? `Learned skill "${skill}" not replayed` : "No learned skill used", detail: text(step.error) ?? text(result.reason), tone: "neutral" };
      }
      if (result.completed === true) {
        return { title: `Learned skill "${skill}" ran all ${result.totalSteps ?? ""} steps`.replace("  ", " "), detail: "The agent checks the screen and finishes the task.", tone: "skill" };
      }
      return {
        title: `Learned skill "${skill}" stopped after ${result.stepsRun ?? 0} of ${result.totalSteps ?? "?"} steps`,
        detail: `${text(result.stoppedAt?.reason) ?? "The page no longer matched"}. The agent takes over from here.`,
        tone: "attention",
      };
    }
    case "awaiting_confirmation":
      if (step.decision === "governance") return { title: "Waiting for approval to start", detail: text(plan.explanation), tone: "attention" };
      if (step.decision === "yield") return { title: "Handed to you", detail: text(plan.explanation), tone: "human" };
      if (step.decision === "safety") return { title: "Asked before acting", detail: text(plan.explanation), tone: "attention" };
      return { title: `Waiting for your approval: ${step.action ?? "next action"}`, detail: text(plan.intent), tone: "attention" };
    case "confirmation":
      return step.decision === "rejected" || step.status === "cancelled"
        ? { title: "You rejected it", tone: "danger" }
        : { title: "You approved it", tone: "success" };
    case "takeover_recorded":
      return {
        title: `Your takeover was recorded (${result.steps ?? 0} step${result.steps === 1 ? "" : "s"})`,
        detail: "It is being drafted into a skill an admin can approve.",
        tone: "human",
      };
    case "safety_block":
    case "governance_block":
      return { title: "Blocked", detail: text(plan.explanation) ?? text(step.error), tone: "danger" };
    case "cancel":
      return { title: "Cancelled", tone: "danger" };
    default:
      return { title: step.phase.replaceAll("_", " "), detail: text(step.error), tone: failed ? "danger" : "neutral" };
  }
}

/** The learned skill a task used, if any: its id and name as recorded in the steps. */
export function skillUsed(steps: StudioStep[], metadataSkillId?: string): { id?: string; name?: string } | undefined {
  for (const step of steps) {
    if (step.phase !== "skill_replay") continue;
    const id = (step.plan?.skillId ?? step.result?.skillId) as string | undefined;
    const name = (step.plan?.skill ?? step.action) as string | undefined;
    if (id || (name && step.status !== "skipped")) return { id, name };
  }
  return metadataSkillId ? { id: metadataSkillId } : undefined;
}

/** The recording made from the person's takeover in this task, if one was captured. */
export function takeoverRecording(steps: StudioStep[]): { recordingId: string; steps: number; at: string } | undefined {
  const step = [...steps].reverse().find((s) => s.phase === "takeover_recorded" && typeof s.result?.recordingId === "string");
  return step ? { recordingId: step.result!.recordingId, steps: Number(step.result!.steps ?? 0), at: step.createdAt } : undefined;
}

/** How long to keep saying a draft is on its way before calling it a failure. */
export const DRAFTING_GRACE_MS = 5 * 60 * 1000;
