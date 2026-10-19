import { getOddjobCapabilityManifest } from "@shared/product/oddjob-capability-manifest.js";

export const MISSION_CONTROL_REPLY_STATUSES = [
  "active",
  "paused",
  "waiting_on_file",
  "waiting_on_human",
] as const;

export type MissionControlReplyStatus = (typeof MISSION_CONTROL_REPLY_STATUSES)[number];

export function shouldScheduleMissionControlReply(status?: string | null): status is MissionControlReplyStatus {
  return MISSION_CONTROL_REPLY_STATUSES.includes(status as MissionControlReplyStatus);
}

export function buildCopilotGuidePrompt(): string {
  const { copilotGuide } = getOddjobCapabilityManifest();
  const commands = copilotGuide.commands
    .map((command) => `- ${command.label}: ${command.intent} Risk=${command.riskLevel}; approval=${command.requiresApproval ? "yes" : "no"}.`)
    .join("\n");
  const trustQuestions = copilotGuide.trustQuestions
    .map((question) => `- ${question.question} Include: ${question.answerShouldInclude.join(", ")}.`)
    .join("\n");

  return `Oddjob Copilot operating guide:
${copilotGuide.operatingMode}

Safe command intents:
${commands}

When explaining a recommendation, be ready to answer:
${trustQuestions}

Rules:
- Prefer ontology-backed real objects when discussing operational state.
- Clearly identify approval-required, write, external, or high-risk actions before they happen.
- Explain sources, risk, affected objects, and replay/audit evidence when relevant.
- Keep prediction intelligence advisory unless validation evidence is present.`;
}

export function buildMissionControlSystemPrompt(input: {
  missionName: string;
  missionObjective: string;
  missionStatus: MissionControlReplyStatus;
  ragContext?: unknown;
}): string {
  const ragContext = typeof input.ragContext === "string"
    ? input.ragContext
    : input.ragContext
      ? JSON.stringify(input.ragContext, null, 2)
      : "";
  return `You are Mission Control (AI). A mission is currently ${input.missionStatus.replaceAll("_", " ")}.
The user has just sent a message regarding the mission.
Context:
- Mission Name: ${input.missionName}
- Mission Objective: ${input.missionObjective}
- Mission Run Status: ${input.missionStatus}
${ragContext}
${buildCopilotGuidePrompt()}
Reply to the user's message concisely.
If they ask for status, report the actual mission run status.
If they provide a new directive, confirm receipt and clarify that it will be incorporated into the blackboard context for workers to see.
If the user asks about reference materials or templates, use the MISSION REFERENCE MATERIALS above to provide accurate information.
If the user asks for a risky action, explain the approval requirement and affected objects before implying execution.`;
}
