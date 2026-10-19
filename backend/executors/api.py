import json
import httpx
from typing import Dict, Any, Optional, Tuple
import asyncpg
from .base import BaseExecutor

class APIExecutor(BaseExecutor):
    async def execute(self, conn: asyncpg.Connection, job_id: int, job_config: Dict[str, Any], 
                      input_data: Optional[str] = None, job_tool: Optional[str] = None) -> Tuple[bool, str]:
        try:
            from runner import get_credential_secret
            url = job_config.get("url")
            method = job_config.get("method", "GET")
            headers = job_config.get("headers", {}) or {}
            body = job_config.get("body")
            auth_type = job_config.get("authType", "none")
            credential_id = job_config.get("credentialId")
            
            if auth_type != "none" and credential_id:
                api_key = await get_credential_secret(conn, credential_id)
                if api_key:
                    if auth_type == "bearer": headers["Authorization"] = f"Bearer {api_key}"
                    elif auth_type == "basic": headers["Authorization"] = f"Basic {api_key}"
            
            if body and input_data and "{{input}}" in body:
                body = body.replace("{{input}}", input_data)
            
            async with httpx.AsyncClient() as client:
                response = await client.request(method=method, url=url, headers=headers, content=body)
                output = response.text
                success = response.is_success
            
            return success, output
        except Exception as e:
            return False, str(e)
