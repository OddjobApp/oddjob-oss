import { createHash } from "node:crypto";
import type { GovernanceDecision, KnowledgePackManifest } from "@shared/schema/knowledge-packs.js";

export interface GovernedActionResult {
  decision: GovernanceDecision;
  applicableControls: string[];
  missingContext: string[];
  reasons: string[];
  safeNextActions: string[];
  contextHash: string;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function hashGovernanceContext(actionType: string, context: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(stable({ actionType, context })).digest("hex")}`;
}

function conditionTriggers(condition: KnowledgePackManifest["controls"][number]["conditions"][number], context: Record<string, unknown>): boolean {
  const actual = context[condition.field];
  if (condition.operator === "known") return actual === undefined || actual === null || actual === "";
  if (condition.operator === "equals") return actual === condition.value;
  if (condition.operator === "not_equals") return actual !== condition.value;
  const expectedField = String(condition.value || "");
  return actual !== context[expectedField];
}

export function evaluateKnowledgePack(manifest: KnowledgePackManifest, actionType: string, context: Record<string, unknown>): GovernedActionResult {
  const controls = manifest.controls.filter(control => control.actionTypes.includes(actionType));
  const missing = new Set<string>();
  for (const control of controls) for (const field of control.requiredContext) {
    if (context[field] === undefined || context[field] === null || context[field] === "") missing.add(field);
  }
  const contextHash = hashGovernanceContext(actionType, context);
  if (missing.size) return {
    decision: "INSUFFICIENT_CONTEXT",
    applicableControls: controls.map(control => control.id),
    missingContext: [...missing].sort(),
    reasons: ["Required governance context is missing; deny-by-default applies."],
    safeNextActions: ["Resolve missing context from trusted organization systems."],
    contextHash,
  };

  const triggered = controls.filter(control => control.conditions.every(condition => conditionTriggers(condition, context)));
  const blocked = triggered.filter(control => control.effect === "BLOCK");
  const approval = triggered.filter(control => control.effect === "APPROVAL_REQUIRED");
  const selected = blocked.length ? blocked : approval;
  return {
    decision: blocked.length ? "BLOCK" : approval.length ? "APPROVAL_REQUIRED" : "ALLOW",
    applicableControls: controls.map(control => control.id),
    missingContext: [],
    reasons: selected.map(control => `${control.id}: ${control.description}`),
    safeNextActions: [...new Set(selected.flatMap(control => control.remediation))],
    contextHash,
  };
}

export function versionSatisfies(version: string, range: string): boolean {
  const tuple = (v: string) => v.split(".").map(Number);
  const compare = (a: number[], b: number[]) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
  const current = tuple(version);
  return range.trim().split(/\s+/).every(part => {
    const match = part.match(/^(>=|>|<=|<|=)?(\d+\.\d+\.\d+)$/);
    if (!match) return false;
    const diff = compare(current, tuple(match[2]));
    return match[1] === ">=" ? diff >= 0 : match[1] === ">" ? diff > 0 : match[1] === "<=" ? diff <= 0 : match[1] === "<" ? diff < 0 : diff === 0;
  });
}

