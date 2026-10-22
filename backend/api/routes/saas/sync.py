"""
SaaS Sync Routes
Endpoints for synchronization operations
"""

from typing import Dict, Any, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from core.service_auth import caller_org

from core.saas_connectors import connector_manager, ConnectorStatus
from core.structured_logging import get_structured_logger

from .models import SyncRequest, SyncResponse

logger = get_structured_logger("saas_sync_api")

router = APIRouter()


@router.post("/connectors/{platform}/sync", response_model=SyncResponse)
async def sync_connector(platform: str, request: SyncRequest, background_tasks: BackgroundTasks, organization_id: int = Depends(caller_org)):
    """Trigger data synchronization for a connector."""
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)
        
    connector = connector_manager.get_connector(organization_id, platform)
    if not connector:
        raise HTTPException(status_code=404, detail=f"Connector for platform '{platform}' not found for org {organization_id}")

    if connector.status != ConnectorStatus.CONNECTED:
        raise HTTPException(status_code=400, detail=f"Connector for platform '{platform}' is not connected")

    background_tasks.add_task(_perform_sync_background, organization_id, platform, request)

    return SyncResponse(
        platform=platform,
        sync_type=request.sync_type,
        success=True,
        metadata={"status": "sync_started"}
    )


async def _perform_sync_background(org_id: int, platform: str, request: SyncRequest):
    """Background task to perform synchronization."""
    try:
        connector = connector_manager.get_connector(org_id, platform)
        if connector:
            result = await connector.sync_data(
                request.sync_type,
                request.since,
                **request.parameters
            )

            logger.info(f"Sync completed for {platform}: {result}")

    except Exception as e:
        logger.error(f"Sync failed for {platform}: {e}")


@router.get("/connectors/{platform}/sync/status")
async def get_sync_status(platform: str, organization_id: int = Depends(caller_org)):
    """Get the current sync status for a connector."""
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)
        
    connector = connector_manager.get_connector(organization_id, platform)
    if not connector:
        raise HTTPException(status_code=404, detail=f"Connector for platform '{platform}' not found for org {organization_id}")

    return {
        "platform": platform,
        "last_sync": connector.last_sync.isoformat() if connector.last_sync else None,
        "status": connector.status.value,
        "is_enabled": connector.config.enabled
    }


@router.get("/connectors/{platform}/health")
async def check_connector_health(platform: str, organization_id: int = Depends(caller_org)):
    """Check the health status of a connector."""
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)
        
    connector = connector_manager.get_connector(organization_id, platform)
    if not connector:
        raise HTTPException(status_code=404, detail=f"Connector for platform '{platform}' not found for org {organization_id}")

    try:
        is_healthy = await connector.validate_connection()
        return {
            "platform": platform,
            "healthy": is_healthy,
            "status": connector.status.value,
            "last_checked": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        return {
            "platform": platform,
            "healthy": False,
            "status": "error",
            "error": str(e),
            "last_checked": datetime.now(timezone.utc).isoformat()
        }


@router.post("/connectors/{platform}/reconnect")
async def reconnect_connector(platform: str, background_tasks: BackgroundTasks, organization_id: int = Depends(caller_org)):
    """Reconnect a connector that has lost connection."""
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)
        
    connector = connector_manager.get_connector(organization_id, platform)
    if not connector:
        raise HTTPException(status_code=404, detail=f"Connector for platform '{platform}' not found")

    connector.status = ConnectorStatus.DISCONNECTED
    background_tasks.add_task(connector.ensure_initialized)

    return {
        "platform": platform,
        "message": "Reconnection initiated",
        "status": "reconnecting"
    }


@router.get("/connectors/{platform}/data/{data_type}")
async def get_connector_data(platform: str, data_type: str, limit: int = 50, offset: int = 0, organization_id: int = Depends(caller_org)):
    """Get cached data from a connector (for debugging/testing)."""
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)
        
    connector = connector_manager.get_connector(organization_id, platform)
    if not connector:
        raise HTTPException(status_code=404, detail=f"Connector for platform '{platform}' not found")

    return {
        "platform": platform,
        "data_type": data_type,
        "status": connector.status.value,
        "last_sync": connector.last_sync.isoformat() if connector.last_sync else None,
        "limit": limit,
        "offset": offset,
        "note": "Data caching not implemented yet - this is for future use"
    }


@router.post("/sync-all")
async def sync_all_connectors(background_tasks: BackgroundTasks, sync_type: str = "full"):
    """Trigger synchronization for all connected connectors."""
    background_tasks.add_task(_sync_all_background, sync_type)

    return {
        "message": f"Bulk sync initiated for all connectors",
        "sync_type": sync_type
    }


async def _sync_all_background(sync_type: str):
    """Background task to sync all connectors."""
    try:
        results = await connector_manager.sync_all_connectors(sync_type)
        logger.info(f"Bulk sync completed: {results}")
    except Exception as e:
        logger.error(f"Bulk sync failed: {e}")


@router.post("/connectors/{platform}/sync-now")
async def sync_now(platform: str, request: Optional[SyncRequest] = None, organization_id: int = Depends(caller_org)):
    """Trigger an immediate sync for a platform."""
    try:
        # Ensure state is loaded
        if organization_id not in connector_manager.org_connectors:
            await connector_manager.load_org_state(organization_id)
            
        sync_type = request.sync_type if request else "projects"
        parameters = (request.parameters if request and request.parameters else {}).copy()
        
        # Only override organization_id if a valid non-None value is provided in parameters
        if "organization_id" in parameters:
            body_org_id = parameters.pop("organization_id")
            if body_org_id is not None:
                organization_id = body_org_id
            
        result = await connector_manager.sync_now(platform, sync_type=sync_type, organization_id=organization_id, **parameters)
        return {
            "message": f"{sync_type} sync initiated for {platform}",
            "result": result
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Sync failed for {platform}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/connectors/{platform}/schema")
async def get_connector_schema(platform: str, project_key: Optional[str] = None, organization_id: int = Depends(caller_org)):
    """Get field schema/metadata for a connector platform."""
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)
        
    connector = connector_manager.get_connector(organization_id, platform)
    if not connector:
        raise HTTPException(status_code=404, detail=f"Connector for platform '{platform}' not found")
    
    if platform == "jira":
        if not project_key:
            project_key = getattr(connector.config, 'project_key', None)
            
        if not project_key:
            schema = await connector.get_global_fields()
        else:
            schema = await connector.get_issue_schema(project_key)
            
        return {
            "platform": platform,
            "project_key": project_key,
            "fields": schema
        }
    
    return {
        "platform": platform,
        "fields": []
    }
