import { useCallback, useMemo } from 'react';
import { Edge, Node } from 'reactflow';
import type { DataFlowEdgeData } from "@domain-ui/pipeline/ui/modules/pipelines/components/DataFlowEdge";

export interface VariablePreview {
  name: string;
  type: string;
  value: any;
  sampleSize?: number;
  description?: string;
  nodeId?: string;
  stepIndex?: number;
}

export interface DependencyMapping {
  sourceNodeId: string;
  targetNodeId: string;
  dependencyType: 'data' | 'control' | 'conditional' | 'error' | 'retry';
  strength: number; // 0-1, how strong the dependency is
  criticality: 'low' | 'medium' | 'high' | 'critical';
  conditionValue?: any;
}

export interface DataFlowAnalysis {
  variablePreviews: VariablePreview[];
  dependencies: DependencyMapping[];
  criticalPath: string[];
  dataTypes: Record<string, string>;
  transformations: Array<{
    nodeId: string;
    inputTypes: string[];
    outputTypes: string[];
    description: string;
  }>;
}

export const useDataFlowVisualization = (
  steps: any[] = [],
  jobs: any[] = [],
  executionResults: any[] = []
) => {

  // Analyze data flow through the pipeline
  const analyzeDataFlow = useCallback((): DataFlowAnalysis => {
    const variablePreviews: VariablePreview[] = [];
    const dependencies: DependencyMapping[] = [];
    const criticalPath: string[] = [];
    const dataTypes: Record<string, string> = {};
    const transformations: any[] = [];

    // Build variable map
    const variableMap = new Map<string, any>();

    // Process each step to analyze data flow
    steps.forEach((step, index) => {
      const job = jobs.find(j => j.id === step.jobId);
      if (!job) return;

      // Analyze input/output variables
      const inputVariables = extractInputVariables(step, variableMap);
      const outputVariables = extractOutputVariables(step, job, executionResults);

      // Update variable map with outputs
      outputVariables.forEach(variable => {
        variableMap.set(variable.name, {
          ...variable,
          nodeId: step.tempId,
          stepIndex: index,
          jobType: job.type
        });
      });

      // Create variable previews for this step
      outputVariables.forEach(variable => {
        if (!variablePreviews.find(v => v.name === variable.name)) {
          variablePreviews.push({
            name: variable.name,
            type: inferDataType(variable.value),
            value: variable.value,
            sampleSize: estimateDataSize(variable.value) ?? undefined,
            description: getVariableDescription(variable, job.type)
          });
        }
      });

      // Analyze dependencies to next steps
      if (index < steps.length - 1) {
        const nextStep = steps[index + 1];
        const dependency = analyzeStepDependency(step, nextStep, job);

        if (dependency) {
          dependencies.push(dependency);
        }
      }

      // Record transformations
      if (inputVariables.length > 0 && outputVariables.length > 0) {
        transformations.push({
          nodeId: step.tempId,
          inputTypes: inputVariables.map(v => v.type),
          outputTypes: outputVariables.map(v => v.type),
          description: `Transforms ${inputVariables.map(v => v.type).join(', ')} to ${outputVariables.map(v => v.type).join(', ')}`
        });
      }

      // Track data types
      const jobDataType = inferJobDataType(job);
      dataTypes[step.tempId] = jobDataType;
    });

    // Calculate critical path
    const criticalPathNodes = calculateCriticalPath(steps, dependencies);
    criticalPath.push(...criticalPathNodes.map(nodeId => {
      const step = steps.find(s => s.tempId === nodeId);
      return step?.tempId || nodeId;
    }));

    return {
      variablePreviews,
      dependencies,
      criticalPath,
      dataTypes,
      transformations
    };
  }, [steps, jobs, executionResults]);

  // Memoized result
  const dataFlowAnalysis = useMemo(() => analyzeDataFlow(), [steps, jobs, executionResults]);

  return {
    dataFlowAnalysis,

    // Helper functions
    getVariablePreview: useCallback((variableName: string) => {
      return dataFlowAnalysis.variablePreviews.find(v => v.name === variableName);
    }, [dataFlowAnalysis.variablePreviews]),

    getDependencyForNodes: useCallback((sourceNodeId: string, targetNodeId: string) => {
      return dataFlowAnalysis.dependencies.find(
        d => d.sourceNodeId === sourceNodeId && d.targetNodeId === targetNodeId
      );
    }, [dataFlowAnalysis.dependencies]),

    isNodeOnCriticalPath: useCallback((nodeId: string) => {
      return dataFlowAnalysis.criticalPath.includes(nodeId);
    }, [dataFlowAnalysis.criticalPath]),

    getNodeTypeForData: useCallback((nodeId: string) => {
      return dataFlowAnalysis.dataTypes[nodeId] || 'unknown';
    }, [dataFlowAnalysis.dataTypes])
  };
};

