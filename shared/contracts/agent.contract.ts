/**
 * IAgentPod Contract
 */
export interface IAgentPod {
    agent: {
        listAgents(orgId?: number): Promise<any[]>;
        getById(id: number): Promise<any>;
        createAgent(data: any): Promise<any>;
    };
    orchestrator: {
        spawnAgent(options: any): Promise<any>;
        delegateTask(agentId: number, task: any): Promise<any>;
    };
    inbox: {
        getMessages(agentId: number): Promise<any[]>;
        sendMessage(agentId: number, message: any): Promise<any>;
    };
}
