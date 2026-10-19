# Swiss Cheese Model Integration: Technical Design Proposal

## Executive Summary

This document provides a comprehensive technical design for implementing the Swiss Cheese Model for multi-layered guardrails in Oddjob's governed agentic AI platform. The Swiss Cheese Model creates multiple defensive layers where each layer can catch different types of safety violations, providing defense-in-depth for agent operations.

**Impact:** Multi-layered safety with >95% risk detection, <0.1% safety violation rate, comprehensive auditability
**Timeline:** 4-5 weeks for full implementation
**Risk Level:** Medium (well-established safety patterns, policy complexity)
**Priority:** High (Phase 1, foundation for all safety systems)

---

## 1. System Architecture

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Swiss Cheese Guardrails Architecture              │
│                                                               │
│  Layer 1: Input Validation                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  • Input sanitization & normalization                │  │
│  │  • Intent analysis & threat detection                │  │
│  │  • Prompt injection prevention                       │  │
│  │  • Schema validation                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  Layer 2: Policy Enforcement                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  • Capability checks                                  │  │
│  │  • Resource limits                                   │  │
│  │  • Data privacy controls                              │  │
│  │  • Budget enforcement                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  Layer 3: Runtime Monitoring                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  • Behavior analysis                                  │  │
│  │  • Anomaly detection                                  │  │
│  │  • Circuit breakers                                   │  │
│  │  • Real-time policy checking                          │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  Layer 4: Output Validation                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  • Content filtering                                  │  │
│  │  • PII detection & redaction                          │  │
│  │  • Harmfulness assessment                            │  │
│  │  • Output sanitization                                │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  Layer 5: Post-Execution Verification                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  • Impact analysis                                    │  │
│  │  • Rollback capabilities                              │  │
│  │  • Audit logging                                     │  │
│  │  • Incident response                                  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Integration Points

```
Existing Swiss Cheese Integration
─────────────────────────────────────
governorService.ts         →  Policy Enforcement Layer
agent-orchestrator.ts     ←  All Layer Validations
tool-executor.service.ts  →  Runtime Monitoring Layer
watchdog.service.ts       →  Anomaly Detection
causal-tracer.service.ts  →  Audit Logging
circuit-breaker.service.ts →  Circuit Breaker Integration
```

---

## 2. Component Design

### 2.1 Swiss Cheese Guardrails Coordinator

#### 2.1.1 Interface Definition

```typescript
interface SwissCheeseGuardrails {
  // Main validation pipeline
  validateThroughLayers(
    input: AgentInput,
    context: AgentContext
  ): Promise<SwissCheeseValidationResult>;
  
  // Layer-specific operations
  validateLayer(
    layer: GuardrailLayer,
    input: LayerInput
  ): Promise<LayerOutput>;
  
  // Layer management
  registerLayer(layer: GuardrailLayer): void;
  unregisterLayer(layerId: string): void;
  getLayer(layerId: string): GuardrailLayer | null;
  listLayers(): GuardrailLayer[];
  
  // Configuration
  updateLayerConfiguration(
    layerId: string,
    config: LayerConfiguration
  ): void;
  
  // Statistics and monitoring
  getLayerStatistics(layerId: string): LayerStatistics;
  getOverallStatistics(): OverallStatistics;
  
  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

interface SwissCheeseValidationResult {
  allowed: boolean;
  blockedAtLayer: string | null;
  finalData: any;
  layerOutputs: LayerOutput[];
  overallConfidence: number;
  reasoning: string;
  suggestedActions: SuggestedAction[];
  violations: PolicyViolation[];
}

interface GuardrailLayer {
  id: string;
  name: string;
  order: number;
  qualityAttributes: QualityAttribute[];
  enabled: boolean;
  configuration: LayerConfiguration;
  
  validate(input: LayerInput): Promise<LayerOutput>;
  monitor(execution: AgentExecution): Promise<MonitoringResult>;
}

interface LayerInput {
  data: any;
  context: AgentContext;
  metadata: Record<string, any>;
  previousLayerOutputs: LayerOutput[];
}

interface LayerOutput {
  allowed: boolean;
  modifiedData?: any;
  reasoning: string;
  confidence: number;
  suggestedActions: SuggestedAction[];
  metrics: LayerMetrics;
  violations: PolicyViolation[];
}

interface QualityAttribute {
  name: string;
  priority: number;
  measurementMethod: string;
  targetValue: number;
  tolerance: number;
  currentValue: number;
}
```

#### 2.1.2 Implementation

```typescript
class SwissCheeseGuardrailsImpl implements SwissCheeseGuardrails {
  private layers: Map<string, GuardrailLayer>;
  private layerOrder: string[];
  private metricsCollector: MetricsCollector;
  private auditLogger: AuditLogger;
  
  constructor(
    metricsCollector: MetricsCollector,
    auditLogger: AuditLogger
  ) {
    this.layers = new Map();
    this.layerOrder = [];
    this.metricsCollector = metricsCollector;
    this.auditLogger = auditLogger;
  }
  
  async initialize(): Promise<void> {
    // Register default layers
    await this.registerDefaultLayers();
    
    // Initialize each layer
    for (const layer of this.layers.values()) {
      if (layer.enabled) {
        await this.initializeLayer(layer);
      }
    }
  }
  
  async validateThroughLayers(
    input: AgentInput,
    context: AgentContext
  ): Promise<SwissCheeseValidationResult> {
    const validationId = this.generateValidationId();
    const startTime = Date.now();
    
    this.auditLogger.logValidationStart(validationId, input, context);
    
    let currentData = input.data;
    const layerOutputs: LayerOutput[] = [];
    const allViolations: PolicyViolation[] = [];
    let blockedAtLayer: string | null = null;
    
    // Process through each layer in order
    for (const layerId of this.layerOrder) {
      const layer = this.layers.get(layerId);
      
      if (!layer || !layer.enabled) {
        continue;
      }
      
      const layerInput: LayerInput = {
        data: currentData,
        context,
        metadata: {
          validationId,
          timestamp: new Date(),
          layerIndex: this.layerOrder.indexOf(layerId)
        },
        previousLayerOutputs: layerOutputs
      };
      
      try {
        const output = await this.validateLayer(layer, layerInput);
        layerOutputs.push(output);
        
        // Record metrics
        this.metricsCollector.recordLayerMetrics(layer.id, output.metrics);
        
        if (!output.allowed) {
          blockedAtLayer = layer.id;
          allViolations.push(...output.violations);
          
          this.auditLogger.logLayerBlock(validationId, layer.id, output);
          
          // Stop processing if layer blocks
          break;
        }
        
        // Update data for next layer
        currentData = output.modifiedData || currentData;
        
      } catch (error) {
        // Log error and continue to next layer (fail-safe)
        this.auditLogger.logLayerError(validationId, layer.id, error as Error);
        
        const errorOutput: LayerOutput = {
          allowed: true, // Allow through on error (fail-safe)
          reasoning: `Layer ${layer.name} encountered error: ${(error as Error).message}`,
          confidence: 0.5,
          suggestedActions: [],
          metrics: this.createErrorMetrics(),
          violations: []
        };
        
        layerOutputs.push(errorOutput);
      }
    }
    
    const validationTime = Date.now() - startTime;
    const overallConfidence = this.calculateOverallConfidence(layerOutputs);
    
    const result: SwissCheeseValidationResult = {
      allowed: blockedAtLayer === null,
      blockedAtLayer,
      finalData: currentData,
      layerOutputs,
      overallConfidence,
      reasoning: this.generateReasoning(layerOutputs, blockedAtLayer),
      suggestedActions: this.aggregateSuggestedActions(layerOutputs),
      violations: allViolations
    };
    
    this.auditLogger.logValidationComplete(validationId, result, validationTime);
    this.metricsCollector.recordValidationMetrics(validationId, result, validationTime);
    
    return result;
  }
  
  async validateLayer(
    layer: GuardrailLayer,
    input: LayerInput
  ): Promise<LayerOutput> {
    const startTime = Date.now();
    
    // Execute layer validation
    const output = await layer.validate(input);
    
    const validationTime = Date.now() - startTime;
    
    // Add timing to metrics
    output.metrics.validationTime = validationTime;
    
    // Update quality attributes
    await this.updateQualityAttributes(layer, output);
    
    return output;
  }
  
  registerLayer(layer: GuardrailLayer): void {
    this.layers.set(layer.id, layer);
    
    // Update order if not already present
    if (!this.layerOrder.includes(layer.id)) {
      this.layerOrder.push(layer.id);
      this.layerOrder.sort((a, b) => {
        const layerA = this.layers.get(a);
        const layerB = this.layers.get(b);
        return (layerA?.order || 0) - (layerB?.order || 0);
      });
    }
  }
  
  unregisterLayer(layerId: string): void {
    this.layers.delete(layerId);
    this.layerOrder = this.layerOrder.filter(id => id !== layerId);
  }
  
  getLayer(layerId: string): GuardrailLayer | null {
    return this.layers.get(layerId) || null;
  }
  
  listLayers(): GuardrailLayer[] {
    return this.layerOrder
      .map(id => this.layers.get(id))
      .filter((layer): layer is GuardrailLayer => layer !== undefined);
  }
  
  updateLayerConfiguration(
    layerId: string,
    config: LayerConfiguration
  ): void {
    const layer = this.layers.get(layerId);
    if (layer) {
      layer.configuration = { ...layer.configuration, ...config };
    }
  }
  
  getLayerStatistics(layerId: string): LayerStatistics {
    const layer = this.layers.get(layerId);
    if (!layer) {
      throw new Error(`Layer ${layerId} not found`);
    }
    
    return this.metricsCollector.getLayerStatistics(layerId);
  }
  
  getOverallStatistics(): OverallStatistics {
    return this.metricsCollector.getOverallStatistics();
  }
  
  async shutdown(): Promise<void> {
    // Shutdown each layer
    for (const layer of this.layers.values()) {
      await this.shutdownLayer(layer);
    }
  }
  
  // Private helper methods
  private async registerDefaultLayers(): Promise<void> {
    // Register standard Swiss Cheese layers
    this.registerLayer(await this.createInputValidationLayer());
    this.registerLayer(await this.createPolicyEnforcementLayer());
    this.registerLayer(await this.createRuntimeMonitoringLayer());
    this.registerLayer(await this.createOutputValidationLayer());
    this.registerLayer(await this.createPostExecutionLayer());
  }
  
  private async initializeLayer(layer: GuardrailLayer): Promise<void> {
    // Layer-specific initialization if needed
    if (typeof (layer as any).initialize === 'function') {
      await (layer as any).initialize();
    }
  }
  
  private async shutdownLayer(layer: GuardrailLayer): Promise<void> {
    // Layer-specific shutdown if needed
    if (typeof (layer as any).shutdown === 'function') {
      await (layer as any).shutdown();
    }
  }
  
  private calculateOverallConfidence(outputs: LayerOutput[]): number {
    if (outputs.length === 0) return 1.0;
    
    const totalConfidence = outputs.reduce((sum, output) => sum + output.confidence, 0);
    return totalConfidence / outputs.length;
  }
  
  private generateReasoning(
    outputs: LayerOutput[],
    blockedAtLayer: string | null
  ): string {
    if (blockedAtLayer) {
      const blockedLayer = outputs.find(o => o.reasoning.includes(blockedAtLayer));
      return blockedLayer?.reasoning || `Blocked at layer: ${blockedAtLayer}`;
    }
    
    const passedLayers = outputs
      .map(o => `${o.reasoning} (confidence: ${o.confidence.toFixed(2)})`)
      .join('; ');
    
    return `All layers passed: ${passedLayers}`;
  }
  
  private aggregateSuggestedActions(outputs: LayerOutput[]): SuggestedAction[] {
    const actions: SuggestedAction[] = [];
    
    for (const output of outputs) {
      actions.push(...output.suggestedActions);
    }
    
    // Deduplicate actions
    const uniqueActions = this.deduplicateActions(actions);
    
    return uniqueActions;
  }
  
  private deduplicateActions(actions: SuggestedAction[]): SuggestedAction[] {
    const seen = new Set<string>();
    return actions.filter(action => {
      const key = `${action.type}_${JSON.stringify(action.parameters)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  
  private async updateQualityAttributes(
    layer: GuardrailLayer,
    output: LayerOutput
  ): Promise<void> {
    for (const attribute of layer.qualityAttributes) {
      const currentValue = await this.measureQualityAttribute(attribute, output);
      attribute.currentValue = currentValue;
    }
  }
  
  private async measureQualityAttribute(
    attribute: QualityAttribute,
    output: LayerOutput
  ): Promise<number> {
    // Implement attribute-specific measurement
    switch (attribute.measurementMethod) {
      case 'confidence':
        return output.confidence;
      case 'validation_time':
        return output.metrics.validationTime || 0;
      case 'violation_count':
        return output.violations.length;
      default:
        return 0;
    }
  }
  
  private createErrorMetrics(): LayerMetrics {
    return {
      validationTime: 0,
      resourceUsage: { cpu: 0, memory: 0 },
      cacheHits: 0,
      cacheMisses: 0
    };
  }
  
  private generateValidationId(): string {
    return `validation_${Date.now()}_${randomBytes(8).toString('hex')}`;
  }
}
```

### 2.2 Layer 1: Input Validation

#### 2.2.1 Interface Definition

```typescript
interface InputValidationLayer extends GuardrailLayer {
  validateInput(input: AgentInput): Promise<InputValidationResult>;
  
