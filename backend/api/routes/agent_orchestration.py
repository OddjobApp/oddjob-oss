"""
Agent Orchestration API Routes
REST endpoints for managing multi-agent workflows and orchestration
"""

from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks
from pydantic import BaseModel, Field
from datetime import datetime, timezone

from services.agent_orchestrator import agent_orchestrator
from core.agent_registry import agent_registry, AgentRole, AgentStatus
from core.api_responses import success_response, error_response, not_found_response
from core.auth_middleware import get_current_user

router = APIRouter()


# Pydantic models for API
class AgentProfileResponse(BaseModel):
    agent_id: str
    name: str
    description: str
    version: str
    roles: List[str]
    capabilities: List[Dict[str, Any]]
    status: str
    health_score: float
    total_tasks_executed: int
    successful_tasks: int
    average_response_time: float
    last_seen: Optional[str]


class WorkflowTaskRequest(BaseModel):
    id: str = Field(..., description="Unique task identifier")
    description: str = Field(..., description="Task description")
    requirements: Dict[str, Any] = Field(default_factory=dict, description="Task requirements")
    dependencies: List[str] = Field(default_factory=list, description="Task dependencies")
    priority: int = Field(default=1, ge=0, le=3, description="Task priority (0-3)")
    max_retries: int = Field(default=3, ge=0, le=10, description="Maximum retry attempts")
    timeout_seconds: int = Field(default=300, ge=30, le=3600, description="Task timeout in seconds")


class WorkflowRequest(BaseModel):
    name: str = Field(..., description="Workflow name")
    description: str = Field(..., description="Workflow description")
    tasks: List[WorkflowTaskRequest] = Field(..., description="List of workflow tasks")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional workflow metadata")


class WorkflowStatusResponse(BaseModel):
    workflow_id: str
    name: str
    status: str
    progress: float
    completed_tasks: int
    total_tasks: int
    running_tasks: int
    failed_tasks: int
    created_at: str
    started_at: Optional[str]
    completed_at: Optional[str]


class AgentStatsResponse(BaseModel):
    total_agents: int
    available_agents: int
    busy_agents: int
    offline_agents: int
    role_distribution: Dict[str, int]
    average_health_score: float


# Routes

