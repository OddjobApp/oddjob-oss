export interface CrewImportedSkillReceipt {
  type: 'crew_imported_skill_receipt';
  version: 1;
  selectionStatus: 'checked' | 'unavailable';
  entries: Array<{
    reviewId: number; augmentationId: number; skillId: number | null; name: string;
    contractHash: string; reviewedAt: string | null;
    requiredTools: string[]; missingTools: string[];
    status: 'missing_tools' | 'reference_only' | 'not_executed' | 'tool_failure' | 'partial_tool_evidence' | 'tool_evidence';
    calls: Array<{ name: string; ok: boolean }>;
  }>;
}