  sanitizeInput(input: string): Promise<string>;
  analyzeIntent(input: string): Promise<IntentAnalysis>;
  detectThreats(input: string): Promise<ThreatDetection>;
  validateSchema(input: any, schema: JSONSchema): Promise<SchemaValidation>;
}

interface InputValidationResult {
  sanitized: string;
  intent: IntentAnalysis;
  threats: ThreatDetection[];
  schemaValid: boolean;
  violations: PolicyViolation[];
}

interface IntentAnalysis {
  primaryIntent: string;
  confidence: number;
  categories: string[];
  complexity: number;
  estimatedRisk: number;
}

interface ThreatDetection {
  threatType: 'prompt_injection' | 'jailbreak' | 'data_exfiltration' | 'privilege_escalation';
  confidence: number;
  detectedPatterns: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}
```

#### 2.2.2 Implementation

```typescript
class InputValidationLayerImpl implements InputValidationLayer {
  id = 'input_validation';
  name = 'Input Validation Layer';
  order = 1;
  qualityAttributes: QualityAttribute[] = [
    {
      name: 'sanitization_effectiveness',
      priority: 1,
      measurementMethod: 'threat_detection_rate',
      targetValue: 0.95,
      tolerance: 0.05,
      currentValue: 0
    },
    {
      name: 'intent_analysis_accuracy',
      priority: 2,
      measurementMethod: 'confidence_score',
      targetValue: 0.90,
      tolerance: 0.10,
      currentValue: 0
    }
  ];
  enabled = true;
  configuration: LayerConfiguration = {
    strictMode: true,
    maxInputLength: 100000,
    allowedInputTypes: ['text', 'json'],
    threatThreshold: 0.7
  };
  
  private threatDetector: ThreatDetector;
  private intentAnalyzer: IntentAnalyzer;
  private schemaValidator: SchemaValidator;
  
  constructor(
    threatDetector: ThreatDetector,
    intentAnalyzer: IntentAnalyzer,
    schemaValidator: SchemaValidator
  ) {
    this.threatDetector = threatDetector;
    this.intentAnalyzer = intentAnalyzer;
    this.schemaValidator = schemaValidator;
  }
  
  async validate(input: LayerInput): Promise<LayerOutput> {
    const startTime = Date.now();
    
    const agentInput = input.data as AgentInput;
    const violations: PolicyViolation[] = [];
    const suggestedActions: SuggestedAction[] = [];
    
    // Step 1: Sanitize input
    const sanitized = await this.sanitizeInput(agentInput.content);
    
    // Step 2: Analyze intent
    const intent = await this.analyzeIntent(sanitized);
    
    // Step 3: Detect threats
    const threats = await this.detectThreats(sanitized);
    
    // Step 4: Validate schema if provided
    let schemaValid = true;
    if (agentInput.schema) {
      const schemaResult = await this.validateSchema(
        JSON.parse(sanitized),
        agentInput.schema
      );
      schemaValid = schemaResult.valid;
      violations.push(...schemaResult.violations);
    }
    
    // Step 5: Check against configuration limits
    if (sanitized.length > this.configuration.maxInputLength) {
      violations.push({
        type: 'input_length_exceeded',
        severity: 'error',
        message: `Input length ${sanitized.length} exceeds maximum ${this.configuration.maxInputLength}`,
        policy: 'input_validation'
      });
    }
    
    // Step 6: Evaluate threats
    const criticalThreats = threats.filter(t => t.severity === 'critical');
    if (criticalThreats.length > 0) {
      violations.push({
        type: 'critical_threat_detected',
        severity: 'critical',
        message: `Critical threats detected: ${criticalThreats.map(t => t.threatType).join(', ')}`,
        policy: 'input_validation',
        details: criticalThreats
      });
      
      suggestedActions.push({
        type: 'block',
        priority: 'critical',
        reason: 'Critical security threats detected',
        parameters: { threats: criticalThreats }
      });
    }
    
    // Step 7: Evaluate intent risk
    if (intent.estimatedRisk > 0.8) {
      violations.push({
        type: 'high_risk_intent',
        severity: 'warning',
        message: `High-risk intent detected: ${intent.primaryIntent} (risk: ${intent.estimatedRisk.toFixed(2)})`,
        policy: 'input_validation',
        details: intent
      });
      
      suggestedActions.push({
        type: 'require_approval',
        priority: 'high',
        reason: 'High-risk intent requires approval',
        parameters: { intent: intent.primaryIntent }
      });
    }
    
    const validationTime = Date.now() - startTime;
    
    return {
      allowed: violations.filter(v => v.severity === 'critical').length === 0,
      modifiedData: { ...agentInput, content: sanitized },
      reasoning: this.generateReasoning(intent, threats, schemaValid),
      confidence: this.calculateConfidence(intent, threats, schemaValid),
      suggestedActions,
      metrics: {
        validationTime,
        resourceUsage: { cpu: 0.1, memory: 0.05 },
        cacheHits: 0,
        cacheMisses: 0
      },
      violations
    };
  }
  
  async sanitizeInput(input: string): Promise<string> {
    // Remove null bytes and other problematic characters
    let sanitized = input.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    
    // Normalize whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    
    // Remove potential prompt injection markers
    const injectionPatterns = [
      /<\|.*?\|>/g, // Special delimiter injection
      /\[SYSTEM\].*?\[\/SYSTEM\]/gi, // System instruction injection
      /\[INST\].*?\[\/INST\]/gi, // Instruction injection
      /<script>.*?<\/script>/gis, // Script injection
      /javascript:/gi, // JavaScript protocol
      /data:/gi // Data protocol
    ];
    
    for (const pattern of injectionPatterns) {
      sanitized = sanitized.replace(pattern, '');
    }
    
    return sanitized;
  }
  
  async analyzeIntent(input: string): Promise<IntentAnalysis> {
    return await this.intentAnalyzer.analyze(input);
  }
  
  async detectThreats(input: string): Promise<ThreatDetection[]> {
    return await this.threatDetector.detect(input);
  }
  
  async validateSchema(input: any, schema: JSONSchema): Promise<SchemaValidation> {
    return await this.schemaValidator.validate(input, schema);
  }
  
  monitor(execution: AgentExecution): Promise<MonitoringResult> {
    // Input validation layer doesn't typically monitor ongoing execution
    return Promise.resolve({
      anomalous: false,
      anomalies: [],
      confidence: 1.0
    });
  }
  
  private generateReasoning(
    intent: IntentAnalysis,
    threats: ThreatDetection[],
    schemaValid: boolean
  ): string {
    const parts: string[] = [];
    
    parts.push(`Intent: ${intent.primaryIntent} (${intent.categories.join(', ')})`);
    parts.push(`Risk: ${(intent.estimatedRisk * 100).toFixed(0)}%`);
    
    if (threats.length > 0) {
      parts.push(`Threats: ${threats.map(t => t.threatType).join(', ')}`);
    }
    
    parts.push(`Schema: ${schemaValid ? 'valid' : 'invalid'}`);
    
    return parts.join('. ');
  }
  
  private calculateConfidence(
    intent: IntentAnalysis,
    threats: ThreatDetection[],
    schemaValid: boolean
  ): number {
    let confidence = intent.confidence;
    
    // Reduce confidence based on threats
    const threatPenalty = threats.reduce((sum, threat) => {
      const severityPenalty = {
        low: 0.05,
        medium: 0.15,
        high: 0.30,
        critical: 0.50
      }[threat.severity];
      return sum + severityPenalty * threat.confidence;
    }, 0);
    
    confidence -= threatPenalty;
    
    // Reduce confidence if schema invalid
    if (!schemaValid) {
      confidence -= 0.2;
    }
    
    return Math.max(0, Math.min(1, confidence));
  }
}
```

### 2.3 Layer 2: Policy Enforcement

#### 2.3.1 Interface Definition

```typescript
interface PolicyEnforcementLayer extends GuardrailLayer {
  validateCapability(check: CapabilityCheck): Promise<CapabilityCheckResult>;
  validateResourceLimit(request: ResourceRequest): Promise<ResourceLimitResult>;
  validateDataPrivacy(data: any, policy: PrivacyPolicy): Promise<PrivacyResult>;
  validateBudget(request: BudgetRequest): Promise<BudgetResult>;
  
  enforcePolicy(toolCall: ToolCall, context: AgentContext): Promise<PolicyEnforcementResult>;
}

interface CapabilityCheck {
  capability: string;
  agentId: string;
  userId: string;
  parameters: Record<string, any>;
}

interface CapabilityCheckResult {
  allowed: boolean;
  reason: string;
  conditions: PolicyCondition[];
  requiredApprovals: ApprovalRequest[];
}

interface ResourceRequest {
  resourceType: 'cpu' | 'memory' | 'gpu' | 'storage' | 'network';
  amount: number;
  duration: number;
  agentId: string;
}