// Helper function to extract input variables from a step
function extractInputVariables(step: any, variableMap: Map<string, any>) {
  const variables: any[] = [];

  // Extract from step configuration
  if (step.config) {
    // Look for variable references in common config fields
    Object.values(step.config).forEach(value => {
      if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
        const varName = value.slice(2, -2);
        variables.push({
          name: varName,
          type: 'reference',
          value: variableMap.get(varName)
        });
      }
    });
  }

  return variables;
}

// Helper function to extract output variables from a step
function extractOutputVariables(step: any, job: any, executionResults: any[]) {
  const variables: any[] = [];

  // Use outputName if specified
  if (step.outputName) {
    const sampleValue = getSampleExecutionValue(step.tempId, executionResults);
    variables.push({
      name: step.outputName,
      type: inferDataType(sampleValue),
      value: sampleValue
    });
  }

  // Infer from job type
  if (job.type === 'ai_api_call') {
    variables.push({
      name: 'ai_response',
      type: 'text',
      value: 'AI generated response'
    });
  } else if (job.type === 'sql_query') {
    variables.push({
      name: 'query_results',
      type: 'table',
      value: 'SQL query result set'
    });
  } else if (job.type === 'transformer') {
    variables.push({
      name: 'transformed_data',
      type: 'json',
      value: 'Transformed JSON data'
    });
  }

  return variables;
}

// Helper function to infer data type
function inferDataType(value: any): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'text';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) return 'object';
  return 'unknown';
}

// Helper function to infer job data type
function inferJobDataType(job: any): string {
  switch (job.type) {
    case 'ai_api_call':
    case 'ai_agent':
      return 'text/ai';
    case 'sql_query':
      return 'table/database';
    case 'curl':
    case 'api':
    case 'openapi':
      return 'json/api';
    case 'transformer':
      return 'json/transform';
    case 'file_import':
      return 'file/binary';
    case 'file_export':
      return 'file/export';
    case 'selenium':
      return 'web/browser';
    case 'python':
    case 'node_script':
      return 'code/executable';
    case 'decision':
      return 'logic/conditional';
    default:
      return 'unknown';
  }
}

// Helper function to get sample execution value
function getSampleExecutionValue(stepTempId: string, executionResults: any[]) {
  const execution = executionResults.find(e => e.pipelineStepId?.toString() === stepTempId);
  return execution?.output || null;
}

