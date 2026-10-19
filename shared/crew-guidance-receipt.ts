/** Prompt provenance, deliberately distinct from tools_used execution evidence. */
export interface CrewGuidanceReceipt {
  type: 'crew_guidance_receipt';
  version: 1;
  status: 'loaded_into_prompt';
  entries: Array<{ id: string; label: string; version: number; contentHash: string; reason: string }>;
}
