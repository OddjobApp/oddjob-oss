/**
 * App Forge / App Studio Integration
 * 
 * Tracks component usage and code patterns from forged apps
 * to improve the AI code generation over time.
 */

import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { adaptiveLearningService } from "@domain/learning/core/adaptive-learning.service.js";
import { 
  componentUsageRecords,
  failureIncidents,
  orgPreferenceEvents,
} from "@shared/schema/learning/index.js";
import { eq, and } from "drizzle-orm";

const logger = createLogger("AppForgeTracker");

/**
 * Parses a forged app's code to identify components used.
 */
export async function analyzeAppComponents(
  appId: number,
  organizationId: number,
  files: Array<{ path: string; content: string }>
): Promise<void> {
  try {
    const componentUsages: Map<string, {
      component: string;
      category: string;
      props: Set<string>;
      usedWith: Set<string>;
    }> = new Map();
    
    // Parse each file for component imports and usage
    for (const file of files) {
      if (!file.path.endsWith('.tsx') && !file.path.endsWith('.jsx')) continue;
      
      const analysis = parseComponentUsage(file.content);
      
      for (const [component, data] of analysis.entries()) {
        const key = `${file.path}:${component}`;
        if (componentUsages.has(key)) {
          const existing = componentUsages.get(key)!;
          data.props.forEach(p => existing.props.add(p));
          data.usedWith.forEach(w => existing.usedWith.add(w));
        } else {
          componentUsages.set(key, data);
        }
      }
    }
    
    // Record component usage
    for (const [key, data] of componentUsages) {
      await adaptiveLearningService.trackComponentUsage({
        organizationId,
        appId,
        componentName: data.component,
        componentCategory: data.category,
        usedInFile: key.split(':')[0],
        propsUsed: Array.from(data.props),
        usedWithComponents: Array.from(data.usedWith).filter(c => c !== data.component),
        deploymentSuccess: true, // Assume success initially, update after runtime
      } as any);
    }
    
    logger.info(`[ForgeTracker] Analyzed ${componentUsages.size} component usages in app ${appId}`);
  } catch (err: any) {
    logger.error("[ForgeTracker] Failed to analyze app components:", err.message);
  }
}

/**
 * Records a successful app deployment for component effectiveness tracking.
 */
export async function recordDeploymentSuccess(
  appId: number,
  organizationId: number,
  deploymentMetrics: {
    buildTimeMs: number;
    bundleSizeKb: number;
    errors: number;
    warnings: number;
  }
): Promise<void> {
  try {
    // Update all component usage records for this app
    await db.update(componentUsageRecords)
      .set({
        deploymentSuccess: true,
        runtimeErrors: deploymentMetrics.errors,
        updatedAt: new Date(),
      })
      .where(and(
        eq(componentUsageRecords.appId, appId),
        eq(componentUsageRecords.organizationId, organizationId)
      ));
    
    // If deployment had errors, record them as failures
    if (deploymentMetrics.errors > 0) {
      await adaptiveLearningService.recordFailure({
        organizationId,
        domain: "deployment",
        severity: deploymentMetrics.errors > 5 ? "high" : "medium",
        appId,
        errorMessage: `Deployment had ${deploymentMetrics.errors} errors`,
      } as any);
    }
    
    logger.info(`[ForgeTracker] Recorded deployment success for app ${appId}`);
  } catch (err: any) {
    logger.error("[ForgeTracker] Failed to record deployment success:", err.message);
  }
}

/**
 * Records runtime errors from a forged app.
 */
export async function recordRuntimeError(
  appId: number,
  organizationId: number,
  error: {
    message: string;
    stack?: string;
    componentName?: string;
    filePath?: string;
  }
): Promise<void> {
  try {
    // Determine domain from error
    let domain = "runtime-error";
    if (error.message.includes("fetch") || error.message.includes("API")) {
      domain = "api-integration";
    } else if (error.message.includes("undefined") || error.message.includes("null")) {
      domain = "code-generation"; // Likely a code generation issue
    } else if (error.message.includes("CSS") || error.message.includes("style")) {
      domain = "ux-design";
    }
    
    await adaptiveLearningService.recordFailure({
      organizationId,
      domain,
      severity: "medium",
      appId,
      componentName: error.componentName,
      filePath: error.filePath,
      errorMessage: error.message,
      errorStack: error.stack,
    } as any);
    
    // Update component effectiveness
    if (error.componentName) {
      const usage = await db.query.componentUsageRecords.findFirst({
        where: and(
          eq(componentUsageRecords.appId, appId),
          eq(componentUsageRecords.componentName, error.componentName)
        ),
      });
      
      if (usage) {
        await adaptiveLearningService.updateComponentEffectiveness(usage.id, {
          runtimeErrors: (usage.runtimeErrors || 0) + 1,
        });
      }
    }
    
    logger.info(`[ForgeTracker] Recorded runtime error for app ${appId}`);
  } catch (err: any) {
    logger.error("[ForgeTracker] Failed to record runtime error:", err.message);
  }
}

