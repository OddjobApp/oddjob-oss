import * as chokidar from 'chokidar';
import { MoltProducer } from './molt-producer.js';
import path from 'path';

export class SovereignWatchdog {
    private watcher: chokidar.FSWatcher | null = null;
    private moltProducer: MoltProducer;
    private cwd: string;
    private isMonitoring: boolean = false;

    constructor(moltProducer: MoltProducer, cwd: string = process.cwd()) {
        this.moltProducer = moltProducer;
        this.cwd = cwd;
    }

    /**
     * Starts monitoring the filesystem for changes.
     * Useful to capture the "Delta" after an execution or detect unauthorized changes.
     */
    start(targetPaths: string[] = ['.']) {
        if (this.isMonitoring) return;

        this.watcher = chokidar.watch(targetPaths, {
            cwd: this.cwd,
            ignored: [
                /(^|[\/\\])\../, // ignore dotfiles
                '**/node_modules/**',
                '**/.git/**',
                '**/dist/**',
                '**/build/**'
            ],
            persistent: true,
            ignoreInitial: true
        });

        this.watcher
            .on('add', (path: string) => this.emitObservation('add', path))
            .on('change', (path: string) => this.emitObservation('change', path))
            .on('unlink', (path: string) => this.emitObservation('unlink', path))
            .on('addDir', (path: string) => this.emitObservation('addDir', path))
            .on('unlinkDir', (path: string) => this.emitObservation('unlinkDir', path));

        this.isMonitoring = true;
        console.log(`[SovereignWatchdog] Monitoring started in ${this.cwd}`);
    }

    stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        this.isMonitoring = false;
        console.log(`[SovereignWatchdog] Monitoring stopped.`);
    }

    private async emitObservation(changeType: string, relativePath: string) {
        if (!this.isMonitoring) return;

        // In the real OODA loop, we might buffer these or debounce them.
        // For Phase 1, we emit them directly as OBSERVATION events.

        await this.moltProducer.publish('OBSERVATION', {
            type: 'filesystem',
            change: changeType,
            path: relativePath,
            timestamp: Date.now()
        });

        console.log(`[SovereignWatchdog] Observed: ${changeType} -> ${relativePath}`);
    }
}


