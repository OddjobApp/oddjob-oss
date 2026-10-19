export interface ExecutorMetadata {
  name: string;
  version: string;
  jobTypes: string[];
  description: string;
  author?: string;
  deprecated?: boolean;
  deprecateInFavorOf?: string;
  capabilities: string[];
  requiredConfig: string[];
  optionalConfig: string[];
}

export interface ExecutorClass {
  new (): any; // Must return JobExecutor
  metadata?: ExecutorMetadata;
}