/**
 * Records user feedback on generated code.
 */
export async function recordCodeFeedback(
  appId: number,
  organizationId: number,
  userId: string,
  feedback: {
    rating: number; // 1-5
    comment?: string;
    filePath?: string;
    componentName?: string;
    feedbackType: "accept" | "reject" | "modify";
  }
): Promise<void> {
  try {
    // Record as preference event
    if (feedback.componentName) {
      await adaptiveLearningService.recordPreferenceEvent({
        organizationId,
        appId,
        userId,
        eventType: feedback.feedbackType === "accept" ? "implicit_accept" : "explicit_feedback",
        category: "component",
        subject: feedback.componentName,
        value: feedback.rating >= 4 ? "preferred" : feedback.rating <= 2 ? "avoid" : "neutral",
        confidence: feedback.rating / 5,
        evidenceCount: 1,
      } as any);
    }
    
    // Update component effectiveness
    if (feedback.componentName) {
      const usage = await db.query.componentUsageRecords.findFirst({
        where: and(
          eq(componentUsageRecords.appId, appId),
          eq(componentUsageRecords.componentName, feedback.componentName)
        ),
      });
      
      if (usage) {
        await adaptiveLearningService.updateComponentEffectiveness(usage.id, {
          effectivenessRating: feedback.rating,
        });
      }
    }
    
    // If rejected, record as failure for learning
    if (feedback.feedbackType === "reject" || feedback.rating <= 2) {
      await adaptiveLearningService.recordFailure({
        organizationId,
        domain: "ux-design",
        severity: "low",
        appId,
        componentName: feedback.componentName,
        filePath: feedback.filePath,
        errorMessage: feedback.comment || "User rejected generated code",
      } as any);
    }
    
    logger.info(`[ForgeTracker] Recorded feedback for app ${appId}`);
  } catch (err: any) {
    logger.error("[ForgeTracker] Failed to record feedback:", err.message);
  }
}

/**
 * Analyzes successful code patterns from a completed mission.
 */
export async function extractSuccessPatterns(
  missionId: number,
  organizationId: number,
  appId: number,
  files: Array<{ path: string; content: string }>
): Promise<void> {
  try {
    // Identify patterns that led to success
    const patterns = identifyPatterns(files);
    
    for (const pattern of patterns) {
      await adaptiveLearningService.recordPreferenceEvent({
        organizationId,
        missionId,
        appId,
        eventType: "pattern_detected",
        category: "pattern",
        subject: pattern.name,
        value: "successful",
        confidence: pattern.confidence,
        evidenceCount: pattern.occurrences,
      } as any);
    }
    
    logger.info(`[ForgeTracker] Extracted ${patterns.length} success patterns for mission ${missionId}`);
  } catch (err: any) {
    logger.error("[ForgeTracker] Failed to extract success patterns:", err.message);
  }
}

// ========================================================================
// INTERNAL HELPERS
// ========================================================================

interface ComponentUsage {
  component: string;
  category: string;
  props: Set<string>;
  usedWith: Set<string>;
}

