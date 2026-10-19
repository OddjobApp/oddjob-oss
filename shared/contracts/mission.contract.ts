/**
 * IMissionPod Contract
 * 
 * Defines the public interface for the Mission domain pod.
 * This contract is used for inter-pod communication and RPC proxy generation.
 */
export interface IMissionPod {
    // Query Operations
    listMissions(orgId?: number): Promise<any[]>;
    getById(id: number): Promise<any>;
    getMissionDetail(id: number): Promise<any>;
    listRuns(missionId?: number): Promise<any[]>;
    
    // Lifecycle Operations
    createMission(data: any, userId: string, members?: any[], isDraft?: boolean, workflow?: any): Promise<any>;
    updateMission(id: number, updates: any, userId?: string): Promise<any>;
    pauseMission(missionId: number): Promise<void>;
    resumeMission(missionId: number): Promise<void>;
    
    // Execution Operations
    planMission(prompt: string, userId: string, orgId: number, history?: any[]): Promise<any>;
    launchMission(missionId: number, userId: string, orgId: number | null, existingRunId?: number, metadata?: any): Promise<any>;
    advanceSequence(missionRunId: number): Promise<any>;
}
