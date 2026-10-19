"""
Atlassian Sync Job
Orchestrates the synchronization of Jira and Confluence data into the Vector Memory Store.
"""

import asyncio
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone

from core.saas_connectors import connector_manager, ConnectorStatus
from core.structured_logging import get_structured_logger

logger = get_structured_logger("atlassian_sync_job")

async def execute_atlassian_sync(
    platform: str,
    organization_id: Optional[str] = None,
    **kwargs
) -> Dict[str, Any]:
    """
    Execute synchronization for an Atlassian platform (jira or confluence).
    
    Args:
        platform: 'jira' or 'confluence'
        organization_id: Context organization ID
        **kwargs: Sync parameters (project_key, space_key, limit, etc.)
        
    Returns:
        Sync result metadata
    """
    logger.info(f"Starting Atlassian sync for platform: {platform}")
    
    connector = connector_manager.get_connector(platform)
    if not connector:
        return {
            "success": False,
            "error": f"Connector for platform '{platform}' not found"
        }
        
    if connector.status != ConnectorStatus.CONNECTED:
        # Try to authenticate/initialize if not connected
        await connector.initialize()
        if not await connector.authenticate():
            return {
                "success": False,
                "error": f"Connector for platform '{platform}' is not connected and authentication failed"
            }
            
    try:
        # Trigger the knowledge_store sync type which we implemented in the connectors
        result = await connector.sync_data(
            sync_type="knowledge_store",
            organization_id=organization_id,
            **kwargs
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Atlassian sync failed for {platform}: {e}")
        return {
            "success": False,
            "error": str(e)
        }

async def run_full_atlassian_sync(organization_id: Optional[str] = None) -> Dict[str, Any]:
    """Sync all Atlassian connectors for an organization."""
    results = {}
    for platform in ["jira", "confluence"]:
        results[platform] = await execute_atlassian_sync(platform, organization_id)
        
    return results
