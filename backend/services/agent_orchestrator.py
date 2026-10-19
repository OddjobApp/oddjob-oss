"""
Agent Orchestrator Service
Coordinates multi-agent workflows, task distribution, and collaboration
"""

import asyncio
import uuid
from typing import Dict, List, Any, Optional, Callable, Set
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from enum import Enum

from core.service_base import BaseService, ServiceConfig
from core.agent_communication import (
    communication_bus,
    AgentMessage,
    MessageType,
    MessagePriority,
    create_task_request,
    create_task_response,
    create_status_update
)
from core.agent_registry import agent_registry, AgentProfile, AgentRole
from core.structured_logging import get_structured_logger
from core.error_patterns import ErrorHandler, ErrorContext, error_context

logger = get_structured_logger("agent_orchestrator")


class WorkflowStatus(Enum):
    """Status of a multi-agent workflow."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskStatus(Enum):
    """Status of an individual task within a workflow."""
    PENDING = "pending"
    ASSIGNED = "assigned"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class WorkflowTask:
    """Represents a task within a multi-agent workflow."""
    task_id: str
    description: str
    requirements: Dict[str, Any] = field(default_factory=dict)
    dependencies: List[str] = field(default_factory=list)  # Task IDs this depends on

    # Execution state
    status: TaskStatus = TaskStatus.PENDING
    assigned_agent: Optional[str] = None
    result: Optional[Any] = None
    error: Optional[str] = None

    # Timing
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    assigned_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    # Metadata
    priority: MessagePriority = MessagePriority.NORMAL
    max_retries: int = 3
    retry_count: int = 0
    timeout_seconds: int = 300

    def can_start(self, completed_tasks: Set[str]) -> bool:
        """Check if this task can start based on dependencies."""
        return all(dep in completed_tasks for dep in self.dependencies)

    def is_expired(self) -> bool:
        """Check if task has exceeded timeout."""
        if not self.assigned_at or self.status != TaskStatus.RUNNING:
            return False

        elapsed = (datetime.now(timezone.utc) - self.assigned_at).total_seconds()
        return elapsed > self.timeout_seconds


@dataclass
class AgentWorkflow:
    """Represents a multi-agent workflow."""
    workflow_id: str
    name: str
    description: str
    tasks: Dict[str, WorkflowTask] = field(default_factory=dict)

    # Workflow state
    status: WorkflowStatus = WorkflowStatus.PENDING
    assigned_agents: Dict[str, str] = field(default_factory=dict)  # task_id -> agent_id

    # Progress tracking
    completed_tasks: Set[str] = field(default_factory=set)
    failed_tasks: Set[str] = field(default_factory=set)

    # Timing
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    # Results and metadata
    final_result: Optional[Any] = None
    error_message: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def get_pending_tasks(self) -> List[WorkflowTask]:
        """Get tasks that are ready to be executed."""
        return [
            task for task in self.tasks.values()
            if task.status == TaskStatus.PENDING and task.can_start(self.completed_tasks)
        ]

    def get_running_tasks(self) -> List[WorkflowTask]:
        """Get currently running tasks."""
        return [task for task in self.tasks.values() if task.status == TaskStatus.RUNNING]

    def calculate_progress(self) -> float:
        """Calculate workflow completion percentage."""
        if not self.tasks:
            return 100.0

        completed_count = len(self.completed_tasks)
        total_count = len(self.tasks)
        return (completed_count / total_count) * 100.0

    def is_complete(self) -> bool:
        """Check if workflow is complete."""
        return len(self.completed_tasks) + len(self.failed_tasks) >= len(self.tasks)

    def has_failed(self) -> bool:
        """Check if workflow has failed tasks that can't be retried."""
        return any(
            task.status == TaskStatus.FAILED and task.retry_count >= task.max_retries
            for task in self.tasks.values()
        )


