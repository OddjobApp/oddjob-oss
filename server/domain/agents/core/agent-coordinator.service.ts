/**
 * AgentCoordinatorService
 * 
 * Multi-agent architecture for distributed AI task execution.
 * Coordinates specialized agents: Architect, Coder, Reviewer, Tester.
 */
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger("AgentCoordinatorService");

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  status: "idle" | "working" | "error";
  currentTask?: string;
  capabilities: string[];
  performance: AgentMetrics;
  lastHeartbeat: number;
}

type AgentRole = "architect" | "coder" | "reviewer" | "tester" | "specialist";

interface AgentMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  averageResponseTime: number;
  successRate: number;
}

export interface Task {
  id: string;
  type: TaskType;
  payload: any;
  priority: "low" | "medium" | "high" | "critical";
  status: "pending" | "assigned" | "in_progress" | "completed" | "failed";
  assignedAgent?: string;
  result?: any;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  dependencies?: string[];
}

type TaskType = 
  | "design_architecture"
  | "write_code"
  | "review_code"
  | "run_tests"
  | "fix_bugs"
  | "optimize"
  | "document";

export interface Workflow {
  id: string;
  name: string;
  tasks: Task[];
  status: "pending" | "running" | "completed" | "failed";
  parallel: boolean;
  createdAt: number;
  completedAt?: number;
}

export class AgentCoordinatorService {
  private agents: Map<string, Agent> = new Map();
  private tasks: Map<string, Task> = new Map();
  private workflows: Map<string, Workflow> = new Map();
  private taskQueue: string[] = [];

  constructor() {
    // Start heartbeat checker
    setInterval(() => this.checkAgentHealth(), 30000);
    // Start task processor
    setInterval(() => this.processTaskQueue(), 1000);
  }

