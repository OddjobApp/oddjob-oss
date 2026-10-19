/**
 * Blueprint Execution Service
 * This service handles the integration with the operational blueprint execution system.
 * It triggers missions based on form submissions and tracks their progress with real-time updates.
 */

import { getAuditService, AuditActions } from './audit';
import { getNotificationService, NotificationTypes } from './notifications';
import { hasBlueprintPermission, authenticateUser } from './auth';
import { getPerformanceMonitoringService, PerformanceMetrics, StepMetric } from './performance-monitoring';

export interface BlueprintExecutionRequest {
  blueprintId: string;
  missionId: string;
  formData: Record<string, any>;
  context?: Record<string, any>;
  userId?: string;
  token?: string;
  maxRetries?: number;
  retryDelay?: number;
}

export interface BlueprintExecutionResponse {
  success: boolean;
  executionId: string;
  missionId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message: string;
  error?: string;
}

export interface MissionStep {
  stepId: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: any;
  error?: string;
  duration?: number;
  startedAt?: string;
  completedAt?: string;
  retryCount?: number;
  maxRetries?: number;
}

export interface MissionStatus {
  executionId: string;
  missionId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  steps: MissionStep[];
  startedAt: string;
  completedAt?: string;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Blueprint Execution Service
 * Handles communication with the blueprint execution engine with real-time updates
 */
export class BlueprintExecutionService {
  private baseUrl: string;
  private apiKey: string;
  private pollIntervals: Map<string, NodeJS.Timeout> = new Map();
  private statusCallbacks: Map<string, (status: MissionStatus) => void> = new Map();

