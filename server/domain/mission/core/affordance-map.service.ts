/**
 * Affordance Map Service
 *
 * Stores learned opportunities for action in a mission context. The planner can
 * ask "what can I do in this state?" without needing to replay every prior
 * exploration attempt.
 */

export type AffordanceTargetKind = 'ui' | 'api' | 'file' | 'tool' | 'system';
export type AffordanceActionKind = 'click' | 'type' | 'submit' | 'navigate' | 'call' | 'read' | 'write' | 'execute';
export type AffordanceOutcomeStatus = 'success' | 'failure' | 'unknown';

export interface AffordanceStateDescriptor {
    kind: AffordanceTargetKind;
    signature: string;
    label?: string;
    url?: string;
    selector?: string;
    method?: string;
    path?: string;
    metadata?: Record<string, any>;
}

export interface AffordanceObservation {
    id: string;
    missionId: number;
    observedBy: string;
    state: AffordanceStateDescriptor;
    action: {
        kind: AffordanceActionKind;
        description: string;
        parameters?: Record<string, any>;
    };
    outcome: {
        status: AffordanceOutcomeStatus;
        description: string;
        stateDelta?: Record<string, any>;
        rewardHint?: number;
    };
    confidence: number;
    evidence: string[];
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
}

export interface AffordanceQuery {
    missionId: number;
    kind?: AffordanceTargetKind;
    signature?: string;
    labelIncludes?: string;
    actionKind?: AffordanceActionKind;
    minConfidence?: number;
    tags?: string[];
    limit?: number;
}

const observations = new Map<string, AffordanceObservation>();

function createId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function normalizeConfidence(confidence: number | undefined, status: AffordanceOutcomeStatus): number {
    if (typeof confidence === 'number') {
        return Math.max(0, Math.min(1, confidence));
    }
    if (status === 'success') return 0.8;
    if (status === 'failure') return 0.35;
    return 0.5;
}

function calculateActionScore(observation: AffordanceObservation): number {
    const statusWeight = observation.outcome.status === 'success'
        ? 1
        : observation.outcome.status === 'failure'
            ? -0.25
            : 0.25;
    const reward = observation.outcome.rewardHint ?? 0;
    return observation.confidence + statusWeight + reward;
}

export const affordanceMapService = {
    recordObservation(
        observation: Omit<AffordanceObservation, 'id' | 'confidence' | 'createdAt' | 'updatedAt'> & {
            confidence?: number;
        }
    ): AffordanceObservation {
        const now = new Date();
        const record: AffordanceObservation = {
            id: createId('affordance'),
            createdAt: now,
            updatedAt: now,
            ...observation,
            confidence: normalizeConfidence(observation.confidence, observation.outcome.status),
        };

        observations.set(record.id, record);
        return record;
    },

    getObservation(id: string): AffordanceObservation | undefined {
        return observations.get(id);
    },

    queryAffordances(query: AffordanceQuery): AffordanceObservation[] {
        let results = Array.from(observations.values()).filter(observation => {
            if (observation.missionId !== query.missionId) return false;
            if (query.kind && observation.state.kind !== query.kind) return false;
            if (query.signature && observation.state.signature !== query.signature) return false;
            if (query.actionKind && observation.action.kind !== query.actionKind) return false;
            if (typeof query.minConfidence === 'number' && observation.confidence < query.minConfidence) return false;
            if (query.labelIncludes) {
                const label = observation.state.label ?? '';
                if (!label.toLowerCase().includes(query.labelIncludes.toLowerCase())) return false;
            }
            if (query.tags?.length && !query.tags.every(tag => observation.tags.includes(tag))) return false;
            return true;
        });

        results = results.sort((a, b) => calculateActionScore(b) - calculateActionScore(a));
        return typeof query.limit === 'number' ? results.slice(0, query.limit) : results;
    },

    suggestActions(query: AffordanceQuery): Array<{
        action: AffordanceObservation['action'];
        state: AffordanceStateDescriptor;
        confidence: number;
        score: number;
        evidence: string[];
    }> {
        return this.queryAffordances(query).map(observation => ({
            action: observation.action,
            state: observation.state,
            confidence: observation.confidence,
            score: calculateActionScore(observation),
            evidence: observation.evidence,
        }));
    },

    mergeObservation(
        id: string,
        update: Partial<Pick<AffordanceObservation, 'outcome' | 'confidence' | 'evidence' | 'tags'>>
    ): AffordanceObservation | undefined {
        const existing = observations.get(id);
        if (!existing) return undefined;

        const next: AffordanceObservation = {
            ...existing,
            ...update,
            evidence: update.evidence ?? existing.evidence,
            tags: update.tags ?? existing.tags,
            confidence: normalizeConfidence(update.confidence ?? existing.confidence, update.outcome?.status ?? existing.outcome.status),
            updatedAt: new Date(),
        };

        observations.set(id, next);
        return next;
    },

    getMissionStats(missionId: number): {
        total: number;
        byStatus: Record<AffordanceOutcomeStatus, number>;
        byKind: Record<AffordanceTargetKind, number>;
        averageConfidence: number;
    } {
        const missionObservations = Array.from(observations.values()).filter(o => o.missionId === missionId);
        const byStatus: Record<AffordanceOutcomeStatus, number> = { success: 0, failure: 0, unknown: 0 };
        const byKind: Record<AffordanceTargetKind, number> = { ui: 0, api: 0, file: 0, tool: 0, system: 0 };

        let confidenceTotal = 0;
        for (const observation of missionObservations) {
            byStatus[observation.outcome.status]++;
            byKind[observation.state.kind]++;
            confidenceTotal += observation.confidence;
        }

        return {
            total: missionObservations.length,
            byStatus,
            byKind,
            averageConfidence: missionObservations.length > 0 ? confidenceTotal / missionObservations.length : 0,
        };
    },

    clearAll(): void {
        observations.clear();
    },
};
