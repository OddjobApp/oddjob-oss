
import { TraceContext } from "@domain/core/infrastructure/trace-context.service.js";

/**
 * Common types for the App Forge domain.
 * This file centralizes interfaces to avoid "any" types and improve maintainability.
 */

export interface WarmContainer {
    containerId: string;
    port: number;
    status: 'idle' | 'claimed' | 'initializing';
    slug?: string;
    workspacePath: string;
    leaseId?: string;
    leaseExpiresAt?: number;
}

export interface ForgeOptions {
    name: string;
    slug: string;
    blueprint?: string;
    description: string;
    theme?: string;
    oddjobMissionId: number;
    missionRunId?: number;
    organizationId?: number;
    projectId?: number;
    jobId?: string;
    apiInstructions?: string;
    referenceAssetIds?: number[];
    designStyleId?: string;           // designdotmd.directory style ID, e.g. "terminal"
    designStyleContext?: string;      // Resolved DESIGN.md prompt context (populated internally)
    traceContext?: TraceContext;
    isApprovedPlan?: boolean;
    isApprovedArchitecture?: boolean;
    userAnswers?: Record<string, string>;
    archAnswers?: Record<string, string>;
    approvedPlan?: any;
    approvedArchitecture?: any;
    approvedWaveId?: number;           // Wave ID that has been approved for assembly
    wavePlan?: WavePlan;               // The structural WavePlan JSON
    allowedPipelineIds?: number[];
    allowedDatasetIds?: number[];
    defaultCollections?: string[];
    warmLeaseId?: string;
    skipToAssembly?: boolean;
    blackboard?: Record<string, any>; // Optional context from mission orchestration
    vNextManifest?: any;              // Blueprint screen and slug configuration
    interactionModel?: 'form-workbench' | 'analytics-dashboard' | 'chat-assistant' | string;
    /** Requested scaffold capabilities, resolved through DPLL before queueing. */
    scaffoldPacks?: string[];
    /** Durable SAT result consumed by planning, workers, and dynamic previews. */
    assemblyPlan?: {
        requestedPacks: string[];
        selectedPacks: string[];
        executionOrder: string[];
        proofExplanation: string;
    };
    /** Durable, gallery-backed preview model streamed while the app is assembled. */
    liveAssembly?: ForgeLiveAssembly;
    /** Delivery profile: 'accelerated' (blueprint archetype slot-fill, ~30s) or 'comprehensive' (full 13-task wave synthesis). */
    deliveryProfile?: 'accelerated' | 'comprehensive';
}

export type ForgeLiveBlockStatus = 'selected' | 'assembling' | 'mounted' | 'failed';

export interface ForgeLiveAssemblyBlock {
    module: string;
    componentName: string;
    category: string;
    description: string;
    props: Record<string, any>;
    span: number;
    status: ForgeLiveBlockStatus;
}

export interface ForgeLiveAssembly {
    title: string;
    slug: string;
    source: 'component-gallery';
    phase: 'planning' | 'assembling' | 'preview' | 'failed';
    blocks: ForgeLiveAssemblyBlock[];
    api: ForgeApiContract;
    files: string[];
    activeTask?: string;
    previewUrl?: string;
    updatedAt: string;
}

/**
 * The contract-first API lifecycle.
 *
 * `validating` sits between generating and ready on purpose: a route that has
 * been written is not the same as one whose request and response schemas have
 * been checked against the contract, and collapsing the two let a spec-mismatched
 * endpoint present as finished.
 */
export type ForgeApiStatus = 'specifying' | 'generating' | 'validating' | 'ready' | 'failed';

export interface ForgeApiEndpoint {
    id: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    summary: string;
    resource: string;
    auth: 'bearer' | 'session' | 'public';
    status: ForgeApiStatus;
    implementationFiles: string[];
}

export interface ForgeApiSchema {
    name: string;
    fields: { name: string; type: string; required: boolean }[];
}

export interface ForgeApiContract {
    openapi: '3.1.0';
    title: string;
    version: string;
    basePath: string;
    status: ForgeApiStatus;
    certification: string;
    endpoints: ForgeApiEndpoint[];
    schemas: ForgeApiSchema[];
    generatedFiles: string[];
    document: Record<string, any>;
}

export interface ForgeJob {
    id: string;
    status: 'queued' | 'pending' | 'building' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    stage?: number;
    message: string;
    updatedAt: string;
    blueprintSlug: string;
    options: ForgeOptions;
    error?: string;
}

export interface DevelopmentPlan {
    overview: string;
    phases: {
        name: string;
        description: string;
        tasks: string[];
    }[];
    techStack: string[];
    integrationStrategy: string;
    uxDescription: string;
    mockStrategy: Record<string, string>;
}

export interface ClarifyingQuestion {
    id: string;
    question: string;
    context: string;
    suggestedAnswers?: string[];
}

export interface ArchitectureProposal {
    services: {
        name: string;
        purpose: string;
        endpoints: { path: string; method: string; description: string }[];
    }[];
    components: {
        name: string;
        type: 'page' | 'shared' | 'module';
        description: string;
        dependencies: string[];
        platformBlockId?: string; // ID from block-registry.json if applicable
    }[];
    dataModels: {
        name: string;
        fields: { name: string; type: string; required: boolean }[];
    }[];
    capabilityMapping: {
        requirement: string;
        oddjobCapability: 'missions' | 'pipelines' | 'datasets' | 'forms' | 'agents' | 'knowledge' | 'hil' | 'custom';
        platformBlockId?: string;
        rationale: string;
    }[];
}

export interface BuildTask {
    id: string;
    waveId: number;
    title: string;
    description: string;
    files: string[];
    dependencies: string[];
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface Wave {
    id: number;
    title: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    tasks: BuildTask[];
    costEstimate?: string;
    timeEstimate?: string;
}

export interface WavePlan {
    overview: string;
    waves: Wave[];
}

export interface ForgeLogEvent {
    jobId: string;
    message: string;
    level: 'info' | 'warn' | 'error' | 'success';
    timestamp: string;
    stage?: number;
    progress?: number;
    [key: string]: any;
}
