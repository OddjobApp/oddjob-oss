/**
 * Shadow Worker
 * 
 * Worker process for isolated shadow execution.
 * 
 * This runs as a separate Node.js process to provide
 * lightweight isolation for shadow runs.
 * 
 * Usage:
 *   node shadow-worker.js <blueprint_json> <scenario_json> <options_json>
 */

import { HermesProtocolService } from "../../../domain/agents/core/hermes-protocol.service.js";

interface WorkerInput {
  blueprint: any;
  scenario: any;
  options: {
    mockExternalCalls: boolean;
  };
}

interface WorkerOutput {
  success: boolean;
  output?: any;
  error?: string;
  traces?: {
    thoughtDepth: number;
    toolCalls: number;
    toolFailures: number;
    selfReflections: number;
    keyDecisions: string[];
  };
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.error("Usage: node shadow-worker.js <blueprint> <scenario> <options>");
    process.exit(1);
  }
  
  try {
    const input: WorkerInput = {
      blueprint: JSON.parse(args[0]),
      scenario: JSON.parse(args[1]),
      options: JSON.parse(args[2])
    };
    
    const result = await executeShadowRun(input);
    console.log(JSON.stringify(result));
    process.exit(0);
    
  } catch (error) {
    const output: WorkerOutput = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
    console.log(JSON.stringify(output));
    process.exit(1);
  }
}

async function executeShadowRun(input: WorkerInput): Promise<WorkerOutput> {
  const { blueprint, scenario, options } = input;
  
  // Mock fetch if required
  if (options.mockExternalCalls) {
    mockExternalCalls(scenario);
  }
  
  // Simulate execution
  const steps = blueprint.steps || [];
  const results: any = {};
  let success = true;
  let error: string | undefined;
  
  // Track traces
  let totalThinkingSteps = 0;
  let totalToolCalls = 0;
  let totalToolFailures = 0;
  let totalSelfReflections = 0;
  const keyDecisions: string[] = [];
  
  for (const step of steps) {
    try {
      // Simulate step execution
      const stepResult = await simulateStep(step, results, scenario);
      
      results[step.id] = stepResult.output;
      
      // Update trace metrics
      totalThinkingSteps += stepResult.thinkingSteps || 1;
      totalToolCalls += stepResult.toolCalls || 0;
      totalToolFailures += stepResult.toolFailures || 0;
      totalSelfReflections += stepResult.selfReflections || 0;
      
      if (stepResult.decision) {
        keyDecisions.push(stepResult.decision);
      }
      
    } catch (e) {
      success = false;
      error = `Step ${step.id} failed: ${e instanceof Error ? e.message : String(e)}`;
      break;
    }
  }
  
  return {
    success,
    output: results,
    error,
    traces: {
      thoughtDepth: totalThinkingSteps,
      toolCalls: totalToolCalls,
      toolFailures: totalToolFailures,
      selfReflections: totalSelfReflections,
      keyDecisions
    }
  };
}

async function simulateStep(
  step: any,
  previousResults: any,
  scenario: any
): Promise<{
  output: any;
  thinkingSteps: number;
  toolCalls: number;
  toolFailures: number;
  selfReflections: number;
  decision?: string;
}> {
  // Base latency
  await delay(50);
  
  // Simulate different step types
  const stepType = step.type || "agent";
  
  let thinkingSteps = 1;
  let toolCalls = 0;
  let toolFailures = 0;
  let selfReflections = 0;
  
  // Stress factor from scenario
  const stressMultiplier = scenario.stressLevel === "extreme" ? 2 : 
                          scenario.stressLevel === "high" ? 1.5 : 1;
  
  // Simulate tool calls
  if (stepType === "agent" && step.config?.toolCalls) {
    toolCalls = step.config.toolCalls.length;
    
    // Simulate tool failures based on stress
    for (let i = 0; i < toolCalls; i++) {
      if (Math.random() < 0.1 * stressMultiplier) {
        toolFailures++;
      }
    }
    
    if (toolFailures > 0) {
      throw new Error(`${toolFailures} tool calls failed`);
    }
  }
  
  // Simulate self-reflection
  if (stepType === "agent" && Math.random() < 0.2) {
    selfReflections = 1;
    thinkingSteps++;
  }
  
  // Simulate decision steps
  let decision: string | undefined;
  if (stepType === "decision") {
    decision = `Decided: ${step.condition || "continue"}`;
  }
  
  // Simulate failure injection
  if (scenario.failureInjection && Math.random() < 0.5) {
    throw new Error(`Injected failure: ${scenario.failureInjection}`);
  }
  
  return {
    output: { stepCompleted: true, type: stepType },
    thinkingSteps,
    toolCalls,
    toolFailures,
    selfReflections,
    decision
  };
}

function mockExternalCalls(scenario: any) {
  // Store original fetch
  const originalFetch = globalThis.fetch;
  
  // Replace with mock
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = url.toString();
    
    // Simulate latency based on scenario stress
    const baseLatency = 100;
    const stressMultiplier = scenario.stressLevel === "extreme" ? 3 :
                            scenario.stressLevel === "high" ? 2 : 1;
    
    await delay(baseLatency * stressMultiplier);
    
    // Simulate occasional failures
    if (scenario.stressLevel === "extreme" && Math.random() < 0.2) {
      throw new Error("Network error (simulated)");
    }
    
    // Return mock response
    return new Response(JSON.stringify({ 
      mocked: true, 
      url: urlStr,
      timestamp: Date.now()
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  
  // Cleanup after execution
  process.on("exit", () => {
    globalThis.fetch = originalFetch;
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run main
main();
