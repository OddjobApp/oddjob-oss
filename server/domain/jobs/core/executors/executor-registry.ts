import { readdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { JobExecutorRegistry, JobExecutor } from './executor-types.js';
import { createLogger } from '../../../../utils/logger.js';

const logger = createLogger('AutoDiscoveryExecutorRegistry');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class AutoDiscoveryExecutorRegistry extends JobExecutorRegistry {
  private executorDir: string;
  private registration: Promise<void> | null = null;

  constructor(executorDir?: string) {
    super();
    this.executorDir = executorDir || __dirname;
  }

  /**
   * Discover and register every executor in the executor directory.
   *
   * Memoised on the first call. `register()` appends unconditionally, so without
   * this guard a second call — bootstrap plus the worker fleet in one process, or a
   * test suite ensuring registration — would stack a duplicate copy of all ~80
   * executors. Lookups would still resolve (find returns the first match), so the
   * damage is silent: an inflated registry and a misleading "Total registered" count.
   *
   * Concurrent callers share the same in-flight promise rather than racing two scans.
   */
  async autoRegister(): Promise<void> {
    if (!this.registration) {
      this.registration = this.performAutoRegister();
    }
    return this.registration;
  }

  private async performAutoRegister(): Promise<void> {
    logger.info(`Starting auto-discovery in ${this.executorDir}`);
    const files = await readdir(this.executorDir).catch(() => [] as string[]);
    const executorFiles = files.filter(f =>
        (f.endsWith('-executor.ts') || f.endsWith('-executor.js')) &&
        !f.includes('.test.') && !f.includes('.spec.')
    );

    // In the esbuild production bundle there is no executors directory on disk
    // (__dirname resolves to dist/), so the scan finds nothing. The generated
    // manifest is statically imported so it survives bundling.
    if (executorFiles.length === 0) {
      const { getBundledExecutors } = await import('./executor-manifest.js');
      for (const executor of getBundledExecutors()) this.register(executor);
      logger.info(`Registered ${this.executors.length} executors from bundled manifest`);
      return;
    }

    for (const file of executorFiles) {
      try {
        const modulePath = join(this.executorDir, file);
        // On Windows with file:// paths, we should convert to URL format
        const moduleUrl = `file://${modulePath.replace(/\\/g, '/')}`;
        const module = await import(moduleUrl);
        
        // Find exported executor classes
        for (const exportName of Object.keys(module)) {
          const ExportedClass = module[exportName];
          if (typeof ExportedClass === 'function' && ExportedClass.prototype && ExportedClass.prototype.canExecute) {
            const executor = new ExportedClass() as JobExecutor;
            this.register(executor);
            
            // Log metadata if available
            if ((ExportedClass as any).metadata) {
              logger.info(`Registered executor via auto-discovery: ${(ExportedClass as any).metadata.name} (from ${file})`);
            } else {
              logger.debug(`Registered executor via auto-discovery: ${exportName} (from ${file})`);
            }
          }
        }
      } catch (error) {
        logger.error(`Failed to load executor from ${file}`, error);
      }
    }
    logger.info(`Auto-discovery completed. Total registered: ${this.executors.length}`);
  }
}
