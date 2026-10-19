import axios, { AxiosInstance } from 'axios';
import { getConfig } from './config';

export class ApiClient {
    private client: AxiosInstance;

    constructor() {
        const config = getConfig();
        this.client = axios.create({
            baseURL: config.apiUrl || 'http://localhost:5000',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        // Add auth token if available
        if (config.authToken) {
            this.client.defaults.headers.common['Authorization'] = `Bearer ${config.authToken}`;
        }
    }

    // Pipelines
    async getPipelines() {
        const response = await this.client.get('/api/pipelines');
        return response.data;
    }

    async getPipeline(id: number) {
        const response = await this.client.get(`/api/pipelines/${id}`);
        return response.data;
    }

    async createPipeline(data: any) {
        const response = await this.client.post('/api/pipelines', data);
        return response.data;
    }

    async updatePipeline(id: number, data: any) {
        const response = await this.client.put(`/api/pipelines/${id}`, data);
        return response.data;
    }

    // Executions
    async executePipeline(pipelineId: number, input?: any) {
        const response = await this.client.post(`/api/pipelines/${pipelineId}/execute`, { input });
        return response.data;
    }

    async getExecution(id: number) {
        const response = await this.client.get(`/api/pipeline-executions/${id}`);
        return response.data;
    }

    async getExecutionSteps(executionId: number) {
        const response = await this.client.get(`/api/pipeline-executions/${executionId}/steps`);
        return response.data;
    }

    // Credentials
    async getCredentials(orgId?: number) {
        const params = orgId ? { organizationId: orgId } : {};
        const response = await this.client.get('/api/credentials', { params });
        return response.data;
    }

    async createCredential(data: any) {
        const response = await this.client.post('/api/credentials', data);
        return response.data;
    }

    async deleteCredential(id: number) {
        await this.client.delete(`/api/credentials/${id}`);
    }

    // Jobs
    async getJobs() {
        const response = await this.client.get('/api/jobs');
        return response.data;
    }

    async getJob(id: number) {
        const response = await this.client.get(`/api/jobs/${id}`);
        return response.data;
    }

    // Missions
    async createMission(data: any) {
        const response = await this.client.post('/api/missions', data);
        return response.data;
    }

    async planMission(prompt: string) {
        const response = await this.client.post('/api/missions/plan', { prompt });
        return response.data;
    }

    async launchMission(missionId: number) {
        const response = await this.client.post(`/api/missions/${missionId}/launch-mission`);
        return response.data;
    }

    async getMissionActivity(missionId: number) {
        const response = await this.client.get(`/api/missions/${missionId}/activity`);
        return response.data;
    }

    async getMissions(params?: Record<string, any>) {
        const response = await this.client.get('/api/missions', { params });
        return response.data;
    }

    async getMission(id: number) {
        const response = await this.client.get(`/api/missions/${id}`);
        return response.data;
    }

    async getMissionStatus(id: number) {
        const response = await this.client.get(`/api/missions/${id}/health`);
        return response.data;
    }

    async getMissionHistory(id: number) {
        const response = await this.client.get(`/api/missions/${id}/history`);
        return response.data;
    }

    async pauseMission(id: number) {
        const response = await this.client.post(`/api/missions/${id}/pause`);
        return response.data;
    }

    async resumeMission(id: number) {
        const response = await this.client.post(`/api/missions/${id}/resume`);
        return response.data;
    }

    async cancelMission(id: number, reason?: string) {
        const response = await this.client.post(`/api/missions/${id}/terminate`, { reason });
        return response.data;
    }

    // Agent Decisions (Approvals)
    async getPendingDecision(sessionId: string) {
        const response = await this.client.get(`/api/agent/${sessionId}/decision`);
        return response.data;
    }

    async submitDecision(sessionId: string, approved: boolean, reason?: string, proposalId?: string) {
        const response = await this.client.post(`/api/agent/${sessionId}/decision`, {
            approved,
            reason,
            proposalId
        });
        return response.data;
    }
}

export const apiClient = new ApiClient();
