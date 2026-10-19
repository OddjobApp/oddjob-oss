export interface TGEntity {
  id: string;          // UUID
  label: string;       // e.g. "Person", "Event"
  properties: Record<string, any>;
  provenance: {
    sourceId: string;  // Oddjob Document/Mission ID
    timestamp: Date;
    evidence: string;  // Raw text extract
  };
}

export interface TGRelationship {
  sourceId: string;
  targetId: string;
  type: string;        // e.g. "WORKS_FOR", "CONTRADICTS"
  confidence: number;
}

export interface TGCoreMetadata {
  missionId: number;
  missionName: string;
  organizationId: number;
  exportedAt: Date;
  version: string;
}


