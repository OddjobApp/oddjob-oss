/**
 * IKnowledgePod Contract
 */
export interface IKnowledgePod {
    knowledge: {
        getSystemInsights(): Promise<any>;
    };
    search: {
        performSearch(query: string, options?: any): Promise<any>;
    };
    graph: {
        getGraphData(missionId: number): Promise<any>;
    };
    extraction: {
        startExtraction(sourceId: number): Promise<any>;
    };
}