  /**
   * Register a new agent
   */
  async registerAgent(
    name: string,
    role: AgentRole,
    capabilities: string[]
  ): Promise<Agent> {
    const id = `agent-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    
    const agent: Agent = {
      id,
      name,
      role,
      status: "idle",
      capabilities,
      performance: {
        tasksCompleted: 0,
        tasksFailed: 0,
        averageResponseTime: 0,
        successRate: 1.0
      },
      lastHeartbeat: Date.now()
    };

    this.agents.set(id, agent);

    logger.info(`[AgentCoordinator] Registered ${role} agent: ${name} (${id})`);

    await eventStream.publish(`agent.registered`, {
      agentId: id,
      name,
      role,
      capabilities,
      timestamp: Date.now()
    });

    return agent;
  }

  /**
   * Create a workflow with multiple tasks
   */
  async createWorkflow(
    name: string,
    taskConfigs: Omit<Task, "id" | "status" | "createdAt">[],
    parallel: boolean = false
  ): Promise<Workflow> {
    const workflowId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    
    const tasks: Task[] = taskConfigs.map((config, index) => ({
      id: `${workflowId}-task-${index}`,
      ...config,
      status: "pending",
      createdAt: Date.now()
    }));

    const workflow: Workflow = {
      id: workflowId,
      name,
      tasks,
      status: "pending",
      parallel,
      createdAt: Date.now()
    };

    this.workflows.set(workflowId, workflow);

    // Add tasks to queue
    for (const task of tasks) {
      this.tasks.set(task.id, task);
      this.taskQueue.push(task.id);
    }

    logger.info(`[AgentCoordinator] Created workflow: ${name} (${workflowId}) with ${tasks.length} tasks`);

    await eventStream.publish(`workflow.created`, {
      workflowId,
      name,
      taskCount: tasks.length,
      parallel,
      timestamp: Date.now()
    });

    // Start workflow
    this.executeWorkflow(workflowId);

    return workflow;
  }

  /**
   * Submit a single task
   */
  async submitTask(
    type: TaskType,
    payload: any,
    priority: Task["priority"] = "medium",
    dependencies?: string[]
  ): Promise<Task> {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    
    const task: Task = {
      id: taskId,
      type,
      payload,
      priority,
      status: "pending",
      createdAt: Date.now(),
      dependencies
    };

    this.tasks.set(taskId, task);
    
    // Add to queue based on priority
    if (priority === "critical") {
      this.taskQueue.unshift(taskId);
    } else if (priority === "high") {
      // Insert after critical tasks
      const firstNonCritical = this.taskQueue.findIndex(
        id => this.tasks.get(id)?.priority !== "critical"
      );
      if (firstNonCritical === -1) {
        this.taskQueue.push(taskId);
      } else {
        this.taskQueue.splice(firstNonCritical, 0, taskId);
      }
    } else {
      this.taskQueue.push(taskId);
    }

    logger.info(`[AgentCoordinator] Submitted task: ${type} (${taskId}) with ${priority} priority`);

    await eventStream.publish(`task.submitted`, {
      taskId,
      type,
      priority,
      timestamp: Date.now()
    });

    return task;
  }

  /**
   * Get best agent for a task based on role and load
   */
  private selectAgentForTask(task: Task): Agent | null {
    const requiredRole = this.getRoleForTaskType(task.type);
    
    // Find available agents with matching role
    const candidates = Array.from(this.agents.values()).filter(
      agent => agent.role === requiredRole && agent.status === "idle"
    );

    if (candidates.length === 0) return null;

    // Select based on performance and load balancing
    return candidates.sort((a, b) => {
      // Prefer agents with higher success rate
      if (a.performance.successRate !== b.performance.successRate) {
        return b.performance.successRate - a.performance.successRate;
      }
      // Then prefer agents with lower response time
      return a.performance.averageResponseTime - b.performance.averageResponseTime;
    })[0];
  }

  private getRoleForTaskType(type: TaskType): AgentRole {
    const roleMap: Record<TaskType, AgentRole> = {
      design_architecture: "architect",
      write_code: "coder",
      review_code: "reviewer",
      run_tests: "tester",
      fix_bugs: "coder",
      optimize: "specialist",
      document: "specialist"
    };
    return roleMap[type];
  }

  /**
   * Process the task queue
   */
  private async processTaskQueue(): Promise<void> {
    // Check for tasks that can be assigned
    for (let i = 0; i < this.taskQueue.length; i++) {
      const taskId = this.taskQueue[i];
      const task = this.tasks.get(taskId);

      if (!task || task.status !== "pending") {
        // Remove completed/failed tasks from queue
        this.taskQueue.splice(i, 1);
        i--;
        continue;
      }

      // Check dependencies
      if (task.dependencies) {
        const allDepsCompleted = task.dependencies.every(depId => {
          const dep = this.tasks.get(depId);
          return dep?.status === "completed";
        });
        if (!allDepsCompleted) continue;
      }

      // Find agent
      const agent = this.selectAgentForTask(task);
      if (!agent) continue; // No available agent, keep in queue

      // Assign task
      task.status = "assigned";
      task.assignedAgent = agent.id;
      agent.status = "working";
      agent.currentTask = task.id;

      // Remove from queue
      this.taskQueue.splice(i, 1);
      i--;

      // Execute task
      this.executeTask(task, agent);
    }
  }

  /**
   * Execute a task with an agent
   */
  private async executeTask(task: Task, agent: Agent): Promise<void> {
    task.status = "in_progress";
    task.startedAt = Date.now();

    logger.info(`[AgentCoordinator] ${agent.name} starting task: ${task.type} (${task.id})`);

    await eventStream.publish(`task.started`, {
      taskId: task.id,
      agentId: agent.id,
      agentName: agent.name,
      type: task.type,
      timestamp: Date.now()
    });

    try {
      // Simulate task execution (in production, this would call actual AI services)
      const result = await this.executeAgentTask(agent, task);
      
      task.status = "completed";
      task.result = result;
      task.completedAt = Date.now();

      // Update agent metrics
      const duration = task.completedAt - (task.startedAt || task.createdAt);
      agent.performance.tasksCompleted++;
      agent.performance.averageResponseTime = 
        (agent.performance.averageResponseTime * (agent.performance.tasksCompleted - 1) + duration) /
        agent.performance.tasksCompleted;
      agent.performance.successRate = 
        agent.performance.tasksCompleted / 
        (agent.performance.tasksCompleted + agent.performance.tasksFailed);

      logger.info(`[AgentCoordinator] ${agent.name} completed task: ${task.type} (${task.id}) in ${duration}ms`);

      await eventStream.publish(`task.completed`, {
        taskId: task.id,
        agentId: agent.id,
        type: task.type,
        duration,
        timestamp: Date.now()
      });

    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      agent.performance.tasksFailed++;
      agent.performance.successRate = 
        agent.performance.tasksCompleted / 
        (agent.performance.tasksCompleted + agent.performance.tasksFailed);

      logger.error(`[AgentCoordinator] ${agent.name} failed task: ${task.type} (${task.id}): ${task.error}`);

      await eventStream.publish(`task.failed`, {
        taskId: task.id,
        agentId: agent.id,
        type: task.type,
        error: task.error,
        timestamp: Date.now()
      });
    } finally {
      agent.status = "idle";
      agent.currentTask = undefined;
    }
  }

  /**
   * Simulate agent task execution
   * In production, this would integrate with actual AI services
   */
  private async executeAgentTask(agent: Agent, task: Task): Promise<any> {
    // Simulate processing time based on task complexity
    const baseTime = 1000;
    const complexityMultiplier = task.priority === "critical" ? 3 : 
                                  task.priority === "high" ? 2 : 1;
    const processingTime = baseTime * complexityMultiplier + Math.random() * 2000;
    
    await new Promise(resolve => setTimeout(resolve, processingTime));

    // Simulate occasional failures (5% rate)
    if (Math.random() < 0.05) {
      throw new Error(`Agent ${agent.name} encountered an error processing ${task.type}`);
    }

    // Return mock result based on task type
    return {
      taskType: task.type,
      processedBy: agent.name,
      processingTime,
      result: `Mock result for ${task.type}`,
      timestamp: Date.now()
    };
  }

  /**
   * Execute a workflow
   */
  private async executeWorkflow(workflowId: string): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return;

    workflow.status = "running";

    logger.info(`[AgentCoordinator] Starting workflow: ${workflow.name} (${workflowId})`);

    await eventStream.publish(`workflow.started`, {
      workflowId,
      name: workflow.name,
      timestamp: Date.now()
    });

    if (workflow.parallel) {
      // Execute all tasks in parallel
      await Promise.all(
        workflow.tasks.map(task => {
          if (task.status === "pending") {
            return this.waitAndExecute(task);
          }
        })
      );
    }
    // Sequential execution happens naturally via task queue

    // Wait for completion
    const checkCompletion = setInterval(async () => {
      const allDone = workflow.tasks.every(
        t => t.status === "completed" || t.status === "failed"
      );
      
      if (allDone) {
        clearInterval(checkCompletion);
        workflow.status = workflow.tasks.some(t => t.status === "failed") ? "failed" : "completed";
        workflow.completedAt = Date.now();

        logger.info(`[AgentCoordinator] Workflow completed: ${workflow.name} (${workflowId}) - ${workflow.status}`);

        await eventStream.publish(`workflow.completed`, {
          workflowId,
          name: workflow.name,
          status: workflow.status,
          timestamp: Date.now()
        });
      }
    }, 1000);
  }

  private async waitAndExecute(task: Task): Promise<void> {
    // Wait for agent assignment and execution
    while (task.status === "pending") {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    // Task is now being handled by processTaskQueue
  }

  /**
   * Check agent health and mark stale agents
   */
  private checkAgentHealth(): void {
    const now = Date.now();
    const staleThreshold = 60000; // 1 minute

    for (const [id, agent] of this.agents) {
      if (now - agent.lastHeartbeat > staleThreshold && agent.status === "idle") {
        logger.warn(`[AgentCoordinator] Agent ${agent.name} (${id}) appears stale`);
        
        eventStream.publish(`agent.stale`, {
          agentId: id,
          name: agent.name,
          lastHeartbeat: agent.lastHeartbeat,
          timestamp: now
        });
      }
    }
  }

  /**
   * Update agent heartbeat
   */
  async heartbeat(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastHeartbeat = Date.now();
    }
  }

  /**
   * Get system status
   */
  getStatus(): {
    agents: Agent[];
    pendingTasks: number;
    activeWorkflows: number;
    queueLength: number;
  } {
    return {
      agents: Array.from(this.agents.values()),
      pendingTasks: this.taskQueue.length,
      activeWorkflows: Array.from(this.workflows.values()).filter(w => w.status === "running").length,
      queueLength: this.taskQueue.length
    };
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get workflow by ID
   */
  getWorkflow(workflowId: string): Workflow | undefined {
    return this.workflows.get(workflowId);
  }
}

// Export singleton
export const agentCoordinator = new AgentCoordinatorService();
