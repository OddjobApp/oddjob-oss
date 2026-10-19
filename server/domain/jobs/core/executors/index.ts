// Re-export the types and base class from executor-types so existing
// consumers keep working. The base class lives in a separate module to
// break the circular import with executor-registry.ts.
export { type ExecuteJobFn, type JobExecutor, JobExecutorRegistry } from "./executor-types.js";
export * from "./presentation-assembly-executor.js";

import { AutoDiscoveryExecutorRegistry } from "./executor-registry.js";
export const jobExecutorRegistry = new AutoDiscoveryExecutorRegistry();