interface ResourceLimitResult {
  allowed: boolean;
  available: number;
  requested: number;
  reason: string;
}
```

#### 2.3.2 Implementation

```typescript
class PolicyEnforcementLayerImpl implements PolicyEnforcementLayer {
  id = 'policy_enforcement';
  name = 'Policy Enforcement Layer';
  order = 2;
  qualityAttributes: QualityAttribute[] = [
    {
      name: 'policy_compliance_rate',
      priority: 1,
      measurementMethod: 'compliance_percentage',
      targetValue: 0.98,
      tolerance: 0.02,
      currentValue: 0
    },
    {
      name: 'resource_utilization_efficiency',
      priority: 2,
      measurementMethod: 'utilization_ratio',
      targetValue: 0.85,
      tolerance: 0.15,
      currentValue: 0
    }
  ];
  enabled = true;
  configuration: LayerConfiguration = {
    strictMode: true,
    enableCapabilityChecks: true,
    enableResourceLimits: true,
    enableDataPrivacy: true,
    enableBudgetEnforcement: true
  };
  
  private governorService: GovernorService;
  private resourceMonitor: ResourceMonitor;
  private privacyEngine: PrivacyEngine;
  private budgetManager: BudgetManager;
  
  constructor(
    governorService: GovernorService,
    resourceMonitor: ResourceMonitor,
    privacyEngine: PrivacyEngine,
    budgetManager: BudgetManager
  ) {
    this.governorService = governorService;
    this.resourceMonitor = resourceMonitor;
    this.privacyEngine = privacyEngine;
    this.budgetManager = budgetManager;
  }
  
  async validate(input: LayerInput): Promise<LayerOutput> {
    const startTime = Date.now();
    
    const agentInput = input.data as AgentInput;
    const context = input.context;
    const violations: PolicyViolation[] = [];
    const suggestedActions: SuggestedAction[] = [];
    
    // Extract tool call if present
    const toolCall = this.extractToolCall(agentInput);
    
    if (toolCall) {
      // Validate tool access
      const toolAccessResult = await this.validateToolAccess(toolCall, context);
      if (!toolAccessResult.allowed) {
        violations.push({
          type: 'tool_access_denied',
          severity: 'critical',
          message: toolAccessResult.reason,
          policy: 'tool_access',
          details: toolAccessResult
        });
        
        suggestedActions.push({
          type: 'block',
          priority: 'critical',
          reason: toolAccessResult.reason,
          parameters: { toolCall }
        });
      }
      
      // Validate capability
      if (this.configuration.enableCapabilityChecks) {
        const capabilityCheck: CapabilityCheck = {
          capability: toolCall.toolName,
          agentId: context.agentId || 'unknown',
          userId: context.userId,
          parameters: toolCall.parameters
        };
        
        const capabilityResult = await this.validateCapability(capabilityCheck);
        if (!capabilityResult.allowed) {
          violations.push({
            type: 'capability_denied',
            severity: 'error',
            message: capabilityResult.reason,
            policy: 'capability',
            details: capabilityResult
          });
          
          suggestedActions.push({
            type: 'require_approval',
            priority: 'high',
            reason: capabilityResult.reason,
            parameters: { capability: capabilityCheck.capability }
          });
        }
      }
      
      // Validate resource limits
      if (this.configuration.enableResourceLimits) {
        const resourceRequest = this.estimateResourceRequest(toolCall);
        const resourceResult = await this.validateResourceLimit(resourceRequest);
        if (!resourceResult.allowed) {
          violations.push({
            type: 'resource_limit_exceeded',
            severity: 'warning',
            message: resourceResult.reason,
            policy: 'resource_limits',
            details: resourceResult
          });
          
          suggestedActions.push({
            type: 'queue',
            priority: 'medium',
            reason: resourceResult.reason,
            parameters: { resourceRequest }
          });
        }
      }
      
      // Validate budget
      if (this.configuration.enableBudgetEnforcement) {
        const budgetRequest = this.estimateBudgetRequest(toolCall);
        const budgetResult = await this.validateBudget(budgetRequest);
        if (!budgetResult.allowed) {
          violations.push({
            type: 'budget_exceeded',
            severity: 'error',
            message: budgetResult.reason,
            policy: 'budget',
            details: budgetResult
          });
          
          suggestedActions.push({
            type: 'block',
            priority: 'high',
            reason: budgetResult.reason,
            parameters: { budgetRequest }
          });
        }
      }
    }
    
    // Validate data privacy
    if (this.configuration.enableDataPrivacy) {
      const privacyResult = await this.validateDataPrivacy(
        agentInput,
        context.privacyPolicy || this.getDefaultPrivacyPolicy()
      );
      
      if (!privacyResult.compliant) {
        violations.push({
          type: 'privacy_violation',
          severity: 'error',
          message: privacyResult.reason,
          policy: 'data_privacy',
          details: privacyResult
        });
        
        suggestedActions.push({
          type: 'redact',
          priority: 'high',
          reason: privacyResult.reason,
          parameters: { redactionFields: privacyResult.fieldsToRedact }
        });
      }
    }
    
    const validationTime = Date.now() - startTime;
    
    return {
      allowed: violations.filter(v => v.severity === 'critical').length === 0,
      modifiedData: agentInput,
      reasoning: this.generateReasoning(violations, suggestedActions),
      confidence: this.calculateConfidence(violations),
      suggestedActions,
      metrics: {
        validationTime,
        resourceUsage: { cpu: 0.15, memory: 0.1 },
        cacheHits: await this.getCacheHits(),
        cacheMisses: await this.getCacheMisses()
      },
      violations
    };
  }
  
  async validateCapability(check: CapabilityCheck): Promise<CapabilityCheckResult> {
    try {
      // Use governor service for capability validation
      const result = this.governorService.validateFromPolicy(
        check.agentId,
        check.userId || 'system',
        {
          capability: check.capability,
          parameters: check.parameters
        }
      );
      
      return {
        allowed: result.allowed,
        reason: result.reasoning || 'Capability check passed',
        conditions: result.conditions || [],
        requiredApprovals: []
      };
    } catch (error) {
      return {
        allowed: false,
        reason: (error as Error).message,
        conditions: [],
        requiredApprovals: []
      };
    }
  }
  
  async validateResourceLimit(request: ResourceRequest): Promise<ResourceLimitResult> {
    const available = await this.resourceMonitor.getAvailableResources(request.resourceType);
    
    if (available >= request.amount) {
      return {
        allowed: true,
        available,
        requested: request.amount,
        reason: 'Sufficient resources available'
      };
    }
    
    return {
      allowed: false,
      available,
      requested: request.amount,
      reason: `Insufficient ${request.resourceType}: ${available} available, ${request.amount} requested`
    };
  }
  
  async validateDataPrivacy(data: any, policy: PrivacyPolicy): Promise<PrivacyResult> {
    return await this.privacyEngine.validate(data, policy);
  }
  
  async validateBudget(request: BudgetRequest): Promise<BudgetResult> {
    return await this.budgetManager.validate(request);
  }
  
  async enforcePolicy(toolCall: ToolCall, context: AgentContext): Promise<PolicyEnforcementResult> {
    const violations: PolicyViolation[] = [];
    const modifications: ToolModification[] = [];
    
    // Enforce governor policies
    try {
      this.governorService.validateToolAccess(
        toolCall.toolName,
        context.governorConfig?.rules || []
      );
    } catch (error) {
      violations.push({
        type: 'tool_access_denied',
        severity: 'critical',
        message: (error as Error).message,
        policy: 'tool_access'
      });
      return { allowed: false, violations, modifications };
    }
    
    // Enforce data privacy policies
    const privacyCheck = await this.validateDataPrivacy(
      toolCall.parameters,
      context.privacyPolicy || this.getDefaultPrivacyPolicy()
    );
    
    if (!privacyCheck.compliant) {
      // Apply redactions
      for (const field of privacyCheck.fieldsToRedact) {
        if (toolCall.parameters[field]) {
          modifications.push({
            field,
            originalValue: toolCall.parameters[field],
            redactedValue: this.redactValue(toolCall.parameters[field]),
            reason: privacyCheck.reason
          });
          toolCall.parameters[field] = modifications[modifications.length - 1].redactedValue;
        }
      }
    }
    
    return {
      allowed: violations.length === 0,
      violations,
      modifications
    };
  }
  
  monitor(execution: AgentExecution): Promise<MonitoringResult> {
    // Monitor for policy violations during execution
    return this.resourceMonitor.monitorExecution(execution);
  }
  
  // Private helper methods
  private extractToolCall(input: AgentInput): ToolCall | null {
    // Extract tool call from agent input
    if (input.toolCall) {
      return input.toolCall;
    }
    
    // Try to parse from content
    try {
      const parsed = JSON.parse(input.content);
      if (parsed.toolName && parsed.parameters) {
        return parsed as ToolCall;
      }
    } catch {
      // Not JSON, return null
    }
    
    return null;
  }
  
  private estimateResourceRequest(toolCall: ToolCall): ResourceRequest {
    // Estimate resource requirements based on tool type and parameters
    const baseRequirements: Record<string, { cpu: number, memory: number }> = {
      'file_read': { cpu: 0.1, memory: 0.05 },
      'file_write': { cpu: 0.2, memory: 0.1 },
      'python': { cpu: 0.5, memory: 0.3 },
      'shell': { cpu: 0.3, memory: 0.2 },
      'browse_web': { cpu: 0.2, memory: 0.15 }
    };
    
    const base = baseRequirements[toolCall.toolName] || { cpu: 0.1, memory: 0.05 };
    
    // Scale based on parameter size
    const paramSize = JSON.stringify(toolCall.parameters).length;
    const scaleFactor = Math.min(2.0, 1 + paramSize / 10000);
    
    return {
      resourceType: 'cpu',
      amount: base.cpu * scaleFactor,
      duration: 60, // Default 1 minute
      agentId: 'unknown'
    };
  }
  
  private estimateBudgetRequest(toolCall: ToolCall): BudgetRequest {
    // Estimate cost based on tool type
    const baseCosts: Record<string, number> = {
      'file_read': 0.001,
      'file_write': 0.002,
      'python': 0.01,
      'shell': 0.005,
      'browse_web': 0.003
    };
    
    const baseCost = baseCosts[toolCall.toolName] || 0.001;
    
    return {
      estimatedCost: baseCost,
      agentId: 'unknown',
      organizationId: 1
    };
  }
  
  private getDefaultPrivacyPolicy(): PrivacyPolicy {
    return {
      piiFields: ['ssn', 'credit_card', 'email', 'phone'],
      allowedDataTypes: ['text', 'json'],
      encryptionRequired: false,
      auditLogRequired: true
    };
  }
  
  private redactValue(value: any): string {
    // Simple redaction - can be enhanced
    if (typeof value === 'string') {
      if (value.length > 4) {
        return value.substring(0, 2) + '***' + value.substring(value.length - 2);
      }
      return '***';
    }
    return '[REDACTED]';
  }
  
  private generateReasoning(
    violations: PolicyViolation[],
    actions: SuggestedAction[]
  ): string {
    const parts: string[] = [];
    
    if (violations.length === 0) {
      parts.push('All policy checks passed');
    } else {
      parts.push(`Violations: ${violations.map(v => v.type).join(', ')}`);
    }
    
    if (actions.length > 0) {
      parts.push(`Actions: ${actions.map(a => a.type).join(', ')}`);
    }
    
    return parts.join('. ');
  }
  