class AgentOrchestrator(BaseService):
    """Service for orchestrating multi-agent workflows and task distribution."""

    def __init__(self, config: ServiceConfig):
        super().__init__(config)
        self.workflows: Dict[str, AgentWorkflow] = {}
        self.pending_responses: Dict[str, asyncio.Future] = {}
        self.logger = get_structured_logger("agent_orchestrator")

    async def initialize(self) -> None:
        """Initialize the orchestrator service."""
        await communication_bus.start()
        await agent_registry.start()

        # Register message handlers
        await communication_bus.register_handler(
            agent_id=self.config.name,
            message_types=[
                MessageType.TASK_RESPONSE,
                MessageType.STATUS_UPDATE,
                MessageType.ERROR_NOTIFICATION
            ],
            handler=self._handle_agent_message
        )

        self.logger.info("Agent orchestrator initialized")

    async def shutdown(self) -> None:
        """Shutdown the orchestrator service."""
        await communication_bus.stop()
        await agent_registry.stop()

        # Cancel all pending responses
        for future in self.pending_responses.values():
            if not future.done():
                future.cancel()

        self.pending_responses.clear()
        self.logger.info("Agent orchestrator shutdown")

    async def _perform_health_check(self) -> None:
        """Perform health check for orchestrator."""
        # Check communication bus
        # Check agent registry connectivity
        # Check Redis connectivity
        pass

    async def create_workflow(
        self,
        name: str,
        description: str,
        tasks: List[Dict[str, Any]],
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Create a new multi-agent workflow.

        Args:
            name: Workflow name
            description: Workflow description
            tasks: List of task definitions
            metadata: Additional workflow metadata

        Returns:
            Workflow ID
        """
        workflow_id = str(uuid.uuid4())

        workflow = AgentWorkflow(
            workflow_id=workflow_id,
            name=name,
            description=description,
            metadata=metadata or {}
        )

        # Create tasks
        for task_data in tasks:
            task = WorkflowTask(
                task_id=task_data["id"],
                description=task_data["description"],
                requirements=task_data.get("requirements", {}),
                dependencies=task_data.get("dependencies", []),
                priority=MessagePriority(task_data.get("priority", 1)),
                max_retries=task_data.get("max_retries", 3),
                timeout_seconds=task_data.get("timeout_seconds", 300)
            )
            workflow.tasks[task.task_id] = task

        self.workflows[workflow_id] = workflow

        self.logger.info(
            f"Created workflow: {workflow_id}",
            extra={
                "workflow_id": workflow_id,
                "name": name,
                "task_count": len(tasks)
            }
        )

        return workflow_id

    async def start_workflow(self, workflow_id: str) -> bool:
        """
        Start executing a workflow.

        Args:
            workflow_id: ID of workflow to start

        Returns:
            True if workflow started successfully
        """
        if workflow_id not in self.workflows:
            self.logger.error(f"Workflow not found: {workflow_id}")
            return False

        workflow = self.workflows[workflow_id]
        if workflow.status != WorkflowStatus.PENDING:
            self.logger.warning(f"Workflow {workflow_id} is not in pending state")
            return False

        workflow.status = WorkflowStatus.RUNNING
        workflow.started_at = datetime.now(timezone.utc)

        # Start executing tasks
        await self._execute_workflow_tasks(workflow)

        self.logger.info(f"Started workflow: {workflow_id}")
        return True

    async def cancel_workflow(self, workflow_id: str) -> bool:
        """
        Cancel a running workflow.

        Args:
            workflow_id: ID of workflow to cancel

        Returns:
            True if workflow cancelled successfully
        """
        if workflow_id not in self.workflows:
            return False

        workflow = self.workflows[workflow_id]
        if workflow.status not in [WorkflowStatus.PENDING, WorkflowStatus.RUNNING]:
            return False

        workflow.status = WorkflowStatus.CANCELLED

        # Cancel running tasks
        for task in workflow.get_running_tasks():
            await self._cancel_task(task)

        self.logger.info(f"Cancelled workflow: {workflow_id}")
        return True

    async def get_workflow_status(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        """Get current status of a workflow."""
        workflow = self.workflows.get(workflow_id)
        if not workflow:
            return None

        return {
            "workflow_id": workflow.workflow_id,
            "name": workflow.name,
            "status": workflow.status.value,
            "progress": workflow.calculate_progress(),
            "completed_tasks": len(workflow.completed_tasks),
            "total_tasks": len(workflow.tasks),
            "running_tasks": len(workflow.get_running_tasks()),
            "failed_tasks": len(workflow.failed_tasks),
            "created_at": workflow.created_at.isoformat(),
            "started_at": workflow.started_at.isoformat() if workflow.started_at else None,
            "completed_at": workflow.completed_at.isoformat() if workflow.completed_at else None,
        }

    async def _execute_workflow_tasks(self, workflow: AgentWorkflow) -> None:
        """Execute tasks in a workflow."""
        while not workflow.is_complete() and workflow.status == WorkflowStatus.RUNNING:
            # Get pending tasks that can start
            pending_tasks = workflow.get_pending_tasks()

            if not pending_tasks:
                # Check if we're waiting for running tasks
                running_tasks = workflow.get_running_tasks()
                if running_tasks:
                    # Wait a bit before checking again
                    await asyncio.sleep(1)
                    continue
                else:
                    # No more tasks to execute
                    break

            # Execute available tasks concurrently
            execution_tasks = [
                self._execute_task(workflow, task)
                for task in pending_tasks[:5]  # Limit concurrent tasks
            ]

            await asyncio.gather(*execution_tasks, return_exceptions=True)

        # Check workflow completion
        await self._check_workflow_completion(workflow)

    async def _execute_task(self, workflow: AgentWorkflow, task: WorkflowTask) -> None:
        """Execute a single task by assigning it to an agent."""
        try:
            # Select best agent for this task
            agent = await agent_registry.select_agent_for_task(
                task_requirements={
                    "required_capabilities": task.requirements.get("required_capabilities", []),
                    "preferred_capabilities": task.requirements.get("preferred_capabilities", []),
                    "max_response_time": task.timeout_seconds,
                    "priority": task.priority.value
                }
            )

            if not agent:
                task.status = TaskStatus.FAILED
                task.error = "No suitable agent found"
                workflow.failed_tasks.add(task.task_id)
                return

            # Assign task to agent
            task.status = TaskStatus.ASSIGNED
            task.assigned_agent = agent.agent_id
            task.assigned_at = datetime.now(timezone.utc)
            workflow.assigned_agents[task.task_id] = agent.agent_id

            # Send task to agent
            message = create_task_request(
                sender_agent_id=self.config.name,
                task_description=task.description,
                task_parameters=task.requirements,
                target_agent_id=agent.agent_id,
                priority=task.priority
            )

            # Store correlation for response handling
            self.pending_responses[message.message_id] = asyncio.Future()

            await communication_bus.send_message(message)

            # Update task status
            task.status = TaskStatus.RUNNING

            self.logger.info(
                f"Assigned task {task.task_id} to agent {agent.agent_id}",
                extra={
                    "workflow_id": workflow.workflow_id,
                    "task_id": task.task_id,
                    "agent_id": agent.agent_id
                }
            )

        except Exception as e:
            task.status = TaskStatus.FAILED
            task.error = str(e)
            workflow.failed_tasks.add(task.task_id)

            self.logger.error(
                f"Failed to execute task {task.task_id}: {e}",
                extra={"workflow_id": workflow.workflow_id, "task_id": task.task_id}
            )

    async def _cancel_task(self, task: WorkflowTask) -> None:
        """Cancel a running task."""
        if task.assigned_agent:
            # Send cancellation message to agent
            message = AgentMessage(
                message_type=MessageType.TASK_REQUEST,
                sender_agent_id=self.config.name,
                target_agent_id=task.assigned_agent,
                payload={"action": "cancel", "task_id": task.task_id}
            )
            await communication_bus.send_message(message)

        task.status = TaskStatus.CANCELLED

    async def _handle_agent_message(self, message: AgentMessage) -> None:
        """Handle messages from agents."""
        if message.message_type == MessageType.TASK_RESPONSE:
            await self._handle_task_response(message)
        elif message.message_type == MessageType.STATUS_UPDATE:
            await self._handle_status_update(message)
        elif message.message_type == MessageType.ERROR_NOTIFICATION:
            await self._handle_error_notification(message)

    async def _handle_task_response(self, message: AgentMessage) -> None:
        """Handle task response from an agent."""
        correlation_id = message.correlation_id
        if not correlation_id:
            return

        # Find the corresponding workflow and task
        workflow = None
        task = None

        for wf in self.workflows.values():
            for t in wf.tasks.values():
                # This is a simplified correlation - in production you'd want better correlation
                if t.assigned_agent == message.sender_agent_id and t.status == TaskStatus.RUNNING:
                    workflow = wf
                    task = t
                    break
            if task:
                break

        if not workflow or not task:
            self.logger.warning(f"Could not correlate task response: {correlation_id}")
            return

        # Update task based on response
        payload = message.payload
        success = payload.get("success", False)

        if success:
            task.status = TaskStatus.COMPLETED
            task.result = payload.get("result")
            task.completed_at = datetime.now(timezone.utc)
            workflow.completed_tasks.add(task.task_id)

            # Update agent performance
            response_time = (task.completed_at - task.assigned_at).total_seconds() if task.assigned_at else 0
            await agent_registry.update_agent_performance(
                task.assigned_agent, True, response_time
            )

            self.logger.info(
                f"Task {task.task_id} completed successfully",
                extra={
                    "workflow_id": workflow.workflow_id,
                    "task_id": task.task_id,
                    "agent_id": task.assigned_agent,
                    "response_time": response_time
                }
            )
        else:
            # Handle task failure
            await self._handle_task_failure(workflow, task, payload.get("error_message"))

    async def _handle_task_failure(
        self,
        workflow: AgentWorkflow,
        task: WorkflowTask,
        error_message: Optional[str]
    ) -> None:
        """Handle task failure with retry logic."""
        task.retry_count += 1
        task.error = error_message or "Task failed"

        if task.retry_count < task.max_retries:
            # Reset task for retry
            task.status = TaskStatus.PENDING
            task.assigned_agent = None
            task.assigned_at = None

            self.logger.warning(
                f"Task {task.task_id} failed, retrying ({task.retry_count}/{task.max_retries})",
                extra={
                    "workflow_id": workflow.workflow_id,
                    "task_id": task.task_id,
                    "error": error_message
                }
            )
        else:
            # Max retries exceeded
            task.status = TaskStatus.FAILED
            workflow.failed_tasks.add(task.task_id)

            # Update agent performance
            if task.assigned_agent:
                await agent_registry.update_agent_performance(
                    task.assigned_agent, False, 0
                )

            self.logger.error(
                f"Task {task.task_id} failed permanently after {task.max_retries} retries",
                extra={
                    "workflow_id": workflow.workflow_id,
                    "task_id": task.task_id,
                    "error": error_message
                }
            )

    async def _handle_status_update(self, message: AgentMessage) -> None:
        """Handle status updates from agents."""
        # Update agent status in registry
        status_str = message.payload.get("status", "unknown")
        try:
            from core.agent_registry import AgentStatus
            status = AgentStatus(status_str)
            await agent_registry.update_agent_status(message.sender_agent_id, status)
        except ValueError:
            self.logger.warning(f"Unknown agent status: {status_str}")

    async def _handle_error_notification(self, message: AgentMessage) -> None:
        """Handle error notifications from agents."""
        error_info = message.payload

        self.logger.error(
            f"Agent error notification: {message.sender_agent_id}",
            extra={
                "agent_id": message.sender_agent_id,
                "error": error_info
            }
        )

        # Update agent health score
        await agent_registry.update_agent_status(
            message.sender_agent_id,
            agent_registry.agents[message.sender_agent_id].status,
            health_score=0.5  # Reduce health score on errors
        )

    async def _check_workflow_completion(self, workflow: AgentWorkflow) -> None:
        """Check if workflow is complete and update status."""
        if workflow.is_complete():
            if workflow.has_failed():
                workflow.status = WorkflowStatus.FAILED
                workflow.error_message = "One or more tasks failed"
            else:
                workflow.status = WorkflowStatus.COMPLETED
                workflow.final_result = self._aggregate_workflow_results(workflow)

            workflow.completed_at = datetime.now(timezone.utc)

            self.logger.info(
                f"Workflow {workflow.workflow_id} completed with status: {workflow.status.value}",
                extra={
                    "workflow_id": workflow.workflow_id,
                    "status": workflow.status.value,
                    "completed_tasks": len(workflow.completed_tasks),
                    "failed_tasks": len(workflow.failed_tasks),
                    "duration": (workflow.completed_at - workflow.started_at).total_seconds() if workflow.started_at else 0
                }
            )

    def _aggregate_workflow_results(self, workflow: AgentWorkflow) -> Any:
        """Aggregate results from all completed tasks."""
        # Simple aggregation - in production this would be more sophisticated
        results = {}
        for task in workflow.tasks.values():
            if task.status == TaskStatus.COMPLETED and task.result:
                results[task.task_id] = task.result

        return results


# Global orchestrator instance
orchestrator_config = ServiceConfig(
    name="agent_orchestrator",
    enabled=True,
    timeout=30,
    max_concurrent_tasks=10
)

agent_orchestrator = AgentOrchestrator(orchestrator_config)