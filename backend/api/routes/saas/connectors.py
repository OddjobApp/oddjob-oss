"""
SaaS Connector CRUD Routes
Endpoints for managing SaaS connectors (list, get, create, delete, test)
"""

from typing import Dict, List, Any, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks, Query, Depends
from core.service_auth import caller_org

from core.saas_connectors import connector_manager, ConnectorStatus
from core.structured_logging import get_structured_logger

from .models import (
    ConnectorConfigRequest,
    ConnectorResponse,
    TestConnectionRequest
)
from core.saas_registry import SaaSConnectorRegistry

logger = get_structured_logger("saas_connectors_api")

router = APIRouter()


def _merge_credentials(org_id: int, platform: str, new_creds: Dict[str, Any]) -> None:
    """
    Merge existing credentials with new ones.
    If a secret field is empty in new_creds but exists in current connector, preserve it.
    """
    existing_connector = connector_manager.get_connector(org_id, platform)
    if not existing_connector or not existing_connector.credentials:
        return

    existing = existing_connector.credentials
    
    # Mapping of request keys to ConnectorCredentials attributes
    secret_map = {
        "api_key": "api_key",
        "password": "password",
        "client_secret": "client_secret", 
        "bot_token": "access_token",
        "access_token": "access_token",
        "refresh_token": "refresh_token"
    }

    for req_key, attr_name in secret_map.items():
        if req_key in new_creds:
            val = new_creds.get(req_key)
            if not val:
                existing_val = getattr(existing, attr_name, None)
                if existing_val:
                    new_creds[req_key] = existing_val


@router.get("/connectors", response_model=List[ConnectorResponse])
async def list_connectors(organization_id: int = Depends(caller_org)):
    """Get list of all registered connectors and their status."""
    connectors = []

    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)

    org_connectors = connector_manager.org_connectors.get(organization_id, {})
    for platform, connector in org_connectors.items():
        connectors.append(ConnectorResponse(
            platform=platform,
            status=connector.status.value,
            last_sync=connector.last_sync,
            config_name=connector.config.name,
            is_enabled=connector.config.enabled,
            base_url=connector.base_url,
            username=connector.credentials.username if connector.credentials else None,
            allowed_projects=getattr(connector.config, 'allowed_projects', None),
            error_message="Connection failed" if connector.status == ConnectorStatus.ERROR else None
        ))

    return connectors


@router.get("/connectors/{platform}", response_model=ConnectorResponse)
async def get_connector(platform: str, organization_id: int = Depends(caller_org)):
    """Get detailed information about a specific connector."""
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)
        
    connector = connector_manager.get_connector(organization_id, platform)
    if not connector:
        raise HTTPException(status_code=404, detail=f"Connector for platform '{platform}' not found")

    return ConnectorResponse(
        platform=platform,
        status=connector.status.value,
        last_sync=connector.last_sync,
        config_name=connector.config.name,
        is_enabled=connector.config.enabled,
        base_url=connector.base_url,
        username=connector.credentials.username if connector.credentials else None,
        allowed_projects=getattr(connector.config, 'allowed_projects', None),
        error_message="Connection failed" if connector.status == ConnectorStatus.ERROR else None
    )


@router.post("/connectors", response_model=ConnectorResponse)
async def create_connector(request: ConnectorConfigRequest, background_tasks: BackgroundTasks, organization_id: int = Depends(caller_org)):
    """Create and register a new SaaS connector."""
    
    org_id = organization_id
    
    # Attempt to merge credentials with existing ones (for updates)
    _merge_credentials(org_id, request.platform, request.credentials)

    # Register the connector through the registry factory
    factory = SaaSConnectorRegistry.get_factory(request.platform)
    if not factory:
        raise HTTPException(status_code=400, detail=f"Unsupported platform: {request.platform}")

    try:
        if request.platform in ["jira", "confluence"]:
            connector = factory(
                request.credentials.get("base_url") or request.config.get("base_url") or "",
                request.credentials.get("api_key"),
                request.credentials.get("username"),
                request.credentials.get("password"),
                request.config
            )
        elif request.platform == "slack":
            connector = factory(
                request.credentials.get("access_token") or request.credentials.get("bot_token"),
                request.config
            )
        elif request.platform == "teams":
            connector = factory(
                request.credentials.get("client_id"),
                request.credentials.get("client_secret"),
                request.credentials.get("tenant_id"),
                request.credentials.get("access_token"),
                request.credentials.get("refresh_token"),
                request.config
            )
        elif request.platform == "github":
            connector = factory(
                request.credentials.get("access_token"),
                request.config
            )
        else:
            raise HTTPException(status_code=400, detail=f"Factory logic not implemented for platform: {request.platform}")
    except Exception as e:
        logger.error(f"Error instantiating {request.platform} connector: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to initialize connector: {str(e)}")

    # Register the connector
    await connector_manager.register_connector(org_id, connector)

    # Initialize in background
    background_tasks.add_task(connector.ensure_initialized)

    logger.info(f"Created/Updated connector for platform: {request.platform}")

    return ConnectorResponse(
        platform=request.platform,
        status=connector.status.value,
        last_sync=connector.last_sync,
        config_name=connector.config.name,
        is_enabled=connector.config.enabled,
        base_url=connector.base_url,
        username=connector.credentials.username if connector.credentials else None,
        allowed_projects=getattr(connector.config, 'allowed_projects', None)
    )