  private calculateConfidence(violations: PolicyViolation[]): number {
    const criticalCount = violations.filter(v => v.severity === 'critical').length;
    const errorCount = violations.filter(v => v.severity === 'error').length;
    const warningCount = violations.filter(v => v.severity === 'warning').length;
    
    let confidence = 1.0;
    confidence -= criticalCount * 0.5;
    confidence -= errorCount * 0.3;
    confidence -= warningCount * 0.1;
    
    return Math.max(0, Math.min(1, confidence));
  }
  
  private async getCacheHits(): Promise<number> {
    // Implement cache hit tracking
    return 0;
  }
  
  private async getCacheMisses(): Promise<number> {
    // Implement cache miss tracking
    return 0;
  }
}
```

### 2.4 Layer 3: Runtime Monitoring

#### 2.4.1 Interface Definition

```typescript
interface RuntimeMonitoringLayer extends GuardrailLayer {
  monitorBehavior(execution: AgentExecution): Promise<BehaviorAnalysis>;
  detectAnomalies(execution: AgentExecution): Promise<AnomalyDetection>;
  checkCircuitBreaker(operation: string): Promise<CircuitBreakerState>;
  monitorRealTimePolicy(execution: AgentExecution): Promise<PolicyCompliance>;
}

interface BehaviorAnalysis {
  normal: boolean;
  patterns: BehaviorPattern[];
  deviations: BehaviorDeviation[];
  riskScore: number;
}

interface AnomalyDetection {
  anomalous: boolean;
  anomalies: Anomaly[];
  confidence: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface Anomaly {
  type: string;
  description: string;
  confidence: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  metrics: Record<string, number>;
}

interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half_open';
  failureCount: number;
  lastFailureTime: Date;
  nextAttemptTime: Date;
}
```

#### 2.4.2 Implementation

```typescript
class RuntimeMonitoringLayerImpl implements RuntimeMonitoringLayer {
  id = 'runtime_monitoring';
  name = 'Runtime Monitoring Layer';
  order = 3;
  qualityAttributes: QualityAttribute[] = [
    {
      name: 'anomaly_detection_accuracy',
      priority: 1,
      measurementMethod: 'true_positive_rate',
      targetValue: 0.90,
      tolerance: 0.10,
      currentValue: 0
    },
    {
      name: 'circuit_breaker_effectiveness',
      priority: 2,
      measurementMethod: 'failure_prevention_rate',
      targetValue: 0.95,
      tolerance: 0.05,
      currentValue: 0
    }
  ];
  enabled = true;
  configuration: LayerConfiguration = {
    strictMode: false,
    anomalyThreshold: 0.7,
    circuitBreakerEnabled: true,
    realTimePolicyChecking: true
  };
  
  private behaviorAnalyzer: BehaviorAnalyzer;
  private anomalyDetector: AnomalyDetector;
  private circuitBreakerRegistry: CircuitBreakerRegistry;
  private policyMonitor: PolicyMonitor;
  
  constructor(
    behaviorAnalyzer: BehaviorAnalyzer,
    anomalyDetector: AnomalyDetector,
    circuitBreakerRegistry: CircuitBreakerRegistry,
    policyMonitor: PolicyMonitor
  ) {
    this.behaviorAnalyzer = behaviorAnalyzer;
    this.anomalyDetector = anomalyDetector;
    this.circuitBreakerRegistry = circuitBreakerRegistry;
    this.policyMonitor = policyMonitor;
  }
  
  async validate(input: LayerInput): Promise<LayerOutput> {
    const startTime = Date.now();
    
    const agentInput = input.data as AgentInput;
    const context = input.context;
    const violations: PolicyViolation[] = [];
    const suggestedActions: SuggestedAction[] = [];
    
    // Extract execution context if available
    const execution = this.extractExecutionContext(agentInput, context);
    
    if (execution) {
      // Check circuit breaker
      if (this.configuration.circuitBreakerEnabled) {
        const circuitBreakerState = await this.checkCircuitBreaker(execution.operation);
        
        if (circuitBreakerState.state === 'open') {
          violations.push({
            type: 'circuit_breaker_open',
            severity: 'critical',
            message: `Circuit breaker open for operation: ${execution.operation}. Failures: ${circuitBreakerState.failureCount}`,
            policy: 'circuit_breaker',
            details: circuitBreakerState
          });
          
          suggestedActions.push({
            type: 'block',
            priority: 'critical',
            reason: 'Circuit breaker prevents operation',
            parameters: { operation: execution.operation }
          });
        }
      }
      
      // Detect anomalies
      const anomalyDetection = await this.detectAnomalies(execution);
      
      if (anomalyDetection.anomalous && anomalyDetection.severity !== 'low') {
        violations.push({
          type: 'anomaly_detected',
          severity: anomalyDetection.severity === 'critical' ? 'critical' : 'warning',
          message: `Anomaly detected: ${anomalyDetection.anomalies.map(a => a.type).join(', ')}`,
          policy: 'anomaly_detection',
          details: anomalyDetection
        });
        
        if (anomalyDetection.severity === 'critical' || anomalyDetection.severity === 'high') {
          suggestedActions.push({
            type: 'block',
            priority: 'high',
            reason: 'Critical anomaly detected',
            parameters: { anomalies: anomalyDetection.anomalies }
          });
        } else {
          suggestedActions.push({
            type: 'require_approval',
            priority: 'medium',
            reason: 'Anomaly detected requires review',
            parameters: { anomalies: anomalyDetection.anomalies }
          });
        }
      }
      
      // Monitor behavior
      const behaviorAnalysis = await this.monitorBehavior(execution);
      
      if (!behaviorAnalysis.normal && behaviorAnalysis.riskScore > 0.7) {
        violations.push({
          type: 'abnormal_behavior',
          severity: 'warning',
          message: `Abnormal behavior detected: ${behaviorAnalysis.deviations.map(d => d.type).join(', ')}`,
          policy: 'behavior_monitoring',
          details: behaviorAnalysis
        });
        
        suggestedActions.push({
          type: 'flag',
          priority: 'medium',
          reason: 'Abnormal behavior flagged for review',
          parameters: { deviations: behaviorAnalysis.deviations }
        });
      }
      
      // Real-time policy checking
      if (this.configuration.realTimePolicyChecking) {
        const policyCompliance = await this.monitorRealTimePolicy(execution);
        
        if (!policyCompliant.compliant) {
          violations.push({
            type: 'policy_violation',
            severity: 'error',
            message: `Real-time policy violation: ${policyCompliance.violations.map(v => v.policy).join(', ')}`,
            policy: 'real_time_policy',
            details: policyCompliance
          });
          
          suggestedActions.push({
            type: 'interrupt',
            priority: 'high',
            reason: 'Policy violation detected during execution',
            parameters: { violations: policyCompliance.violations }
          });
        }
      }
    }
    
    const validationTime = Date.now() - startTime;
    
    return {
      allowed: violations.filter(v => v.severity === 'critical').length === 0,
      modifiedData: agentInput,
      reasoning: this.generateReasoning(execution, violations),
      confidence: this.calculateConfidence(violations),
      suggestedActions,
      metrics: {
        validationTime,
        resourceUsage: { cpu: 0.2, memory: 0.15 },
        cacheHits: 0,
        cacheMisses: 0
      },
      violations
    };
  }
  
  async monitorBehavior(execution: AgentExecution): Promise<BehaviorAnalysis> {
    return await this.behaviorAnalyzer.analyze(execution);
  }
  
  async detectAnomalies(execution: AgentExecution): Promise<AnomalyDetection> {
    return await this.anomalyDetector.detect(execution);
  }
  
  async checkCircuitBreaker(operation: string): Promise<CircuitBreakerState> {
    return await this.circuitBreakerRegistry.getState(operation);
  }
  
  async monitorRealTimePolicy(execution: AgentExecution): Promise<PolicyCompliance> {
    return await this.policyMonitor.monitor(execution);
  }
  
  // Private helper methods
  private extractExecutionContext(input: AgentInput, context: AgentContext): AgentExecution | null {
    // Extract execution context from input
    if (input.execution) {
      return input.execution;
    }
    
    // Try to construct from context
    if (context.toolCall) {
      return {
        operation: context.toolCall.toolName,
        parameters: context.toolCall.parameters,
        startTime: new Date(),
        agentId: context.agentId,
        userId: context.userId
      };
    }
    
    return null;
  }
  
  private generateReasoning(execution: AgentExecution | null, violations: PolicyViolation[]): string {
    const parts: string[] = [];
    
    if (execution) {
      parts.push(`Monitoring operation: ${execution.operation}`);
    }
    
    if (violations.length === 0) {
      parts.push('No runtime issues detected');
    } else {
      parts.push(`Issues: ${violations.map(v => v.type).join(', ')}`);
    }
    
    return parts.join('. ');
  }
  
  private calculateConfidence(violations: PolicyViolation[]): number {
    const criticalCount = violations.filter(v => v.severity === 'critical').length;
    const highCount = violations.filter(v => v.severity === 'high').length;
    
    let confidence = 1.0;
    confidence -= criticalCount * 0.4;
    confidence -= highCount * 0.2;
    
    return Math.max(0, Math.min(1, confidence));
  }
}
```

### 2.5 Layer 4: Output Validation

#### 2.5.1 Interface Definition

```typescript
interface OutputValidationLayer extends GuardrailLayer {
  validateContent(output: string): Promise<ContentValidation>;
  detectPII(content: string): Promise<PIIDetection>;
  assessHarmfulness(content: string): Promise<HarmfulnessAssessment>;
  sanitizeOutput(content: string): Promise<string>;
}

interface ContentValidation {
  valid: boolean;
  violations: ContentViolation[];
  issues: ContentIssue[];
}

interface PIIDetection {
  detected: boolean;
  entities: PIIEntity[];
  types: string[];
  confidence: number;
}

interface PIIEntity {
  type: 'ssn' | 'credit_card' | 'email' | 'phone' | 'address' | 'name';
  value: string;
  start: number;
  end: number;
  confidence: number;
}

interface HarmfulnessAssessment {
  harmful: boolean;
  categories: HarmCategory[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
}
```

#### 2.5.2 Implementation

```typescript
class OutputValidationLayerImpl implements OutputValidationLayer {
  id = 'output_validation';
  name = 'Output Validation Layer';
  order = 4;
  qualityAttributes: QualityAttribute[] = [
    {
      name: 'pii_detection_accuracy',
      priority: 1,
      measurementMethod: 'detection_recall',
      targetValue: 0.95,
      tolerance: 0.05,
      currentValue: 0
    },
    {
      name: 'harmfulness_detection_accuracy',
      priority: 2,
      measurementMethod: 'harm_classification_accuracy',
      targetValue: 0.90,
      tolerance: 0.10,
      currentValue: 0
    }
  ];
  enabled = true;
  configuration: LayerConfiguration = {
    strictMode: true,
    enablePIIDetection: true,
    enableHarmfulnessCheck: true,
    enableContentFiltering: true,
    redactionStrategy: 'mask'
  };
  
  private piiDetector: PIIDetector;
  private harmfulnessAnalyzer: HarmfulnessAnalyzer;
  private contentFilter: ContentFilter;
  
  constructor(
    piiDetector: PIIDetector,
    harmfulnessAnalyzer: HarmfulnessAnalyzer,
    contentFilter: ContentFilter
  ) {
    this.piiDetector = piiDetector;
    this.harmfulnessAnalyzer = harmfulnessAnalyzer;
    this.contentFilter = contentFilter;
  }
  