@router.get("/agents", response_model=List[AgentProfileResponse])
async def list_agents(
    status: Optional[str] = Query(None, description="Filter by agent status"),
    role: Optional[str] = Query(None, description="Filter by agent role"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """List all registered agents with optional filtering."""
    try:
        status_filter = None
        if status:
            try:
                status_filter = [AgentStatus(status)]
            except ValueError:
                return error_response(f"Invalid status: {status}", 400)

        role_filter = None
        if role:
            try:
                role_filter = [AgentRole(role)]
            except ValueError:
                return error_response(f"Invalid role: {role}", 400)

        agents = await agent_registry.list_agents(
            status_filter=status_filter,
            role_filter=role_filter
        )

        agent_responses = [
            AgentProfileResponse(
                agent_id=agent.agent_id,
                name=agent.name,
                description=agent.description,
                version=agent.version,
                roles=[r.value for r in agent.roles],
                capabilities=[cap.__dict__ if hasattr(cap, '__dict__') else cap for cap in agent.capabilities],
                status=agent.status.value,
                health_score=agent.health_score,
                total_tasks_executed=agent.total_tasks_executed,
                successful_tasks=agent.successful_tasks,
                average_response_time=agent.average_response_time,
                last_seen=agent.last_seen.isoformat() if agent.last_seen else None
            )
            for agent in agents
        ]

        return success_response(data=agent_responses)

    except Exception as e:
        return error_response(f"Failed to list agents: {str(e)}", 500)


@router.get("/agents/stats", response_model=AgentStatsResponse)
async def get_agent_stats(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Get agent registry statistics."""
    try:
        stats = agent_registry.get_agent_stats()
        return success_response(data=AgentStatsResponse(**stats))
    except Exception as e:
        return error_response(f"Failed to get agent stats: {str(e)}", 500)


@router.get("/agents/{agent_id}")
async def get_agent(
    agent_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get details for a specific agent."""
    try:
        agent = await agent_registry.get_agent(agent_id)
        if not agent:
            return not_found_response("Agent", agent_id)

        agent_response = AgentProfileResponse(
            agent_id=agent.agent_id,
            name=agent.name,
            description=agent.description,
            version=agent.version,
            roles=[r.value for r in agent.roles],
            capabilities=[cap.__dict__ if hasattr(cap, '__dict__') else cap for cap in agent.capabilities],
            status=agent.status.value,
            health_score=agent.health_score,
            total_tasks_executed=agent.total_tasks_executed,
            successful_tasks=agent.successful_tasks,
            average_response_time=agent.average_response_time,
            last_seen=agent.last_seen.isoformat() if agent.last_seen else None
        )

        return success_response(data=agent_response)

    except Exception as e:
        return error_response(f"Failed to get agent: {str(e)}", 500)


@router.post("/workflows")
async def create_workflow(
    workflow_request: WorkflowRequest,
    background_tasks: BackgroundTasks,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Create a new multi-agent workflow."""
    try:
        # Convert Pydantic models to dicts for the orchestrator
        tasks_data = [task.dict() for task in workflow_request.tasks]

        workflow_id = await agent_orchestrator.create_workflow(
            name=workflow_request.name,
            description=workflow_request.description,
            tasks=tasks_data,
            metadata={
                **(workflow_request.metadata or {}),
                "created_by": current_user.get("id"),
                "created_at": datetime.now(timezone.utc).isoformat()
            }
        )

        return success_response(
            data={"workflow_id": workflow_id},
            message=f"Workflow '{workflow_request.name}' created successfully"
        )

    except Exception as e:
        return error_response(f"Failed to create workflow: {str(e)}", 500)


@router.post("/workflows/{workflow_id}/start")
async def start_workflow(
    workflow_id: str,
    background_tasks: BackgroundTasks,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Start executing a workflow."""
    try:
        success = await agent_orchestrator.start_workflow(workflow_id)

        if not success:
            return error_response("Failed to start workflow - may not exist or already running", 400)

        return success_response(
            message=f"Workflow {workflow_id} started successfully"
        )

    except Exception as e:
        return error_response(f"Failed to start workflow: {str(e)}", 500)


@router.post("/workflows/{workflow_id}/cancel")
async def cancel_workflow(
    workflow_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Cancel a running workflow."""
    try:
        success = await agent_orchestrator.cancel_workflow(workflow_id)

        if not success:
            return error_response("Failed to cancel workflow - may not exist or not running", 400)

        return success_response(
            message=f"Workflow {workflow_id} cancelled successfully"
        )

    except Exception as e:
        return error_response(f"Failed to cancel workflow: {str(e)}", 500)


@router.get("/workflows/{workflow_id}", response_model=WorkflowStatusResponse)
async def get_workflow_status(
    workflow_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get the current status of a workflow."""
    try:
        status_data = await agent_orchestrator.get_workflow_status(workflow_id)

        if not status_data:
            return not_found_response("Workflow", workflow_id)

        return success_response(data=WorkflowStatusResponse(**status_data))

    except Exception as e:
        return error_response(f"Failed to get workflow status: {str(e)}", 500)


@router.get("/workflows")
async def list_workflows(
    status: Optional[str] = Query(None, description="Filter by workflow status"),
    limit: int = Query(50, ge=1, le=100, description="Maximum number of workflows to return"),
    offset: int = Query(0, ge=0, description="Number of workflows to skip"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """List workflows with optional filtering and pagination."""
    try:
        # For now, return a simple list - in production this would query a database
        workflows = []
        for workflow_id, workflow in agent_orchestrator.workflows.items():
            if status and workflow.status.value != status:
                continue

            workflow_data = await agent_orchestrator.get_workflow_status(workflow_id)
            if workflow_data:
                workflows.append(workflow_data)

        # Apply pagination
        total = len(workflows)
        paginated_workflows = workflows[offset:offset + limit]

        return success_response(
            data={
                "workflows": paginated_workflows,
                "pagination": {
                    "total": total,
                    "limit": limit,
                    "offset": offset,
                    "has_more": offset + limit < total
                }
            }
        )

    except Exception as e:
        return error_response(f"Failed to list workflows: {str(e)}", 500)


@router.post("/workflows/{workflow_id}/tasks/{task_id}/retry")
async def retry_workflow_task(
    workflow_id: str,
    task_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Manually retry a failed task in a workflow."""
    try:
        workflow = agent_orchestrator.workflows.get(workflow_id)
        if not workflow:
            return not_found_response("Workflow", workflow_id)

        task = workflow.tasks.get(task_id)
        if not task:
            return not_found_response("Task", task_id)

        if task.status != agent_orchestrator.TaskStatus.FAILED:
            return error_response("Task is not in failed state", 400)

        # Reset task for retry
        task.status = agent_orchestrator.TaskStatus.PENDING
        task.assigned_agent = None
        task.assigned_at = None
        task.error = None
        task.retry_count = 0  # Reset retry count

        # Remove from failed tasks if present
        workflow.failed_tasks.discard(task.task_id)

        return success_response(
            message=f"Task {task_id} reset for retry"
        )

    except Exception as e:
        return error_response(f"Failed to retry task: {str(e)}", 500)


@router.get("/orchestrator/health")
async def get_orchestrator_health(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Get the health status of the orchestrator service."""
    try:
        health = await agent_orchestrator.health_check()

        return success_response(
            data={
                "service_name": health.service_name,
                "healthy": health.healthy,
                "last_check": health.last_check.isoformat() if health.last_check else None,
                "response_time": health.response_time,
                "error_message": health.error_message,
                "workflows_active": len(agent_orchestrator.workflows),
                "agents_registered": len(agent_registry.agents)
            },
            message="Orchestrator health check completed"
        )

    except Exception as e:
        return error_response(f"Orchestrator health check failed: {str(e)}", 500)