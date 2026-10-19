import json
from typing import Dict, Any, Optional, Tuple
import asyncpg
from .base import BaseExecutor

class AtlassianSyncExecutor(BaseExecutor):
    def __init__(self, platform: str):
        self.platform = platform

    async def execute(self, conn: asyncpg.Connection, job_id: int, job_config: Dict[str, Any], 
                      input_data: Optional[str] = None, job_tool: Optional[str] = None) -> Tuple[bool, str]:
        try:
            from services.atlassian_sync_job import execute_atlassian_sync
            
            organization_id = job_config.get("organizationId")
            sync_params = {
                "project_key": job_config.get("projectKey") or job_config.get("project_key"),
                "space_key": job_config.get("spaceKey") or job_config.get("space_key"),
                "limit": job_config.get("limit", 100)
            }
            sync_params = {k: v for k, v in sync_params.items() if v is not None}
            
            result = await execute_atlassian_sync(
                platform=self.platform,
                organization_id=str(organization_id) if organization_id else None,
                **sync_params
            )
            
            return result.get("success", False), json.dumps(result, indent=2)
            
        except Exception as e:
            return False, f"Atlassian sync execution error: {str(e)}"
