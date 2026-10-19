from fastapi import APIRouter, HTTPException
from typing import Dict, Any
from core.saas_manager import connector_manager
from .models import JiraCommentRequest, JiraTransitionRequest, JiraUpdateRequest, JiraCreateRequest
from core.structured_logging import get_structured_logger

logger = get_structured_logger("saas_jira_actions_api")
router = APIRouter(prefix="/jira", tags=["jira-actions"])

@router.post("/comment")
async def add_jira_comment(request: JiraCommentRequest):
    """Add a comment to a Jira issue."""
    org_id = request.organization_id or 1
    connector = connector_manager.get_connector(org_id, "jira")
    if not connector:
        # Load state if not loaded
        await connector_manager.load_org_state(org_id)
        connector = connector_manager.get_connector(org_id, "jira")
        
    if not connector:
        raise HTTPException(status_code=404, detail=f"Jira connector not found for org {org_id}")
    
    try:
        # JiraConnector specific method
        if hasattr(connector, 'add_comment'):
            result = await connector.add_comment(request.issue_key, request.comment)
            return {"success": True, "result": result}
        else:
            raise HTTPException(status_code=400, detail="Connector does not support add_comment")
    except Exception as e:
        logger.error(f"Failed to add Jira comment: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/transition")
async def transition_jira_issue(request: JiraTransitionRequest):
    """Transition a Jira issue to a new status."""
    org_id = request.organization_id or 1
    connector = connector_manager.get_connector(org_id, "jira")
    if not connector:
        await connector_manager.load_org_state(org_id)
        connector = connector_manager.get_connector(org_id, "jira")
        
    if not connector:
        raise HTTPException(status_code=404, detail=f"Jira connector not found for org {org_id}")
    
    try:
        if hasattr(connector, 'transition_issue'):
            success = await connector.transition_issue(request.issue_key, request.status)
            return {"success": success}
        else:
            raise HTTPException(status_code=400, detail="Connector does not support transition_issue")
    except Exception as e:
        logger.error(f"Failed to transition Jira issue: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/update")
async def update_jira_issue(request: JiraUpdateRequest):
    """Update Jira issue fields."""
    org_id = request.organization_id or 1
    connector = connector_manager.get_connector(org_id, "jira")
    if not connector:
        await connector_manager.load_org_state(org_id)
        connector = connector_manager.get_connector(org_id, "jira")
        
    if not connector:
        raise HTTPException(status_code=404, detail=f"Jira connector not found for org {org_id}")
    
    try:
        if hasattr(connector, 'update_issue'):
            success = await connector.update_issue(
                issue_key=request.issue_key,
                summary=request.summary,
                description=request.description,
                priority=request.priority,
                assignee=request.assignee,
                labels=request.labels
            )
            return {"success": success}
        else:
            raise HTTPException(status_code=400, detail="Connector does not support update_issue")
    except Exception as e:
        logger.error(f"Failed to update Jira issue: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/create")
async def create_jira_issue(request: JiraCreateRequest):
    """Create a new Jira issue."""
    org_id = request.organization_id or 1
    connector = connector_manager.get_connector(org_id, "jira")
    if not connector:
        await connector_manager.load_org_state(org_id)
        connector = connector_manager.get_connector(org_id, "jira")
        
    if not connector:
        raise HTTPException(status_code=404, detail=f"Jira connector not found for org {org_id}")
    
    try:
        if hasattr(connector, 'create_issue'):
            result = await connector.create_issue(
                project_key=request.project_key,
                summary=request.summary,
                issue_type=request.issue_type,
                description=request.description,
                assignee=request.assignee,
                priority=request.priority,
                labels=request.labels
            )
            return {"success": True, "result": result}
        else:
            raise HTTPException(status_code=400, detail="Connector does not support create_issue")
    except Exception as e:
        logger.error(f"Failed to create Jira issue: {e}")
        raise HTTPException(status_code=500, detail=str(e))
