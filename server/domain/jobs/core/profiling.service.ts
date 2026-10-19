import * as os from 'os';

interface JobProfile {
    jobId: number;
    startTime: number;
    endTime?: number;
    duration?: number;
    samples: any[];
    aggregates?: any;
    intervalId?: NodeJS.Timeout;
}

export class ProfilingService {
    private profiles = new Map<number, JobProfile>();
    
    async startProfiling(jobId: number): Promise<void> {
        const intervalId = setInterval(() => {
            this.recordSample(jobId, {
                timestamp: Date.now(),
                memoryUsageMB: process.memoryUsage().heapUsed / 1024 / 1024,
                cpuUsagePercent: this.getCPUUsage(),
                dbQueries: 0,
                externalApiCalls: 0,
            });
        }, 100);

        this.profiles.set(jobId, {
            jobId,
            startTime: Date.now(),
            samples: [],
            intervalId,
        });
    }
    
    private lastCpus = os.cpus();
    private getCPUUsage(): number {
        const cpus = os.cpus();
        let idle = 0;
        let total = 0;
        for (let i = 0, len = cpus.length; i < len; i++) {
            const cpu = cpus[i];
            const lastCpu = this.lastCpus[i];
            for (const type in cpu.times) {
                const diff = cpu.times[type as keyof os.CpuInfo['times']] - lastCpu.times[type as keyof os.CpuInfo['times']];
                total += diff;
                if (type === 'idle') {
                    idle += diff;
                }
            }
        }
        this.lastCpus = cpus;
        return total > 0 ? 100 - Math.floor(100 * idle / total) : 0;
    }

    async recordSample(jobId: number, sample: {
        timestamp: number;
        memoryUsageMB: number;
        cpuUsagePercent: number;
        dbQueries: number;
        externalApiCalls: number;
    }): Promise<void> {
        const profile = this.profiles.get(jobId);
        if (!profile) return;
        
        profile.samples.push(sample);
    }
    
    async stopProfiling(jobId: number): Promise<JobProfile> {
        const profile = this.profiles.get(jobId);
        if (!profile) {
            throw new Error('No active profile for job');
        }
        
        if (profile.intervalId) {
            clearInterval(profile.intervalId);
            delete profile.intervalId;
        }
        
        profile.endTime = Date.now();
        profile.duration = profile.endTime - profile.startTime;
        
        // Calculate aggregates
        profile.aggregates = this.calculateAggregates(profile.samples);
        
        this.profiles.delete(jobId);
        return profile;
    }
    
    private calculateAggregates(samples: any[]): any {
        if (samples.length === 0) {
            return {
                avgMemoryMB: 0,
                maxMemoryMB: 0,
                avgCpuPercent: 0,
                maxCpuPercent: 0,
                totalDbQueries: 0,
                totalExternalApiCalls: 0,
            };
        }
        
        return {
            avgMemoryMB: samples.reduce((sum, s) => sum + s.memoryUsageMB, 0) / samples.length,
            maxMemoryMB: Math.max(...samples.map(s => s.memoryUsageMB)),
            avgCpuPercent: samples.reduce((sum, s) => sum + s.cpuUsagePercent, 0) / samples.length,
            maxCpuPercent: Math.max(...samples.map(s => s.cpuUsagePercent)),
            totalDbQueries: samples.reduce((sum, s) => sum + s.dbQueries, 0),
            totalExternalApiCalls: samples.reduce((sum, s) => sum + s.externalApiCalls, 0),
        };
    }
}

export const profilingService = new ProfilingService();
