/**
 * Load Testing Script for Phase 4C Streaming Endpoints
 *
 * Purpose: Validate performance improvements from streaming endpoints
 * Metrics: Latency, memory usage, throughput, network efficiency
 * Targets: 32x memory reduction, 5-7x latency improvement
 */

import axios, { AxiosInstance } from 'axios';
import * as os from 'os';

interface LoadTestResult {
    endpoint: string;
    format: 'sse' | 'csv' | 'jsonl' | 'traditional';
    itemsReceived: number;
    totalTime: number;
    firstItemTime: number;
    peakMemory: number;
    avgMemory: number;
    bytesReceived: number;
    throughput: number; // items/sec
    success: boolean;
    error?: string;
}

class StreamingLoadTester {
    private client: AxiosInstance;
    private baseUrl: string;
    private token: string;

    constructor(baseUrl: string, token: string) {
        this.baseUrl = baseUrl;
        this.token = token;
        this.client = axios.create({
            baseURL: baseUrl,
            headers: { 'Authorization': `Bearer ${token}` },
            timeout: 60000,
            maxContentLength: Infinity,
        });
    }

    /**
     * Measure peak memory before/after operation
     */
    private getMemoryUsage(): number {
        return process.memoryUsage().heapUsed / 1024 / 1024; // MB
    }