@router.post("/connectors/{platform}/test")
async def test_connection(platform: str, request: TestConnectionRequest, organization_id: int = Depends(caller_org)):
    """Test connection with provided credentials."""
    logger.info(f"Testing connection for platform: {platform}")
    
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)

    # Never the credentials: only which fields arrived.
    logger.debug(f"Request fields: {sorted(k for k, v in request.dict().items() if v is not None)}")
    try:
        test_creds = {
            "base_url": request.base_url,
            "api_key": request.api_token,
            "username": request.username,
            "password": request.password,
            "client_id": request.client_id,
            "client_secret": request.client_secret,
            "tenant_id": request.tenant_id,
            "bot_token": request.bot_token,
            "access_token": request.access_token,
            "refresh_token": request.refresh_token
        }
        
        _merge_credentials(organization_id, platform, test_creds)
        
        factory = SaaSConnectorRegistry.get_factory(platform)
        if not factory:
            raise HTTPException(status_code=400, detail=f"Unsupported platform: {platform}")

        if platform == "slack":
            connector = factory(
                test_creds.get("bot_token"),
                request.config
            )
        elif platform == "github":
            connector = factory(
                test_creds.get("access_token"),
                {"name": "github_test", **(request.config or {})}
            )
        elif platform in ["jira", "confluence"]:
            connector = factory(
                test_creds.get("base_url") or "",
                test_creds.get("api_key"),
                test_creds.get("username"),
                test_creds.get("password"),
                request.config
            )
        elif platform == "teams":
            connector = factory(
                test_creds.get("client_id"),
                test_creds.get("client_secret"),
                test_creds.get("tenant_id"),
                test_creds.get("access_token"),
                test_creds.get("refresh_token"),
                request.config
            )
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported platform: {platform}")

        is_valid, validation_msg = await connector.validate_connection()
        
        try:
            await connector.shutdown()
        except:
            pass
            
        if is_valid:
            return {"success": True, "message": validation_msg or f"Successfully connected to {platform}"}
        else:
            raise HTTPException(status_code=400, detail=validation_msg or f"Failed to connect to {platform}. Please check credentials and URL.")
            
    except HTTPException:
        # Re-raise HTTP exceptions from the block above
        raise
    except Exception as e:
        logger.error(f"Connection test failed for {platform}: {e}", exc_info=True)
        # Avoid redundant wrapping if the string already looks like an error
        err_msg = str(e)
        if not err_msg.startswith("Connection failed"):
            err_msg = f"Connection failed: {err_msg}"
        raise HTTPException(status_code=400, detail=err_msg)


@router.delete("/connectors/{platform}")
async def delete_connector(platform: str, organization_id: int = Depends(caller_org)):
    """Remove a connector."""
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)
        
    org_connectors = connector_manager.org_connectors.get(organization_id, {})
    if platform.lower() not in org_connectors:
        raise HTTPException(status_code=404, detail=f"Connector for platform '{platform}' not found for org {organization_id}")

    await connector_manager.unregister_connector(organization_id, platform)

    logger.info(f"Deleted connector for platform: {platform}")
    return {"message": f"Connector for platform '{platform}' deleted successfully"}
@router.post("/connectors/{platform}/discover/{resource}")
async def discover_resource(
    platform: str, 
    resource: str, 
    request: TestConnectionRequest, 
    organization_id: int = Depends(caller_org)
):
    """Discover platform resources (spaces, projects, etc) with provided credentials."""
    logger.info(f"Discovering {resource} for platform: {platform}")
    
    try:
        test_creds = {
            "base_url": request.base_url,
            "api_key": request.api_token,
            "username": request.username,
            "password": request.password,
            "bot_token": request.bot_token,
            "access_token": request.access_token
        }
        
        factory = SaaSConnectorRegistry.get_factory(platform)
        if not factory:
            raise HTTPException(status_code=400, detail=f"Unsupported platform: {platform}")

        # Instantiate connector for discovery
        if platform in ["jira", "confluence"]:
            connector = factory(
                test_creds.get("base_url") or "",
                test_creds.get("api_key"),
                test_creds.get("username"),
                test_creds.get("password"),
                request.config
            )
        else:
            raise HTTPException(status_code=400, detail=f"Discovery not supported for {platform}")

        results = []
        if platform == "confluence" and resource == "spaces":
            results = await connector.get_spaces()
        elif platform == "jira" and resource == "projects":
            results = await connector.get_projects()
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported discovery resource: {resource}")

        try:
            await connector.shutdown()
        except:
            pass
            
        return {"results": results}
            
    except Exception as e:
        logger.error(f"Discovery failed for {platform}/{resource}: {e}")
        raise HTTPException(status_code=400, detail=f"Discovery failed: {str(e)}")


@router.get("/connectors/{platform}/schema")
async def get_connector_schema(
    platform: str, 
    project_key: Optional[str] = Query(None),
    organization_id: int = Depends(caller_org)
):
    """Get field schema for a platform (e.g., Jira issue fields for a project)."""
    logger.info(f"Fetching schema for platform: {platform}, Project: {project_key}")
    
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)
        
    connector = connector_manager.get_connector(organization_id, platform)
    if not connector:
        raise HTTPException(status_code=404, detail=f"Connector for platform '{platform}' not found")

    try:
        if platform == "jira":
            if not project_key:
                # Fallback to global fields if no project key provided
                fields = await connector.get_global_fields()
            else:
                fields = await connector.get_issue_schema(project_key)
            return {"platform": platform, "fields": fields}
        else:
            raise HTTPException(status_code=400, detail=f"Schema discovery not supported for {platform}")
    except Exception as e:
        logger.error(f"Schema discovery failed for {platform}: {e}")
        raise HTTPException(status_code=500, detail=f"Schema discovery failed: {str(e)}")