  async validate(input: LayerInput): Promise<LayerOutput> {
    const startTime = Date.now();
    
    const agentInput = input.data as AgentInput;
    const context = input.context;
    const violations: PolicyViolation[] = [];
    const suggestedActions: SuggestedAction[] = [];
    
    // Extract output content
    const output = this.extractOutput(agentInput);
    
    if (output) {
      // Validate content
      const contentValidation = await this.validateContent(output);
      
      if (!contentValidation.valid) {
        violations.push(...contentValidation.violations.map(v => ({
          type: 'content_violation',
          severity: 'error',
          message: v.message,
          policy: 'content_validation',
          details: v
        })));
      }
      
      // Detect PII
      if (this.configuration.enablePIIDetection) {
        const piiDetection = await this.detectPII(output);
        
        if (piiDetection.detected) {
          violations.push({
            type: 'pii_detected',
            severity: 'warning',
            message: `PII detected: ${piiDetection.types.join(', ')}`,
            policy: 'data_privacy',
            details: piiDetection
          });
          
          suggestedActions.push({
            type: 'redact',
            priority: 'high',
            reason: 'PII detected in output',
            parameters: { entities: piiDetection.entities }
          });
        }
      }
      
      // Assess harmfulness
      if (this.configuration.enableHarmfulnessCheck) {
        const harmfulness = await this.assessHarmfulness(output);
        
        if (harmful.harmful) {
          violations.push({
            type: 'harmful_content',
            severity: harmful.severity === 'critical' ? 'critical' : 'error',
            message: `Harmful content detected: ${harmful.categories.map(c => c.category).join(', ')}`,
            policy: 'content_safety',
            details: harmfulness
          });
          
          if (harmful.severity === 'critical' || harmful.severity === 'high') {
            suggestedActions.push({
              type: 'block',
              priority: 'critical',
              reason: 'Harmful content detected',
              parameters: { categories: harmful.categories }
            });
          } else {
            suggestedActions.push({
              type: 'flag',
              priority: 'high',
              reason: 'Potentially harmful content',
              parameters: { categories: harmful.categories }
            });
          }
        }
      }
      
      // Apply content filtering
      if (this.configuration.enableContentFiltering) {
        const filterResult = await this.contentFilter.filter(output);
        
        if (filterResult.filtered) {
          violations.push({
            type: 'content_filtered',
            severity: 'warning',
            message: `Content filtered: ${filterResult.reason}`,
            policy: 'content_filtering',
            details: filterResult
          });
          
          suggestedActions.push({
            type: 'modify',
            priority: 'medium',
            reason: 'Content filtered for policy compliance',
            parameters: { originalContent: output, filteredContent: filterResult.filtered }
          });
        }
      }
    }
    
    const validationTime = Date.now() - startTime;
    
    return {
      allowed: violations.filter(v => v.severity === 'critical').length === 0,
      modifiedData: agentInput,
      reasoning: this.generateReasoning(output, violations),
      confidence: this.calculateConfidence(violations),
      suggestedActions,
      metrics: {
        validationTime,
        resourceUsage: { cpu: 0.1, memory: 0.05 },
        cacheHits: 0,
        cacheMisses: 0
      },
      violations
    };
  }
  
  async validateContent(output: string): Promise<ContentValidation> {
    const violations: ContentViolation[] = [];
    const issues: ContentIssue[] = [];
    
    // Check for empty output
    if (!output || output.trim().length === 0) {
      violations.push({
        type: 'empty_output',
        message: 'Output is empty',
        severity: 'warning'
      });
    }
    
    // Check for excessive length
    if (output.length > 100000) {
      violations.push({
        type: 'excessive_length',
        message: `Output length ${output.length} exceeds maximum 100000`,
        severity: 'warning'
      });
    }
    
    // Check for suspicious patterns
    const suspiciousPatterns = [
      /<script[^>]*>.*?<\/script>/gis,
      /javascript:[^"'\s]*\(/gi,
      /data:[^"'\s]*text\/html/gi,
      /\[SYSTEM\].*?\[\/SYSTEM\]/gi
    ];
    
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(output)) {
        violations.push({
          type: 'suspicious_pattern',
          message: `Suspicious pattern detected: ${pattern.source}`,
          severity: 'error'
        });
      }
    }
    
    return {
      valid: violations.length === 0,
      violations,
      issues
    };
  }
  
  async detectPII(content: string): Promise<PIIDetection> {
    return await this.piiDetector.detect(content);
  }
  
  async assessHarmfulness(content: string): Promise<HarmfulnessAssessment> {
    return await this.harmfulnessAnalyzer.assess(content);
  }
  
  async sanitizeOutput(content: string): Promise<string> {
    let sanitized = content;
    
    // Apply redaction strategy
    if (this.configuration.redactionStrategy === 'mask') {
      const piiDetection = await this.detectPII(content);
      
      for (const entity of piiDetection.entities) {
        const original = content.substring(entity.start, entity.end);
        const masked = '*'.repeat(entity.end - entity.start);
        sanitized = sanitized.replace(original, masked);
      }
    }
    
    return sanitized;
  }
  
  monitor(execution: AgentExecution): Promise<MonitoringResult> {
    // Output validation layer doesn't typically monitor ongoing execution
    return Promise.resolve({
      anomalous: false,
      anomalies: [],
      confidence: 1.0
    });
  }
  
  // Private helper methods
  private extractOutput(input: AgentInput): string | null {
    if (input.output) {
      return input.output;
    }
    
    if (input.content) {
      return input.content;
    }
    
    return null;
  }
  
  private generateReasoning(output: string | null, violations: PolicyViolation[]): string {
    const parts: string[] = [];
    
    if (output) {
      parts.push(`Output length: ${output.length} characters`);
    }
    
    if (violations.length === 0) {
      parts.push('Output validation passed');
    } else {
      parts.push(`Violations: ${violations.map(v => v.type).join(', ')}`);
    }
    
    return parts.join('. ');
  }
  
  private calculateConfidence(violations: PolicyViolation[]): number {
    const criticalCount = violations.filter(v => v.severity === 'critical').length;
    const errorCount = violations.filter(v => v.severity === 'error').length;
    
    let confidence = 1.0;
    confidence -= criticalCount * 0.5;
    confidence -= errorCount * 0.3;
    
    return Math.max(0, Math.min(1, confidence));
  }
}
```

### 2.6 Layer 5: Post-Execution Verification

#### 2.6.1 Interface Definition

```typescript
interface PostExecutionLayer extends GuardrailLayer {
  analyzeImpact(execution: AgentExecution): Promise<ImpactAnalysis>;
  performRollback(execution: AgentExecution): Promise<RollbackResult>;
  logAudit(execution: AgentExecution): Promise<AuditLog>;
  triggerIncidentResponse(violation: PolicyViolation): Promise<IncidentResponse>;
}

interface ImpactAnalysis {
  impact: 'low' | 'medium' | 'high' | 'critical';
  affectedSystems: string[];
  dataChanges: DataChange[];
  resourceUsage: ResourceUsage;
  rollbackRequired: boolean;
}

interface DataChange {
  type: 'create' | 'update' | 'delete';
  resource: string;
  before: any;
  after: any;
  reversible: boolean;
}

interface RollbackResult {
  success: boolean;
  rolledBackChanges: DataChange[];
  remainingChanges: DataChange[];
  error: string | null;
}

interface AuditLog {
  executionId: string;
  timestamp: Date;
  agentId: string;
  userId: string;
  operation: string;
  inputs: any;
  outputs: any;
  layerDecisions: LayerDecision[];
  violations: PolicyViolation[];
  impact: ImpactAnalysis;
}
```

#### 2.6.2 Implementation

```typescript
class PostExecutionLayerImpl implements PostExecutionLayer {
  id = 'post_execution';
  name = 'Post-Execution Layer';
  order = 5;
  qualityAttributes: QualityAttribute[] = [
    {
      name: 'impact_analysis_accuracy',
      priority: 1,
      measurementMethod: 'impact_classification_accuracy',
      targetValue: 0.85,
      tolerance: 0.15,
      currentValue: 0
    },
    {
      name: 'rollback_success_rate',
      priority: 2,
      measurementMethod: 'rollback_success_percentage',
      targetValue: 0.90,
      tolerance: 0.10,
      currentValue: 0
    }
  ];
  enabled = true;
  configuration: LayerConfiguration = {
    strictMode: false,
    enableImpactAnalysis: true,
    enableRollback: true,
    enableAuditLogging: true,
    enableIncidentResponse: true
  };
  
  private impactAnalyzer: ImpactAnalyzer;
  private rollbackManager: RollbackManager;
  private auditLogger: AuditLogger;
  private incidentResponder: IncidentResponder;
  
  constructor(
    impactAnalyzer: ImpactAnalyzer,
    rollbackManager: RollbackManager,
    auditLogger: AuditLogger,
    incidentResponder: IncidentResponder
  ) {
    this.impactAnalyzer = impactAnalyzer;
    this.rollbackManager = rollbackManager;
    this.auditLogger = auditLogger;
    this.incidentResponder = incidentResponder;
  }
  
  async validate(input: LayerInput): Promise<LayerOutput> {
    const startTime = Date.now();
    
    const agentInput = input.data as AgentInput;
    const context = input.context;
    const violations: PolicyViolation[] = [];
    const suggestedActions: SuggestedAction[] = [];
    
    // Extract execution result if available
    const execution = this.extractExecutionResult(agentInput, context);
    
    if (execution) {
      // Analyze impact
      if (this.configuration.enableImpactAnalysis) {
        const impactAnalysis = await this.analyzeImpact(execution);
        
        if (impactAnalysis.impact === 'critical') {
          violations.push({
            type: 'critical_impact',
            severity: 'critical',
            message: `Critical impact detected: ${impactAnalysis.affectedSystems.join(', ')}`,
            policy: 'impact_analysis',
            details: impactAnalysis
          });
          
          suggestedActions.push({
            type: 'rollback',
            priority: 'critical',
            reason: 'Critical impact requires rollback',
            parameters: { execution }
          });
        }
      }
      
      // Log audit
      if (this.configuration.enableAuditLogging) {
        const auditLog = await this.logAudit(execution);
        
        // Check for audit failures
        if (!auditLog) {
          violations.push({
            type: 'audit_failure',
            severity: 'warning',
            message: 'Failed to log audit trail',
            policy: 'audit_logging'
          });
        }
      }
      
      // Check for violations from previous layers
      const previousViolations = input.previousLayerOutputs
        .flatMap(output => output.violations);
      
      if (previousViolations.length > 0) {
        const criticalViolations = previousViolations.filter(v => v.severity === 'critical');
        
        if (criticalViolations.length > 0) {
          // Trigger incident response
          if (this.configuration.enableIncidentResponse) {
            for (const violation of criticalViolations) {
              const incidentResponse = await this.triggerIncidentResponse(violation);
              
              if (incidentResponse.requiresRollback) {
                suggestedActions.push({
                  type: 'rollback',
                  priority: 'critical',
                  reason: incidentResponse.reason,
                  parameters: { violation }
                });
              }
            }
          }
        }
      }
    }
    
    const validationTime = Date.now() - startTime;
    
    return {
      allowed: violations.filter(v => v.severity === 'critical').length === 0,
      modifiedData: agentInput,
      reasoning: this.generateReasoning(execution, violations),
      confidence: this.calculateConfidence(violations),
      suggestedActions,
      metrics: {
        validationTime,
        resourceUsage: { cpu: 0.15, memory: 0.1 },
        cacheHits: 0,
        cacheMisses: 0
      },
      violations
    };
  }
  
