import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCircuitBreaker, getCircuitState, withCircuitBreaker } from '@domain/core/infrastructure/circuit-breaker.service.js';
import { integrationTelemetryService } from '@domain/governance/core/integration-telemetry.service.js';
import { granolaMcpUrl } from './granola-oauth.adapter.js';

function parseContent(result: any): any {
    const texts = Array.isArray(result?.content) ? result.content.filter((part: any) => part?.type === 'text').map((part: any) => String(part.text)) : [];
    if (!texts.length) return result?.structuredContent ?? result;
    const joined = texts.join('\n');
    try { return JSON.parse(joined); } catch { return { text: joined }; }
}

export class GranolaMcpClient {
    constructor(private readonly connectionId: number, private readonly accessToken: () => Promise<string>) {}

    async call(tool: string, args: Record<string, unknown> = {}) {
        const circuitName = `mcp:granola:${this.connectionId}:${tool}`;
        if (!getCircuitState(circuitName)) createCircuitBreaker({ name: circuitName, failureThreshold: 5, resetTimeoutMs: 30_000, halfOpenMaxAttempts: 3 });
        const started = Date.now();
        try {
            const result = await withCircuitBreaker(circuitName, async () => {
                const token = await this.accessToken();
                const transport = new StreamableHTTPClientTransport(new URL(granolaMcpUrl()), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
                const client = new Client({ name: 'Oddjob Granola', version: '1.0.0' });
                try {
                    await client.connect(transport);
                    return await client.callTool({ name: tool, arguments: args });
                } finally {
                    await client.close().catch(() => undefined);
                }
            });
            await integrationTelemetryService.logCall({ platform: 'granola', method: 'POST', url: granolaMcpUrl(), action: tool, responseStatus: 200, durationMs: Date.now() - started, isPriority: true, metadata: { connectionId: this.connectionId } } as any);
            if ((result as any)?.isError) throw new Error(`Granola ${tool} failed: ${JSON.stringify(parseContent(result))}`);
            return parseContent(result);
        } catch (error) {
            await integrationTelemetryService.logCall({ platform: 'granola', method: 'POST', url: granolaMcpUrl(), action: tool, responseStatus: 500, durationMs: Date.now() - started, isPriority: true, metadata: { connectionId: this.connectionId } } as any).catch(() => undefined);
            throw error;
        }
    }

    accountInfo() { return this.call('get_account_info'); }
    searchMeetings(query: string) { return this.call('query_granola_meetings', { query }); }
    listMeetings(args: Record<string, unknown> = {}) { return this.call('list_meetings', args); }
    listFolders() { return this.call('list_meeting_folders'); }
    getMeetings(meetingIds: string[]) { return this.call('get_meetings', { meeting_ids: meetingIds }); }
    getTranscript(meetingId: string) { return this.call('get_meeting_transcript', { meeting_id: meetingId }); }
}
