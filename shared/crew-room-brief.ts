import { z } from 'zod';

export const crewRoomBriefSchema = z.object({
  objective: z.string().trim().min(1).max(2000),
  successCriteria: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  constraints: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
});
export type CrewRoomBrief = z.infer<typeof crewRoomBriefSchema>;

export function formatCrewRoomBrief(brief?: CrewRoomBrief): string {
  if (!brief) return '';
  return `\nUser-defined room objective: ${brief.objective}\nSuccess criteria:\n${brief.successCriteria.map(item => `- ${item}`).join('\n')}\nScope constraints:\n${brief.constraints.map(item => `- ${item}`).join('\n') || 'None specified'}\nTreat these as the standing brief. Report unmet criteria and evidence gaps explicitly; conversation or consensus alone does not establish completion.\n`;
}