    /**
     * Test SSE streaming endpoint
     */
    async testSSEStreaming(endpoint: string): Promise<LoadTestResult> {
        const memBefore = this.getMemoryUsage();
        const startTime = Date.now();
        let firstItemTime = 0;
        let itemsReceived = 0;
        let peakMemory = memBefore;
        const memSamples: number[] = [];

        try {
            const response = await this.client.get(endpoint, {
                responseType: 'stream',
            });

            const stream = response.data;
            let buffer = '';

            for await (const chunk of stream) {
                // Parse SSE format
                const chunkStr = chunk.toString();
                buffer += chunkStr;
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.substring(6));

                            // First item timer
                            if (itemsReceived === 0 && !firstItemTime) {
                                firstItemTime = Date.now() - startTime;
                            }

                            // Skip metadata/control messages
                            if (data.item) {
                                itemsReceived++;
                            }

                            // Skip completion messages
                            if (data._complete) {
                                break;
                            }
                        } catch (e) {
                            // Invalid JSON line, skip
                        }
                    }
                }

                // Sample memory periodically
                if (itemsReceived % 50 === 0) {
                    const mem = this.getMemoryUsage();
                    memSamples.push(mem);
                    peakMemory = Math.max(peakMemory, mem);
                }
            }

            const totalTime = Date.now() - startTime;
            const avgMemory = memSamples.length > 0
                ? memSamples.reduce((a, b) => a + b, 0) / memSamples.length
                : memBefore;

            return {
                endpoint,
                format: 'sse',
                itemsReceived,
                totalTime,
                firstItemTime,
                peakMemory,
                avgMemory,
                bytesReceived: parseInt(String(response.headers['content-length'] ?? '0'), 10) || 0,
                throughput: itemsReceived / (totalTime / 1000),
                success: true,
            };
        } catch (error: any) {
            return {
                endpoint,
                format: 'sse',
                itemsReceived: 0,
                totalTime: Date.now() - startTime,
                firstItemTime: 0,
                peakMemory,
                avgMemory: peakMemory,
                bytesReceived: 0,
                throughput: 0,
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Test CSV streaming endpoint
     */
    async testCSVStreaming(endpoint: string): Promise<LoadTestResult> {
        const memBefore = this.getMemoryUsage();
        const startTime = Date.now();
        let firstItemTime = 0;
        let itemsReceived = 0;
        let peakMemory = memBefore;
        let bytesReceived = 0;
        const memSamples: number[] = [];

        try {
            const response = await this.client.get(endpoint, {
                responseType: 'stream',
            });

            const stream = response.data;
            let lineNum = 0;

            for await (const chunk of stream) {
                const chunkStr = chunk.toString();
                bytesReceived += chunkStr.length;

                const lines = chunkStr.split('\n');
                for (const line of lines) {
                    lineNum++;

                    // Skip header
                    if (lineNum === 1) continue;

                    if (line.trim()) {
                        if (itemsReceived === 0 && !firstItemTime) {
                            firstItemTime = Date.now() - startTime;
                        }
                        itemsReceived++;
                    }
                }

                // Sample memory periodically
                if (itemsReceived % 100 === 0) {
                    const mem = this.getMemoryUsage();
                    memSamples.push(mem);
                    peakMemory = Math.max(peakMemory, mem);
                }
            }

            const totalTime = Date.now() - startTime;
            const avgMemory = memSamples.length > 0
                ? memSamples.reduce((a, b) => a + b, 0) / memSamples.length
                : memBefore;

            return {
                endpoint,
                format: 'csv',
                itemsReceived,
                totalTime,
                firstItemTime,
                peakMemory,
                avgMemory,
                bytesReceived,
                throughput: itemsReceived / (totalTime / 1000),
                success: true,
            };
        } catch (error: any) {
            return {
                endpoint,
                format: 'csv',
                itemsReceived: 0,
                totalTime: Date.now() - startTime,
                firstItemTime: 0,
                peakMemory,
                avgMemory: peakMemory,
                bytesReceived,
                throughput: 0,
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Test JSONL streaming endpoint
     */
    async testJSONLStreaming(endpoint: string): Promise<LoadTestResult> {
        const memBefore = this.getMemoryUsage();
        const startTime = Date.now();
        let firstItemTime = 0;
        let itemsReceived = 0;
        let peakMemory = memBefore;
        let bytesReceived = 0;
        const memSamples: number[] = [];

        try {
            const response = await this.client.get(endpoint, {
                responseType: 'stream',
            });

            const stream = response.data;
            let buffer = '';

            for await (const chunk of stream) {
                const chunkStr = chunk.toString();
                bytesReceived += chunkStr.length;
                buffer += chunkStr;

                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const data = JSON.parse(line);

                        if (itemsReceived === 0 && !firstItemTime) {
                            firstItemTime = Date.now() - startTime;
                        }

                        // Skip metadata
                        if (!data._metadata) {
                            itemsReceived++;
                        }
                    } catch (e) {
                        // Invalid JSON, skip
                    }
                }

                // Sample memory periodically
                if (itemsReceived % 50 === 0) {
                    const mem = this.getMemoryUsage();
                    memSamples.push(mem);
                    peakMemory = Math.max(peakMemory, mem);
                }
            }

            const totalTime = Date.now() - startTime;
            const avgMemory = memSamples.length > 0
                ? memSamples.reduce((a, b) => a + b, 0) / memSamples.length
                : memBefore;

            return {
                endpoint,
                format: 'jsonl',
                itemsReceived,
                totalTime,
                firstItemTime,
                peakMemory,
                avgMemory,
                bytesReceived,
                throughput: itemsReceived / (totalTime / 1000),
                success: true,
            };
        } catch (error: any) {
            return {
                endpoint,
                format: 'jsonl',
                itemsReceived: 0,
                totalTime: Date.now() - startTime,
                firstItemTime: 0,
                peakMemory,
                avgMemory: peakMemory,
                bytesReceived,
                throughput: 0,
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Run all tests
     */
    async runAllTests(): Promise<LoadTestResult[]> {
        const results: LoadTestResult[] = [];

        console.log('🚀 Phase 4C Streaming Load Test\n');
        console.log('Testing approval endpoints...');

        // Test approval streaming
        results.push(await this.testSSEStreaming('/api/approvals/stream'));
        results.push(await this.testCSVStreaming('/api/approvals/export.csv'));
        results.push(await this.testJSONLStreaming('/api/approvals/export.jsonl'));

        console.log('Testing cycle endpoints...');

        // Test cycle streaming
        results.push(await this.testSSEStreaming('/api/cycles/stream'));
        results.push(await this.testCSVStreaming('/api/cycles/export.csv'));
        results.push(await this.testJSONLStreaming('/api/cycles/export.jsonl'));

        return results;
    }
}

/**
 * Format results as a table
 */
function formatResults(results: LoadTestResult[]): string {
    const header = [
        'Endpoint',
        'Format',
        'Items',
        'Time (ms)',
        'First Item (ms)',
        'Peak Mem (MB)',
        'Avg Mem (MB)',
        'Throughput (items/sec)',
        'Status',
    ].join(' | ');

    const rows = results.map(r => [
        r.endpoint.split('/').pop() || r.endpoint,
        r.format.toUpperCase(),
        String(r.itemsReceived),
        String(r.totalTime),
        String(r.firstItemTime),
        r.peakMemory.toFixed(2),
        r.avgMemory.toFixed(2),
        r.throughput.toFixed(2),
        r.success ? '✅' : '❌',
    ].join(' | '));

    return `${header}\n${rows.map((r, i) => {
        if (i === 0) return r;
        return r;
    }).join('\n')}`;
}

/**
 * Main entry point
 */
async function main() {
    const apiUrl = process.env.API_URL || 'http://localhost:3000/api';
    const authToken = process.env.AUTH_TOKEN || '';

    if (!authToken) {
        console.error('❌ AUTH_TOKEN environment variable required');
        process.exit(1);
    }

    const tester = new StreamingLoadTester(apiUrl, authToken);

    try {
        const results = await tester.runAllTests();

        console.log('\n📊 Results:\n');
        console.log(formatResults(results));

        // Summary statistics
        const successful = results.filter(r => r.success);
        const avgLatency = successful.length > 0
            ? successful.reduce((sum, r) => sum + r.totalTime, 0) / successful.length
            : 0;
        const avgMemory = successful.length > 0
            ? successful.reduce((sum, r) => sum + r.peakMemory, 0) / successful.length
            : 0;

        console.log('\n📈 Summary:');
        console.log(`  Successful tests: ${successful.length}/${results.length}`);
        console.log(`  Average latency: ${avgLatency.toFixed(0)}ms`);
        console.log(`  Average peak memory: ${avgMemory.toFixed(2)}MB`);

        // Validate targets
        console.log('\n🎯 Target Validation:');
        const firstItemTarget = 500; // ms
        const memoryTarget = 0.5; // MB per page
        const latencyImprovement = 5; // 5-7x improvement

        const failingTests = results.filter(r => !r.success);
        const firstItemFailing = results.filter(r => r.firstItemTime > firstItemTarget);
        const memoryFailing = results.filter(r => r.peakMemory > memoryTarget * 2);

        if (failingTests.length > 0) {
            console.log(`  ❌ ${failingTests.length} test(s) failed`);
        } else {
            console.log(`  ✅ All tests passed`);
        }

        if (firstItemFailing.length > 0) {
            console.log(`  ⚠️  ${firstItemFailing.length} test(s) exceed first-item target (${firstItemTarget}ms)`);
        } else {
            console.log(`  ✅ First-item latency < ${firstItemTarget}ms`);
        }

        if (memoryFailing.length > 0) {
            console.log(`  ⚠️  ${memoryFailing.length} test(s) exceed memory target (${memoryTarget}MB)`);
        } else {
            console.log(`  ✅ Peak memory < ${memoryTarget * 2}MB per batch`);
        }

        process.exit(failingTests.length > 0 ? 1 : 0);
    } catch (error: any) {
        console.error('❌ Load test error:', error.message);
        process.exit(1);
    }
}

main();