// Helper function to analyze dependency between steps
function analyzeStepDependency(currentStep: any, nextStep: any, job: any): DependencyMapping | null {
  const dependency: DependencyMapping = {
    sourceNodeId: currentStep.tempId,
    targetNodeId: nextStep.tempId,
    dependencyType: 'data',
    strength: 0.5,
    criticality: 'medium' as const
  };

  // Analyze specific dependency patterns
  if (currentStep.destinationStepId === nextStep.id) {
    dependency.dependencyType = 'control';
    dependency.strength = 1.0;
    dependency.criticality = 'high' as const;
  }

  // Check for conditional routing
  if (job.type === 'decision') {
    dependency.dependencyType = 'conditional';
    dependency.strength = 0.8;
    dependency.conditionValue = true; // This will be determined by actual condition
  }

  // Check for data usage
  let hasDataDependency = false;
  const nextStepJob = nextStep.jobId ? job : null;
  if (nextStepJob) {
    const inputData = extractInputVariables(nextStep, new Map());
    const outputData = extractOutputVariables(currentStep, job, []);

    // Check if next step uses data from current step
    hasDataDependency = inputData.some(input =>
      outputData.some(output => output.name === input.name)
    );

    if (hasDataDependency) {
      dependency.strength = 0.7;
      dependency.criticality = calculateCriticality(currentStep, nextStep);
    }
  }

  return hasDataDependency ? dependency : null;
}

// Helper function to calculate criticality
function calculateCriticality(sourceStep: any, targetStep: any): 'low' | 'medium' | 'high' | 'critical' {
  // Simple heuristic-based criticality calculation
  let criticality: 'low' | 'medium' | 'high' | 'critical' = 'medium';

  // High-critical job types
  const criticalJobTypes = ['ai_api_call', 'sql_query', 'decision', 'transformer'];

  if (criticalJobTypes.includes(targetStep.jobId?.type || '')) {
    criticality = 'high';
  }

  // Error/retry paths
  if (targetStep.retryConfig && targetStep.retryConfig.maxRetries > 0) {
    criticality = 'critical';
  }

  return criticality;
}

// Helper function to calculate critical path
function calculateCriticalPath(steps: any[], dependencies: DependencyMapping[]): string[] {
  // Simple implementation - find the longest path through dependencies
  const stepMap = new Map(steps.map(step => [step.tempId, step]));
  const dependencyMap = new Map(
    dependencies.map(dep => [`${dep.sourceNodeId}-${dep.targetNodeId}`, dep])
  );

  const visited = new Set<string>();
  const inProgress = new Set<string>();
  const path = new Set<string>();

  // Find all steps that have no incoming dependencies
  const entryPoints = steps.filter(step =>
    !dependencies.some(dep => dep.targetNodeId === step.tempId)
  );

  // DFS to find longest path
  function dfs(nodeId: string, currentPath: string[]) {
    if (visited.has(nodeId)) return currentPath;

    visited.add(nodeId);
    inProgress.add(nodeId);

    const outgoingDeps = dependencies.filter(dep => dep.sourceNodeId === nodeId);

    if (outgoingDeps.length === 0) {
      // End of path
      if (currentPath.length + 1 > path.size) {
        path.clear();
        currentPath.forEach(n => path.add(n));
        path.add(nodeId);
      }
    } else {
      // Continue exploring
      outgoingDeps.forEach(dep => {
        if (!inProgress.has(dep.targetNodeId)) {
          dfs(dep.targetNodeId, [...currentPath, nodeId]);
        }
      });
    }

    inProgress.delete(nodeId);
  }

  entryPoints.forEach(step => {
    dfs(step.tempId, []);
  });

  return Array.from(path);
}

// Helper function to estimate data size
function estimateDataSize(value: any): number | null {
  if (typeof value === 'string') return value.length;
  if (typeof value === 'object') return JSON.stringify(value).length;
  if (Array.isArray(value)) return value.length;
  return null;
}

// Helper function to get variable description
function getVariableDescription(variable: any, jobType: string): string {
  const descriptions: Record<string, string> = {
    ai_api_call: 'Response from AI model execution',
    sql_query: 'Results from SQL database query',
    transformer: 'Data after transformation operation',
    curl: 'HTTP response from API call',
    file_import: 'Data imported from external source',
    file_export: 'Data prepared for export',
    decision: 'Boolean decision result'
  };

  return descriptions[jobType] || 'Pipeline data';
}