function parseComponentUsage(content: string): Map<string, ComponentUsage> {
  const usages = new Map<string, ComponentUsage>();
  
  // Import pattern: import { Component } from "@domain-ui/core/ui/components/ui/component"
  const importRegex = /import\s*{([^}]+)}\s*from\s*["']@domain-ui\/core\/ui\/components\/ui\/([^"']+)["']/g;
  let match;
  
  while ((match = importRegex.exec(content)) !== null) {
    const components = match[1].split(',').map(c => c.trim());
    const category = inferCategory(components);
    
    for (const component of components) {
      usages.set(component, {
        component,
        category,
        props: new Set(),
        usedWith: new Set(components.filter(c => c !== component)),
      });
    }
  }
  
  // Also detect JSX usage
  const jsxRegex = /<([A-Z][a-zA-Z0-9]*)/g;
  while ((match = jsxRegex.exec(content)) !== null) {
    const component = match[1];
    if (!usages.has(component)) {
      usages.set(component, {
        component,
        category: inferCategory([component]),
        props: new Set(),
        usedWith: new Set(),
      });
    }
    
    // Extract props (simplified)
    const propsMatch = content.slice(match.index, match.index + 500).match(/\w+={/g);
    if (propsMatch) {
      const usage = usages.get(component)!;
      propsMatch.forEach(p => usage.props.add(p.replace('={', '')));
    }
  }
  
  return usages;
}

function inferCategory(components: string[]): string {
  const layoutComponents = ["Card", "Tabs", "Sheet", "Accordion", "Resizable", "ScrollArea", "Separator", "Sidebar"];
  const dataVizComponents = ["Chart", "Table", "Progress", "Stat", "Calendar", "Carousel"];
  const interactiveComponents = ["Dialog", "Popover", "Command", "Drawer", "Tooltip", "HoverCard", "MenuBar"];
  const inputComponents = ["Button", "Input", "Select", "Checkbox", "Switch", "Slider", "Textarea", "Form"];
  const feedbackComponents = ["Toast", "Alert", "Skeleton", "Badge", "Avatar"];
  const aiComponents = ["CopilotKit", "CopilotSidebar", "CopilotPopup", "FormRenderer", "MarkdownEditor"];
  
  for (const component of components) {
    if (layoutComponents.some(c => component.toLowerCase().includes(c.toLowerCase()))) return "ui-layout";
    if (dataVizComponents.some(c => component.toLowerCase().includes(c.toLowerCase()))) return "ui-data-viz";
    if (interactiveComponents.some(c => component.toLowerCase().includes(c.toLowerCase()))) return "ui-interactive";
    if (inputComponents.some(c => component.toLowerCase().includes(c.toLowerCase()))) return "ui-inputs";
    if (feedbackComponents.some(c => component.toLowerCase().includes(c.toLowerCase()))) return "ui-feedback";
    if (aiComponents.some(c => component.toLowerCase().includes(c.toLowerCase()))) return "ui-ai-workflow";
  }
  
  return "ui-layout"; // Default
}

interface Pattern {
  name: string;
  confidence: number;
  occurrences: number;
}

function identifyPatterns(files: Array<{ path: string; content: string }>): Pattern[] {
  const patterns: Pattern[] = [];
  
  // Pattern 1: Error handling
  const errorHandlingCount = files.filter(f => 
    f.content.includes("try {") && f.content.includes("} catch")
  ).length;
  if (errorHandlingCount > 0) {
    patterns.push({
      name: "try-catch-error-handling",
      confidence: errorHandlingCount / files.length,
      occurrences: errorHandlingCount,
    });
  }
  
  // Pattern 2: Loading states
  const loadingStateCount = files.filter(f => 
    f.content.includes("loading") || f.content.includes("isLoading") || f.content.includes("<Skeleton")
  ).length;
  if (loadingStateCount > 0) {
    patterns.push({
      name: "loading-state-management",
      confidence: loadingStateCount / files.length,
      occurrences: loadingStateCount,
    });
  }
  
  // Pattern 3: TypeScript types
  const typescriptCount = files.filter(f => 
    f.content.includes(":") && (f.content.includes("interface") || f.content.includes("type "))
  ).length;
  if (typescriptCount > 0) {
    patterns.push({
      name: "typescript-type-safety",
      confidence: typescriptCount / files.length,
      occurrences: typescriptCount,
    });
  }
  
  // Pattern 4: Form validation
  const formValidationCount = files.filter(f => 
    f.content.includes("validation") || f.content.includes("schema") || f.content.includes("zod")
  ).length;
  if (formValidationCount > 0) {
    patterns.push({
      name: "form-validation",
      confidence: formValidationCount / files.length,
      occurrences: formValidationCount,
    });
  }
  
  return patterns;
}