  constructor(baseUrl: string = '/api/blueprints', apiKey: string = '') {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  /**
   * Execute a blueprint mission with form data
   */
  async executeMission(request: BlueprintExecutionRequest): Promise<BlueprintExecutionResponse> {
    const auditService = getAuditService();
    const notificationService = getNotificationService();
    const performanceService = getPerformanceMonitoringService();
    
    const startTime = new Date().toISOString();
    let executionId = '';
    
    try {
      // Check permissions if token is provided
      if (request.token) {
        const user = await authenticateUser(request.token);
        if (!user) {
          return {
            success: false,
            executionId: '',
            missionId: request.missionId,
            status: 'failed',
            message: 'Authentication failed',
            error: 'Invalid or expired token',
          };
        }

        // Check blueprint permissions
        if (!hasBlueprintPermission(user, request.blueprintId, request.missionId)) {
          await auditService.createLog({
            user_id: user.user_id,
            action: 'blueprint.permission_denied',
            entity_type: 'blueprint',
            entity_id: request.blueprintId,
            new_values: {
              missionId: request.missionId,
              reason: 'Insufficient permissions',
            },
          });

          return {
            success: false,
            executionId: '',
            missionId: request.missionId,
            status: 'failed',
            message: 'Permission denied',
            error: 'You do not have the required permissions to execute this blueprint',
          };
        }

        // Use authenticated user ID
        request.userId = user.user_id;
      }

      // Log blueprint execution start
      await auditService.createLog({
        user_id: request.userId,
        action: 'blueprint.execution_started',
        entity_type: 'blueprint',
        entity_id: request.blueprintId,
        new_values: {
          missionId: request.missionId,
          formData: request.formData,
          context: request.context,
        },
      });

      // Send notification for workflow start
      if (request.userId) {
        await notificationService.createNotification({
          user_id: request.userId,
          type: NotificationTypes.SYSTEM_UPDATE,
          title: 'Workflow Started',
          message: `Your ${request.missionId} workflow has been initiated`,
          priority: 'normal',
        });
      }

      const response = await fetch(`${this.baseUrl}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : '',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = `Blueprint execution failed: ${response.statusText}`;
        
        // Log execution failure
        await auditService.createLog({
          user_id: request.userId,
          action: 'blueprint.execution_failed',
          entity_type: 'blueprint',
          entity_id: request.blueprintId,
          new_values: {
            missionId: request.missionId,
            error: error,
          },
        });
        
        // Send notification for workflow failure
        if (request.userId) {
          await notificationService.createNotification({
            user_id: request.userId,
            type: NotificationTypes.SYSTEM_ALERT,
            title: 'Workflow Failed',
            message: `Your ${request.missionId} workflow failed to start: ${error}`,
            priority: 'urgent',
          });
        }
        
        throw new Error(error);
      }

      const data = await response.json();
      executionId = data.executionId;
      
      // Initialize performance tracking
      await performanceService.recordMetrics({
        execution_id: executionId,
        blueprint_id: request.blueprintId,
        mission_id: request.missionId,
        user_id: request.userId || 'unknown',
        start_time: startTime,
        status: 'running',
        step_metrics: [],
      });
      
      // Log successful execution start
      await auditService.createLog({
        user_id: request.userId,
        action: 'blueprint.execution_initiated',
        entity_type: 'blueprint_execution',
        entity_id: data.executionId,
        new_values: {
          missionId: request.missionId,
          blueprintId: request.blueprintId,
          status: data.status,
        },
      });
      
      // Start polling for real-time updates if execution was successful
      if (data.success && data.executionId) {
        const maxRetries = request.maxRetries || 3;
        const retryDelay = request.retryDelay || 5000;
        
        this.startPolling(data.executionId, async (status) => {
          // Update step metrics
          const stepMetrics: StepMetric[] = status.steps.map(step => ({
            step_id: step.stepId,
            step_name: step.name,
            start_time: step.startedAt || new Date().toISOString(),
            end_time: step.completedAt,
            duration_ms: step.duration ? step.duration * 60 * 1000 : undefined,
            status: step.status,
            error_message: step.error,
            retry_count: step.retryCount,
          }));
          
          await performanceService.recordMetrics({
            execution_id: data.executionId,
            blueprint_id: request.blueprintId,
            mission_id: request.missionId,
            user_id: request.userId || 'unknown',
            start_time: startTime,
            end_time: status.completedAt,
            duration_ms: status.completedAt ? new Date(status.completedAt).getTime() - new Date(startTime).getTime() : undefined,
            status: status.status,
            step_metrics: stepMetrics,
            error_count: status.steps.filter(s => s.status === 'failed').length,
          });
          
          // Log status changes to audit trail
          await auditService.createLog({
            user_id: request.userId,
            action: 'blueprint.status_changed',
            entity_type: 'blueprint_execution',
            entity_id: data.executionId,
            new_values: {
              status: status.status,
              progress: status.progress,
              steps: status.steps,
            },
          });
          
          // Log completion or failure
          if (status.status === 'completed') {
            await auditService.createLog({
              user_id: request.userId,
              action: 'blueprint.execution_completed',
              entity_type: 'blueprint_execution',
              entity_id: data.executionId,
              new_values: {
                missionId: request.missionId,
                completedAt: status.completedAt,
              },
            });
            
            // Send notification for workflow completion
            if (request.userId) {
              await notificationService.createNotification({
                user_id: request.userId,
                type: NotificationTypes.SYSTEM_UPDATE,
                title: 'Workflow Completed',
                message: `Your ${request.missionId} workflow has completed successfully`,
                priority: 'normal',
              });
            }
          } else if (status.status === 'failed') {
            await auditService.createLog({
              user_id: request.userId,
              action: 'blueprint.execution_failed',
              entity_type: 'blueprint_execution',
              entity_id: data.executionId,
              new_values: {
                missionId: request.missionId,
                error: status.error,
              },
            });
            
            // Send notification for workflow failure
            if (request.userId) {
              await notificationService.createNotification({
                user_id: request.userId,
                type: NotificationTypes.SYSTEM_ALERT,
                title: 'Workflow Failed',
                message: `Your ${request.missionId} workflow has failed: ${status.error || 'Unknown error'}`,
                priority: 'urgent',
              });
            }
            
            // Attempt automatic retry of failed steps
            await this.retryFailedSteps(data.executionId, maxRetries, retryDelay, request.userId);
          }
        });
      }
      
      return data;
    } catch (error) {
      console.error('Blueprint execution error:', error);
      
      // Log execution error
      await auditService.createLog({
        user_id: request.userId,
        action: 'blueprint.execution_error',
        entity_type: 'blueprint',
        entity_id: request.blueprintId,
        new_values: {
          missionId: request.missionId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      
      // Update performance metrics with error
      if (executionId) {
        await performanceService.recordMetrics({
          execution_id: executionId,
          blueprint_id: request.blueprintId,
          mission_id: request.missionId,
          user_id: request.userId || 'unknown',
          start_time: startTime,
          end_time: new Date().toISOString(),
          duration_ms: new Date().getTime() - new Date(startTime).getTime(),
          status: 'failed',
          step_metrics: [],
          error_count: 1,
        });
      }
      
      // Send notification for workflow error
      if (request.userId) {
        await notificationService.createNotification({
          user_id: request.userId,
          type: NotificationTypes.SYSTEM_ALERT,
          title: 'Workflow Error',
          message: `Error in ${request.missionId} workflow: ${error instanceof Error ? error.message : String(error)}`,
          priority: 'urgent',
        });
      }
      
      return {
        success: false,
        executionId: '',
        missionId: request.missionId,
        status: 'failed',
        message: 'Failed to execute blueprint mission',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get the status of a mission execution
   */
  async getMissionStatus(executionId: string): Promise<MissionStatus | null> {
    try {
      const response = await fetch(`${this.baseUrl}/status/${executionId}`, {
        headers: {
          'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : '',
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Mission status check error:', error);
      return null;
    }
  }

  /**
   * Start polling for mission status updates
   */
  startPolling(executionId: string, callback?: (status: MissionStatus) => void, interval: number = 2000): void {
    if (callback) {
      this.statusCallbacks.set(executionId, callback);
    }

    if (this.pollIntervals.has(executionId)) {
      return; // Already polling
    }

    const poll = async () => {
      const status = await this.getMissionStatus(executionId);
      if (status) {
        const callback = this.statusCallbacks.get(executionId);
        if (callback) {
          callback(status);
        }

        // Stop polling if mission is completed or failed
        if (status.status === 'completed' || status.status === 'failed') {
          this.stopPolling(executionId);
        }
      }
    };

    // Initial poll
    poll();
    
    // Set up interval
    const intervalId = setInterval(poll, interval);
    this.pollIntervals.set(executionId, intervalId);
  }

  /**
   * Stop polling for mission status updates
   */
  stopPolling(executionId: string): void {
    const intervalId = this.pollIntervals.get(executionId);
    if (intervalId) {
      clearInterval(intervalId);
      this.pollIntervals.delete(executionId);
    }
    this.statusCallbacks.delete(executionId);
  }

  /**
   * Retry a failed step
   */
  async retryStep(executionId: string, stepId: string, userId?: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/retry/${executionId}/${stepId}`, {
        method: 'POST',
        headers: {
          'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : '',
        },
      });

      if (response.ok) {
        console.log('[Step Retried]', { executionId, stepId });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Step retry error:', error);
      return false;
    }
  }

  /**
   * Retry failed steps automatically
   */
  async retryFailedSteps(executionId: string, maxRetries: number = 3, retryDelay: number = 5000, userId?: string): Promise<void> {
    const status = await this.getMissionStatus(executionId);
    if (!status) return;

    const failedSteps = status.steps.filter(step => step.status === 'failed');
    
    for (const step of failedSteps) {
      const retryCount = step.retryCount || 0;
      if (retryCount < maxRetries) {
        console.log(`Retrying step ${step.stepId} (attempt ${retryCount + 1}/${maxRetries})`);
        
        // Wait for delay
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        
        // Retry the step
        const success = await this.retryStep(executionId, step.stepId, userId);
        
        if (!success) {
          console.error(`Failed to retry step ${step.stepId}`);
        }
      } else {
        console.error(`Max retries reached for step ${step.stepId}`);
      }
    }
  }
  async cancelMission(executionId: string, userId?: string): Promise<boolean> {
    const auditService = getAuditService();
    
    try {
      this.stopPolling(executionId);
      
      const response = await fetch(`${this.baseUrl}/cancel/${executionId}`, {
        method: 'POST',
        headers: {
          'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : '',
        },
      });

      if (response.ok) {
        // Log successful cancellation
        await auditService.createLog({
          user_id: userId,
          action: 'blueprint.execution_cancelled',
          entity_type: 'blueprint_execution',
          entity_id: executionId,
          new_values: {
            cancelledAt: new Date().toISOString(),
          },
        });
      }

      return response.ok;
    } catch (error) {
      console.error('Mission cancellation error:', error);
      
      // Log cancellation error
      await auditService.createLog({
        user_id: userId,
        action: 'blueprint.cancellation_failed',
        entity_type: 'blueprint_execution',
        entity_id: executionId,
        new_values: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      
      return false;
    }
  }

  /**
   * Get available blueprints
   */
  async getAvailableBlueprints(): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/blueprints`, {
        headers: {
          'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : '',
        },
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Get blueprints error:', error);
      return [];
    }
  }

  /**
   * Get recent executions for a user
   */
  async getUserExecutions(userId: string, limit: number = 10): Promise<MissionStatus[]> {
    try {
      const response = await fetch(`${this.baseUrl}/executions/user/${userId}?limit=${limit}`, {
        headers: {
          'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : '',
        },
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Get user executions error:', error);
      return [];
    }
  }

  /**
   * Clean up all polling intervals
   */
  cleanup(): void {
    this.pollIntervals.forEach((intervalId) => {
      clearInterval(intervalId);
    });
    this.pollIntervals.clear();
    this.statusCallbacks.clear();
  }
}

// Blueprint ID mappings based on cycle definitions
export const BLUEPRINT_MAPPINGS = {
  procurement: {
    purchaseRequest: {
      blueprintId: 'procurement-management',
      missionId: 'mission-process-request',
    },
    approval: {
      blueprintId: 'procurement-management',
      missionId: 'mission-approval-review',
    },
  },
  vendor: {
    onboarding: {
      blueprintId: 'vendor-management',
      missionId: 'mission-onboard-vendor',
    },
    review: {
      blueprintId: 'vendor-management',
      missionId: 'mission-performance-review',
    },
  },
};

// Singleton instance
let executionServiceInstance: BlueprintExecutionService | null = null;

export function getBlueprintExecutionService(): BlueprintExecutionService {
  if (!executionServiceInstance) {
    executionServiceInstance = new BlueprintExecutionService(
      process.env.BLUEPRINT_BASE_URL || '/api/blueprints',
      process.env.BLUEPRINT_API_KEY || ''
    );
  }
  return executionServiceInstance;
}

/**
 * Helper function to execute a blueprint mission based on form type
 */
export async function executeBlueprintMission(
  formType: 'procurement-purchase' | 'procurement-approval' | 'vendor-onboarding' | 'vendor-review',
  formData: Record<string, any>
): Promise<BlueprintExecutionResponse> {
  const service = getBlueprintExecutionService();
  
  let mapping;
  switch (formType) {
    case 'procurement-purchase':
      mapping = BLUEPRINT_MAPPINGS.procurement.purchaseRequest;
      break;
    case 'procurement-approval':
      mapping = BLUEPRINT_MAPPINGS.procurement.approval;
      break;
    case 'vendor-onboarding':
      mapping = BLUEPRINT_MAPPINGS.vendor.onboarding;
      break;
    case 'vendor-review':
      mapping = BLUEPRINT_MAPPINGS.vendor.review;
      break;
    default:
      return {
        success: false,
        executionId: '',
        missionId: '',
        status: 'failed',
        message: 'Unknown form type',
      };
  }

  const request: BlueprintExecutionRequest = {
    blueprintId: mapping.blueprintId,
    missionId: mapping.missionId,
    formData,
    context: {
      timestamp: new Date().toISOString(),
      source: 'workbench',
    },
  };

  return service.executeMission(request);
}