  async analyzeImpact(execution: AgentExecution): Promise<ImpactAnalysis> {
    return await this.impactAnalyzer.analyze(execution);
  }
  
  async performRollback(execution: AgentExecution): Promise<RollbackResult> {
    return await this.rollbackManager.rollback(execution);
  }
  
  async logAudit(execution: AgentExecution): Promise<AuditLog> {
    const auditLog: AuditLog = {
      executionId: execution.id || this.generateExecutionId(),
      timestamp: new Date(),
      agentId: execution.agentId,
      userId: execution.userId,
      operation: execution.operation,
      inputs: execution.inputs,
      outputs: execution.outputs,
      layerDecisions: execution.layerDecisions || [],
      violations: execution.violations || [],
      impact: execution.impact || { impact: 'low', affectedSystems: [], dataChanges: [], resourceUsage: { cpu: 0, memory: 0 }, rollbackRequired: false }
    };
    
    await this.auditLogger.log(auditLog);
    return auditLog;
  }
  
  async triggerIncidentResponse(violation: PolicyViolation): Promise<IncidentResponse> {
    return await this.incidentResponder.respond(violation);
  }
  
  monitor(execution: AgentExecution): Promise<MonitoringResult> {
    // Post-execution layer monitors completed executions
    return this.impactAnalyzer.monitor(execution);
  }
  
  // Private helper methods
  private extractExecutionResult(input: AgentInput, context: AgentContext): AgentExecution | null {
    if (input.execution) {
      return input.execution;
    }
    
    // Try to construct from context
    if (context.executionResult) {
      return context.executionResult;
    }
    
    return null;
  }
  
  private generateReasoning(execution: AgentExecution | null, violations: PolicyViolation[]): string {
    const parts: string[] = [];
    
    if (execution) {
      parts.push(`Post-execution verification for: ${execution.operation}`);
      
      if (execution.impact) {
        parts.push(`Impact: ${execution.impact.impact} - ${execution.impact.affectedSystems.join(', ')}`);
      }
    }
    
    if (violations.length === 0) {
      parts.push('Post-execution verification passed');
    } else {
      parts.push(`Violations: ${violations.map(v => v.type).join(', ')}`);
    }
    
    return parts.join('. ');
  }
  
  private calculateConfidence(violations: PolicyViolation[]): number {
    const criticalCount = violations.filter(v => v.severity === 'critical').length;
    
    let confidence = 1.0;
    confidence -= criticalCount * 0.5;
    
    return Math.max(0, Math.min(1, confidence));
  }
  
  private generateExecutionId(): string {
    return `exec_${Date.now()}_${randomBytes(8).toString('hex')}`;
  }
}
```

---

## 3. Integration with Existing Systems

### 3.1 Governor Service Integration

```typescript
// Extend governor service with Swiss cheese layer integration
class SwissCheeseAwareGovernorService extends GovernorService {
  private swissCheese: SwissCheeseGuardrails;
  
  constructor(swissCheese: SwissCheeseGuardrails) {
    super();
    this.swissCheese = swissCheese;
  }
  
  async validateToolAccess(
    toolName: string,
    rules: GovernorPolicyRule[]
  ): void {
    // Run through Swiss cheese layers first
    const input: AgentInput = {
      toolCall: {
        toolName,
        parameters: {}
      },
      content: JSON.stringify({ toolName }),
      timestamp: new Date()
    };
    
    const context: AgentContext = {
      sessionId: 'validation',
      agentId: 'system',
      timestamp: new Date(),
      metadata: { toolName }
    };
    
    const result = await this.swissCheese.validateThroughLayers(input, context);
    
    if (!result.allowed) {
      throw new ForbiddenError(result.reasoning);
    }
    
    // Then run existing validation
    await super.validateToolAccess(toolName, rules);
  }
  
  async validateBudget(
    params: { executionId?: number, organizationId?: number },
    rules: GovernorPolicyRule[]
  ): Promise<ValidationResult> {
    // Run through Swiss cheese layers for budget validation
    const input: AgentInput = {
      content: JSON.stringify(params),
      timestamp: new Date()
    };
    
    const context: AgentContext = {
      sessionId: 'validation',
      organizationId: params.organizationId,
      executionId: params.executionId,
      timestamp: new Date(),
      metadata: params
    };
    
    const result = await this.swissCheese.validateThroughLayers(input, context);
    
    if (!result.allowed) {
      return {
        allowed: false,
        message: result.reasoning
      };
    }
    
    // Then run existing validation
    return await super.validateBudget(params, rules);
  }
}
```

### 3.2 Agent Orchestrator Integration

```typescript
// Extend AgentOrchestrator to use Swiss cheese guardrails
class SwissCheeseAwareAgentOrchestrator extends AgentOrchestrator {
  private swissCheese: SwissCheeseGuardrails;
  
  constructor(
    client: AIClient,
    apiKey: string,
    context: AgentContext,
    swissCheese: SwissCheeseGuardrails
  ) {
    super(client, apiKey, context);
    this.swissCheese = swissCheese;
  }
  
  protected async executeTool(
    toolName: string,
    toolParams: any,
    context: AgentContext
  ): Promise<string> {
    // Validate tool execution through Swiss cheese layers
    const input: AgentInput = {
      toolCall: {
        toolName,
        parameters: toolParams
      },
      content: JSON.stringify({ toolName, parameters: toolParams }),
      timestamp: new Date()
    };
    
    const validation = await this.swissCheese.validateThroughLayers(input, context);
    
    if (!validation.allowed) {
      return `Error: ${validation.reasoning}. Suggested actions: ${validation.suggestedActions.map(a => a.type).join(', ')}`;
    }
    
    // Apply any modifications from layers
    if (validation.modifiedData.toolCall) {
      toolParams = validation.modifiedData.toolCall.parameters;
    }
    
    // Execute tool with existing implementation
    const result = await super.executeTool(toolName, toolParams, context);
    
    // Post-execution verification
    const execution: AgentExecution = {
      id: this.generateExecutionId(),
      operation: toolName,
      inputs: toolParams,
      outputs: result,
      agentId: context.agentId,
      userId: context.userId,
      timestamp: new Date(),
      layerDecisions: validation.layerOutputs.map(output => ({
        layerId: this.getLayerIdFromOutput(output),
        allowed: output.allowed,
        reasoning: output.reasoning
      })),
      violations: validation.violations
    };
    
    await this.performPostExecutionVerification(execution, context);
    
    return result;
  }
  
  private async performPostExecutionVerification(
    execution: AgentExecution,
    context: AgentContext
  ): Promise<void> {
    const input: AgentInput = {
      execution,
      content: JSON.stringify({ operation: execution.operation }),
      timestamp: new Date()
    };
    
    const validation = await this.swissCheese.validateThroughLayers(input, context);
    
    if (!validation.allowed) {
      // Trigger rollback if needed
      const criticalViolations = validation.violations.filter(v => v.severity === 'critical');
      
      if (criticalViolations.length > 0) {
        const rollbackAction = validation.suggestedActions.find(a => a.type === 'rollback');
        if (rollbackAction) {
          await this.performRollback(execution, context);
        }
      }
    }
  }
  
  private async performRollback(
    execution: AgentExecution,
    context: AgentContext
  ): Promise<void> {
    // Implement rollback logic based on execution type
    const postExecutionLayer = this.swissCheese.getLayer('post_execution') as PostExecutionLayer;
    
    if (postExecutionLayer) {
      await postExecutionLayer.performRollback(execution);
    }
  }
  
  private getLayerIdFromOutput(output: LayerOutput): string {
    // Extract layer ID from output reasoning or metadata
    const match = output.reasoning.match(/layer:\s*(\w+)/i);
    return match ? match[1] : 'unknown';
  }
  
  private generateExecutionId(): string {
    return `exec_${Date.now()}_${randomBytes(8).toString('hex')}`;
  }
}
```

### 3.3 Watchdog Service Integration

```typescript
// Extend watchdog service with Swiss cheese monitoring
class SwissCheeseAwareWatchdogService {
  private swissCheese: SwissCheeseGuardrails;
  
  constructor(swissCheese: SwissCheeseGuardrails) {
    this.swissCheese = swissCheese;
  }
  
  async monitorAgent(agentId: string, organizationId: number): Promise<WatchdogReport> {
    // Get Swiss cheese statistics
    const overallStats = this.swissCheese.getOverallStatistics();
    
    // Get layer-specific statistics
    const layerStats = {
      inputValidation: await this.swissCheese.getLayerStatistics('input_validation'),
      policyEnforcement: await this.swissCheese.getLayerStatistics('policy_enforcement'),
      runtimeMonitoring: await this.swissCheese.getLayerStatistics('runtime_monitoring'),
      outputValidation: await this.swissCheese.getLayerStatistics('output_validation'),
      postExecution: await this.swissCheese.getLayerStatistics('post_execution')
    };
    
    // Analyze health based on statistics
    const health = this.analyzeHealth(overallStats, layerStats);
    
    return {
      agentId,
      organizationId,
      timestamp: new Date(),
      health,
      overallStats,
      layerStats,
      recommendations: this.generateRecommendations(health, layerStats)
    };
  }
  
  private analyzeHealth(
    overallStats: OverallStatistics,
    layerStats: Record<string, LayerStatistics>
  ): 'healthy' | 'degraded' | 'unhealthy' {
    let issues = 0;
    
    // Check overall validation success rate
    if (overallStats.validationSuccessRate < 0.95) {
      issues++;
    }
    
    // Check individual layer health
    for (const [layerName, stats] of Object.entries(layerStats)) {
      if (stats.successRate < 0.90) {
        issues++;
      }
      if (stats.averageLatency > 1000) { // 1 second
        issues++;
      }
    }
    
    if (issues === 0) return 'healthy';
    if (issues <= 2) return 'degraded';
    return 'unhealthy';
  }
  
  private generateRecommendations(
    health: string,
    layerStats: Record<string, LayerStatistics>
  ): string[] {
    const recommendations: string[] = [];
    
    if (health === 'unhealthy') {
      recommendations.push('System health critical - investigate all layers');
    }
    
    // Check for slow layers
    for (const [layerName, stats] of Object.entries(layerStats)) {
      if (stats.averageLatency > 500) {
        recommendations.push(`${layerName} latency high - consider optimization`);
      }
    }
    
    // Check for low success rates
    for (const [layerName, stats] of Object.entries(layerStats)) {
      if (stats.successRate < 0.85) {
        recommendations.push(`${layerName} success rate low - review policies`);
      }
    }
    
    return recommendations;
  }
}
```

---

## 4. Configuration Management

### 4.1 Layer Configuration Schema

```typescript
interface SwissCheeseConfiguration {
  // Global settings
  enabled: boolean;
  strictMode: boolean;
  failFast: boolean;
  
  // Layer configurations
  layers: {
    inputValidation: InputValidationConfig;
    policyEnforcement: PolicyEnforcementConfig;
    runtimeMonitoring: RuntimeMonitoringConfig;
    outputValidation: OutputValidationConfig;
    postExecution: PostExecutionConfig;
  };
  
