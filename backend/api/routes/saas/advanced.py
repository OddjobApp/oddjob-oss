"""
SaaS Advanced Features Routes
Endpoints for bidirectional sync, event workflows, and statistics
"""

from typing import Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Query

from core.saas_connectors import (
    connector_manager, 
    ConnectorStatus,
    BidirectionalSyncConfig,
    EventDrivenWorkflow
)
from core.structured_logging import get_structured_logger

from .models import BidirectionalSyncConfigRequest, EventWorkflowRequest

logger = get_structured_logger("saas_advanced_api")

router = APIRouter()


# Bidirectional Sync Endpoints

@router.post("/connectors/{platform}/bidirectional-sync")
async def configure_bidirectional_sync(platform: str, request: BidirectionalSyncConfigRequest):
    """Configure bidirectional synchronization for a connector."""
    org_id = request.organization_id or 1 # Default to org 1 if not specified
    connector = connector_manager.get_connector(org_id, platform)
    if not connector:
        # Try to load org state if not loaded
        await connector_manager.load_org_state(org_id)
        connector = connector_manager.get_connector(org_id, platform)
        
    if not connector:
        raise HTTPException(status_code=404, detail=f"Connector for platform '{platform}' not found for org {org_id}")

    sync_config = BidirectionalSyncConfig(
        enabled=request.enabled,
        sync_interval=request.sync_interval,
        conflict_resolution=request.conflict_resolution,
        mappings=request.mappings
    )
    # Preservation of filters if sent
    if hasattr(request, 'filters'):
        sync_config.filters = request.filters

    await connector_manager.configure_bidirectional_sync(org_id, platform, sync_config)

    return {
        "platform": platform,
        "bidirectional_sync": {
            "enabled": sync_config.enabled,
            "sync_interval": sync_config.sync_interval,
            "conflict_resolution": sync_config.conflict_resolution
        }
    }


@router.get("/connectors/{platform}/bidirectional-sync")
async def get_bidirectional_sync(platform: str, organization_id: Optional[int] = Query(1)):
    """Get bidirectional synchronization configuration for a connector."""
    # Ensure state is loaded
    if organization_id not in connector_manager.org_sync_configs:
        await connector_manager.load_org_state(organization_id)
        
    org_configs = connector_manager.org_sync_configs.get(organization_id, {})
    if platform not in org_configs:
        return {"platform": platform, "enabled": False, "status": "Not Configured"}
        
    sync_config = org_configs[platform]
    return {
        "platform": platform,
        "enabled": sync_config.enabled,
        "sync_interval": sync_config.sync_interval,
        "conflict_resolution": sync_config.conflict_resolution,
        "mappings": sync_config.mappings,
        "filters": getattr(sync_config, 'filters', {}),
        "status": "active" if sync_config.enabled else "disabled"
    }


# Event Workflow Endpoints

@router.post("/connectors/{platform}/event-workflows")
async def add_event_workflow(platform: str, request: EventWorkflowRequest, organization_id: Optional[int] = Query(1)):
    """Add an event-driven workflow for a connector."""
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)

    connector = connector_manager.get_connector(organization_id, platform)
    if not connector:
        raise HTTPException(status_code=404, detail=f"Connector for platform '{platform}' not found for org {organization_id}")

    workflow = EventDrivenWorkflow(
        trigger_event=request.trigger_event,
        workflow_id=request.workflow_id,
        conditions=request.conditions,
        transformation=request.transformation,
        enabled=request.enabled
    )

    connector_manager.add_event_workflow(platform, workflow)

    return {
        "platform": platform,
        "workflow": {
            "trigger_event": workflow.trigger_event,
            "workflow_id": workflow.workflow_id,
            "enabled": workflow.enabled,
            "conditions": workflow.conditions
        }
    }


@router.get("/connectors/{platform}/event-workflows")
async def get_event_workflows(platform: str, organization_id: Optional[int] = Query(1)):
    """Get event-driven workflows for a connector."""
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)

    connector = connector_manager.get_connector(organization_id, platform)
    if not connector:
        raise HTTPException(status_code=404, detail=f"Connector for platform '{platform}' not found for org {organization_id}")

    workflows = connector_manager.event_workflows.get(platform, [])

    return {
        "platform": platform,
        "workflows": [
            {
                "trigger_event": wf.trigger_event,
                "workflow_id": wf.workflow_id,
                "enabled": wf.enabled,
                "conditions": wf.conditions,
                "transformation": wf.transformation
            }
            for wf in workflows
        ]
    }


@router.post("/connectors/{platform}/test-event-workflow")
async def test_event_workflow(platform: str, event_type: str, event_data: Dict[str, Any], organization_id: Optional[int] = Query(1)):
    """Test event workflow triggering for a connector."""
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)

    connector = connector_manager.get_connector(organization_id, platform)
    if not connector:
        raise HTTPException(status_code=404, detail=f"Connector for platform '{platform}' not found for org {organization_id}")

    try:
        triggered_workflows = await connector_manager.trigger_event_workflows(
            platform, event_type, event_data
        )

        return {
            "platform": platform,
            "event_type": event_type,
            "triggered_workflows": triggered_workflows,
            "event_data": event_data
        }

    except Exception as e:
        logger.error(f"Event workflow test failed for {platform}: {e}")
        raise HTTPException(status_code=500, detail=f"Event workflow test failed: {str(e)}")


# Monitoring and Statistics Endpoints

@router.get("/advanced-features")
async def get_advanced_features_status(organization_id: Optional[int] = Query(1)):
    """Get status of all advanced integration features."""
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)

    return connector_manager.get_advanced_features_status(organization_id)


@router.get("/monitoring/history")
async def get_sync_history():
    """Get history of recent sync operations."""
    history = await connector_manager.get_sync_history()
    return {
        "history": history,
        "count": len(history)
    }


@router.get("/stats")
async def get_saas_stats(organization_id: Optional[int] = Query(1)):
    """Get statistics about SaaS integrations."""
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)
        
    org_connectors = connector_manager.org_connectors.get(organization_id, {})
    total_connectors = len(org_connectors)
    connected_count = sum(
        1 for c in org_connectors.values()
        if c.status == ConnectorStatus.CONNECTED
    )
    error_count = sum(
        1 for c in org_connectors.values()
        if c.status == ConnectorStatus.ERROR
    )

    platforms = list(org_connectors.keys())

    advanced_features = connector_manager.get_advanced_features_status(organization_id)
    bidirectional_sync_count = sum(
        1 for config in advanced_features["bidirectional_syncs"].values()
        if config["enabled"]
    )
    event_workflow_count = sum(
        len(workflows) for workflows in advanced_features["event_workflows"].values()
    )

    return {
        "total_connectors": total_connectors,
        "connected_count": connected_count,
        "error_count": error_count,
        "platforms": platforms,
        "overall_health": "healthy" if error_count == 0 else "degraded",
        "advanced_features": {
            "bidirectional_syncs_enabled": bidirectional_sync_count,
            "event_workflows_configured": event_workflow_count,
            "active_sync_tasks": len(advanced_features["active_sync_tasks"])
        }
    }