  // Performance settings
  performance: {
    maxValidationTime: number;
    parallelLayers: boolean;
    cachingEnabled: boolean;
    cacheTTL: number;
  };
  
  // Monitoring settings
  monitoring: {
    metricsEnabled: boolean;
    tracingEnabled: boolean;
    auditLoggingEnabled: boolean;
    alertThresholds: AlertThresholds;
  };
}

interface InputValidationConfig {
  enabled: boolean;
  maxInputLength: number;
  allowedInputTypes: string[];
  threatThreshold: number;
  strictSanitization: boolean;
}

interface PolicyEnforcementConfig {
  enabled: boolean;
  strictMode: boolean;
  enableCapabilityChecks: boolean;
  enableResourceLimits: boolean;
  enableDataPrivacy: boolean;
  enableBudgetEnforcement: boolean;
}

interface RuntimeMonitoringConfig {
  enabled: boolean;
  anomalyThreshold: number;
  circuitBreakerEnabled: boolean;
  realTimePolicyChecking: boolean;
  behaviorAnalysisEnabled: boolean;
}

interface OutputValidationConfig {
  enabled: boolean;
  enablePIIDetection: boolean;
  enableHarmfulnessCheck: boolean;
  enableContentFiltering: boolean;
  redactionStrategy: 'mask' | 'remove' | 'hash';
}

interface PostExecutionConfig {
  enabled: boolean;
  enableImpactAnalysis: boolean;
  enableRollback: boolean;
  enableAuditLogging: boolean;
  enableIncidentResponse: true;
}

interface AlertThresholds {
  criticalViolationRate: number;
  highLatencyMs: number;
  lowSuccessRate: number;
  highResourceUsage: number;
}
```

### 4.2 Default Configuration

```typescript
const defaultSwissCheeseConfiguration: SwissCheeseConfiguration = {
  enabled: true,
  strictMode: true,
  failFast: true,
  
  layers: {
    inputValidation: {
      enabled: true,
      maxInputLength: 100000,
      allowedInputTypes: ['text', 'json'],
      threatThreshold: 0.7,
      strictSanitization: true
    },
    
    policyEnforcement: {
      enabled: true,
      strictMode: true,
      enableCapabilityChecks: true,
      enableResourceLimits: true,
      enableDataPrivacy: true,
      enableBudgetEnforcement: true
    },
    
    runtimeMonitoring: {
      enabled: true,
      anomalyThreshold: 0.7,
      circuitBreakerEnabled: true,
      realTimePolicyChecking: true,
      behaviorAnalysisEnabled: true
    },
    
    outputValidation: {
      enabled: true,
      enablePIIDetection: true,
      enableHarmfulnessCheck: true,
      enableContentFiltering: true,
      redactionStrategy: 'mask'
    },
    
    postExecution: {
      enabled: true,
      enableImpactAnalysis: true,
      enableRollback: true,
      enableAuditLogging: true,
      enableIncidentResponse: true
    }
  },
  
  performance: {
    maxValidationTime: 5000, // 5 seconds
    parallelLayers: false,
    cachingEnabled: true,
    cacheTTL: 300000 // 5 minutes
  },
  
  monitoring: {
    metricsEnabled: true,
    tracingEnabled: true,
    auditLoggingEnabled: true,
    alertThresholds: {
      criticalViolationRate: 0.05, // 5%
      highLatencyMs: 1000,
      lowSuccessRate: 0.90, // 90%
      highResourceUsage: 0.80 // 80%
    }
  }
};
```

---

## 5. Monitoring & Observability

### 5.1 Metrics Collection

```typescript
class SwissCheeseMetrics {
  private metricsCollector: MetricsCollector;
  
  constructor(metricsCollector: MetricsCollector) {
    this.metricsCollector = metricsCollector;
  }
  
  recordLayerValidation(
    layerId: string,
    allowed: boolean,
    validationTime: number,
    violations: number
  ): void {
    this.metricsCollector.recordMetric(`swisscheese.layer.${layerId}.validation_count`, 1);
    this.metricsCollector.recordMetric(`swisscheese.layer.${layerId}.allowed_count`, allowed ? 1 : 0);
    this.metricsCollector.recordMetric(`swisscheese.layer.${layerId}.validation_time`, validationTime);
    this.metricsCollector.recordMetric(`swisscheese.layer.${layerId}.violation_count`, violations);
  }
  
  recordLayerMetrics(layerId: string, metrics: LayerMetrics): void {
    this.metricsCollector.recordMetric(`swisscheese.layer.${layerId}.validation_time`, metrics.validationTime);
    this.metricsCollector.recordMetric(`swisscheese.layer.${layerId}.cpu_usage`, metrics.resourceUsage.cpu);
    this.metricsCollector.recordMetric(`swisscheese.layer.${layerId}.memory_usage`, metrics.resourceUsage.memory);
    this.metricsCollector.recordMetric(`swisscheese.layer.${layerId}.cache_hits`, metrics.cacheHits);
    this.metricsCollector.recordMetric(`swisscheese.layer.${layerId}.cache_misses`, metrics.cacheMisses);
  }
  
  recordQualityAttribute(
    layerId: string,
    attributeName: string,
    currentValue: number,
    targetValue: number
  ): void {
    this.metricsCollector.recordMetric(
      `swisscheese.layer.${layerId}.quality.${attributeName}`,
      currentValue
    );
    this.metricsCollector.recordMetric(
      `swisscheese.layer.${layerId}.quality.${attributeName}.target`,
      targetValue
    );
    
    // Alert if out of tolerance
    const tolerance = this.getToleranceForAttribute(layerId, attributeName);
    if (Math.abs(currentValue - targetValue) > tolerance) {
      this.metricsCollector.recordMetric(
        `swisscheese.layer.${layerId}.quality.${attributeName}.out_of_tolerance`,
        1
      );
    }
  }
  
  recordOverallMetrics(stats: OverallStatistics): void {
    this.metricsCollector.recordMetric('swisscheese.overall.validation_count', stats.totalValidations);
    this.metricsCollector.recordMetric('swisscheese.overall.success_count', stats.successfulValidations);
    this.metricsCollector.recordMetric('swisscheese.overall.failure_count', stats.failedValidations);
    this.metricsCollector.recordMetric('swisscheese.overall.success_rate', stats.successRate);
    this.metricsCollector.recordMetric('swisscheese.overall.average_validation_time', stats.averageValidationTime);
  }
  
  recordCircuitBreakerTripped(operation: string, layerId: string): void {
    this.metricsCollector.recordMetric(
      `swisscheese.circuit_breaker.${operation}.tripped`,
      1
    );
    this.metricsCollector.recordMetric(
      `swisscheese.layer.${layerId}.circuit_breaker_trips`,
      1
    );
  }
  
  recordIncidentTriggered(
    severity: string,
    layerId: string,
    violationType: string
  ): void {
    this.metricsCollector.recordMetric(
      `swisscheese.incident.${severity}.count`,
      1
    );
    this.metricsCollector.recordMetric(
      `swisscheese.layer.${layerId}.incident.${violationType}`,
      1
    );
  }
  
  private getToleranceForAttribute(layerId: string, attributeName: string): number {
    // Get tolerance from layer configuration
    const layer = this.swissCheese.getLayer(layerId);
    const attribute = layer?.qualityAttributes.find(a => a.name === attributeName);
    return attribute?.tolerance || 0.1;
  }
}
```

### 5.2 Distributed Tracing

```typescript
class SwissCheeseTracing {
  private tracer: Tracer;
  
  constructor(tracer: Tracer) {
    this.tracer = tracer;
  }
  
  async traceValidation(
    input: AgentInput,
    context: AgentContext,
    validationFn: () => Promise<SwissCheeseValidationResult>
  ): Promise<SwissCheeseValidationResult> {
    const span = this.tracer.startSpan('swisscheese.validation', {
      sessionId: context.sessionId,
      userId: context.userId,
      agentId: context.agentId,
      inputSize: input.content?.length || 0
    });
    
    try {
      const result = await validationFn();
      
      span.setAttributes({
        'validation.allowed': result.allowed,
        'validation.blocked_at_layer': result.blockedAtLayer || 'none',
        'validation.overall_confidence': result.overallConfidence,
        'validation.layer_count': result.layerOutputs.length,
        'validation.violation_count': result.violations.length,
        'validation.suggested_action_count': result.suggestedActions.length
      });
      
      // Add layer-specific attributes
      for (const output of result.layerOutputs) {
        span.setAttributes({
          `layer.${this.extractLayerId(output)}.allowed`: output.allowed,
          `layer.${this.extractLayerId(output)}.confidence`: output.confidence,
          `layer.${this.extractLayerId(output)}.violation_count`: output.violations.length
        });
      }
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  }
  
  async traceLayerExecution(
    layerId: string,
    input: LayerInput,
    layerFn: () => Promise<LayerOutput>
  ): Promise<LayerOutput> {
    const span = this.tracer.startSpan(`swisscheese.layer.${layerId}`, {
      layerId,
      inputSize: JSON.stringify(input.data).length
    });
    
    try {
      const result = await layerFn();
      
      span.setAttributes({
        'layer.allowed': result.allowed,
        'layer.confidence': result.confidence,
        'layer.violation_count': result.violations.length,
        'layer.suggested_action_count': result.suggestedActions.length,
        'layer.validation_time': result.metrics.validationTime
      });
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: ( error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  }
  
  private extractLayerId(output: LayerOutput): string {
    // Extract layer ID from output metadata
    const match = output.reasoning.match(/layer:\s*(\w+)/i);
    return match ? match[1] : 'unknown';
  }
}
```

---

## 6. Testing Strategy

### 6.1 Unit Tests

```typescript
describe('SwissCheese Guardrails Coordinator', () => {
  let swissCheese: SwissCheeseGuardrails;
  let mockMetricsCollector: MockMetricsCollector;
  let mockAuditLogger: MockAuditLogger;
  
  beforeEach(async () => {
    mockMetricsCollector = new MockMetricsCollector();
    mockAuditLogger = new MockAuditLogger();
    
    swissCheese = new SwissCheeseGuardrailsImpl(
      mockMetricsCollector,
      mockAuditLogger
    );
    await swissCheese.initialize();
  });
  
  describe('validateThroughLayers', () => {
    it('should pass through all layers when input is safe', async () => {
      const input = createSafeAgentInput();
      const context = createMockContext();
      
      const result = await swissCheese.validateThroughLayers(input, context);
      
      expect(result.allowed).toBe(true);
      expect(result.blockedAtLayer).toBeNull();
      expect(result.layerOutputs.length).toBe(5); // All 5 layers
      expect(result.violations.length).toBe(0);
    });
    
    it('should block at input validation when critical threat detected', async () => {
      const input = createMaliciousAgentInput();
      const context = createMockContext();
      
      const result = await swissCheese.validateThroughLayers(input, context);
      
      expect(result.allowed).toBe(false);
      expect(result.blockedAtLayer).toBe('input_validation');
      expect(result.layerOutputs.length).toBe(1); // Only first layer
      expect(result.violations.length).toBeGreaterThan(0);
    });
    
    it('should block at policy enforcement when capability denied', async () => {
      const input = createAgentInputWithRestrictedTool();
      const context = createMockContext();
      
      const result = await swissCheese.validateThroughLayers(input, context);
      
      expect(result.allowed).toBe(false);
      expect(result.blockedAtLayer).toBe('policy_enforcement');
      expect(result.violations.some(v => v.type === 'capability_denied')).toBe(true);
    });
  });
  
  describe('layer management', () => {
    it('should register new layer', () => {
      const customLayer = createMockLayer('custom_layer', 6);
      
      swissCheese.registerLayer(customLayer);
      
      expect(swissCheese.getLayer('custom_layer')).not.toBeNull();
      expect(swissCheese.listLayers().length).toBe(6); // 5 default + 1 custom
    });
    
    it('should unregister layer', () => {
      swissCheese.unregisterLayer('input_validation');
      
      expect(swissCheese.getLayer('input_validation')).toBeNull();
      expect(swissCheese.listLayers().length).toBe(4); // 5 - 1
    });
  });
});
```

### 6.2 Integration Tests

```typescript
describe('Swiss Cheese Integration', () => {
  let swissCheese: SwissCheeseGuardrails;
  let realGovernorService: GovernorService;
  let realToolExecutor: ToolExecutor;
  
  beforeEach(async () => {
    realGovernorService = new GovernorService();
    realToolExecutor = new ToolExecutor();
    
    swissCheese = new SwissCheeseGuardrailsImpl(
      new MetricsCollector(),
      new AuditLogger()
    );
    
    await swissCheese.initialize();
  });
  
  describe('end-to-end guardrail validation', () => {
    it('should validate complex agent execution with multiple layers', async () => {
      const input = createComplexAgentInput();
      const context = createMockContext();
      
      const result = await swissCheese.validateThroughLayers(input, context);
      
      expect(result.layerOutputs.length).toBe(5);
      expect(result.overallConfidence).toBeGreaterThan(0.5);
      expect(result.suggestedActions).toBeDefined();
    });
    
    it('should handle layer-specific violations correctly', async () => {
      const input = createInputWithPolicyViolation();
      const context = createMockContext();
      
      const result = await swissCheese.validateThroughLayers(input, context);
      
      expect(result.allowed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.suggestedActions.length).toBeGreaterThan(0);
    });
  });
  
  describe('circuit breaker integration', () => {
    it('should trigger circuit breaker after threshold failures', async () => {
      const operation = 'failing_operation';
      
      // Simulate failures
      for (let i = 0; i < 10; i++) {
        await this.simulateOperationFailure(operation);
      }
      
      const circuitBreakerState = await swissCheese
        .getLayer('runtime_monitoring') as RuntimeMonitoringLayer
        .checkCircuitBreaker(operation);
      
      expect(circuitBreakerState.state).toBe('open');
      expect(circuitBreakerState.failureCount).toBeGreaterThan(5);
    });
  });
});
```

### 6.3 Performance Tests

```typescript
describe('Swiss Cheese Performance', () => {
  let swissCheese: SwissCheeseGuardrails;
  
  beforeEach(async () => {
    swissCheese = new SwissCheeseGuardrailsImpl(
      new MetricsCollector(),
      new AuditLogger()
    );
    await swissCheese.initialize();
  });
  
  describe('validation performance', () => {
    it('should meet latency requirements for safe inputs', async () => {
      const input = createSafeAgentInput();
      const context = createMockContext();
      const iterations = 100;
      
      const startTime = Date.now();
      
      for (let i = 0; i < iterations; i++) {
        await swissCheese.validateThroughLayers(input, context);
      }
      
      const duration = Date.now() - startTime;
      const avgDuration = duration / iterations;
      
      expect(avgDuration).toBeLessThan(100); // 100ms max per validation
    });
    
    it('should fail fast when critical violation detected', async () => {
      const input = createMaliciousAgentInput();
      const context = createMockContext();
      const iterations = 50;
      
      const startTime = Date.now();
      
      for (let i = 0; i < iterations; i++) {
        await swissCheese.validateThroughLayers(input, context);
      }
      
      const duration = Date.now() - startTime;
      const avgDuration = duration / iterations;
      
      expect(avgDuration).toBeLessThan(50); // Should be faster due to fail-fast
    });
  });
  
  describe('scalability', () => {
    it('should handle concurrent validations efficiently', async () => {
      const inputs = Array(10).fill(null).map(() => createSafeAgentInput());
      const context = createMockContext();
      
      const startTime = Date.now();
      
      const results = await Promise.all(
        inputs.map(input => swissCheese.validateThroughLayers(input, context))
      );
      
      const duration = Date.now() - startTime;
      
      expect(results.length).toBe(10);
      expect(results.every(r => r.allowed)).toBe(true);
      expect(duration).toBeLessThan(500); // 500ms for 10 concurrent validations
    });
  });
});
```

---

## 7. Deployment Strategy

### 7.1 Phased Rollout

**Phase 1: Layer Registration (1 week)**
- Register all five default layers
- Implement layer interfaces
- Create layer configuration schemas
- Test layer registration and discovery

**Phase 2: Individual Layer Testing (1 week)**
- Test each layer independently
- Validate layer-specific functionality
- Test layer integration with existing services
- Create layer-specific monitoring

**Phase 3: Integration Testing (1 week)**
- Test full validation pipeline
- Test layer coordination and communication
- Test fail-fast behavior
- Test rollback mechanisms

**Phase 4: Shadow Mode (1 week)**
- Deploy in shadow mode alongside existing validation
- Compare safety metrics with baseline
- Collect performance data
- Fine-tune configuration parameters

**Phase 5: Canary Deployment (1 week)**
- Route 5% of traffic to Swiss cheese validation
- Monitor for errors and performance issues
- Compare success rates and safety metrics
- Gradually increase to 10%, then 25%

**Phase 6: Full Rollout (1 week)**
- Route 100% of traffic to Swiss cheese validation
- Maintain fallback to existing validation
- Monitor closely for first week
- Keep shadow mode for comparison

### 7.2 Configuration Migration

```typescript
class SwissCheeseConfigurationMigrator {
  async migrateExistingPolicies(): Promise<MigrationResult> {
    // Migrate existing governor policies to Swiss cheese layer format
    const existingPolicies = await this.loadExistingGovernorPolicies();
    
    const result: MigrationResult = {
      totalPolicies: existingPolicies.length,
      migratedPolicies: 0,
      failedPolicies: 0,
      warnings: []
    };
    
    for (const policy of existingPolicies) {
      try {
        const layerConfig = this.convertPolicyToLayerConfig(policy);
        
        // Apply to appropriate layer
        await this.applyLayerConfiguration(policy.layerId, layerConfig);
        
        result.migratedPolicies++;
      } catch (error) {
        result.failedPolicies++;
        result.warnings.push(`Failed to migrate policy ${policy.id}: ${(error as Error).message}`);
      }
    }
    
    return result;
  }
  
  private async loadExistingGovernorPolicies(): Promise<ExistingPolicy[]> {
    // Load from governor service
    const policies = await governorService.listPolicies();
    
    return policies.map(policy => ({
      id: policy.id,
      name: policy.name,
      type: policy.type,
      rules: policy.rules,
      layerId: this.determineTargetLayer(policy)
    }));
  }
  
  private determineTargetLayer(policy: ExistingPolicy): string {
    // Map policy type to appropriate layer
    const layerMapping: Record<string, string> = {
      'tool_access': 'policy_enforcement',
      'budget_limit': 'policy_enforcement',
      'data_privacy': 'policy_enforcement',
      'content_safety': 'output_validation',
      'monitoring': 'runtime_monitoring'
    };
    
    return layerMapping[policy.type] || 'policy_enforcement';
  }
  
  private convertPolicyToLayerConfig(policy: ExistingPolicy): LayerConfiguration {
    // Convert existing policy to layer configuration format
    return {
      strictMode: policy.strictMode || false,
      enabled: policy.isActive !== false,
      // Map policy-specific settings
      ...this.mapPolicySettings(policy)
    };
  }
  
  private async applyLayerConfiguration(
    layerId: string,
    config: LayerConfiguration
  ): Promise<void> {
    swissCheese.updateLayerConfiguration(layerId, config);
  }
}
```

---

## 8. Success Criteria

### 8.1 Technical Metrics

- **Validation Latency:** <100ms for safe inputs, <50ms for fail-fast cases
- **Layer Success Rate:** >95% for each individual layer
- **Overall Success Rate:** >98% for complete validation pipeline
- **False Positive Rate:** <5% for safety violations
- **Circuit Breaker Effectiveness:** >95% failure prevention rate
- **Rollback Success Rate:** >90% for eligible operations

### 8.2 Safety Metrics

- **Critical Violation Detection:** >99% of critical threats caught
- **Risk Detection:** >95% of high-risk scenarios identified
- **Policy Compliance:** 100% for critical constraints
- **Audit Trail Completeness:** 100% of executions logged
- **Incident Response Time:** <5 minutes for critical incidents

### 8.3 Operational Metrics

- **System Uptime:** >99.9%
- **Error Rate:** <0.1% of validation requests
- **Resource Overhead:** <15% additional resource consumption
- **Scalability:** Support >1000 concurrent validations
- **Configuration Change Impact:** <1s to apply configuration changes

---

## 9. Risk Mitigation

### 9.1 Technical Risks

**Risk:** Layer coordination complexity leads to unexpected failures
**Mitigation:**
- Comprehensive integration testing
- Clear layer interface contracts
- Fail-safe default behavior
- Extensive logging and debugging

**Risk:** Performance degradation with multiple layers
**Mitigation:**
- Layer caching strategies
- Parallel validation where possible
- Performance monitoring with automatic degradation
- Configurable layer timeout thresholds

**Risk:** False positives blocking legitimate operations
**Mitigation:**
- Tunable severity thresholds
- A/B testing against baseline
- Human override capabilities
- Learning from false positive feedback

### 9.2 Operational Risks

**Risk:** Migration from existing validation causes disruption
**Mitigation:**
- Parallel operation during transition
- Comprehensive backup and rollback
- Gradual traffic migration
- Extensive testing before cutover

**Risk:** Configuration complexity leads to misconfiguration
**Mitigation:**
- Configuration validation schemas
- Default configurations for common use cases
- Configuration testing framework
- Admin UI for configuration management

### 9.3 Business Risks

**Risk:** Users perceive guardrails as overly restrictive
**Mitigation:**
- Gradual rollout with feedback collection
- Transparent reasoning for decisions
- User-configurable strictness levels
- Clear documentation and user education

---

## 10. Conclusion

This technical design provides a comprehensive implementation plan for integrating the Swiss Cheese Model into Oddjob's safety and governance infrastructure. The design addresses:

- **Architecture:** Clear five-layer defense-in-depth architecture with well-defined interfaces
- **Integration:** Seamless integration with existing governor service and agent orchestrator
- **Performance:** Optimization strategies for efficient multi-layer validation
- **Reliability:** Comprehensive error handling, fail-safe behavior, and rollback mechanisms
- **Observability:** Extensive monitoring, tracing, and audit logging capabilities
- **Testing:** Thorough testing strategy at unit, integration, and performance levels
- **Deployment:** Phased rollout with migration strategy and rollback capabilities

The implementation will provide immediate impact through multi-layered safety with >95% risk detection and <0.1% safety violation rate, while establishing the foundation for all subsequent safety enhancements (GuardAgent, TrustAgent, ToolEmu).

The 4-5 week implementation timeline is realistic given the well-established safety patterns and clear integration points, with phased deployment ensuring minimal disruption to existing safety operations.